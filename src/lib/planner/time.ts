/**
 * Time helpers for staffing plans.
 *
 * Plans speak in wall-clock times ("09:00", "13:30") because that is how
 * organizers think about their event. Everything is converted to minutes since
 * midnight for arithmetic, and only turned into absolute timestamps at publish
 * time (on the client, where the organizer's timezone is known).
 */

export const MINUTES_IN_DAY = 24 * 60;

/** Matches "09:00", "9:00" and a bare "9" (minutes optional). */
const HHMM = /^(\d{1,2})(?::(\d{2}))?$/;

/**
 * Parses "09:00", "9:00", "9am", "9", "9:00 AM" into minutes since midnight.
 * Returns null when the value isn't a usable time.
 */
export function parseTime(value: string): number | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  // Split off an optional am/pm suffix so the model's formatting habits
  // don't break the plan.
  const suffix = trimmed.match(/\s*([ap])\.?m\.?$/);
  const clock = suffix ? trimmed.slice(0, suffix.index).trim() : trimmed;

  const match = HHMM.exec(clock);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (minutes > 59) return null;

  if (suffix) {
    if (hours === 12) hours = 0;
    if (suffix[1] === "p") hours += 12;
  }

  if (hours > 23) return null;
  return hours * 60 + minutes;
}

/** Minutes since midnight → "09:00". Wraps past midnight. */
export function toHHMM(minutes: number): string {
  const wrapped = ((minutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Minutes since midnight → "9:00am", for display next to the raw value. */
export function toFriendlyTime(minutes: number): string {
  const wrapped = ((minutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

/** "9:00am – 1:00pm" */
export function formatRange(start: number, end: number): string {
  return `${toFriendlyTime(start)} – ${toFriendlyTime(end)}`;
}

/** 90 → "1 hr 30 min", 60 → "1 hr", 30 → "30 min" */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = `${hours} hr`;
  return rest ? `${h} ${rest} min` : h;
}
