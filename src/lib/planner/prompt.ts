import { toFriendlyTime } from "@/lib/planner/time";
import {
  MAX_SHIFT_MINUTES,
  MIN_SHIFT_MINUTES,
  toWirePlan,
  type PastEventsSummary,
  type Plan,
} from "@/lib/planner/types";

/**
 * The system prompt is exactly as specified — it's also the strongest
 * instruction we have, so the schema and constraints go in the user turn where
 * they change per request anyway.
 */
export const SYSTEM_PROMPT =
  "You are an event staffing planner. Return ONLY valid JSON.";

export type PlannerRequest = {
  sentence: string;
  windowStart: number | null;
  windowEnd: number | null;
  eventDate?: string;
  clarifications?: Record<string, string>;
  pastEventsSummary?: PastEventsSummary | null;
};

/**
 * Task 1: Clarifying Questions prompt.
 */
export function buildClarifyPrompt(sentence: string): string {
  return `Review this one-sentence event description and decide whether key staffing details are missing:

Organizer's description:
"""${sentence}"""

Check for these 4 key details:
1. indoor/outdoor setting
2. whether food or drinks are served
3. attendee ages (e.g. kids & families, all ages, adults)
4. number of volunteers available

If the sentence already includes enough detail (at least 3 of the 4 key details are clear), skip clarifying questions by returning:
{"needsClarification": false, "questions": []}

Otherwise, return up to 3 short clarifying questions for the missing details in this exact JSON shape:
{"needsClarification": true, "questions": [{"id": "setting", "question": "Indoor or outdoor?", "options": ["Outdoors", "Indoors", "Both"]}]}

Rules:
- Return at most 3 questions.
- Keep each question under 8 words.
- Provide 3 or 4 short quick-tap options per question (2 to 4 words each).
- Output the JSON object and nothing else.`;
}

/**
 * Task 2: Plan Generation prompt (with optional clarifications and past-event history).
 */
export function buildUserPrompt({
  sentence,
  windowStart,
  windowEnd,
  eventDate,
  clarifications,
  pastEventsSummary,
}: PlannerRequest): string {
  const windowLine =
    windowStart !== null && windowEnd !== null
      ? `The event runs ${toFriendlyTime(windowStart)} to ${toFriendlyTime(windowEnd)}${eventDate ? ` on ${eventDate}` : ""}. Shifts must cover that whole window.`
      : "Work out the event's start and end from the description. Shifts must cover the whole event.";

  const clarificationLines =
    clarifications && Object.keys(clarifications).length > 0
      ? `\nAdditional organizer details:\n${Object.entries(clarifications)
          .filter(([, answer]) => Boolean(answer?.trim()))
          .map(([question, answer]) => `- ${question}: ${answer}`)
          .join("\n")}\n`
      : "";

  const pastEventsLine = pastEventsSummary?.promptSummary
    ? `\nPast event history from this organizer:\n${pastEventsSummary.promptSummary}\n`
    : "";

  return `Plan volunteer staffing for this event.

Organizer's description:
"""${sentence}"""
${clarificationLines}${pastEventsLine}
${windowLine}

Return JSON in exactly this shape:
{"title": string, "roles": [{"name": string, "description": string, "why": string, "shifts": [{"start": "HH:MM", "end": "HH:MM", "headcount": number}]}]}

Rules:
- "start" and "end" are 24-hour "HH:MM" (for example "09:00", "13:30"). No am/pm, no dates, no timezone.
- Every shift is between ${MIN_SHIFT_MINUTES} and ${MAX_SHIFT_MINUTES} minutes long.
- Shifts must cover the full event including setup and cleanup, with no uncovered gaps.
- Roles run in parallel: it is normal for two roles to have shifts at the same time. Do not avoid overlap between different roles.
- Roles are jobs, not people. Include setup, main event roles, and cleanup. Four to six roles is usually right.
- "headcount" is how many volunteers that shift needs, a whole number of 1 or more. Scale headcount to the event's attendance and available volunteer pool.
- "why" is one plain sentence explaining the headcount for that role (for example: "Four volunteers run two game lanes so 200 guests aren't waiting in line.").
- "description" is one short sentence telling a volunteer what they will actually do.
- Use plain, specific wording. No marketing language.
- Output the JSON object and nothing else.`;
}

/** Second attempt: hand the model its own errors. */
export function buildRepairPrompt(
  base: PlannerRequest,
  rawOutput: string,
  problems: string[],
): string {
  return `${buildUserPrompt(base)}

Your previous answer did not satisfy the rules. Here it is:

"""
${rawOutput}
"""

Fix these specific problems and return the corrected JSON object only:
${problems.map((problem) => `- ${problem}`).join("\n")}`;
}

/**
 * Task 3: Chat Editing prompt.
 */
export function buildChatEditPrompt({
  plan,
  instruction,
  windowStart,
  windowEnd,
}: {
  plan: Plan;
  instruction: string;
  windowStart: number | null;
  windowEnd: number | null;
}): string {
  const windowLine =
    windowStart !== null && windowEnd !== null
      ? `Event window: ${toFriendlyTime(windowStart)} to ${toFriendlyTime(windowEnd)}.`
      : "Keep the full event window covered.";

  return `Update this event staffing plan based on the organizer's plain-English request.

Current plan JSON:
${JSON.stringify(toWirePlan(plan), null, 2)}

${windowLine}

Organizer's change request:
"""${instruction}"""

Return the full updated plan in this exact JSON shape:
{"title": string, "whatChanged": string, "roles": [{"name": string, "description": string, "why": string, "shifts": [{"start": "HH:MM", "end": "HH:MM", "headcount": number}]}]}

Rules:
- Keep every shift between ${MIN_SHIFT_MINUTES} and ${MAX_SHIFT_MINUTES} minutes long (24-hour "HH:MM"). If a requested shift is longer than ${MAX_SHIFT_MINUTES} minutes, split it into back-to-back shifts of ${MIN_SHIFT_MINUTES}–${MAX_SHIFT_MINUTES} minutes.
- Ensure shifts across all roles still cover the full event window without gaps.
- "why" is one short sentence explaining the headcount for each role.
- "whatChanged" is one short, plain sentence summarizing what you changed for the organizer.
- Output the JSON object and nothing else.`;
}

/**
 * Task 4: Plan Check prompt.
 */
export function buildPlanCheckPrompt({
  plan,
  sentence,
  windowStart,
  windowEnd,
}: {
  plan: Plan;
  sentence?: string;
  windowStart: number | null;
  windowEnd: number | null;
}): string {
  const windowLine =
    windowStart !== null && windowEnd !== null
      ? `Stated event hours: ${toFriendlyTime(windowStart)} to ${toFriendlyTime(windowEnd)}.`
      : "";

  return `Review this event staffing plan for operational gaps (such as no volunteer break/float relief on back-to-back shifts, missing setup or cleanup roles, or understaffed busy peak hours).

${sentence ? `Organizer's original description: """${sentence}"""\n` : ""}${windowLine}

Current plan JSON:
${JSON.stringify(toWirePlan(plan), null, 2)}

Return up to 3 warnings in this exact JSON shape:
{"warnings": [{"id": "w1", "title": string, "detail": string, "fixPrompt": string}]}

Rules:
- Return at most 3 warnings (or an empty array if the plan has no gaps).
- "title" is a short 4-to-9 word headline naming the gap.
- "detail" is one plain sentence explaining why it matters.
- "fixPrompt" is a specific plain-English instruction that can be sent to the plan editor to fix this warning (for example: "Add a Break relief float role with 2 volunteers from 11:00 to 15:00 so volunteers can take breaks").
- Use plain, specific language. Output the JSON object and nothing else.`;
}

/**
 * Task 5: Publish Copy Generation prompt.
 */
export function buildPublishCopyPrompt({
  plan,
  sentence,
  date,
  start,
  end,
  location,
}: {
  plan: Plan;
  sentence?: string;
  date: string;
  start: string;
  end: string;
  location?: string;
}): string {
  return `Generate volunteer-facing copy for publishing this event.

Event date: ${date}
Hours: ${start} to ${end}
${location ? `Location: ${location}\n` : ""}${sentence ? `Original note: """${sentence}"""\n` : ""}
Plan JSON:
${JSON.stringify(toWirePlan(plan), null, 2)}

Return JSON in this exact shape:
{
  "eventDescription": string,
  "location": string,
  "roleDescriptions": [{"name": string, "description": string}],
  "announcement": string
}

Rules:
- "eventDescription": 2 to 3 friendly, plain-English sentences welcoming volunteers and explaining what the event is and why their help matters. No marketing buzzwords.
- "roleDescriptions": one entry for each role in the plan (matching "name" exactly). Each "description" must be 1 to 2 plain sentences explaining what to do AND what to wear or bring (for example: "Run the ring-toss booth and hand out prizes. Wear comfortable shoes and a sun hat.").
- "announcement": a short, ready-to-paste group chat message (for text, WhatsApp, or Slack) inviting people to sign up for a shift.
- Output the JSON object and nothing else.`;
}
