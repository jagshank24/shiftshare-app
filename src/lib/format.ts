/**
 * Date and duration formatting helpers.
 *
 * Fixed to en-US and a stable timezone-free format so server-rendered markup
 * matches what the client would produce (no hydration mismatches).
 */

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

export function formatEventDate(iso: string) {
  return dateFormatter.format(new Date(iso));
}

/** Minutes → "4 hours" / "1 hour 30 minutes" / "45 minutes". */
export function formatHours(minutes: number) {
  if (minutes <= 0) return "0 hours";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (rest) parts.push(`${rest} minute${rest === 1 ? "" : "s"}`);
  return parts.join(" ");
}
