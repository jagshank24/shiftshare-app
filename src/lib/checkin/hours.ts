/**
 * Server-side shift hour & check-in window calculations.
 *
 * Safeguard: Hours are calculated strictly from check-in and check-out
 * timestamps on the server. Volunteers can never supply or edit hours.
 */

export const CHECKIN_WINDOW_MINUTES = 30;
const CHECKIN_WINDOW_MS = CHECKIN_WINDOW_MINUTES * 60 * 1000;

export type CheckinWindowCheck = {
  allowed: boolean;
  status: "early" | "open" | "late";
  windowOpensAt: Date;
  windowClosesAt: Date;
};

/**
 * Checks whether `now` falls within 30 minutes before to 30 minutes after
 * `shiftStartsAt` (inclusive).
 */
export function checkShiftWindow(
  shiftStartsAt: string | Date,
  now: string | Date = new Date(),
): CheckinWindowCheck {
  const startMs = new Date(shiftStartsAt).getTime();
  const nowMs = new Date(now).getTime();

  const opensMs = startMs - CHECKIN_WINDOW_MS;
  const closesMs = startMs + CHECKIN_WINDOW_MS;
  const windowOpensAt = new Date(opensMs);
  const windowClosesAt = new Date(closesMs);

  if (Number.isNaN(startMs) || Number.isNaN(nowMs)) {
    return {
      allowed: false,
      status: "early",
      windowOpensAt: new Date(0),
      windowClosesAt: new Date(0),
    };
  }

  if (nowMs < opensMs) {
    return { allowed: false, status: "early", windowOpensAt, windowClosesAt };
  }
  if (nowMs > closesMs) {
    return { allowed: false, status: "late", windowOpensAt, windowClosesAt };
  }
  return { allowed: true, status: "open", windowOpensAt, windowClosesAt };
}

/**
 * Computes hours worked from `checkedInAt` and `checkedOutAt` timestamps,
 * rounded to 2 decimal places. Never trusts client-provided hour numbers.
 */
export function calculateShiftHours(
  checkedInAt: string | Date | null | undefined,
  checkedOutAt: string | Date | null | undefined,
): number {
  if (!checkedInAt || !checkedOutAt) return 0;
  const inMs = new Date(checkedInAt).getTime();
  const outMs = new Date(checkedOutAt).getTime();
  if (Number.isNaN(inMs) || Number.isNaN(outMs) || outMs <= inMs) {
    return 0;
  }
  const hours = (outMs - inMs) / 3_600_000;
  return Math.round(hours * 100) / 100;
}

/**
 * Formats an hours value to strictly 2 decimal places, e.g. `1.5` -> `"1.50"`.
 */
export function formatHoursToTwoDecimals(hours: number | null | undefined): string {
  const safe = typeof hours === "number" && Number.isFinite(hours) && hours >= 0 ? hours : 0;
  return safe.toFixed(2);
}

/**
 * Sums server-side hours across all completed shifts for a volunteer,
 * rounded to 2 decimal places.
 */
export function calculateRunningTotalHours(
  pairs: ReadonlyArray<{
    checkedInAt?: string | Date | null;
    checkedOutAt?: string | Date | null;
  }>,
): number {
  const rawTotal = pairs.reduce((sum, pair) => {
    if (!pair.checkedInAt || !pair.checkedOutAt) return sum;
    const inMs = new Date(pair.checkedInAt).getTime();
    const outMs = new Date(pair.checkedOutAt).getTime();
    if (Number.isNaN(inMs) || Number.isNaN(outMs) || outMs <= inMs) return sum;
    return sum + (outMs - inMs) / 3_600_000;
  }, 0);
  return Math.round(rawTotal * 100) / 100;
}

/**
 * Formats an ISO timestamp as 24-hour `"HH:MM"` in the given IANA timezone.
 */
export function wallClockTimeInZone(
  iso: string,
  timeZone: string | null | undefined,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "12:00";
  let zone = timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: zone,
  }).formatToParts(d);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "12";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh === "24" ? "00" : hh}:${mm}`;
}

/**
 * Resolves a 24-hour `"HH:MM"` check-out time on the same event day as
 * `checkedInIso` (in `timeZone`) into an ISO timestamp string.
 */
export function resolveCheckoutInstantFromWallClock(
  checkedInIso: string,
  targetHHMM: string,
  timeZone: string | null | undefined,
): string | null {
  const inDate = new Date(checkedInIso);
  if (Number.isNaN(inDate.getTime())) return null;

  const match = /^(\d{1,2}):(\d{2})$/.exec(targetHHMM.trim());
  if (!match) return null;

  const outH = Number(match[1]);
  const outM = Number(match[2]);
  if (outH < 0 || outH > 23 || outM < 0 || outM > 59) return null;

  const inHHMM = wallClockTimeInZone(checkedInIso, timeZone);
  const [inHStr, inMStr] = inHHMM.split(":");
  const inMinutes = Number(inHStr) * 60 + Number(inMStr);
  const outMinutes = outH * 60 + outM;

  let diffMinutes = outMinutes - inMinutes;
  if (diffMinutes <= 0) {
    // If the typed clock time is earlier than check-in clock time, only wrap
    // across midnight if check-in was late in the evening; otherwise invalid.
    if (inMinutes >= 18 * 60 && outMinutes <= 6 * 60) {
      diffMinutes += 24 * 60;
    } else {
      return null;
    }
  }

  // Round base to the start of the check-in minute so HH:MM math is clean,
  // while keeping it strictly after checkedInIso.
  const outMs = inDate.getTime() + diffMinutes * 60_000;
  return new Date(outMs).toISOString();
}

