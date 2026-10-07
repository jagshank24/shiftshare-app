import { formatRange, parseTime, toFriendlyTime, toHHMM } from "@/lib/planner/time";
import { summarizePlanDiff } from "@/lib/planner/parse";
import {
  shiftId,
  totalHeadcount,
  type ClarifyingQuestion,
  type PastEventsSummary,
  type Plan,
  type PlanRole,
  type PlanWarning,
  type PublishCopy,
} from "@/lib/planner/types";

/**
 * Deterministic planner and assistant functions used when ANTHROPIC_API_KEY is
 * not set.
 *
 * This exists so every part of /events/new — clarifying questions, plan
 * generation with "why", plain-English chat editing with undo, plan check with
 * one-tap fixes, and publish copy generation — works end-to-end without an API
 * key. It is NEVER used to hide a failing Claude call when a key is present.
 */

const ROLE_SETS: {
  match: RegExp;
  roles: { name: string; description: string; wearAndBring: string }[];
}[] = [
  {
    match: /\b(5k|10k|race|run|marathon|walk|fun run)\b/i,
    roles: [
      {
        name: "Course setup",
        description: "Put out cones, signs and the mile markers.",
        wearAndBring: "Wear running shoes and a high-visibility layer; bring work gloves if you have them.",
      },
      {
        name: "Registration tent",
        description: "Hand out bibs and answer questions from runners.",
        wearAndBring: "Wear comfortable layers for the morning chill and bring a water bottle.",
      },
      {
        name: "Water station",
        description: "Fill cups and hand them out as runners pass.",
        wearAndBring: "Wear waterproof or closed-toe shoes that can get splashed and a sun hat.",
      },
      {
        name: "Finish line",
        description: "Record bib numbers and hand out medals.",
        wearAndBring: "Wear comfortable shoes for standing and bring sunglasses.",
      },
      {
        name: "Teardown",
        description: "Collect signs and cones, and clear the course.",
        wearAndBring: "Wear closed-toe shoes and clothes you can lift and carry in.",
      },
    ],
  },
  {
    match: /\b(carnival|fair|festival|booth|halloween|fundraiser|bake)\b/i,
    roles: [
      {
        name: "Booth setup",
        description: "Build booths, hang signs and set out supplies.",
        wearAndBring: "Wear closed-toe shoes and clothes you can move tables in.",
      },
      {
        name: "Ticket booth",
        description: "Sell tickets and keep the cash box.",
        wearAndBring: "Wear comfortable layers and bring a charged phone for tap payments.",
      },
      {
        name: "Game booths",
        description: "Run the games and restock prizes.",
        wearAndBring: "Wear sneakers for standing and bring a water bottle and sun hat.",
      },
      {
        name: "Food table",
        description: "Serve food and keep the table tidy.",
        wearAndBring: "Wear closed-toe shoes and tie back long hair; aprons and gloves are provided.",
      },
      {
        name: "Teardown",
        description: "Pack everything away and clean the site.",
        wearAndBring: "Wear sturdy closed-toe shoes and clothes you don't mind getting dusty.",
      },
    ],
  },
  {
    match: /\b(food drive|pantry|meal|kitchen|donation|clothing|toy|breakfast|pancake|dinner|lunch)\b/i,
    roles: [
      {
        name: "Setup: tables and signs",
        description: "Set up tables, signs and the check-in area.",
        wearAndBring: "Wear closed-toe shoes and comfortable clothes for lifting folding tables.",
      },
      {
        name: "Check-in table",
        description: "Greet volunteers and sign people in and out.",
        wearAndBring: "Wear comfortable shoes and bring a layer in case the entrance is breezy.",
      },
      {
        name: "Sorting and packing",
        description: "Sort donations and pack them into bags.",
        wearAndBring: "Wear closed-toe shoes and sleeves you can roll up; bring a water bottle.",
      },
      {
        name: "Loading and delivery",
        description: "Carry boxes to cars and load them up.",
        wearAndBring: "Wear sturdy closed-toe shoes and bring work gloves if you have a pair.",
      },
      {
        name: "Cleanup",
        description: "Break down tables, sweep up and take out the recycling.",
        wearAndBring: "Wear closed-toe shoes and clothes you can sweep and carry boxes in.",
      },
    ],
  },
  {
    match: /\b(cleanup|clean-up|litter|beach|park|trail|garden|tree|planting)\b/i,
    roles: [
      {
        name: "Check-in and supplies",
        description: "Sign people in and hand out gloves and bags.",
        wearAndBring: "Wear comfortable shoes, sun protection, and a windbreaker.",
      },
      {
        name: "Cleanup crews",
        description: "Work in pairs picking up litter along the route.",
        wearAndBring: "Wear sturdy closed-toe shoes, long pants, and sunscreen; bring a reusable water bottle.",
      },
      {
        name: "Sorting and hauling",
        description: "Sort what's collected and haul it to the pickup point.",
        wearAndBring: "Wear work boots or sturdy sneakers and clothes that can get dirty.",
      },
      {
        name: "Wrap-up",
        description: "Count bags, return tools and sweep the staging area.",
        wearAndBring: "Wear closed-toe shoes and bring a water bottle.",
      },
    ],
  },
];

const GENERIC_ROLES = [
  {
    name: "Setup",
    description: "Set up tables, signs and supplies before doors open.",
    wearAndBring: "Wear closed-toe shoes and clothes you can lift light boxes in.",
  },
  {
    name: "Front desk",
    description: "Greet people, answer questions and sign volunteers in.",
    wearAndBring: "Wear comfortable shoes and bring a water bottle.",
  },
  {
    name: "Main activity",
    description: "Run the main activity and keep things moving.",
    wearAndBring: "Wear comfortable shoes for standing and moving around.",
  },
  {
    name: "Cleanup",
    description: "Pack everything away and leave the space tidy.",
    wearAndBring: "Wear closed-toe shoes and clothes you don't mind getting dusty.",
  },
];

/**
 * Extracts a time window from a sentence:
 * "9am to 1pm", "9:00-13:00", "from 9 until 1", "Saturday 10-4" → { start: 600, end: 960 }
 */
export function windowFromSentence(sentence: string): { start: number; end: number } | null {
  const pattern =
    /\b(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)\s*(?:-|–|—|\bto\b|\buntil\b|\btill\b|\bthrough\b)\s*(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)/i;
  const match = pattern.exec(sentence);
  if (!match) return null;

  let start = parseTime(match[1]);
  let end = parseTime(match[2]);

  if (start === null || end === null) return null;

  const endSuffix = /([ap])\.?m\.?/i.exec(match[2]);
  const startHasSuffix = /[ap]\.?m\.?/i.test(match[1]);

  if (endSuffix && !startHasSuffix && start < 12 * 60) {
    // "3 to 8pm" → 3pm to 8pm; "9 to 1pm" → 9am to 1pm
    const endIsPm = endSuffix[1].toLowerCase() === "p";
    if (endIsPm && start + 12 * 60 < end) {
      start += 12 * 60;
    }
  } else if (!endSuffix && !startHasSuffix) {
    // Bare numbers like "Saturday 10-4" or "1-5":
    // Community events between 1 and 6 without am/pm mean 1pm–6pm.
    if (start >= 60 && start <= 6 * 60) {
      start += 12 * 60;
    }
  }

  if (end <= start) end += 12 * 60;
  if (end <= start || end > 24 * 60) return null;
  return { start, end };
}

/**
 * Distinguishes volunteer headcount ("need 12 people", "18 volunteers") from
 * event attendance ("200 people", "150 guests").
 */
export function volunteerCountFromSentence(
  sentence: string,
  clarifications?: Record<string, string>,
): number | null {
  const combined = [
    sentence,
    ...(clarifications ? Object.values(clarifications) : []),
  ].join(" ");

  // Explicit volunteer keywords first.
  const volMatch =
    /(?:up to|about|around|need|have|only)?\s*(\d{1,3})\s*(?:\+\s*)?(?:volunteers?|helpers?|folks|staff|shift spots?)/i.exec(
      combined,
    );
  if (volMatch) return Math.max(1, Math.min(99, Number(volMatch[1])));

  // Range in quick-tap option like "About 20–30 volunteers"
  const rangeVolMatch = /(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})\s*volunteers?/i.exec(combined);
  if (rangeVolMatch) {
    const mid = Math.round((Number(rangeVolMatch[1]) + Number(rangeVolMatch[2])) / 2);
    return Math.max(1, Math.min(99, mid));
  }

  // "need 12 people" -> volunteer count; "200 people" -> attendance
  const needPeople = /\b(?:need|with|have|only)\s+(\d{1,3})\s*people\b/i.exec(combined);
  if (needPeople) return Math.max(1, Math.min(99, Number(needPeople[1])));

  const barePeople = /\b(\d{1,3})\s*(?:people|parent|students?)\b/i.exec(sentence);
  if (barePeople) {
    const num = Number(barePeople[1]);
    if (num <= 40) return Math.max(1, num);
  }

  return null;
}

/** Extracts expected crowd attendance ("200 people", "150 guests", "300 attendees"). */
export function attendanceFromSentence(sentence: string): number | null {
  const guestMatch = /(\d{2,4})\s*(?:guests?|attendees?|visitors?|runners?|participants?|families|kids|crowd)/i.exec(
    sentence,
  );
  if (guestMatch) return Number(guestMatch[1]);

  const peopleMatch = /\b(\d{2,4})\s*people\b/i.exec(sentence);
  if (peopleMatch && !/\b(?:need|only)\s+\d+\s*people\b/i.test(sentence)) {
    const count = Number(peopleMatch[1]);
    if (count >= 45) return count;
  }

  return null;
}

/**
 * Task 1 (Demo): Checks whether key details are missing from the organizer's
 * sentence (indoor/outdoor, food served, attendee ages, number of volunteers)
 * and returns up to 3 short clarifying questions with quick-tap options.
 */
export function demoClarifyEventDetails(sentence: string): {
  needsClarification: boolean;
  questions: ClarifyingQuestion[];
} {
  const hasSetting =
    /\b(indoors?|outdoors?|inside|outside|gym|hall|auditorium|cafeteria|library|rec center|park|field|beach|trail|parking lot|courtyard|lawn)\b/i.test(
      sentence,
    );
  const hasFood =
    /\b(food|snacks?|drinks?|water station|meals?|lunch|dinner|breakfast|pancakes?|bake|coffee|refreshments?|no food|catering|concessions?|pizza|bbq)\b/i.test(
      sentence,
    );
  const hasAges =
    /\b(kids?|children|families|family|all ages|adults?|seniors?|teens?|youth|elementary|high school|middle school|students?|toddlers?)\b/i.test(
      sentence,
    );
  const hasVolunteers = volunteerCountFromSentence(sentence) !== null;

  const missing: ClarifyingQuestion[] = [];

  if (!hasSetting) {
    missing.push({
      id: "setting",
      question: "Is the event indoors or outdoors?",
      options: ["Outdoors", "Indoors", "Both indoor & outdoor"],
    });
  }

  if (!hasFood) {
    missing.push({
      id: "food",
      question: "Will food or drinks be served?",
      options: ["Food & drink booths", "Snacks & water only", "No food served"],
    });
  }

  if (!hasVolunteers) {
    missing.push({
      id: "volunteers",
      question: "How many volunteers are available?",
      options: ["About 10 volunteers", "About 20 volunteers", "30+ volunteers"],
    });
  }

  if (!hasAges && missing.length < 3) {
    missing.push({
      id: "ages",
      question: "Who is attending?",
      options: ["Kids & families", "All ages", "Mostly adults"],
    });
  }

  // If the sentence already covers at least 3 of the 4 key details, skip!
  const knownCount =
    Number(hasSetting) + Number(hasFood) + Number(hasAges) + Number(hasVolunteers);
  if (knownCount >= 3 || missing.length === 0) {
    return { needsClarification: false, questions: [] };
  }

  return {
    needsClarification: true,
    questions: missing.slice(0, 3),
  };
}

/**
 * Splits [start, end) into chunks of at most 90 minutes, then hands the leftover
 * to the last chunk so no piece is shorter than 30 minutes.
 */
export function chunkWindow(start: number, end: number): { start: number; end: number }[] {
  const total = end - start;
  if (total <= 0) return [];
  if (total < 30) return [{ start, end: start + 30 }];

  const count = Math.max(1, Math.ceil(total / 90));
  const size = total / count;

  const chunks: { start: number; end: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const chunkStart = Math.round(start + i * size);
    const chunkEnd = i === count - 1 ? end : Math.round(start + (i + 1) * size);
    chunks.push({ start: chunkStart, end: chunkEnd });
  }
  return chunks;
}

function buildRoleWhy(
  roleName: string,
  headcount: number,
  attendance: number | null,
  isSetupOrCleanup: boolean,
  pastEventsSummary?: PastEventsSummary | null,
): string {
  const peopleLabel = headcount === 1 ? "1 volunteer" : `${headcount} volunteers`;
  const pastSuffix =
    pastEventsSummary && pastEventsSummary.noShowCount > 0
      ? ` (includes a small buffer for ${pastEventsSummary.lastEventTitle}'s no-shows)`
      : "";

  if (isSetupOrCleanup) {
    return `${peopleLabel} can handle ${roleName.toLowerCase()} in one pass so tables and gear move quickly${pastSuffix}.`;
  }
  if (attendance) {
    return `${peopleLabel} per shift scales to ${attendance} expected guests so lines stay short at ${roleName.toLowerCase()}${pastSuffix}.`;
  }
  return `${peopleLabel} per shift keeps ${roleName.toLowerCase()} covered so one person can step away briefly if needed${pastSuffix}.`;
}

export type DemoPlanOptions = {
  clarifications?: Record<string, string>;
  pastEventsSummary?: PastEventsSummary | null;
};

export function generateDemoPlan(
  sentence: string,
  windowStart: number | null,
  windowEnd: number | null,
  eventDate: string,
  options?: DemoPlanOptions,
): { plan: Plan; note: string; adjustedFromPastEvent?: string } {
  const fromSentence = windowFromSentence(sentence);
  const start = windowStart ?? fromSentence?.start ?? 9 * 60;
  const end = windowEnd ?? fromSentence?.end ?? 13 * 60;

  const clarificationsText = options?.clarifications
    ? Object.values(options.clarifications).join(" ")
    : "";
  const combinedText = `${sentence} ${clarificationsText}`.trim();

  const matchedSet =
    ROLE_SETS.find((set) => set.match.test(combinedText))?.roles ?? GENERIC_ROLES;

  // Filter out Food table if the user explicitly answered "No food served"
  const noFood = /\bno food\b/i.test(combinedText);
  const roleSet = noFood
    ? matchedSet.filter((r) => !/\bfood\b/i.test(r.name))
    : matchedSet;

  const requestedVolunteers = volunteerCountFromSentence(sentence, options?.clarifications);
  const attendance = attendanceFromSentence(sentence);
  const chunks = chunkWindow(start, end);

  // Scale concurrent headcount target from either explicit volunteer count or
  // expected attendance (roughly 1 concurrent volunteer per 12-15 attendees,
  // clamped to a practical range).
  const pastBuffer =
    options?.pastEventsSummary &&
    (options.pastEventsSummary.noShowCount > 0 || options.pastEventsSummary.fillRatePct < 85)
      ? 1.15
      : 1;

  const targetConcurrent = requestedVolunteers
    ? Math.round(requestedVolunteers * pastBuffer)
    : attendance
      ? Math.max(8, Math.min(35, Math.round((attendance / 12) * pastBuffer)))
      : null;

  const weights = roleSet.map((_, index) =>
    index === 0 || index === roleSet.length - 1 ? 0.5 : 1,
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  const roles: PlanRole[] = roleSet.map((role, roleIndex) => {
    const isSetupOrCleanup = roleIndex === 0 || roleIndex === roleSet.length - 1;
    const headcount = targetConcurrent
      ? Math.max(1, Math.round((targetConcurrent * weights[roleIndex]) / totalWeight))
      : isSetupOrCleanup
        ? 2
        : 3;

    return {
      name: role.name,
      description: role.description,
      why: buildRoleWhy(
        role.name,
        headcount,
        attendance,
        isSetupOrCleanup,
        options?.pastEventsSummary,
      ),
      shifts: chunks.map((chunk) => ({
        id: shiftId(),
        start: toHHMM(chunk.start),
        end: toHHMM(chunk.end),
        headcount,
      })),
    };
  });

  const title = titleFromSentence(sentence);

  return {
    plan: { title, roles },
    note: `Demo plan for ${formatRange(start, end)} on ${eventDate}. No ANTHROPIC_API_KEY is set, so this came from the built-in demo planner — not Claude.`,
    adjustedFromPastEvent: options?.pastEventsSummary?.uiNote,
  };
}

function titleFromSentence(sentence: string): string {
  const cleaned = sentence
    .replace(/^\s*(we('| a)?re\s+|we\s+need\s+|please\s+)?/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const firstClause = cleaned.split(/[,.;]/)[0]?.trim() ?? cleaned;
  const words = firstClause.split(" ").slice(0, 8).join(" ");
  const title = words || "Community event";

  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * Task 3 (Demo): Applies a plain-English chat edit to the current plan and
 * returns the updated plan plus a concise "what changed" summary.
 */
export function applyDemoChatEdit(
  plan: Plan,
  instruction: string,
  window: { start: number | null; end: number | null },
): { plan: Plan; whatChanged: string } {
  const text = instruction.trim();
  const lower = text.toLowerCase();

  // Compute current span
  const allStarts = plan.roles.flatMap((r) =>
    r.shifts.map((s) => parseTime(s.start)).filter((n): n is number => n !== null),
  );
  const allEnds = plan.roles.flatMap((r) =>
    r.shifts.map((s) => parseTime(s.end)).filter((n): n is number => n !== null),
  );
  const spanStart = window.start ?? (allStarts.length ? Math.min(...allStarts) : 9 * 60);
  const spanEnd = window.end ?? (allEnds.length ? Math.max(...allEnds) : 13 * 60);

  // 1. Cap or scale to N volunteers: e.g. "we only have 15 volunteers", "cap at 12 volunteers"
  const capMatch =
    /(?:only have|only|cap at|limit to|down to|maximum of|max|have)\s+(\d{1,3})\s*(?:volunteers?|people|helpers?|spots?)/i.exec(
      text,
    );
  if (capMatch) {
    const cap = Math.max(1, Number(capMatch[1]));
    const currentTotal = totalHeadcount(plan);
    const roleCount = Math.max(1, plan.roles.length);

    // Distribute `cap` concurrent volunteers across roles (setup/cleanup get
    // lighter weight, active middle roles share the rest).
    const weights = plan.roles.map((r, idx) =>
      idx === 0 ||
      idx === roleCount - 1 ||
      /\b(setup|cleanup|teardown|break|float)\b/i.test(r.name)
        ? 0.6
        : 1,
    );
    const weightSum = weights.reduce((a, b) => a + b, 0) || 1;

    const updatedRoles: PlanRole[] = plan.roles.map((role, rIdx) => {
      const targetPerShift = Math.max(
        1,
        Math.round((cap * weights[rIdx]) / weightSum),
      );
      return {
        ...role,
        why: `Scaled to ${targetPerShift} volunteer${targetPerShift === 1 ? "" : "s"} per shift to stay within your ${cap}-volunteer limit.`,
        shifts: role.shifts.map((shift) => ({
          ...shift,
          headcount: Math.min(shift.headcount, targetPerShift),
        })),
      };
    });

    const newTotal = updatedRoles.reduce(
      (s, r) => s + r.shifts.reduce((acc, sh) => acc + sh.headcount, 0),
      0,
    );
    const concurrentPeak = updatedRoles.reduce(
      (s, r) => s + Math.max(0, ...r.shifts.map((sh) => sh.headcount)),
      0,
    );

    const updatedPlan: Plan = { ...plan, roles: updatedRoles };
    return {
      plan: updatedPlan,
      whatChanged: `Scaled staffing to fit ${cap} volunteers (up to ${concurrentPeak} on shift at once, ${newTotal} shift spots down from ${currentTotal}).`,
    };
  }

  // 2. Break relief / float role request (including from Plan Check "Apply fix")
  if (/\b(break|float|relief|rover)\b/i.test(lower)) {
    const headcountMatch = /(\d+)\s*(?:volunteers?|people|floaters?)/i.exec(text);
    const headcount = headcountMatch ? Math.max(1, Math.min(10, Number(headcountMatch[1]))) : 2;
    const chunks = chunkWindow(spanStart, spanEnd);
    const existingIdx = plan.roles.findIndex((r) =>
      /\b(break|float|relief|rover)\b/i.test(r.name),
    );

    const newRole: PlanRole = {
      name: "Break relief & float",
      description: "Rotate across stations so volunteers on back-to-back shifts can take 15-minute breaks.",
      why: `${headcount} floaters let stations stay at full strength while volunteers step away for water and rest.`,
      shifts: chunks.map((c) => ({
        id: shiftId(),
        start: toHHMM(c.start),
        end: toHHMM(c.end),
        headcount,
      })),
    };

    const nextRoles =
      existingIdx >= 0
        ? plan.roles.map((r, i) => (i === existingIdx ? newRole : r))
        : [...plan.roles, newRole];

    return {
      plan: { ...plan, roles: nextRoles },
      whatChanged: `Added "Break relief & float" (${chunks.length} shift${chunks.length === 1 ? "" : "s"}, ${headcount} volunteers per shift) to cover breaks.`,
    };
  }

  // 3. Boost busy middle hours (including from Plan Check "Apply fix")
  if (/\b(busy|middle|peak|extra volunteer)\b/i.test(lower) && /\b(hour|shift|role|staff)\b/i.test(lower)) {
    let boostedCount = 0;
    const nextRoles = plan.roles.map((role, roleIdx) => {
      const isSetupOrCleanup =
        /\b(setup|set-up|cleanup|clean-up|teardown|wrap-up)\b/i.test(role.name) ||
        roleIdx === 0 ||
        roleIdx === plan.roles.length - 1;
      if (isSetupOrCleanup && plan.roles.length > 2) return role;

      const midIndex = Math.floor(role.shifts.length / 2);
      const nextShifts = role.shifts.map((shift, sIdx) => {
        const isMiddle =
          role.shifts.length <= 2 ? sIdx === 0 : sIdx > 0 && sIdx < role.shifts.length - 1;
        if (isMiddle || sIdx === midIndex) {
          boostedCount += 1;
          return { ...shift, headcount: Math.min(99, shift.headcount + 1) };
        }
        return shift;
      });
      const peakH = nextShifts.reduce((m, s) => Math.max(m, s.headcount), 1);
      return {
        ...role,
        why: `Up to ${peakH} volunteers during peak middle hours to handle the busiest crowd flow.`,
        shifts: nextShifts,
      };
    });

    return {
      plan: { ...plan, roles: nextRoles },
      whatChanged: `Added 1 extra volunteer across ${boostedCount} peak-hour shift${boostedCount === 1 ? "" : "s"} on main roles.`,
    };
  }

  // 4. Raise 1-person shifts to 2 volunteers
  if (/\b(1-person|one-person|solo|at least 2)\b/i.test(lower)) {
    let raised = 0;
    const nextRoles = plan.roles.map((role) => {
      let roleChanged = false;
      const nextShifts = role.shifts.map((s) => {
        if (s.headcount < 2) {
          raised += 1;
          roleChanged = true;
          return { ...s, headcount: 2 };
        }
        return s;
      });
      return {
        ...role,
        why: roleChanged
          ? "At least 2 volunteers per shift so nobody works a station alone."
          : role.why,
        shifts: nextShifts,
      };
    });
    return {
      plan: { ...plan, roles: nextRoles },
      whatChanged:
        raised > 0
          ? `Raised ${raised} solo shift${raised === 1 ? "" : "s"} to 2 volunteers each.`
          : "All shifts already have at least 2 volunteers.",
    };
  }

  // 5. Add a role at a specific time: e.g. "add a cleanup crew at 3pm"
  const addMatch =
    /\badd\s+(?:a\s+|an\s+)?([a-z0-9\s&-]+?)(?:\s+role)?(?:\s+at|\s+from|\s+starting|\s+for|$)\s*(.*)$/i.exec(
      text,
    );
  if (addMatch) {
    const rawRoleName = addMatch[1]
      .replace(/\s+(?:with|for)\s+\d+.*$/i, "")
      .trim();
    const roleName =
      rawRoleName.charAt(0).toUpperCase() + rawRoleName.slice(1) || "Extra crew";

    // Parse time if present (e.g. "3pm", "15:00", "3:00pm to 4:00pm")
    const rangeInTail = windowFromSentence(text);
    const singleTimeMatch =
      /\b(?:at|from|starting)\s+(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)/i.exec(text);

    let roleStart = spanStart;
    let roleEnd = spanEnd;

    if (rangeInTail) {
      roleStart = rangeInTail.start;
      roleEnd = rangeInTail.end;
    } else if (singleTimeMatch) {
      let parsed = parseTime(singleTimeMatch[1]);
      if (parsed !== null) {
        if (
          !/[ap]\.?m\.?/i.test(singleTimeMatch[1]) &&
          parsed < 12 * 60 &&
          parsed < spanStart
        ) {
          parsed += 12 * 60;
        }
        roleStart = parsed;
        roleEnd = Math.max(roleStart + 60, spanEnd);
      }
    } else if (/\b(cleanup|clean-up|teardown|wrap-up)\b/i.test(roleName)) {
      roleStart = Math.max(spanStart, spanEnd - 60);
      roleEnd = spanEnd;
    } else if (/\b(setup|set-up)\b/i.test(roleName)) {
      roleStart = spanStart;
      roleEnd = Math.min(spanEnd, spanStart + 60);
    }

    const headcountMatch = /(\d{1,2})\s*(?:volunteers?|people|helpers?)/i.exec(text);
    const headcount = headcountMatch ? Math.max(1, Number(headcountMatch[1])) : 3;

    const shifts = chunkWindow(roleStart, roleEnd).map((c) => ({
      id: shiftId(),
      start: toHHMM(c.start),
      end: toHHMM(c.end),
      headcount,
    }));

    const newRole: PlanRole = {
      name: roleName,
      description: `Handle ${roleName.toLowerCase()} tasks during ${formatRange(roleStart, roleEnd)}.`,
      why: `${headcount} volunteers cover ${roleName.toLowerCase()} from ${toFriendlyTime(roleStart)} to ${toFriendlyTime(roleEnd)}.`,
      shifts,
    };

    const existingIndex = plan.roles.findIndex(
      (r) => r.name.trim().toLowerCase() === roleName.toLowerCase(),
    );
    const nextRoles =
      existingIndex >= 0
        ? plan.roles.map((r, i) =>
            i === existingIndex ? { ...r, shifts: [...r.shifts, ...shifts] } : r,
          )
        : [...plan.roles, newRole];

    return {
      plan: { ...plan, roles: nextRoles },
      whatChanged: `Added ${roleName} (${formatRange(roleStart, roleEnd)}, ${headcount} volunteers per shift).`,
    };
  }

  // 6. Remove / delete a role
  const removeMatch = /\b(?:remove|delete|drop)\s+(?:the\s+)?([a-z0-9\s:&-]+)/i.exec(text);
  if (removeMatch && plan.roles.length > 1) {
    const target = removeMatch[1].trim().toLowerCase();
    const filtered = plan.roles.filter(
      (r) => !r.name.toLowerCase().includes(target),
    );
    if (filtered.length > 0 && filtered.length < plan.roles.length) {
      const updated = { ...plan, roles: filtered };
      return {
        plan: updated,
        whatChanged: summarizePlanDiff(plan, updated, instruction),
      };
    }
  }

  // Default fallback: adjust headcount or add a helper role based on instruction
  const delta = /\b(fewer|reduce|less|smaller)\b/i.test(lower) ? -1 : 1;
  const nextRoles = plan.roles.map((role) => ({
    ...role,
    shifts: role.shifts.map((s) => ({
      ...s,
      headcount: Math.max(1, Math.min(99, s.headcount + delta)),
    })),
  }));
  const updated = { ...plan, roles: nextRoles };
  return {
    plan: updated,
    whatChanged: summarizePlanDiff(plan, updated, instruction),
  };
}

/**
 * Task 4 (Demo): Reviews a plan for operational gaps (no breaks, missing
 * setup/cleanup, understaffed busy hours, solo stations) and returns up to 3
 * warnings with one-tap `fixPrompt` instructions.
 */
export function checkDemoPlanForGaps(
  plan: Plan,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _window?: { start: number | null; end: number | null },
): PlanWarning[] {
  const warnings: PlanWarning[] = [];

  const hasBreakRole = plan.roles.some((r) =>
    /\b(break|float|relief|rover)\b/i.test(r.name),
  );
  const hasMultiShiftRole = plan.roles.some((r) => r.shifts.length >= 2);

  if (!hasBreakRole && hasMultiShiftRole) {
    warnings.push({
      id: "no-breaks",
      title: "No break relief for back-to-back shifts",
      detail:
        "Several roles run across multiple consecutive shifts without a floater to cover water or restroom breaks.",
      fixPrompt:
        "Add a Break relief float role with 2 volunteers so people on back-to-back shifts can take a 15-minute break.",
    });
  }

  const hasSetup = plan.roles.some((r) =>
    /\b(setup|set-up|set up|prep|check-in and supplies)\b/i.test(r.name),
  );
  const hasCleanup = plan.roles.some((r) =>
    /\b(cleanup|clean-up|clean up|teardown|tear-down|wrap-up)\b/i.test(r.name),
  );

  if (!hasSetup) {
    warnings.push({
      id: "missing-setup",
      title: "No dedicated setup crew before doors open",
      detail:
        "Nobody is assigned specifically to unload supplies, place signs, and set up tables at the start.",
      fixPrompt: "Add a Setup crew role with 2 volunteers at the start of the event.",
    });
  } else if (!hasCleanup) {
    warnings.push({
      id: "missing-cleanup",
      title: "Missing cleanup crew at the end of the event",
      detail:
        "There is no teardown or cleanup crew scheduled to pack up tables and clear the site at the end.",
      fixPrompt: "Add a Cleanup crew role with 3 volunteers for the final hour of the event.",
    });
  }

  // Check if main activity roles have flat staffing during middle peak shifts
  const mainRoles = plan.roles.filter(
    (r) =>
      !/\b(setup|set-up|cleanup|clean-up|teardown|wrap-up|break|float|relief)\b/i.test(
        r.name,
      ),
  );
  const hasFlatPeak = mainRoles.some((role) => {
    if (role.shifts.length < 2) return false;
    const first = role.shifts[0].headcount;
    const max = Math.max(...role.shifts.map((s) => s.headcount));
    return max <= first;
  });

  if (hasFlatPeak && warnings.length < 3) {
    warnings.push({
      id: "busy-hours",
      title: "Peak middle hours have the same staffing as opening",
      detail:
        "Crowd traffic usually peaks in the middle of the event, but main stations have flat headcount all day.",
      fixPrompt:
        "Add 1 extra volunteer per shift on the main activity roles during the busy middle hours.",
    });
  }

  // Check for solo 1-person shifts
  const hasSoloShift = plan.roles.some((r) =>
    r.shifts.some((s) => s.headcount === 1),
  );
  if (hasSoloShift && warnings.length < 3) {
    warnings.push({
      id: "solo-shift",
      title: "Some shifts have only 1 volunteer scheduled",
      detail:
        "If a single volunteer runs late or cancels on a 1-person shift, that station goes unstaffed.",
      fixPrompt:
        "Raise any 1-person shifts to at least 2 volunteers so nobody works a station alone.",
    });
  }

  return warnings.slice(0, 3);
}

/**
 * Task 5 (Demo): Generates friendly volunteer-facing publish copy (event
 * description, per-role what-to-do + what-to-wear/bring, and group chat
 * announcement).
 */
export function generateDemoPublishCopy({
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
}): PublishCopy {
  const startMin = parseTime(start) ?? 9 * 60;
  const endMin = parseTime(end) ?? 13 * 60;
  const rangeText = formatRange(startMin, endMin);
  const spots = totalHeadcount(plan);
  const shiftCount = plan.roles.reduce((sum, r) => sum + r.shifts.length, 0);

  const detectedLocation =
    location?.trim() ||
    extractLocationFromSentence(sentence ?? "") ||
    "";

  const wherePhrase = detectedLocation ? ` at ${detectedLocation}` : "";

  const eventDescription = `Join us for ${plan.title}${wherePhrase} on ${date} (${rangeText}). We have ${spots} volunteer spots split into short 30–90 minute shifts across ${plan.roles.length} roles so everyone has time to enjoy the event too. Pick any shift below that works for you — we'll brief you when you arrive.`;

  // Match known role wear-and-bring guidance or generate sensible guidance by role name
  const allKnownRoles = [...ROLE_SETS.flatMap((s) => s.roles), ...GENERIC_ROLES];

  const roleDescriptions = plan.roles.map((role) => {
    const known = allKnownRoles.find(
      (k) => k.name.toLowerCase() === role.name.trim().toLowerCase(),
    );
    const whatToDo =
      role.description?.trim() ||
      known?.description ||
      `Help run ${role.name.toLowerCase()} and assist guests during your shift.`;

    const alreadyHasWear = /\b(wear|bring|shoes|gloves|hat|water)\b/i.test(whatToDo);
    if (alreadyHasWear) {
      return { name: role.name, description: whatToDo };
    }

    const wearGuide =
      known?.wearAndBring ??
      (/\b(setup|cleanup|teardown|loading|sorting)\b/i.test(role.name)
        ? "Wear closed-toe shoes and clothes you can lift and move in; bring a water bottle."
        : "Wear comfortable shoes for standing and bring a water bottle and weather-appropriate layer.");

    return {
      name: role.name,
      description: `${whatToDo.replace(/\.?$/, ".")} ${wearGuide}`,
    };
  });

  const announcement = `Hey everyone! We're lining up volunteers for ${plan.title}${wherePhrase} on ${date} (${rangeText}). Shifts are only 30–90 minutes and we need ${spots} spots across ${shiftCount} shifts (${plan.roles.map((r) => r.name).join(", ")}). Grab a shift that works for you here:`;

  return {
    eventDescription,
    roleDescriptions,
    announcement,
    location: detectedLocation || undefined,
  };
}

function extractLocationFromSentence(sentence: string): string {
  const match = /\b(?:at|in)\s+(?:the\s+)?([A-Z][A-Za-z0-9\s'-]{2,35}?)(?=[,.;]|\s+\b(?:on|from|for|need|with|\d)\b|$)/.exec(
    sentence,
  );
  return match ? match[1].trim() : "";
}
