import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Checkin,
  Database,
  EventRow,
  OrganizerSetCheckoutResult,
  Profile,
  QrScanCheckinResult,
  RefreshCheckinTokenResult,
  RoleRow,
  Shift,
  Signup,
  ValidateCheckinTokenResult,
} from "@/lib/supabase/database.types";
import {
  calculateRunningTotalHours,
  calculateShiftHours,
  checkShiftWindow,
} from "./hours";
import { generateCheckinToken, isValidCheckinToken } from "./qr";
import { buildWhosHereRoster, type WhosHereEntry } from "./roster";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveEventByIdOrSlug(
  supabase: SupabaseClient<Database>,
  idOrSlug: string,
): Promise<EventRow | null> {
  const trimmed = idOrSlug.trim();
  if (!trimmed) return null;

  const query = supabase.from("events").select("*");
  const { data } = UUID_RE.test(trimmed)
    ? await query.eq("id", trimmed).maybeSingle()
    : await query.eq("slug", trimmed).maybeSingle();

  return (data as EventRow | null) ?? null;
}

export async function validateEventCheckinToken(
  supabase: SupabaseClient<Database>,
  eventIdOrSlug: string,
  token: string | null | undefined,
): Promise<ValidateCheckinTokenResult & { event?: EventRow }> {
  const event = await resolveEventByIdOrSlug(supabase, eventIdOrSlug);
  if (!event) {
    return { valid: false, code: "not_found" };
  }

  if (!isValidCheckinToken(token, event.checkin_token)) {
    return {
      valid: false,
      code: "invalid_token",
      event_id: event.id,
      event_title: event.title,
      event_slug: event.slug,
      timezone: event.timezone,
      event,
    };
  }

  return {
    valid: true,
    code: "ok",
    event_id: event.id,
    event_title: event.title,
    event_slug: event.slug,
    timezone: event.timezone,
    event,
  };
}

async function computeVolunteerRunningTotalHours(
  supabase: SupabaseClient<Database>,
  volunteerId: string,
): Promise<number> {
  const { data: mySignups } = await supabase
    .from("signups")
    .select("id")
    .eq("volunteer_id", volunteerId);

  const signupIds = ((mySignups ?? []) as Array<{ id: string }>).map((s) => s.id);
  if (signupIds.length === 0) return 0;

  const { data: allCheckins } = await supabase
    .from("checkins")
    .select("signup_id, kind, at")
    .in("signup_id", signupIds);

  const rows = (allCheckins ?? []) as Array<{
    signup_id: string;
    kind: "in" | "out";
    at: string;
  }>;

  const inBySignup = new Map<string, string>();
  const outBySignup = new Map<string, string>();

  for (const r of rows) {
    if (r.kind === "in" && !inBySignup.has(r.signup_id)) {
      inBySignup.set(r.signup_id, r.at);
    } else if (r.kind === "out") {
      outBySignup.set(r.signup_id, r.at);
    }
  }

  const pairs = signupIds.map((id) => ({
    checkedInAt: inBySignup.get(id) ?? null,
    checkedOutAt: outBySignup.get(id) ?? null,
  }));

  return calculateRunningTotalHours(pairs);
}

/**
 * Processes a volunteer QR check-in or check-out scan on `/checkin/[eventId]`.
 *
 * Strictly enforces:
 * - Token validation against `event.checkin_token`
 * - Confirmed signup check (`not_signed_up` if none)
 * - [-30 min, +30 min] window around shift start (`outside_window` if outside)
 * - Idempotent check-in and check-out (never duplicates `'in'` or `'out'` rows)
 * - Server-side hour calculation from timestamps only (to 2 decimals)
 */
export async function processVolunteerCheckinScan(
  supabase: SupabaseClient<Database>,
  userId: string | null | undefined,
  eventIdOrSlug: string,
  token: string | null | undefined,
  now: Date = new Date(),
): Promise<QrScanCheckinResult> {
  if (!userId) {
    return { code: "unauthenticated" };
  }

  const validation = await validateEventCheckinToken(
    supabase,
    eventIdOrSlug,
    token,
  );

  if (validation.code === "not_found" || !validation.event) {
    return { code: "not_found" };
  }

  const event = validation.event;

  if (!validation.valid) {
    return {
      code: "invalid_token",
      event_id: event.id,
      event_title: event.title,
      event_slug: event.slug,
      timezone: event.timezone,
    };
  }

  // Load roles & shifts for this event
  const { data: roleData } = await supabase
    .from("roles")
    .select("id, name, position")
    .eq("event_id", event.id);

  const roles = (roleData ?? []) as Pick<RoleRow, "id" | "name" | "position">[];
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const roleIds = roles.map((r) => r.id);

  if (roleIds.length === 0) {
    return {
      code: "not_signed_up",
      event_id: event.id,
      event_title: event.title,
      event_slug: event.slug,
      timezone: event.timezone,
    };
  }

  const { data: shiftData } = await supabase
    .from("shifts")
    .select("id, role_id, starts_at, ends_at")
    .in("role_id", roleIds);

  const shifts = (shiftData ?? []) as Pick<
    Shift,
    "id" | "role_id" | "starts_at" | "ends_at"
  >[];
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const shiftIds = shifts.map((s) => s.id);

  if (shiftIds.length === 0) {
    return {
      code: "not_signed_up",
      event_id: event.id,
      event_title: event.title,
      event_slug: event.slug,
      timezone: event.timezone,
    };
  }

  // Load this volunteer's confirmed/pending signups on this event
  const { data: signupData } = await supabase
    .from("signups")
    .select("id, shift_id, volunteer_id, status")
    .eq("volunteer_id", userId)
    .in("shift_id", shiftIds);

  const activeSignups = (
    (signupData ?? []) as Pick<
      Signup,
      "id" | "shift_id" | "volunteer_id" | "status"
    >[]
  ).filter((sg) => sg.status === "confirmed" || sg.status === "pending");

  if (activeSignups.length === 0) {
    return {
      code: "not_signed_up",
      event_id: event.id,
      event_title: event.title,
      event_slug: event.slug,
      timezone: event.timezone,
    };
  }

  const signupIds = activeSignups.map((sg) => sg.id);
  const { data: checkinData } = await supabase
    .from("checkins")
    .select("id, signup_id, kind, at, verified, method, adjusted_by_organizer")
    .in("signup_id", signupIds);

  const checkins = (checkinData ?? []) as Checkin[];
  const inBySignup = new Map<string, Checkin>();
  const outBySignup = new Map<string, Checkin>();

  for (const c of checkins) {
    if (c.kind === "in" && !inBySignup.has(c.signup_id)) {
      inBySignup.set(c.signup_id, c);
    } else if (c.kind === "out" && !outBySignup.has(c.signup_id)) {
      outBySignup.set(c.signup_id, c);
    }
  }

  // Enrich signups with shift & role details, ordered by shift start time
  const enriched = activeSignups
    .map((sg) => {
      const shift = shiftById.get(sg.shift_id);
      const role = shift ? roleById.get(shift.role_id) : undefined;
      if (!shift || !role) return null;
      return {
        signup: sg,
        shift,
        role,
        checkinIn: inBySignup.get(sg.id) ?? null,
        checkinOut: outBySignup.get(sg.id) ?? null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort(
      (a, b) =>
        new Date(a.shift.starts_at).getTime() -
        new Date(b.shift.starts_at).getTime(),
    );

  // Case 1: Already checked in (has 'in', no 'out') -> Check them out!
  const currentlyCheckedIn = enriched.find(
    (item) => item.checkinIn !== null && item.checkinOut === null,
  );

  if (currentlyCheckedIn && currentlyCheckedIn.checkinIn) {
    const nowIso = now.toISOString();
    // Ensure checkout timestamp is at least 1s after checkin timestamp
    const inMs = new Date(currentlyCheckedIn.checkinIn.at).getTime();
    const outIso =
      now.getTime() > inMs ? nowIso : new Date(inMs + 1000).toISOString();

    // Idempotent insert: check if an 'out' row was already inserted concurrently
    const { data: existingOut } = await supabase
      .from("checkins")
      .select("id, at")
      .eq("signup_id", currentlyCheckedIn.signup.id)
      .eq("kind", "out")
      .maybeSingle();

    let finalOutIso = (existingOut as { at: string } | null)?.at ?? outIso;

    if (!existingOut) {
      const { data: insertedOut } = await supabase
        .from("checkins")
        .insert({
          signup_id: currentlyCheckedIn.signup.id,
          kind: "out",
          at: outIso,
          method: "qr",
        })
        .select("at")
        .maybeSingle();

      if (insertedOut && (insertedOut as { at?: string }).at) {
        finalOutIso = (insertedOut as { at: string }).at;
      }
    }

    const shiftHours = calculateShiftHours(
      currentlyCheckedIn.checkinIn.at,
      finalOutIso,
    );
    const totalHours = await computeVolunteerRunningTotalHours(
      supabase,
      userId,
    );

    return {
      code: "checked_out",
      signup_id: currentlyCheckedIn.signup.id,
      role_name: currentlyCheckedIn.role.name,
      event_id: event.id,
      event_title: event.title,
      event_slug: event.slug,
      timezone: event.timezone,
      shift_starts_at: currentlyCheckedIn.shift.starts_at,
      shift_ends_at: currentlyCheckedIn.shift.ends_at,
      checked_in_at: currentlyCheckedIn.checkinIn.at,
      checked_out_at: finalOutIso,
      shift_hours: shiftHours,
      total_hours: Math.max(shiftHours, totalHours),
    };
  }

  // Case 2: Has a confirmed shift within [-30 min, +30 min] of start and not checked in -> Check in!
  const eligibleToCheckIn = enriched.find(
    (item) =>
      item.checkinIn === null &&
      checkShiftWindow(item.shift.starts_at, now).allowed,
  );

  if (eligibleToCheckIn) {
    const nowIso = now.toISOString();

    const { data: existingIn } = await supabase
      .from("checkins")
      .select("id, at")
      .eq("signup_id", eligibleToCheckIn.signup.id)
      .eq("kind", "in")
      .maybeSingle();

    let finalInIso = (existingIn as { at: string } | null)?.at ?? nowIso;

    if (!existingIn) {
      const { data: insertedIn } = await supabase
        .from("checkins")
        .insert({
          signup_id: eligibleToCheckIn.signup.id,
          kind: "in",
          at: nowIso,
          method: "qr",
        })
        .select("at")
        .maybeSingle();

      if (insertedIn && (insertedIn as { at?: string }).at) {
        finalInIso = (insertedIn as { at: string }).at;
      }
    }

    return {
      code: "checked_in",
      signup_id: eligibleToCheckIn.signup.id,
      role_name: eligibleToCheckIn.role.name,
      event_id: event.id,
      event_title: event.title,
      event_slug: event.slug,
      timezone: event.timezone,
      shift_starts_at: eligibleToCheckIn.shift.starts_at,
      shift_ends_at: eligibleToCheckIn.shift.ends_at,
      checked_in_at: finalInIso,
    };
  }

  // Case 3: Has an un-checked-in shift, but outside the [-30 min, +30 min] window
  const uncheckedShifts = enriched.filter((item) => item.checkinIn === null);
  if (uncheckedShifts.length > 0) {
    // Pick the shift closest to `now`
    const closest = [...uncheckedShifts].sort(
      (a, b) =>
        Math.abs(new Date(a.shift.starts_at).getTime() - now.getTime()) -
        Math.abs(new Date(b.shift.starts_at).getTime() - now.getTime()),
    )[0];

    const windowCheck = checkShiftWindow(closest.shift.starts_at, now);

    const { data: orgProfile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", event.organizer_id)
      .maybeSingle();

    const organizer = (orgProfile as Pick<
      Profile,
      "full_name" | "email"
    > | null) ?? { full_name: null, email: null };

    return {
      code: "outside_window",
      signup_id: closest.signup.id,
      role_name: closest.role.name,
      event_id: event.id,
      event_title: event.title,
      event_slug: event.slug,
      timezone: event.timezone,
      shift_starts_at: closest.shift.starts_at,
      shift_ends_at: closest.shift.ends_at,
      window_opens_at: windowCheck.windowOpensAt.toISOString(),
      window_closes_at: windowCheck.windowClosesAt.toISOString(),
      organizer_name: organizer.full_name,
      organizer_email: organizer.email,
    };
  }

  // Case 4: All shifts on this event are already checked in and checked out (idempotent)
  const lastCompleted = enriched[enriched.length - 1];
  const shiftHours = calculateShiftHours(
    lastCompleted.checkinIn?.at,
    lastCompleted.checkinOut?.at,
  );
  const totalHours = await computeVolunteerRunningTotalHours(supabase, userId);

  return {
    code: "already_checked_out",
    signup_id: lastCompleted.signup.id,
    role_name: lastCompleted.role.name,
    event_id: event.id,
    event_title: event.title,
    event_slug: event.slug,
    timezone: event.timezone,
    shift_starts_at: lastCompleted.shift.starts_at,
    shift_ends_at: lastCompleted.shift.ends_at,
    checked_in_at: lastCompleted.checkinIn?.at,
    checked_out_at: lastCompleted.checkinOut?.at,
    shift_hours: shiftHours,
    total_hours: Math.max(shiftHours, totalHours),
  };
}

/**
 * Rotates an event's QR check-in token so old QR codes can no longer be used.
 */
export async function refreshEventQrToken(
  supabase: SupabaseClient<Database>,
  userId: string | null | undefined,
  eventId: string,
): Promise<RefreshCheckinTokenResult> {
  if (!userId) return { code: "unauthenticated" };

  const { data: eventData } = await supabase
    .from("events")
    .select("id, organizer_id")
    .eq("id", eventId)
    .maybeSingle();

  const event = eventData as Pick<EventRow, "id" | "organizer_id"> | null;
  if (!event) return { code: "not_found" };
  if (event.organizer_id !== userId) return { code: "forbidden" };

  const newToken = generateCheckinToken();

  const { error } = await supabase
    .from("events")
    .update({ checkin_token: newToken })
    .eq("id", eventId);

  if (error) {
    return { code: "forbidden" };
  }

  return { code: "refreshed", token: newToken };
}

/**
 * Organizer manually sets or adjusts a volunteer's check-out time when they
 * forgot to check out, flagging the record `"adjusted by organizer"`.
 */
export async function setOrganizerManualCheckout(
  supabase: SupabaseClient<Database>,
  userId: string | null | undefined,
  signupId: string,
  checkoutIso: string,
): Promise<OrganizerSetCheckoutResult> {
  if (!userId) return { code: "unauthenticated" };

  const { data: signupData } = await supabase
    .from("signups")
    .select("id, shift_id")
    .eq("id", signupId)
    .maybeSingle();

  const signup = signupData as Pick<Signup, "id" | "shift_id"> | null;
  if (!signup) return { code: "not_found" };

  const { data: shiftData } = await supabase
    .from("shifts")
    .select("id, role_id")
    .eq("id", signup.shift_id)
    .maybeSingle();

  const shift = shiftData as Pick<Shift, "id" | "role_id"> | null;
  if (!shift) return { code: "not_found" };

  const { data: roleData } = await supabase
    .from("roles")
    .select("id, event_id")
    .eq("id", shift.role_id)
    .maybeSingle();

  const role = roleData as Pick<RoleRow, "id" | "event_id"> | null;
  if (!role) return { code: "not_found" };

  const { data: eventData } = await supabase
    .from("events")
    .select("id, organizer_id")
    .eq("id", role.event_id)
    .maybeSingle();

  const event = eventData as Pick<EventRow, "id" | "organizer_id"> | null;
  if (!event) return { code: "not_found" };
  if (event.organizer_id !== userId) return { code: "forbidden" };

  const { data: inData } = await supabase
    .from("checkins")
    .select("id, at")
    .eq("signup_id", signupId)
    .eq("kind", "in")
    .maybeSingle();

  const checkinIn = inData as Pick<Checkin, "id" | "at"> | null;
  if (!checkinIn) return { code: "not_checked_in" };

  const inMs = new Date(checkinIn.at).getTime();
  const outMs = new Date(checkoutIso).getTime();
  if (Number.isNaN(outMs) || outMs <= inMs) {
    return { code: "invalid_time" };
  }

  const nowIso = new Date().toISOString();

  const { data: existingOut } = await supabase
    .from("checkins")
    .select("id")
    .eq("signup_id", signupId)
    .eq("kind", "out")
    .maybeSingle();

  if (existingOut) {
    await supabase
      .from("checkins")
      .update({
        at: checkoutIso,
        method: "organizer_adjusted",
        adjusted_by_organizer: true,
        verified: true,
        verified_by: userId,
        verified_at: nowIso,
      })
      .eq("id", (existingOut as { id: string }).id);
  } else {
    const { data: insertedOut } = await supabase
      .from("checkins")
      .insert({
        signup_id: signupId,
        kind: "out",
        at: checkoutIso,
        method: "organizer_adjusted",
        adjusted_by_organizer: true,
      })
      .select("id")
      .maybeSingle();

    if (insertedOut && (insertedOut as { id?: string }).id) {
      await supabase
        .from("checkins")
        .update({
          verified: true,
          verified_by: userId,
          verified_at: nowIso,
        })
        .eq("id", (insertedOut as { id: string }).id);
    }
  }

  await supabase
    .from("checkins")
    .update({
      verified: true,
      verified_by: userId,
      verified_at: nowIso,
    })
    .eq("id", checkinIn.id);

  const shiftHours = calculateShiftHours(checkinIn.at, checkoutIso);

  return {
    code: "adjusted",
    signup_id: signupId,
    checked_in_at: checkinIn.at,
    checked_out_at: checkoutIso,
    shift_hours: shiftHours,
    adjusted_by_organizer: true,
  };
}

/**
 * Loads the live "Who's here" roster for an organizer's event.
 */
export async function loadOrganizerEventRoster(
  supabase: SupabaseClient<Database>,
  eventId: string,
): Promise<WhosHereEntry[]> {
  const { data: roleData } = await supabase
    .from("roles")
    .select("id, name, position")
    .eq("event_id", eventId)
    .order("position", { ascending: true });

  const roles = (roleData ?? []) as Pick<RoleRow, "id" | "name" | "position">[];
  const roleIds = roles.map((r) => r.id);
  if (roleIds.length === 0) return [];

  const { data: shiftData } = await supabase
    .from("shifts")
    .select("id, role_id, starts_at, ends_at")
    .in("role_id", roleIds)
    .order("starts_at", { ascending: true });

  const shifts = (shiftData ?? []) as Pick<
    Shift,
    "id" | "role_id" | "starts_at" | "ends_at"
  >[];
  const shiftIds = shifts.map((s) => s.id);
  if (shiftIds.length === 0) return [];

  const { data: signupData } = await supabase
    .from("signups")
    .select("id, shift_id, volunteer_id, status")
    .in("shift_id", shiftIds);

  const signups = (
    (signupData ?? []) as Pick<
      Signup,
      "id" | "shift_id" | "volunteer_id" | "status"
    >[]
  ).filter((sg) => sg.status === "confirmed" || sg.status === "pending");

  if (signups.length === 0) return [];

  const volunteerIds = Array.from(new Set(signups.map((sg) => sg.volunteer_id)));
  const signupIds = signups.map((sg) => sg.id);

  const [{ data: profileData }, { data: checkinData }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", volunteerIds),
    supabase
      .from("checkins")
      .select("id, signup_id, kind, at, verified, method, adjusted_by_organizer")
      .in("signup_id", signupIds),
  ]);

  const profiles = (profileData ?? []) as Pick<
    Profile,
    "id" | "full_name" | "email"
  >[];
  const checkins = (checkinData ?? []) as Checkin[];

  return buildWhosHereRoster({
    roles,
    shifts,
    signups,
    profiles,
    checkins,
  });
}
