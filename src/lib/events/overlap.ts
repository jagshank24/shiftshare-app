/**
 * Overlap detection.
 *
 * A volunteer cannot be in two places at once, so a signup is blocked when it
 * clashes with a shift they're already committed to. The database enforces this
 * (see `sign_up_for_shift`); these helpers are what the page uses to *warn*
 * before anyone taps a button, so the rule never feels like a surprise.
 *
 * Intervals are half-open — [start, end). A shift ending at 11:00 and another
 * starting at 11:00 are back-to-back, not overlapping.
 */

export type TimeSpan = { startMs: number; endMs: number };

export type BookedShift = TimeSpan & {
  shiftId: string;
  /** Human label for the message, e.g. "Check-in table at the food drive". */
  label: string;
};

export function spansOverlap(a: TimeSpan, b: TimeSpan): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/** Parses a pair of ISO instants, or null when either is unusable. */
export function toSpan(startIso: string, endIso: string): TimeSpan | null {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

/**
 * The first shift the visitor is already committed to that clashes with the
 * one they're looking at. Ordered by start time so the message names the shift
 * they'd hit first.
 */
export function findConflict(
  target: TimeSpan | null,
  booked: readonly BookedShift[],
): BookedShift | null {
  if (!target) return null;

  const clashes = booked
    .filter((shift) => spansOverlap(target, shift))
    .sort((a, b) => a.startMs - b.startMs);

  return clashes[0] ?? null;
}
