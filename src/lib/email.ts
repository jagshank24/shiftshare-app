import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  eventDayWithYear,
  eventTimeRange,
  eventZoneLabel,
  safeZone,
} from "@/lib/events/format";
import { siteUrl } from "@/lib/supabase/env";
import type {
  Database,
  EventRow,
  Profile,
  RoleRow,
  Shift,
  Signup,
  SignupResult,
} from "@/lib/supabase/database.types";

if (typeof window !== "undefined") {
  throw new Error(
    "lib/email.ts is a server-only module and must never be imported in client components.",
  );
}

export const DEFAULT_EMAIL_FROM = "ShiftShare <onboarding@resend.dev>";

export type SendEmailPayload = {
  from: string;
  to: string;
  subject: string;
  html: string;
};

export type SendEmailResult = {
  ok: boolean;
  id?: string;
  skipped?: boolean;
  error?: string;
};

type EmailTransport = (
  payload: SendEmailPayload,
) => Promise<{ id?: string; error?: string }>;

let customTransportForTests: EmailTransport | null = null;

/**
 * Allows unit tests to intercept outgoing emails without making real network
 * calls to the Resend API. Pass `null` to restore default Resend behavior.
 */
export function setEmailTransportForTests(
  transport: EmailTransport | null,
): void {
  customTransportForTests = transport;
}

/**
 * Resolves the `From` address from `process.env.EMAIL_FROM`, defaulting to
 * `"ShiftShare <onboarding@resend.dev>"`.
 */
export function getEmailFrom(): string {
  const fromEnv = process.env.EMAIL_FROM?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_EMAIL_FROM;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Formats a shift start/end ISO pair in the event's IANA timezone into a
 * human-readable string like:
 *   "Saturday, October 17, 2026 · 9:00am – 10:00am PDT"
 */
export function formatShiftTimeForEmail(
  startsAtIso: string,
  endsAtIso: string,
  timezone?: string | null,
): string {
  const zone = safeZone(timezone ?? "UTC");
  const day = eventDayWithYear(startsAtIso, zone);
  const range = eventTimeRange(startsAtIso, endsAtIso, zone);
  const tzLabel = eventZoneLabel(startsAtIso, zone);
  return `${day} · ${range}${tzLabel ? ` ${tzLabel}` : ""}`;
}

/**
 * Builds an absolute URL to the public event page (`/events/[slugOrId]`).
 */
export function buildEventPageUrl(
  eventSlugOrId: string,
  baseOrigin?: string,
): string {
  const origin = (baseOrigin ?? siteUrl()).replace(/\/+$/, "");
  const cleanSegment = encodeURIComponent(eventSlugOrId.trim());
  return `${origin}/events/${cleanSegment}`;
}

/**
 * Server-only helper that sends an HTML email via Resend.
 *
 * - Reads `RESEND_API_KEY` from `process.env.RESEND_API_KEY`
 * - Sends from `process.env.EMAIL_FROM` (default `"ShiftShare <onboarding@resend.dev>"`)
 * - Never throws: if `RESEND_API_KEY` is missing or the Resend API fails, logs
 *   the error and returns `{ ok: false, error }` so email failures never block
 *   a signup, cancellation, standby promotion, or cron run.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<SendEmailResult> {
  const recipient = to?.trim();
  const from = getEmailFrom();

  if (!recipient) {
    console.error("[ShiftShare Email] Missing recipient ('to') address.");
    return { ok: false, error: "Missing recipient email address." };
  }

  const payload: SendEmailPayload = {
    from,
    to: recipient,
    subject,
    html,
  };

  if (customTransportForTests) {
    try {
      const res = await customTransportForTests(payload);
      if (res.error) {
        console.error(
          `[ShiftShare Email] Failed sending "${subject}" to ${recipient}: ${res.error}`,
        );
        return { ok: false, error: res.error };
      }
      return { ok: true, id: res.id ?? "test-email-id" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[ShiftShare Email] Exception sending "${subject}" to ${recipient}:`,
        err,
      );
      return { ok: false, error: message };
    }
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      `[ShiftShare Email] RESEND_API_KEY is not set; skipping email "${subject}" to ${recipient}.`,
    );
    return {
      ok: false,
      skipped: true,
      error: "RESEND_API_KEY is not configured.",
    };
  }

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: recipient,
      subject,
      html,
    });

    if (error) {
      console.error(
        `[ShiftShare Email] Resend error sending "${subject}" to ${recipient}:`,
        error,
      );
      return { ok: false, error: error.message || "Resend API error" };
    }

    return { ok: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[ShiftShare Email] Unexpected error sending "${subject}" to ${recipient}:`,
      err,
    );
    return { ok: false, error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* Shared ShiftShare HTML Email Layout                                        */
/* -------------------------------------------------------------------------- */
/* Brand palette:                                                             */
/*   Navy:      #1B2A49                                                       */
/*   Accent:    #FFC93C                                                       */
/*   Off-white: #FAF8F3                                                       */
/*   Mint:      #2EC4B6 (dark badge text #0E6B62)                             */
/*   Coral:     #FF6B6B                                                       */
/* -------------------------------------------------------------------------- */

export type ShiftEmailDetails = {
  volunteerName?: string | null;
  eventTitle: string;
  roleName: string;
  shiftTime: string;
  location?: string | null;
  eventUrl: string;
};

function renderShiftShareEmailLayout(options: {
  preheader: string;
  badgeText: string;
  badgeBg: string;
  badgeColor: string;
  heading: string;
  introHtml: string;
  details: ShiftEmailDetails;
  ctaLabel: string;
  footerNote: string;
}): string {
  const {
    preheader,
    badgeText,
    badgeBg,
    badgeColor,
    heading,
    introHtml,
    details,
    ctaLabel,
    footerNote,
  } = options;

  const eventTitle = escapeHtml(details.eventTitle);
  const roleName = escapeHtml(details.roleName);
  const shiftTime = escapeHtml(details.shiftTime);
  const location = escapeHtml(
    details.location?.trim() || "See event page for location details",
  );
  const eventUrl = escapeHtml(details.eventUrl);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#FAF8F3;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1B2A49;-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      ${escapeHtml(preheader)}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAF8F3;padding:28px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#FFFFFF;border:2px solid #1B2A49;border-radius:18px;overflow:hidden;">
            <!-- Top Brand Bar -->
            <tr>
              <td style="background-color:#1B2A49;padding:18px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <span style="display:inline-block;background-color:#FFC93C;color:#1B2A49;font-weight:800;font-size:13px;padding:4px 9px;border-radius:6px;margin-right:8px;">&#8644;</span>
                      <span style="font-size:18px;font-weight:800;color:#FAF8F3;letter-spacing:-0.02em;">ShiftShare</span>
                    </td>
                    <td align="right">
                      <span style="display:inline-block;background-color:${badgeBg};color:${badgeColor};font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;">
                        ${escapeHtml(badgeText)}
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Main Content -->
            <tr>
              <td style="padding:28px 24px 24px 24px;">
                <h1 style="margin:0 0 12px 0;font-size:24px;line-height:1.25;font-weight:800;color:#1B2A49;">
                  ${escapeHtml(heading)}
                </h1>
                <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#1B2A49;">
                  ${introHtml}
                </p>

                <!-- Shift Details Card -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAF8F3;border:1.5px solid #1B2A49;border-radius:14px;padding:18px;margin-bottom:24px;">
                  <tr>
                    <td style="padding:0 0 10px 0;">
                      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#4E5D78;">Event</div>
                      <div style="font-size:16px;font-weight:700;color:#1B2A49;margin-top:2px;">${eventTitle}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;border-top:1px solid #E2DDD2;">
                      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#4E5D78;">Role</div>
                      <div style="font-size:15px;font-weight:700;color:#1B2A49;margin-top:2px;">${roleName}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;border-top:1px solid #E2DDD2;">
                      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#4E5D78;">Shift time</div>
                      <div style="font-size:15px;font-weight:600;color:#1B2A49;margin-top:2px;">${shiftTime}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0 0 0;border-top:1px solid #E2DDD2;">
                      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#4E5D78;">Location</div>
                      <div style="font-size:15px;font-weight:600;color:#1B2A49;margin-top:2px;">${location}</div>
                    </td>
                  </tr>
                </table>

                <!-- Primary CTA Button -->
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                  <tr>
                    <td align="center" style="border-radius:12px;background-color:#FFC93C;border:2px solid #1B2A49;">
                      <a href="${eventUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:800;color:#1B2A49;text-decoration:none;">
                        ${escapeHtml(ctaLabel)} &rarr;
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0;font-size:13px;line-height:1.5;color:#4E5D78;">
                  ${escapeHtml(footerNote)}<br />
                  Event link: <a href="${eventUrl}" style="color:#1B2A49;font-weight:600;text-decoration:underline;">${eventUrl}</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/* 1. Sign-up Confirmation Email                                              */
/* -------------------------------------------------------------------------- */

export function buildSignupConfirmationEmail(details: ShiftEmailDetails): {
  subject: string;
  html: string;
} {
  const greeting = details.volunteerName?.trim()
    ? `Hi ${escapeHtml(details.volunteerName.trim())}, you're`
    : "You're";

  const subject = `You're signed up: ${details.roleName} at ${details.eventTitle}`;
  const html = renderShiftShareEmailLayout({
    preheader: `Confirmed for ${details.roleName} at ${details.eventTitle} (${details.shiftTime}).`,
    badgeText: "Confirmed",
    badgeBg: "#2EC4B6",
    badgeColor: "#1B2A49",
    heading: `You're signed up for ${details.eventTitle}`,
    introHtml: `${greeting} confirmed for <strong>${escapeHtml(details.roleName)}</strong>. The organizer can see you on the roster.`,
    details,
    ctaLabel: "View event page",
    footerNote:
      "Need to cancel? Open the event page anytime to release your spot for another volunteer.",
  });

  return { subject, html };
}

export async function sendSignupConfirmationEmail(
  to: string,
  details: ShiftEmailDetails,
): Promise<SendEmailResult> {
  const { subject, html } = buildSignupConfirmationEmail(details);
  return sendEmail(to, subject, html);
}

/* -------------------------------------------------------------------------- */
/* 2. Standby Promotion Email ("A spot opened up, you're in")                 */
/* -------------------------------------------------------------------------- */

export function buildStandbyPromotionEmail(details: ShiftEmailDetails): {
  subject: string;
  html: string;
} {
  const greeting = details.volunteerName?.trim()
    ? `Good news, ${escapeHtml(details.volunteerName.trim())}! `
    : "Good news! ";

  const subject = `A spot opened up, you're in — ${details.eventTitle}`;
  const html = renderShiftShareEmailLayout({
    preheader: `A spot opened up, you're in for ${details.roleName} at ${details.eventTitle}.`,
    badgeText: "Promoted from Standby",
    badgeBg: "#FFC93C",
    badgeColor: "#1B2A49",
    heading: "A spot opened up, you're in",
    introHtml: `${greeting}A spot opened up, you're in for <strong>${escapeHtml(details.roleName)}</strong> at <strong>${escapeHtml(details.eventTitle)}</strong>. Your signup has been moved from standby to confirmed.`,
    details,
    ctaLabel: "View event page",
    footerNote:
      "If your plans changed and you can no longer make it, open the event page to cancel so the next person on standby can step in.",
  });

  return { subject, html };
}

export async function sendStandbyPromotionEmail(
  to: string,
  details: ShiftEmailDetails,
): Promise<SendEmailResult> {
  const { subject, html } = buildStandbyPromotionEmail(details);
  return sendEmail(to, subject, html);
}

/* -------------------------------------------------------------------------- */
/* 3. 24-Hour Shift Reminder Email                                            */
/* -------------------------------------------------------------------------- */

export function buildShiftReminderEmail(details: ShiftEmailDetails): {
  subject: string;
  html: string;
} {
  const greeting = details.volunteerName?.trim()
    ? `Hi ${escapeHtml(details.volunteerName.trim())}, your`
    : "Your";

  const subject = `Reminder: ${details.roleName} at ${details.eventTitle} starts within 24 hours`;
  const html = renderShiftShareEmailLayout({
    preheader: `24-hour reminder: ${details.roleName} at ${details.eventTitle} (${details.shiftTime}).`,
    badgeText: "24h Reminder",
    badgeBg: "#FFC93C",
    badgeColor: "#1B2A49",
    heading: `Your shift at ${details.eventTitle} is tomorrow`,
    introHtml: `${greeting} confirmed shift for <strong>${escapeHtml(details.roleName)}</strong> starts within the next 24 hours. Remember to scan the organizer's QR code when you arrive so your hours are verified.`,
    details,
    ctaLabel: "View event page",
    footerNote:
      "Can't make it? Please cancel on the event page as soon as possible so a standby volunteer can take your place.",
  });

  return { subject, html };
}

export async function sendShiftReminderEmail(
  to: string,
  details: ShiftEmailDetails,
): Promise<SendEmailResult> {
  const { subject, html } = buildShiftReminderEmail(details);
  return sendEmail(to, subject, html);
}

/* -------------------------------------------------------------------------- */
/* Database-Aware Notification Helpers (Non-Blocking)                         */
/* -------------------------------------------------------------------------- */

export async function loadShiftEmailContext(
  supabase: SupabaseClient<Database>,
  shiftId: string,
): Promise<Omit<ShiftEmailDetails, "volunteerName"> | null> {
  try {
    const { data: rawShift } = await supabase
      .from("shifts")
      .select("*")
      .eq("id", shiftId)
      .maybeSingle();

    const shift = rawShift as Shift | null;
    if (!shift) return null;

    const { data: rawRole } = await supabase
      .from("roles")
      .select("*")
      .eq("id", shift.role_id)
      .maybeSingle();

    const role = rawRole as RoleRow | null;
    if (!role) return null;

    const { data: rawEvent } = await supabase
      .from("events")
      .select("*")
      .eq("id", role.event_id)
      .maybeSingle();

    const event = rawEvent as EventRow | null;
    if (!event) return null;

    return {
      eventTitle: event.title,
      roleName: role.name,
      shiftTime: formatShiftTimeForEmail(
        shift.starts_at,
        shift.ends_at,
        event.timezone,
      ),
      location: event.location,
      eventUrl: buildEventPageUrl(event.slug || event.id),
    };
  } catch (err) {
    console.error(
      `[ShiftShare Email] Failed loading shift context for ${shiftId}:`,
      err,
    );
    return null;
  }
}

/**
 * Sends a sign-up confirmation email when a volunteer claims a confirmed spot.
 * Never throws — logs any error and returns so signup is never blocked.
 */
export async function notifyConfirmedSignup(input: {
  supabase: SupabaseClient<Database>;
  shiftId: string;
  volunteerId: string;
  volunteerEmail?: string | null;
  volunteerName?: string | null;
}): Promise<SendEmailResult> {
  try {
    let email = input.volunteerEmail?.trim() ?? "";
    let name = input.volunteerName?.trim() ?? "";

    if (!email || !name) {
      const { data: rawProfile } = await input.supabase
        .from("profiles")
        .select("*")
        .eq("id", input.volunteerId)
        .maybeSingle();
      const profile = rawProfile as Profile | null;
      if (!email && profile?.email) email = profile.email.trim();
      if (!name && profile?.full_name) name = profile.full_name.trim();
    }

    if (!email) {
      console.error(
        `[ShiftShare Email] Cannot send signup confirmation: no email for volunteer ${input.volunteerId}.`,
      );
      return { ok: false, error: "Volunteer has no email address." };
    }

    const context = await loadShiftEmailContext(input.supabase, input.shiftId);
    if (!context) {
      console.error(
        `[ShiftShare Email] Cannot send signup confirmation: shift ${input.shiftId} context not found.`,
      );
      return { ok: false, error: "Shift context not found." };
    }

    return await sendSignupConfirmationEmail(email, {
      ...context,
      volunteerName: name || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ShiftShare Email] notifyConfirmedSignup error:", err);
    return { ok: false, error: message };
  }
}

/**
 * Sends a standby promotion email ("A spot opened up, you're in") when a
 * waitlisted volunteer is promoted to a confirmed spot.
 * Never throws — logs any error and returns so cancellation is never blocked.
 */
export async function notifyStandbyPromotion(input: {
  supabase: SupabaseClient<Database>;
  shiftId: string;
  promoted: NonNullable<SignupResult["promoted"]>;
}): Promise<SendEmailResult> {
  try {
    let email = input.promoted.volunteer_email?.trim() ?? "";
    let name = input.promoted.volunteer_name?.trim() ?? "";

    if ((!email || !name) && input.promoted.volunteer_id) {
      const { data: rawProfile } = await input.supabase
        .from("profiles")
        .select("*")
        .eq("id", input.promoted.volunteer_id)
        .maybeSingle();
      const profile = rawProfile as Profile | null;
      if (!email && profile?.email) email = profile.email.trim();
      if (!name && profile?.full_name) name = profile.full_name.trim();
    }

    if (!email) {
      console.error(
        `[ShiftShare Email] Cannot send standby promotion email: no email for volunteer ${input.promoted.volunteer_id}.`,
      );
      return { ok: false, error: "Promoted volunteer has no email address." };
    }

    const context = await loadShiftEmailContext(input.supabase, input.shiftId);
    if (!context) {
      console.error(
        `[ShiftShare Email] Cannot send standby promotion email: shift ${input.shiftId} context not found.`,
      );
      return { ok: false, error: "Shift context not found." };
    }

    return await sendStandbyPromotionEmail(email, {
      ...context,
      volunteerName: name || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ShiftShare Email] notifyStandbyPromotion error:", err);
    return { ok: false, error: message };
  }
}

export type ReminderBatchSummary = {
  ok: true;
  windowStart: string;
  windowEnd: string;
  checked: number;
  sent: number;
  failed: number;
  signupIds: string[];
};

/**
 * Finds all `confirmed` signups with `reminder_sent = false` whose shift starts
 * within the next 24 hours (`(now, now + 24h]`), emails each volunteer, and
 * marks `reminder_sent = true`.
 *
 * If an individual email fails, logs the error and continues to the next signup.
 */
export async function sendDueShiftReminders(
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<ReminderBatchSummary> {
  const windowStart = now.toISOString();
  const windowEnd = new Date(
    now.getTime() + 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: rawSignups, error: signupsError } = await supabase
    .from("signups")
    .select("*")
    .eq("status", "confirmed")
    .eq("reminder_sent", false);

  if (signupsError) {
    console.error(
      "[ShiftShare Email] Failed querying pending reminder signups:",
      signupsError,
    );
    return {
      ok: true,
      windowStart,
      windowEnd,
      checked: 0,
      sent: 0,
      failed: 0,
      signupIds: [],
    };
  }

  const candidateSignups = ((rawSignups ?? []) as Signup[]).filter(
    (sg) => sg.status === "confirmed" && !sg.reminder_sent,
  );

  if (candidateSignups.length === 0) {
    return {
      ok: true,
      windowStart,
      windowEnd,
      checked: 0,
      sent: 0,
      failed: 0,
      signupIds: [],
    };
  }

  const shiftIds = Array.from(new Set(candidateSignups.map((s) => s.shift_id)));
  const { data: rawShifts } = await supabase
    .from("shifts")
    .select("*")
    .in("id", shiftIds);

  const nowMs = now.getTime();
  const endMs = nowMs + 24 * 60 * 60 * 1000;

  const dueShifts = ((rawShifts ?? []) as Shift[]).filter((sh) => {
    const startMs = new Date(sh.starts_at).getTime();
    return Number.isFinite(startMs) && startMs > nowMs && startMs <= endMs;
  });

  if (dueShifts.length === 0) {
    return {
      ok: true,
      windowStart,
      windowEnd,
      checked: 0,
      sent: 0,
      failed: 0,
      signupIds: [],
    };
  }

  const dueShiftById = new Map(dueShifts.map((s) => [s.id, s]));
  const dueSignups = candidateSignups.filter((sg) =>
    dueShiftById.has(sg.shift_id),
  );

  const roleIds = Array.from(new Set(dueShifts.map((s) => s.role_id)));
  const volunteerIds = Array.from(
    new Set(dueSignups.map((sg) => sg.volunteer_id)),
  );

  const [{ data: rawRoles }, { data: rawProfiles }] = await Promise.all([
    supabase.from("roles").select("*").in("id", roleIds),
    supabase.from("profiles").select("*").in("id", volunteerIds),
  ]);

  const roles = (rawRoles ?? []) as RoleRow[];
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const eventIds = Array.from(new Set(roles.map((r) => r.event_id)));

  const { data: rawEvents } =
    eventIds.length > 0
      ? await supabase.from("events").select("*").in("id", eventIds)
      : { data: [] as EventRow[] };

  const eventById = new Map(
    ((rawEvents ?? []) as EventRow[]).map((e) => [e.id, e]),
  );
  const profileById = new Map(
    ((rawProfiles ?? []) as Profile[]).map((p) => [p.id, p]),
  );

  let sent = 0;
  let failed = 0;
  const sentSignupIds: string[] = [];

  for (const signup of dueSignups) {
    try {
      const shift = dueShiftById.get(signup.shift_id);
      const role = shift ? roleById.get(shift.role_id) : undefined;
      const event = role ? eventById.get(role.event_id) : undefined;
      const profile = profileById.get(signup.volunteer_id);

      if (!shift || !role || !event || !profile?.email) {
        console.error(
          `[ShiftShare Email] Skipping reminder for signup ${signup.id}: missing shift/role/event or volunteer email.`,
        );
        failed += 1;
        continue;
      }

      const emailResult = await sendShiftReminderEmail(profile.email, {
        volunteerName: profile.full_name,
        eventTitle: event.title,
        roleName: role.name,
        shiftTime: formatShiftTimeForEmail(
          shift.starts_at,
          shift.ends_at,
          event.timezone,
        ),
        location: event.location,
        eventUrl: buildEventPageUrl(event.slug || event.id),
      });

      if (!emailResult.ok) {
        failed += 1;
        continue;
      }

      const { error: updateErr } = await supabase
        .from("signups")
        .update({ reminder_sent: true })
        .eq("id", signup.id);

      if (updateErr) {
        console.error(
          `[ShiftShare Email] Sent reminder for signup ${signup.id} but failed setting reminder_sent = true:`,
          updateErr,
        );
        failed += 1;
        continue;
      }

      sent += 1;
      sentSignupIds.push(signup.id);
    } catch (err) {
      console.error(
        `[ShiftShare Email] Unexpected error processing reminder for signup ${signup.id}:`,
        err,
      );
      failed += 1;
    }
  }

  return {
    ok: true,
    windowStart,
    windowEnd,
    checked: dueSignups.length,
    sent,
    failed,
    signupIds: sentSignupIds,
  };
}
