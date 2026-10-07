import { toHHMM } from "@/lib/planner/time";
import {
  defaultRoleWhy,
  shiftId,
  totalHeadcount,
  type ClarifyingQuestion,
  type Plan,
  type PlanRole,
  type PlanShift,
  type PlanWarning,
  type PublishCopy,
} from "@/lib/planner/types";

/**
 * Turning whatever the model wrote into strongly-typed objects.
 *
 * The system prompt says "Return ONLY valid JSON", and models mostly comply —
 * but "mostly" isn't a parser. This module handles the failure modes seen in
 * practice: prose wrapped around the JSON, ```json fences, and field values
 * that are the right idea in the wrong shape ("9am" instead of "09:00",
 * "3 volunteers" instead of 3).
 *
 * It never throws. Anything it can't make sense of becomes a safe default or
 * partial object, and `validatePlan` reports specifics as issues the organizer
 * can see and fix.
 */

/** Pulls the outermost JSON object or array out of a string. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // Straight parse first.
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to recovery
  }

  // Strip ```json … ``` fences.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }

  // Fall back to the widest {...} span, tracking depth so nested objects and
  // braces inside strings don't end it early.
  const start = trimmed.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i += 1) {
    const char = trimmed[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

/** "3", "3 volunteers", 3 → 3. Anything unparseable → 1. */
function asHeadcount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(99, Math.round(value)));
  }
  const digits = asString(value).match(/\d+/);
  if (digits) return Math.max(1, Math.min(99, Number(digits[0])));
  return 1;
}

/** Accepts "09:00", "9:00", "9am", "9:00 AM", 540. */
function asTime(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Minutes since midnight, or an hour count.
    return toHHMM(value <= 24 ? value * 60 : value);
  }

  const raw = asString(value).toLowerCase();
  if (!raw) return "";

  const withMinutes = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/);
  if (withMinutes) {
    let hours = Number(withMinutes[1]);
    const minutes = Number(withMinutes[2] ?? 0);
    if (hours === 12) hours = 0;
    if (withMinutes[3] === "p") hours += 12;
    return toHHMM(hours * 60 + minutes);
  }

  const clock = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) return toHHMM(Number(clock[1]) * 60 + Number(clock[2]));

  const bare = raw.match(/^(\d{1,2})$/);
  if (bare) return toHHMM(Number(bare[1]) * 60);

  return "";
}

function asShift(value: unknown): PlanShift {
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    id: shiftId(),
    start: asTime(record.start ?? record.start_time ?? record.from),
    end: asTime(record.end ?? record.end_time ?? record.to),
    headcount: asHeadcount(record.headcount ?? record.people ?? record.count),
  };
}

function asRole(value: unknown): PlanRole {
  const record = (value ?? {}) as Record<string, unknown>;
  const rawShifts = Array.isArray(record.shifts) ? record.shifts : [];
  const shifts = rawShifts.map(asShift);
  const name = asString(record.name ?? record.role ?? record.title) || "Untitled role";
  const maxHeadcount = shifts.reduce((max, s) => Math.max(max, s.headcount), 1);
  const why =
    asString(record.why ?? record.reason ?? record.rationale ?? record.headcount_reason) ||
    defaultRoleWhy(name, maxHeadcount);

  return {
    name,
    description: asString(record.description ?? record.details ?? record.notes),
    why,
    shifts,
  };
}

/**
 * Coerces unknown JSON into a Plan. Missing pieces become empty values rather
 * than exceptions — `validatePlan` is what decides whether it's usable.
 */
export function normalizePlan(raw: unknown): Plan {
  const root = (raw ?? {}) as Record<string, unknown>;
  const nestedPlan =
    root.plan && typeof root.plan === "object" && !Array.isArray(root.plan)
      ? (root.plan as Record<string, unknown>)
      : root;

  const rawRoles = Array.isArray(nestedPlan.roles)
    ? nestedPlan.roles
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];

  return {
    title:
      asString(nestedPlan.title ?? nestedPlan.name ?? nestedPlan.event ?? root.title) || "",
    roles: rawRoles.map(asRole).filter((role) => role.shifts.length > 0 || role.name),
  };
}

/**
 * Coerces unknown JSON into up to 3 clarifying questions with quick-tap options.
 */
export function normalizeClarifyingQuestions(raw: unknown): {
  needsClarification: boolean;
  questions: ClarifyingQuestion[];
} {
  if (!raw || typeof raw !== "object") {
    return { needsClarification: false, questions: [] };
  }

  const root = raw as Record<string, unknown>;
  const rawQuestions = Array.isArray(root.questions)
    ? root.questions
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];

  const questions: ClarifyingQuestion[] = [];
  for (let i = 0; i < rawQuestions.length && questions.length < 3; i += 1) {
    const item = (rawQuestions[i] ?? {}) as Record<string, unknown>;
    const question = asString(item.question ?? item.prompt ?? item.label ?? item.text);
    const rawOptions = Array.isArray(item.options ?? item.choices)
      ? ((item.options ?? item.choices) as unknown[])
      : [];
    const options = rawOptions
      .map((opt) => asString(opt))
      .filter((opt) => opt.length > 0)
      .slice(0, 4);

    if (question && options.length >= 2) {
      questions.push({
        id: asString(item.id) || `q${questions.length + 1}`,
        question,
        options,
      });
    }
  }

  const explicitFlag =
    typeof root.needsClarification === "boolean"
      ? root.needsClarification
      : typeof root.needs_clarification === "boolean"
        ? root.needs_clarification
        : questions.length > 0;

  return {
    needsClarification: explicitFlag && questions.length > 0,
    questions: explicitFlag ? questions : [],
  };
}

/**
 * Summarizes the difference between two plans so the organizer gets a clear
 * "what changed" line after a chat edit even if the model omitted `whatChanged`.
 */
export function summarizePlanDiff(
  before: Plan,
  after: Plan,
  instruction?: string,
): string {
  const changes: string[] = [];

  if (before.title.trim() !== after.title.trim() && after.title.trim()) {
    changes.push(`renamed event to "${after.title.trim()}"`);
  }

  const beforeByName = new Map(
    before.roles.map((r) => [r.name.trim().toLowerCase(), r]),
  );
  const afterByName = new Map(
    after.roles.map((r) => [r.name.trim().toLowerCase(), r]),
  );

  const addedRoles = after.roles.filter(
    (r) => !beforeByName.has(r.name.trim().toLowerCase()),
  );
  const removedRoles = before.roles.filter(
    (r) => !afterByName.has(r.name.trim().toLowerCase()),
  );

  if (addedRoles.length > 0) {
    changes.push(
      `added ${addedRoles.map((r) => `${r.name} (${r.shifts.length} shift${r.shifts.length === 1 ? "" : "s"})`).join(", ")}`,
    );
  }
  if (removedRoles.length > 0) {
    changes.push(`removed ${removedRoles.map((r) => r.name).join(", ")}`);
  }

  const beforeTotal = totalHeadcount(before);
  const afterTotal = totalHeadcount(after);
  if (beforeTotal !== afterTotal) {
    changes.push(
      `adjusted total spots from ${beforeTotal} to ${afterTotal}`,
    );
  }

  const beforeShiftCount = before.roles.reduce((s, r) => s + r.shifts.length, 0);
  const afterShiftCount = after.roles.reduce((s, r) => s + r.shifts.length, 0);
  if (beforeShiftCount !== afterShiftCount && addedRoles.length === 0 && removedRoles.length === 0) {
    changes.push(
      `updated shifts (${beforeShiftCount} → ${afterShiftCount} total shifts)`,
    );
  }

  if (changes.length === 0) {
    return instruction
      ? `Updated the plan for "${instruction.trim()}".`
      : "Updated role details and shift assignments.";
  }

  const sentence = changes.join("; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/**
 * Normalizes the output of a chat-edit call: extracts the updated Plan and a
 * one-sentence `whatChanged` summary.
 */
export function normalizeChatEdit(
  raw: unknown,
  previousPlan: Plan,
  instruction?: string,
): { plan: Plan; whatChanged: string } {
  const root = (raw ?? {}) as Record<string, unknown>;
  const plan = normalizePlan(raw);
  const explicitSummary = asString(
    root.whatChanged ?? root.what_changed ?? root.summary ?? root.changeSummary,
  );
  const whatChanged =
    explicitSummary || summarizePlanDiff(previousPlan, plan, instruction);

  return { plan, whatChanged };
}

/**
 * Normalizes the output of the Plan Check call into up to 3 actionable warnings.
 */
export function normalizePlanWarnings(raw: unknown): PlanWarning[] {
  if (!raw || typeof raw !== "object") return [];

  const root = raw as Record<string, unknown>;
  const list = Array.isArray(root.warnings)
    ? root.warnings
    : Array.isArray(root.issues)
      ? root.issues
      : Array.isArray(raw)
        ? (raw as unknown[])
        : [];

  const warnings: PlanWarning[] = [];
  for (let i = 0; i < list.length && warnings.length < 3; i += 1) {
    const item = (list[i] ?? {}) as Record<string, unknown>;
    const title = asString(item.title ?? item.heading ?? item.warning ?? item.message);
    const detail = asString(item.detail ?? item.description ?? item.reason ?? item.message ?? title);
    const fixPrompt = asString(
      item.fixPrompt ?? item.fix_prompt ?? item.fix ?? item.suggestion ?? item.action,
    );

    if (title || detail) {
      warnings.push({
        id: asString(item.id) || `warn-${warnings.length + 1}`,
        title: title || detail,
        detail: detail && detail !== title ? detail : "Tap Apply fix to update the schedule.",
        fixPrompt:
          fixPrompt ||
          `Fix this staffing gap: ${title || detail}`,
      });
    }
  }

  return warnings;
}

/**
 * Normalizes the publish-time copy returned by Claude.
 */
export function normalizePublishCopy(raw: unknown, plan: Plan): PublishCopy {
  const root = (raw ?? {}) as Record<string, unknown>;

  const eventDescription =
    asString(
      root.eventDescription ??
        root.event_description ??
        root.description ??
        root.summary,
    ) ||
    `We're looking for volunteers to help run ${plan.title || "our community event"}. Pick a shift below that fits your schedule — no prior experience needed.`;

  const rawRoles = Array.isArray(root.roleDescriptions ?? root.role_descriptions ?? root.roles)
    ? ((root.roleDescriptions ?? root.role_descriptions ?? root.roles) as unknown[])
    : [];

  const byName = new Map<string, string>();
  for (const entry of rawRoles) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const name = asString(item.name ?? item.role).toLowerCase();
    const desc = asString(
      item.description ?? item.whatToDo ?? item.what_to_do ?? item.details,
    );
    if (name && desc) {
      byName.set(name, desc);
    }
  }

  const roleDescriptions = plan.roles.map((role, index) => {
    const matched =
      byName.get(role.name.trim().toLowerCase()) ??
      asString((rawRoles[index] as Record<string, unknown> | undefined)?.description);
    return {
      name: role.name,
      description:
        matched ||
        `${role.description || `Help with ${role.name.toLowerCase()}.`} Wear comfortable closed-toe shoes and bring a water bottle.`,
    };
  });

  const announcement =
    asString(
      root.announcement ??
        root.groupChatMessage ??
        root.group_chat_message ??
        root.message,
    ) ||
    `Hi everyone! We need volunteers for ${plan.title || "our upcoming event"} (${totalHeadcount(plan)} spots across ${plan.roles.length} roles). Shifts are 30–90 minutes — grab a spot here:`;

  const location = asString(root.location) || undefined;

  return {
    eventDescription,
    roleDescriptions,
    announcement,
    location,
  };
}
