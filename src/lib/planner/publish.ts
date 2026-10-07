/**
 * Pure helpers for turning a plan into database rows.
 *
 * Split out from the server action so the fiddly parts — wall-clock times,
 * timezones, slugs — can be tested directly.
 */

/** "Saturday Food Drive!" → "saturday-food-drive" */
export function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");
  return slug || "event";
}

/**
 * Combines an organizer's local date + time into an ISO instant.
 *
 * `tzOffset` is JavaScript's `Date.prototype.getTimezoneOffset()`: minutes to
 * add to local time to reach UTC (PDT = 420). So 09:00 in California on
 * 2026-10-10 becomes 16:00Z — 9am where the organizer is, not 9am UTC.
 */
export function toInstant(date: string, time: string, tzOffset: number) {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);

  if ([year, month, day, hours, minutes].some((n) => !Number.isFinite(n))) {
    throw new Error(`Cannot build a timestamp from ${date} ${time}`);
  }

  const utcMs =
    Date.UTC(year, month - 1, day, hours, minutes) + tzOffset * 60_000;

  return new Date(utcMs).toISOString();
}

/** Minutes since midnight → "HH:MM". */
export function minutesToHHMM(minutes: number | null, fallback = "09:00") {
  if (minutes === null || !Number.isFinite(minutes)) return fallback;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Finds a slug that isn't taken, given the ones already in use. */
export function uniqueSlug(base: string, taken: Iterable<string>) {
  const used = new Set(Array.from(taken, (s) => s.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; n <= 50; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
