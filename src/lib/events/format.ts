/**
 * Formatting for event times.
 *
 * An event's times belong to the *event's* timezone, not the reader's: a 9:00am
 * food drive is 9:00am at the library whether you're reading the link from
 * Fremont or Frankfurt. Every helper takes the event's IANA zone and renders
 * through `Intl`, so the server and the browser always agree — no wrong clock,
 * no hydration mismatch.
 */

const zoneCache = new Map<string, string>();
const formatterCache = new Map<string, Intl.DateTimeFormat>();

/** An unknown or missing zone falls back to UTC rather than throwing. */
export function safeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";

  const cached = zoneCache.get(timeZone);
  if (cached) return cached;

  let resolved = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    resolved = "UTC";
  }

  zoneCache.set(timeZone, resolved);
  return resolved;
}

function formatter(
  key: string,
  options: Intl.DateTimeFormatOptions,
  timeZone: string,
): Intl.DateTimeFormat {
  const cacheKey = `${key}|${timeZone}`;
  const cached = formatterCache.get(cacheKey);
  if (cached) return cached;

  const built = new Intl.DateTimeFormat("en-US", { ...options, timeZone });
  formatterCache.set(cacheKey, built);
  return built;
}

/** "Saturday, October 10" */
export function eventDay(iso: string, timeZone: string | null | undefined): string {
  return formatter(
    "day",
    { weekday: "long", month: "long", day: "numeric" },
    safeZone(timeZone),
  ).format(new Date(iso));
}

/** "Saturday, October 10, 2026" — for the page heading, where the year matters. */
export function eventDayWithYear(iso: string, timeZone: string | null | undefined): string {
  return formatter(
    "dayYear",
    { weekday: "long", month: "long", day: "numeric", year: "numeric" },
    safeZone(timeZone),
  ).format(new Date(iso));
}

/** "9:00am" — lowercase, matching the planner's own time formatting. */
export function eventClock(iso: string, timeZone: string | null | undefined): string {
  return formatter(
    "clock",
    { hour: "numeric", minute: "2-digit", hour12: true },
    safeZone(timeZone),
  )
    .format(new Date(iso))
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** "PDT" — the short zone name, so "9:00am" is unambiguous. */
export function eventZoneLabel(iso: string, timeZone: string | null | undefined): string {
  const parts = formatter(
    "zone",
    { hour: "numeric", timeZoneName: "short" },
    safeZone(timeZone),
  ).formatToParts(new Date(iso));

  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}

/** "Pacific Daylight Time" — for the footnote, where the abbreviation alone is terse. */
export function eventZoneLong(iso: string, timeZone: string | null | undefined): string {
  const parts = formatter(
    "zoneLong",
    { hour: "numeric", timeZoneName: "long" },
    safeZone(timeZone),
  ).formatToParts(new Date(iso));

  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}

export function sameEventDay(
  a: string,
  b: string,
  timeZone: string | null | undefined,
): boolean {
  const zone = safeZone(timeZone);
  const key = (iso: string) =>
    formatter("dayKey", { year: "numeric", month: "2-digit", day: "2-digit" }, zone).format(
      new Date(iso),
    );
  return key(a) === key(b);
}

/**
 * "9:00am – 1:00pm". A shift that runs past midnight gets its end date spelled
 * out, so "10:00pm – 12:30am" can't be misread as a 2½-hour shift.
 */
export function eventTimeRange(
  startIso: string,
  endIso: string,
  timeZone: string | null | undefined,
): string {
  const start = eventClock(startIso, timeZone);

  if (sameEventDay(startIso, endIso, timeZone)) {
    return `${start} – ${eventClock(endIso, timeZone)}`;
  }

  return `${start} – ${eventDay(endIso, timeZone)} ${eventClock(endIso, timeZone)}`;
}

/** Whole minutes between two instants; 0 if either date is unreadable. */
export function minutesBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 60_000);
}

/** True when the instant is in the past — used to retire finished shifts. */
export function isPast(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() < now.getTime();
}
