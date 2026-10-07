/**
 * The staffing-plan shape, shared by the API route, the editor and the publish
 * action. This is the contract Claude is asked to fill, the thing the validator
 * checks, and what gets written to Postgres.
 */

export const MIN_SHIFT_MINUTES = 30;
export const MAX_SHIFT_MINUTES = 90;

export type PlanShift = {
  /** Stable client-side id so the editor can track rows while renaming. */
  id: string;
  /** "HH:MM", 24-hour. */
  start: string;
  /** "HH:MM", 24-hour. */
  end: string;
  headcount: number;
};

export type PlanRole = {
  name: string;
  description: string;
  /** One sentence explaining the headcount for this role. */
  why?: string;
  shifts: PlanShift[];
};

export type Plan = {
  title: string;
  roles: PlanRole[];
};

/** Wire format returned by and sent to Claude (no internal shift IDs). */
export type WirePlan = {
  title: string;
  roles: {
    name: string;
    description: string;
    why: string;
    shifts: { start: string; end: string; headcount: number }[];
  }[];
};

/** Short clarifying question shown as quick-tap options before generating a plan. */
export type ClarifyingQuestion = {
  id: string;
  question: string;
  options: string[];
};

/** Gap warning returned by the Plan Check review call. */
export type PlanWarning = {
  id: string;
  title: string;
  detail: string;
  /** Plain-English instruction passed to the chat-edit function when "Apply fix" is tapped. */
  fixPrompt: string;
};

/** Copy generated at publish time for the organizer to review and edit before saving. */
export type PublishCopy = {
  eventDescription: string;
  roleDescriptions: { name: string; description: string }[];
  announcement: string;
  location?: string;
};

/** Summary of an organizer's past events in Supabase (fill rates and no-shows). */
export type PastEventsSummary = {
  eventCount: number;
  lastEventTitle: string;
  totalCapacity: number;
  filledCount: number;
  fillRatePct: number;
  noShowCount: number;
  /** Injected into the plan generation prompt. */
  promptSummary: string;
  /** Displayed in the planner UI ("Adjusted based on your last event..."). */
  uiNote: string;
};

/** The event's own window — what "cover the full event" is measured against. */
export type PlanWindow = {
  start: number | null;
  end: number | null;
};

export type PlanIssue = {
  level: "error" | "warning";
  message: string;
  /** Where to point the editor, when the problem belongs to one row. */
  roleIndex?: number;
  shiftId?: string;
};

export function countIssues(issues: PlanIssue[], level: PlanIssue["level"]) {
  return issues.filter((issue) => issue.level === level).length;
}

/** Total people needed across every shift. */
export function totalHeadcount(plan: Plan): number {
  return plan.roles.reduce(
    (sum, role) => sum + role.shifts.reduce((s, shift) => s + shift.headcount, 0),
    0,
  );
}

/** Converts an editor Plan into the strict wire JSON format expected by prompts. */
export function toWirePlan(plan: Plan): WirePlan {
  return {
    title: plan.title,
    roles: plan.roles.map((role) => ({
      name: role.name,
      description: role.description,
      why:
        role.why?.trim() ||
        defaultRoleWhy(
          role.name,
          role.shifts.reduce((max, s) => Math.max(max, s.headcount), 1),
        ),
      shifts: role.shifts.map((shift) => ({
        start: shift.start,
        end: shift.end,
        headcount: shift.headcount,
      })),
    })),
  };
}

export function defaultRoleWhy(roleName: string, headcount: number): string {
  const people = headcount === 1 ? "1 volunteer keeps" : `${headcount} volunteers keep`;
  return `${people} ${roleName.toLowerCase() || "this station"} running smoothly without bottlenecks.`;
}

let counter = 0;
/** Unique-enough id for a shift row. */
export function shiftId() {
  counter += 1;
  return `s${Date.now().toString(36)}${counter}`;
}
