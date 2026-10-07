import { parseTime, formatDuration, formatRange } from "@/lib/planner/time";
import {
  MAX_SHIFT_MINUTES,
  MIN_SHIFT_MINUTES,
  type Plan,
  type PlanIssue,
  type PlanWindow,
} from "@/lib/planner/types";

/**
 * Plan validation.
 *
 * The rules the plan has to satisfy:
 *   1. every shift is 30–90 minutes long, and ends after it starts
 *   2. the shifts cover the whole event window, with no gaps
 *   3. headcounts are whole numbers of at least 1
 *   4. role names are filled in and unique
 *
 * Coverage is measured over the *union* of every shift in every role, not per
 * role. Roles run in parallel — a check-in table and a packing line both
 * covering 9–11am is full coverage, not an overlap error.
 *
 * Errors block publishing. Warnings don't: a shift that starts an hour before
 * the gates open is usually deliberate setup time, so we mention it and move on.
 */

type Interval = { start: number; end: number; roleIndex: number; shiftId: string };

/** Merge overlapping/touching intervals into the spans they cover. */
function mergeIntervals(intervals: Interval[]) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];

  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ start: interval.start, end: interval.end });
    }
  }

  return merged;
}

export function validatePlan(plan: Plan, window: PlanWindow = { start: null, end: null }): PlanIssue[] {
  const issues: PlanIssue[] = [];

  if (!plan.title.trim()) {
    issues.push({ level: "error", message: "The event needs a title." });
  }

  if (plan.roles.length === 0) {
    issues.push({
      level: "error",
      message: "The plan has no roles. Add at least one role with a shift.",
    });
    return issues;
  }

  // Role names.
  const seenNames = new Map<string, number>();
  plan.roles.forEach((role, roleIndex) => {
    const key = role.name.trim().toLowerCase();
    if (!key) {
      issues.push({
        level: "error",
        message: `Role ${roleIndex + 1} has no name.`,
        roleIndex,
      });
      return;
    }
    const firstSeen = seenNames.get(key);
    if (firstSeen !== undefined) {
      issues.push({
        level: "error",
        message: `"${role.name}" is used twice. Role names need to be different — they're how volunteers tell shifts apart.`,
        roleIndex,
      });
    } else {
      seenNames.set(key, roleIndex);
    }
  });

  // Shifts.
  const intervals: Interval[] = [];

  plan.roles.forEach((role, roleIndex) => {
    if (role.shifts.length === 0) {
      issues.push({
        level: "error",
        message: `"${role.name}" has no shifts, so nobody can sign up for it.`,
        roleIndex,
      });
      return;
    }

    role.shifts.forEach((shift) => {
      const start = parseTime(shift.start);
      const end = parseTime(shift.end);

      if (start === null || end === null) {
        issues.push({
          level: "error",
          message: `"${role.name}" has a shift with an unreadable time. Use 24-hour HH:MM.`,
          roleIndex,
          shiftId: shift.id,
        });
        return;
      }

      if (end <= start) {
        issues.push({
          level: "error",
          message: `"${role.name}" has a shift that ends (${shift.end}) before it starts (${shift.start}).`,
          roleIndex,
          shiftId: shift.id,
        });
        return;
      }

      const duration = end - start;
      if (duration < MIN_SHIFT_MINUTES || duration > MAX_SHIFT_MINUTES) {
        issues.push({
          level: "error",
          message: `"${role.name}" ${formatRange(start, end)} runs ${formatDuration(duration)}. Shifts need to be between ${MIN_SHIFT_MINUTES} and ${MAX_SHIFT_MINUTES} minutes.`,
          roleIndex,
          shiftId: shift.id,
        });
      }

      if (shift.headcount < 1 || !Number.isFinite(shift.headcount)) {
        issues.push({
          level: "error",
          message: `"${role.name}" ${formatRange(start, end)} needs a headcount of at least 1.`,
          roleIndex,
          shiftId: shift.id,
        });
      }

      intervals.push({ start, end, roleIndex, shiftId: shift.id });
    });
  });

  if (intervals.length === 0) return issues;

  // Coverage.
  const spanStart = Math.min(...intervals.map((i) => i.start));
  const spanEnd = Math.max(...intervals.map((i) => i.end));
  const target =
    window.start !== null && window.end !== null
      ? { start: window.start, end: window.end }
      : { start: spanStart, end: spanEnd };

  const merged = mergeIntervals(intervals);

  // Gaps inside the window.
  const gaps: { start: number; end: number }[] = [];
  let cursor = target.start;
  for (const span of merged) {
    if (span.end <= target.start) continue;
    if (span.start > target.end) break;
    if (span.start > cursor) {
      gaps.push({ start: cursor, end: Math.min(span.start, target.end) });
    }
    cursor = Math.max(cursor, span.end);
    if (cursor >= target.end) break;
  }
  if (cursor < target.end) {
    gaps.push({ start: cursor, end: target.end });
  }

  for (const gap of gaps) {
    issues.push({
      level: "error",
      message: `Nobody is scheduled ${formatRange(gap.start, gap.end)} — that's a ${formatDuration(gap.end - gap.start)} gap in the event.`,
    });
  }

  // Shifts reaching outside the stated window.
  if (window.start !== null && spanStart < window.start) {
    issues.push({
      level: "warning",
      message: `Scheduling starts at ${formatRange(spanStart, spanStart)} — before the event opens. Fine if that's setup, otherwise trim it.`,
    });
  }
  if (window.end !== null && spanEnd > window.end) {
    issues.push({
      level: "warning",
      message: `Scheduling runs to ${formatRange(spanEnd, spanEnd)} — after the event ends. Fine if that's teardown, otherwise trim it.`,
    });
  }

  return issues;
}

/** Convenience for the publish path: only errors block. */
export function hasBlockingIssues(issues: PlanIssue[]) {
  return issues.some((issue) => issue.level === "error");
}
