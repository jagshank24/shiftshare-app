import Anthropic from "@anthropic-ai/sdk";
import {
  extractJson,
  normalizeChatEdit,
  normalizeClarifyingQuestions,
  normalizePlan,
  normalizePlanWarnings,
  normalizePublishCopy,
} from "@/lib/planner/parse";
import {
  SYSTEM_PROMPT,
  buildChatEditPrompt,
  buildClarifyPrompt,
  buildPlanCheckPrompt,
  buildPublishCopyPrompt,
  buildRepairPrompt,
  buildUserPrompt,
  type PlannerRequest,
} from "@/lib/planner/prompt";
import {
  applyDemoChatEdit,
  checkDemoPlanForGaps,
  demoClarifyEventDetails,
  generateDemoPlan,
  generateDemoPublishCopy,
} from "@/lib/planner/demo";
import { validatePlan } from "@/lib/planner/validate";
import { toHHMM } from "@/lib/planner/time";
import type {
  ClarifyingQuestion,
  Plan,
  PlanIssue,
  PlanWarning,
  PublishCopy,
} from "@/lib/planner/types";

/**
 * Single server-side AI service (`lib/ai.ts`) with one function per task:
 *   1. `clarifyEventDetails` — up to 3 clarifying questions as JSON
 *   2. `generatePlan`        — full staffing plan with `why` per role (+ past-event context)
 *   3. `editPlanWithChat`    — plain-English plan edits returning updated plan + `whatChanged`
 *   4. `checkPlanForGaps`    — reviews plan for gaps and returns up to 3 warnings with fixes
 *   5. `generatePublishCopy` — event description, role descriptions (what to do/wear/bring), and group-chat announcement
 *
 * Server-only: `ANTHROPIC_API_KEY` is read exclusively from `process.env` and
 * never exposed to the client.
 */

export const DEFAULT_MODEL = "claude-sonnet-5";
export { SYSTEM_PROMPT, toHHMM };

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type AiFailure = {
  ok: false;
  error: string;
  hint?: string;
};

function createAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
}

/** Pulls the text out of a Claude Messages response. */
function textOf(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Shared low-level Claude call. Uses the exact required system prompt:
 * "You are an event staffing planner. Return ONLY valid JSON."
 */
async function askClaude(
  client: Anthropic,
  userPrompt: string,
): Promise<{ text: string } | { error: string; hint?: string }> {
  try {
    const message = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    if (message.stop_reason === "max_tokens") {
      return {
        error: "Claude's response was cut off before it finished.",
        hint: "Try a shorter request or fewer roles, then tap Retry.",
      };
    }

    return { text: textOf(message) };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return {
        error: "The Anthropic API key was rejected.",
        hint: "Check ANTHROPIC_API_KEY in .env.local — it should start with sk-ant-.",
      };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return {
        error: "Claude is rate limiting this key right now.",
        hint: "Wait a moment and tap Retry.",
      };
    }
    if (error instanceof Anthropic.APIError) {
      return {
        error: `Claude returned an error (${error.status}).`,
        hint: error.message.slice(0, 200),
      };
    }
    return {
      error: "Couldn't reach Claude.",
      hint: "Check your network connection and tap Retry.",
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Task 1: Clarifying Questions                                               */
/* -------------------------------------------------------------------------- */

export type ClarifyResult =
  | {
      ok: true;
      mode: "claude" | "demo";
      needsClarification: boolean;
      questions: ClarifyingQuestion[];
    }
  | AiFailure;

/**
 * 1. CLARIFYING QUESTIONS
 * Evaluates the organizer's one-sentence description. If key details are
 * missing (indoor/outdoor, food served, attendee ages, number of volunteers
 * available), returns up to 3 short clarifying questions as JSON.
 */
export async function clarifyEventDetails(
  sentence: string,
): Promise<ClarifyResult> {
  const client = createAnthropicClient();
  if (!client) {
    const demo = demoClarifyEventDetails(sentence);
    return {
      ok: true,
      mode: "demo",
      needsClarification: demo.needsClarification,
      questions: demo.questions,
    };
  }

  // If the sentence clearly already contains all key details, we still let
  // Claude decide, or fast-skip if heuristic sees all 4 details present.
  const response = await askClaude(client, buildClarifyPrompt(sentence));
  if ("error" in response) {
    return { ok: false, error: response.error, hint: response.hint };
  }

  const raw = extractJson(response.text);
  if (raw === null) {
    return {
      ok: false,
      error: "Claude returned an unreadable response for clarifying questions.",
      hint: "Tap Retry to ask again, or skip straight to building the plan.",
    };
  }

  const normalized = normalizeClarifyingQuestions(raw);
  return {
    ok: true,
    mode: "claude",
    needsClarification: normalized.needsClarification,
    questions: normalized.questions,
  };
}

/* -------------------------------------------------------------------------- */
/* Task 2: Plan Generation                                                    */
/* -------------------------------------------------------------------------- */

export type PlannerResult =
  | {
      ok: true;
      mode: "claude" | "demo";
      plan: Plan;
      issues: PlanIssue[];
      attempts: number;
      raw: string;
      note?: string;
      adjustedFromPastEvent?: string;
    }
  | AiFailure;

function repairableIssues(plan: Plan, issues: PlanIssue[]) {
  const problems: string[] = [];
  if (!plan.title.trim()) problems.push("Give the event a title.");

  for (const issue of issues) {
    if (issue.level !== "error") continue;
    problems.push(issue.message);
  }

  const windowLine = (() => {
    const times = plan.roles
      .flatMap((role) => role.shifts)
      .map((shift) => `${shift.start}-${shift.end}`)
      .join(", ");
    return times ? `Current shifts: ${times}` : "";
  })();

  if (windowLine) problems.push(windowLine);
  return problems.slice(0, 12);
}

/**
 * 2. PLAN GENERATION
 * Calls Claude with system prompt "You are an event staffing planner. Return ONLY valid JSON."
 * Returns `{ title, roles: [{ name, description, why, shifts: [{ start, end, headcount }] }] }`.
 * Validates 30-90m shifts and full event coverage, repairing once if needed.
 */
export async function generatePlan(
  request: PlannerRequest,
  customBuildPrompt: (request: PlannerRequest) => string = buildUserPrompt,
  customBuildRepair: (
    request: PlannerRequest,
    raw: string,
    problems: string[],
  ) => string = buildRepairPrompt,
): Promise<PlannerResult> {
  const client = createAnthropicClient();
  const window = {
    start: request.windowStart,
    end: request.windowEnd,
  };

  if (!client) {
    const { plan, note, adjustedFromPastEvent } = generateDemoPlan(
      request.sentence,
      request.windowStart,
      request.windowEnd,
      request.eventDate ?? "your event date",
      {
        clarifications: request.clarifications,
        pastEventsSummary: request.pastEventsSummary,
      },
    );
    const issues = validatePlan(plan, window);
    return {
      ok: true,
      mode: "demo",
      plan,
      issues,
      attempts: 1,
      raw: JSON.stringify(plan),
      note,
      adjustedFromPastEvent,
    };
  }

  const first = await askClaude(client, customBuildPrompt(request));
  if ("error" in first) {
    return { ok: false, error: first.error, hint: first.hint };
  }

  const firstJson = extractJson(first.text);
  if (firstJson === null) {
    return {
      ok: false,
      error: "Claude returned an unreadable staffing plan (invalid JSON).",
      hint: "Tap Retry to generate the plan again.",
    };
  }

  let plan = normalizePlan(firstJson);
  let issues = validatePlan(plan, window);

  if (issues.some((issue) => issue.level === "error")) {
    const second = await askClaude(
      client,
      customBuildRepair(request, first.text, repairableIssues(plan, issues)),
    );

    if (!("error" in second)) {
      const secondJson = extractJson(second.text);
      if (secondJson !== null) {
        const repaired = normalizePlan(secondJson);
        const repairedIssues = validatePlan(repaired, window);

        const before = issues.filter((i) => i.level === "error").length;
        const after = repairedIssues.filter((i) => i.level === "error").length;
        if (after < before) {
          plan = repaired;
          issues = repairedIssues;
        }

        return {
          ok: true,
          mode: "claude",
          plan,
          issues,
          attempts: 2,
          raw: after < before ? second.text : first.text,
          adjustedFromPastEvent: request.pastEventsSummary?.uiNote,
        };
      }
    }
  }

  return {
    ok: true,
    mode: "claude",
    plan,
    issues,
    attempts: 1,
    raw: first.text,
    adjustedFromPastEvent: request.pastEventsSummary?.uiNote,
  };
}

/** Backwards-compatible alias for existing imports. */
export const generatePlanWithClaude = generatePlan;

/* -------------------------------------------------------------------------- */
/* Task 3: Chat Editing                                                       */
/* -------------------------------------------------------------------------- */

export type ChatEditInput = {
  plan: Plan;
  instruction: string;
  windowStart: number | null;
  windowEnd: number | null;
};

export type ChatEditResult =
  | {
      ok: true;
      mode: "claude" | "demo";
      plan: Plan;
      whatChanged: string;
      issues: PlanIssue[];
    }
  | AiFailure;

/**
 * 3. CHAT EDITING
 * Sends the current plan JSON plus the organizer's plain-English request to
 * Claude, returning the full updated plan in the same format plus a short
 * `whatChanged` summary.
 */
export async function editPlanWithChat(
  input: ChatEditInput,
): Promise<ChatEditResult> {
  const client = createAnthropicClient();
  const window = { start: input.windowStart, end: input.windowEnd };

  if (!client) {
    const { plan, whatChanged } = applyDemoChatEdit(
      input.plan,
      input.instruction,
      window,
    );
    return {
      ok: true,
      mode: "demo",
      plan,
      whatChanged,
      issues: validatePlan(plan, window),
    };
  }

  const response = await askClaude(client, buildChatEditPrompt(input));
  if ("error" in response) {
    return { ok: false, error: response.error, hint: response.hint };
  }

  const raw = extractJson(response.text);
  if (raw === null) {
    return {
      ok: false,
      error: "Claude couldn't return a valid updated plan JSON.",
      hint: "Tap Retry or rephrase your change request.",
    };
  }

  const { plan, whatChanged } = normalizeChatEdit(
    raw,
    input.plan,
    input.instruction,
  );
  if (plan.roles.length === 0) {
    return {
      ok: false,
      error: "The updated plan came back without any roles.",
      hint: "Tap Retry to try that edit again.",
    };
  }

  return {
    ok: true,
    mode: "claude",
    plan,
    whatChanged,
    issues: validatePlan(plan, window),
  };
}

/* -------------------------------------------------------------------------- */
/* Task 4: Plan Check                                                         */
/* -------------------------------------------------------------------------- */

export type PlanCheckInput = {
  plan: Plan;
  sentence?: string;
  windowStart: number | null;
  windowEnd: number | null;
};

export type PlanCheckResult =
  | {
      ok: true;
      mode: "claude" | "demo";
      warnings: PlanWarning[];
    }
  | AiFailure;

/**
 * 4. PLAN CHECK
 * Reviews the current plan for operational gaps (no breaks, missing
 * setup/cleanup, understaffed busy hours) and returns up to 3 warnings as JSON,
 * each with an actionable `fixPrompt` for the chat-edit function.
 */
export async function checkPlanForGaps(
  input: PlanCheckInput,
): Promise<PlanCheckResult> {
  const client = createAnthropicClient();
  const window = { start: input.windowStart, end: input.windowEnd };

  if (!client) {
    return {
      ok: true,
      mode: "demo",
      warnings: checkDemoPlanForGaps(input.plan, window),
    };
  }

  const response = await askClaude(client, buildPlanCheckPrompt(input));
  if ("error" in response) {
    return { ok: false, error: response.error, hint: response.hint };
  }

  const raw = extractJson(response.text);
  if (raw === null) {
    return {
      ok: false,
      error: "Claude returned an unreadable plan-check response.",
      hint: "Tap Retry to run the plan check again.",
    };
  }

  return {
    ok: true,
    mode: "claude",
    warnings: normalizePlanWarnings(raw),
  };
}

/* -------------------------------------------------------------------------- */
/* Task 5: Publish Copy Generation                                            */
/* -------------------------------------------------------------------------- */

export type PublishCopyInput = {
  plan: Plan;
  sentence?: string;
  date: string;
  start: string;
  end: string;
  location?: string;
};

export type PublishCopyResult =
  | {
      ok: true;
      mode: "claude" | "demo";
      copy: PublishCopy;
    }
  | AiFailure;

/**
 * 5. PUBLISH
 * Generates a friendly event description, a plain-language description of each
 * role (what to do, what to wear or bring), and a short announcement message
 * the organizer can copy into a group chat.
 */
export async function generatePublishCopy(
  input: PublishCopyInput,
): Promise<PublishCopyResult> {
  const client = createAnthropicClient();

  if (!client) {
    return {
      ok: true,
      mode: "demo",
      copy: generateDemoPublishCopy(input),
    };
  }

  const response = await askClaude(client, buildPublishCopyPrompt(input));
  if ("error" in response) {
    return { ok: false, error: response.error, hint: response.hint };
  }

  const raw = extractJson(response.text);
  if (raw === null) {
    return {
      ok: false,
      error: "Claude returned an unreadable response while writing the event descriptions.",
      hint: "Tap Retry to generate the descriptions again.",
    };
  }

  return {
    ok: true,
    mode: "claude",
    copy: normalizePublishCopy(raw, input.plan),
  };
}

/* -------------------------------------------------------------------------- */
/* Task 6: Personalized Volunteer Thank-You Messages                          */
/* -------------------------------------------------------------------------- */

export type VolunteerThankYouInputItem = {
  volunteerId: string;
  volunteerName: string;
  roleName: string;
  hours: number;
};

export type VolunteerThankYouInput = {
  eventTitle: string;
  eventDate?: string;
  volunteers: ReadonlyArray<VolunteerThankYouInputItem>;
};

export type VolunteerThankYouMessage = {
  volunteerId: string;
  volunteerName: string;
  roleName: string;
  hours: number;
  message: string;
};

export type VolunteerThankYouResult =
  | {
      ok: true;
      mode: "claude" | "demo";
      messages: VolunteerThankYouMessage[];
    }
  | AiFailure;

function buildDefaultThankYouMessage(
  eventTitle: string,
  item: VolunteerThankYouInputItem,
): string {
  const hoursFormatted = Number(item.hours || 0).toFixed(2);
  if (item.hours > 0) {
    return `Hi ${item.volunteerName}, thank you so much for contributing ${hoursFormatted} verified hours on ${item.roleName} at ${eventTitle}! Your help kept things running smoothly from start to finish, and your hours are now verified on your ShiftShare certificate.`;
  }
  return `Hi ${item.volunteerName}, thank you for signing up for ${item.roleName} at ${eventTitle}! We appreciate your support for our community event and hope to see you at the next one.`;
}

export function normalizeThankYouMessages(
  raw: unknown,
  input: VolunteerThankYouInput,
): VolunteerThankYouMessage[] {
  const rawList: unknown[] = Array.isArray(raw)
    ? raw
    : raw &&
        typeof raw === "object" &&
        Array.isArray((raw as { messages?: unknown }).messages)
      ? ((raw as { messages: unknown[] }).messages ?? [])
      : [];

  return input.volunteers.map((v, idx) => {
    const match =
      rawList.find(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          ((entry as { volunteerId?: unknown }).volunteerId === v.volunteerId ||
            String(
              (entry as { volunteerName?: unknown }).volunteerName ?? "",
            ).toLowerCase() === v.volunteerName.toLowerCase()),
      ) ?? rawList[idx];

    const customMsg =
      match &&
      typeof match === "object" &&
      typeof (match as { message?: unknown }).message === "string"
        ? (match as { message: string }).message.trim()
        : "";

    return {
      volunteerId: v.volunteerId,
      volunteerName: v.volunteerName,
      roleName: v.roleName,
      hours: Math.round(Math.max(0, v.hours) * 100) / 100,
      message:
        customMsg || buildDefaultThankYouMessage(input.eventTitle, v),
    };
  });
}

function buildThankYouPrompt(input: VolunteerThankYouInput): string {
  return [
    `Write a warm, specific, plain-language thank-you message for each volunteer at "${input.eventTitle}"${input.eventDate ? ` (${input.eventDate})` : ""}.`,
    `Reference each volunteer's first name or full name, their specific role, and the exact verified hours they contributed.`,
    `Return ONLY valid JSON matching this schema:`,
    `{ "messages": [{ "volunteerId": "string", "volunteerName": "string", "roleName": "string", "hours": number, "message": "2-3 sentence thank-you note" }] }`,
    `Volunteers:`,
    JSON.stringify(input.volunteers),
  ].join("\n");
}

/**
 * 6. THANK VOLUNTEERS
 * Writes a personalized thank-you message for each volunteer based on their
 * role and verified hours, which the organizer can edit and copy.
 */
export async function generateVolunteerThankYous(
  input: VolunteerThankYouInput,
): Promise<VolunteerThankYouResult> {
  if (input.volunteers.length === 0) {
    return { ok: true, mode: "demo", messages: [] };
  }

  const client = createAnthropicClient();
  if (!client) {
    return {
      ok: true,
      mode: "demo",
      messages: normalizeThankYouMessages(null, input),
    };
  }

  const response = await askClaude(client, buildThankYouPrompt(input));
  if ("error" in response) {
    return { ok: false, error: response.error, hint: response.hint };
  }

  const raw = extractJson(response.text);
  if (raw === null) {
    return {
      ok: false,
      error: "Claude returned an unreadable response while writing thank-you messages.",
      hint: "Tap Retry to generate the thank-you messages again.",
    };
  }

  return {
    ok: true,
    mode: "claude",
    messages: normalizeThankYouMessages(raw, input),
  };
}

/* -------------------------------------------------------------------------- */
/* Task 7: AI Event Recap Card                                                */
/* -------------------------------------------------------------------------- */

export type EventRecapRoleStat = {
  roleName: string;
  capacity: number;
  signedUp: number;
  attended: number;
  fillRatePercent: number;
};

export type EventRecapInput = {
  eventTitle: string;
  totalCapacity: number;
  confirmedSignups: number;
  fillRatePercent: number;
  checkedInCount: number;
  noShowCount: number;
  noShowRatePercent: number;
  totalVolunteerHours: number;
  roles: ReadonlyArray<EventRecapRoleStat>;
};

export type EventRecap = {
  /** 3-4 sentences summarizing the event's performance from signup and check-in data. */
  summary: string;
  /** 2 actionable suggestions for next time. */
  suggestions: [string, string];
};

export type EventRecapResult =
  | {
      ok: true;
      mode: "claude" | "demo";
      recap: EventRecap;
    }
  | AiFailure;

function buildDemoEventRecap(input: EventRecapInput): EventRecap {
  const hoursStr = Number(input.totalVolunteerHours || 0).toFixed(2);
  const lowestRole = [...input.roles].sort(
    (a, b) => a.fillRatePercent - b.fillRatePercent,
  )[0];
  const highestRole = [...input.roles].sort(
    (a, b) => b.fillRatePercent - a.fillRatePercent,
  )[0];

  const sentence1 = `${input.eventTitle} filled ${input.confirmedSignups} of ${input.totalCapacity} total shift spots (${input.fillRatePercent}% fill rate) across ${input.roles.length || 1} ${input.roles.length === 1 ? "role" : "roles"}.`;
  const sentence2 = `${input.checkedInCount} ${input.checkedInCount === 1 ? "volunteer" : "volunteers"} checked in on site and contributed ${hoursStr} total verified hours, with ${input.noShowCount} ${input.noShowCount === 1 ? "no-show" : "no-shows"} (${input.noShowRatePercent}% no-show rate).`;
  const sentence3 = highestRole
    ? `${highestRole.roleName} saw the strongest turnout at ${highestRole.fillRatePercent}% filled (${highestRole.attended} attended), keeping core stations covered.`
    : `Volunteer check-ins tracked cleanly through QR scans from arrival to checkout.`;
  const sentence4 =
    lowestRole && lowestRole.roleName !== highestRole?.roleName
      ? `${lowestRole.roleName} had the tightest coverage at ${lowestRole.fillRatePercent}% filled (${lowestRole.signedUp} of ${lowestRole.capacity} spots claimed).`
      : `Overall attendance held steady across the scheduled shift windows.`;

  const suggestion1 =
    input.noShowRatePercent > 15
      ? `Add a 15–20% standby buffer and send a reminder 24 hours before shift start to offset the ${input.noShowRatePercent}% no-show rate.`
      : `Send a quick 24-hour reminder with the check-in desk location so all ${input.confirmedSignups} confirmed volunteers arrive inside the 30-minute check-in window.`;

  const suggestion2 =
    lowestRole && lowestRole.fillRatePercent < 100
      ? `Open signups for ${lowestRole.roleName} (${lowestRole.fillRatePercent}% filled) a few days earlier or split its window into shorter 60-minute shifts next time.`
      : `Keep the QR check-in poster posted at both the entrance and break area so every volunteer remembers to scan out before leaving.`;

  return {
    summary: `${sentence1} ${sentence2} ${sentence3} ${sentence4}`,
    suggestions: [suggestion1, suggestion2],
  };
}

export function normalizeEventRecap(
  raw: unknown,
  input: EventRecapInput,
): EventRecap {
  const fallback = buildDemoEventRecap(input);
  if (!raw || typeof raw !== "object") return fallback;

  const obj = raw as { summary?: unknown; suggestions?: unknown };
  const summary =
    typeof obj.summary === "string" && obj.summary.trim().length >= 20
      ? obj.summary.trim()
      : fallback.summary;

  const rawSuggestions = Array.isArray(obj.suggestions)
    ? obj.suggestions
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim())
    : [];

  const suggestions: [string, string] = [
    rawSuggestions[0] ?? fallback.suggestions[0],
    rawSuggestions[1] ?? fallback.suggestions[1],
  ];

  return { summary, suggestions };
}

function buildEventRecapPrompt(input: EventRecapInput): string {
  return [
    `Summarize the performance of "${input.eventTitle}" in 3-4 plain-language sentences and give 2 specific suggestions for next time, based strictly on this real signup and check-in data.`,
    `Return ONLY valid JSON matching this schema:`,
    `{ "summary": "3-4 sentences citing actual numbers (fill rate, check-ins, no-show rate, hours)", "suggestions": ["suggestion 1", "suggestion 2"] }`,
    `Event data:`,
    JSON.stringify(input),
  ].join("\n");
}

/**
 * 7. EVENT RECAP
 * Summarizes the event's performance in 3-4 sentences and gives 2 suggestions
 * for next time based on real signup and check-in data.
 */
export async function generateEventRecap(
  input: EventRecapInput,
): Promise<EventRecapResult> {
  const client = createAnthropicClient();
  if (!client) {
    return {
      ok: true,
      mode: "demo",
      recap: buildDemoEventRecap(input),
    };
  }

  const response = await askClaude(client, buildEventRecapPrompt(input));
  if ("error" in response) {
    return { ok: false, error: response.error, hint: response.hint };
  }

  const raw = extractJson(response.text);
  if (raw === null) {
    return {
      ok: false,
      error: "Claude returned an unreadable response for the event recap.",
      hint: "Tap Retry to generate the recap again.",
    };
  }

  return {
    ok: true,
    mode: "claude",
    recap: normalizeEventRecap(raw, input),
  };
}
