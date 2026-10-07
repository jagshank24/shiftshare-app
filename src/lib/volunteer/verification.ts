import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Checkin,
  Database,
  EventRow,
  Profile,
  RoleRow,
  Shift,
  Signup,
  VerifyCertificateEventRow,
  VerifyCertificateResult,
} from "@/lib/supabase/database.types";
import {
  calculateRunningTotalHours,
  calculateShiftHours,
} from "@/lib/checkin/hours";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deterministic fallback verification code derived from a volunteer's UUID
 * when `profiles.verification_code` is not yet populated.
 */
export function deriveDefaultVerificationCode(volunteerId: string): string {
  const clean = volunteerId.replace(/-/g, "").toUpperCase();
  const head = clean.slice(0, 6);
  const tail = clean.slice(-4);
  return `SS-${head}${tail}`;
}

/**
 * Builds the verification code for either a full-profile certificate or a
 * single-event certificate (`<baseCode>--<eventId>`).
 */
export function formatCertificateVerificationCode(
  baseCode: string,
  eventId?: string | null,
): string {
  const normalizedBase = baseCode.trim().toUpperCase();
  if (!eventId || !eventId.trim()) return normalizedBase;
  return `${normalizedBase}--${eventId.trim()}`;
}

export function parseVerificationCode(rawCode: string | null | undefined): {
  validFormat: boolean;
  baseCode: string;
  eventId: string | null;
} {
  const trimmed = (rawCode ?? "").trim();
  if (trimmed.length < 4 || !/^SS-[A-Z0-9]{4,}/i.test(trimmed)) {
    return { validFormat: false, baseCode: "", eventId: null };
  }

  if (trimmed.includes("--")) {
    const [base, eventPart, ...rest] = trimmed.split("--");
    if (rest.length > 0 || !UUID_RE.test(eventPart)) {
      return { validFormat: false, baseCode: "", eventId: null };
    }
    return {
      validFormat: true,
      baseCode: base.toUpperCase(),
      eventId: eventPart,
    };
  }

  return {
    validFormat: true,
    baseCode: trimmed.toUpperCase(),
    eventId: null,
  };
}

export function buildVerifyPath(code: string): string {
  return `/verify/${encodeURIComponent(code.trim())}`;
}

export function buildVerifyUrl(code: string, origin?: string | null): string {
  const path = buildVerifyPath(code);
  const base = (origin ?? "").trim().replace(/\/$/, "");
  if (!base) return path;
  return `${base}${path}`;
}

/**
 * Resolves a public verification code (`/verify/[code]`) without requiring login.
 */
export async function resolveCertificateByVerificationCode(
  supabase: SupabaseClient<Database>,
  rawCode: string,
): Promise<VerifyCertificateResult> {
  const parsed = parseVerificationCode(rawCode);
  if (!parsed.validFormat) {
    return { valid: false, code: "invalid_code" };
  }

  // First try the security-definer RPC if available
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "verify_volunteer_certificate",
      { p_code: rawCode.trim() },
    );
    if (
      !rpcError &&
      rpcData &&
      typeof rpcData === "object" &&
      "valid" in rpcData &&
      (rpcData as VerifyCertificateResult).valid
    ) {
      return rpcData as VerifyCertificateResult;
    }
  } catch {
    // Fall through to table resolution
  }

  // Table-level resolution (works with mock Supabase / PostgREST or when RPC is not installed)
  const { data: profilesData } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, verification_code");

  const profiles = (profilesData ?? []) as Profile[];
  const matchedProfile = profiles.find((p) => {
    const stored = p.verification_code?.trim().toUpperCase();
    const derived = deriveDefaultVerificationCode(p.id);
    return stored === parsed.baseCode || derived === parsed.baseCode;
  });

  if (!matchedProfile) {
    return { valid: false, code: "invalid_code" };
  }

  const profileById = new Map(profiles.map((p) => [p.id, p]));

  const { data: signupData } = await supabase
    .from("signups")
    .select("id, shift_id, volunteer_id, status")
    .eq("volunteer_id", matchedProfile.id);

  const signups = ((signupData ?? []) as Signup[]).filter(
    (sg) => sg.status === "confirmed" || sg.status === "pending",
  );

  if (signups.length === 0) {
    if (parsed.eventId) {
      return { valid: false, code: "invalid_code" };
    }
    return {
      valid: true,
      code: rawCode.trim(),
      verification_code:
        matchedProfile.verification_code ??
        deriveDefaultVerificationCode(matchedProfile.id),
      volunteer_id: matchedProfile.id,
      volunteer_name:
        matchedProfile.full_name?.trim() ||
        matchedProfile.email?.split("@")[0] ||
        "Volunteer",
      total_hours: 0,
      events: [],
    };
  }

  const signupIds = signups.map((s) => s.id);
  const shiftIds = Array.from(new Set(signups.map((s) => s.shift_id)));

  const [{ data: checkinData }, { data: shiftData }] = await Promise.all([
    supabase
      .from("checkins")
      .select("id, signup_id, kind, at, verified, method, adjusted_by_organizer")
      .in("signup_id", signupIds),
    supabase
      .from("shifts")
      .select("id, role_id, starts_at, ends_at")
      .in("id", shiftIds),
  ]);

  const checkins = (checkinData ?? []) as Checkin[];
  const shifts = (shiftData ?? []) as Shift[];
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  const roleIds = Array.from(new Set(shifts.map((s) => s.role_id)));
  const { data: roleData } =
    roleIds.length > 0
      ? await supabase
          .from("roles")
          .select("id, event_id, name")
          .in("id", roleIds)
      : { data: [] as RoleRow[] };

  const roles = (roleData ?? []) as RoleRow[];
  const roleById = new Map(roles.map((r) => [r.id, r]));

  const eventIds = Array.from(new Set(roles.map((r) => r.event_id)));
  const { data: eventData } =
    eventIds.length > 0
      ? await supabase
          .from("events")
          .select("id, organizer_id, title, starts_at, timezone")
          .in("id", eventIds)
      : { data: [] as EventRow[] };

  const events = (eventData ?? []) as EventRow[];
  const eventById = new Map(events.map((e) => [e.id, e]));

  const inBySignup = new Map<string, Checkin>();
  const outBySignup = new Map<string, Checkin>();

  for (const c of checkins) {
    if (c.kind === "in" && !inBySignup.has(c.signup_id)) {
      inBySignup.set(c.signup_id, c);
    } else if (c.kind === "out") {
      outBySignup.set(c.signup_id, c);
    }
  }

  const eventRows: (VerifyCertificateEventRow & { shiftStartsAt: string })[] = [];
  const hourPairs: Array<{ checkedInAt: string; checkedOutAt: string }> = [];

  for (const sg of signups) {
    const inRow = inBySignup.get(sg.id);
    const outRow = outBySignup.get(sg.id);
    if (!inRow || !outRow) continue;

    const shift = shiftById.get(sg.shift_id);
    if (!shift) continue;
    const role = roleById.get(shift.role_id);
    if (!role) continue;
    const event = eventById.get(role.event_id);
    if (!event) continue;

    if (parsed.eventId && event.id !== parsed.eventId) continue;

    const hours = calculateShiftHours(inRow.at, outRow.at);
    if (hours <= 0) continue;

    const orgProfile = profileById.get(event.organizer_id);
    const organizerName =
      orgProfile?.full_name?.trim() ||
      orgProfile?.email?.split("@")[0] ||
      "Event Organizer";

    eventRows.push({
      event_id: event.id,
      event_title: event.title,
      event_date: event.starts_at,
      timezone: event.timezone || "UTC",
      organizer_name: organizerName,
      role_name: role.name,
      hours,
      shiftStartsAt: shift.starts_at,
    });
    hourPairs.push({ checkedInAt: inRow.at, checkedOutAt: outRow.at });
  }

  if (parsed.eventId && eventRows.length === 0) {
    return { valid: false, code: "invalid_code" };
  }

  eventRows.sort(
    (a, b) =>
      new Date(b.shiftStartsAt).getTime() - new Date(a.shiftStartsAt).getTime(),
  );

  const totalHours = calculateRunningTotalHours(hourPairs);

  return {
    valid: true,
    code: rawCode.trim(),
    verification_code:
      matchedProfile.verification_code ??
      deriveDefaultVerificationCode(matchedProfile.id),
    volunteer_id: matchedProfile.id,
    volunteer_name:
      matchedProfile.full_name?.trim() ||
      matchedProfile.email?.split("@")[0] ||
      "Volunteer",
    total_hours: totalHours,
    events: eventRows.map((row) => ({
      event_id: row.event_id,
      event_title: row.event_title,
      event_date: row.event_date,
      timezone: row.timezone,
      organizer_name: row.organizer_name,
      role_name: row.role_name,
      hours: row.hours,
    })),
  };
}
