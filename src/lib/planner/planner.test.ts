/**
 * Unit tests for the planner's parsing, validation, and 6-part AI workflow.
 *
 *   npm test
 *
 * Plain node:assert — no framework. These cover the rules that decide whether a
 * plan is publishable and verify all 6 parts of /events/new.
 */

import assert from "node:assert/strict";
import {
  extractJson,
  normalizeChatEdit,
  normalizeClarifyingQuestions,
  normalizePlan,
  normalizePlanWarnings,
  normalizePublishCopy,
  summarizePlanDiff,
} from "./parse";
import { validatePlan, hasBlockingIssues } from "./validate";
import { parseTime, toHHMM, formatDuration, formatRange } from "./time";
import {
  applyDemoChatEdit,
  checkDemoPlanForGaps,
  demoClarifyEventDetails,
  generateDemoPlan,
  generateDemoPublishCopy,
  windowFromSentence,
} from "./demo";
import { summarizePastEvents } from "./past-events";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import { minutesToHHMM, slugify, toInstant, uniqueSlug } from "./publish";
import { toWirePlan, type Plan, type PlanRole, type PlanShift, type PlanWindow } from "./types";

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL  ${name}`);
    console.log(`      ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  }
}

function shift(start: string, end: string, headcount = 2): PlanShift {
  return { id: `${start}-${end}`, start, end, headcount };
}

function role(
  name: string,
  shifts: PlanShift[],
  description = "Do the thing.",
  why = "Two people keep the station covered.",
): PlanRole {
  return { name, description, why, shifts };
}

function planOf(...roles: PlanRole[]): Plan {
  return { title: "Test event", roles };
}

const NO_WINDOW: PlanWindow = { start: null, end: null };

const errors = (plan: Plan, window: PlanWindow = NO_WINDOW) =>
  validatePlan(plan, window).filter((i) => i.level === "error");

const warnings = (plan: Plan, window: PlanWindow = NO_WINDOW) =>
  validatePlan(plan, window).filter((i) => i.level === "warning");

console.log("\ntime helpers");

test("parses 24-hour and 12-hour times", () => {
  assert.equal(parseTime("09:00"), 540);
  assert.equal(parseTime("9:00"), 540);
  assert.equal(parseTime("9am"), 540);
  assert.equal(parseTime("9:00 AM"), 540);
  assert.equal(parseTime("1:30pm"), 810);
  assert.equal(parseTime("12:00am"), 0);
  assert.equal(parseTime("12:00pm"), 720);
  assert.equal(parseTime("23:59"), 1439);
});

test("rejects nonsense times instead of guessing", () => {
  assert.equal(parseTime(""), null);
  assert.equal(parseTime("noon"), null);
  assert.equal(parseTime("25:00"), null);
  assert.equal(parseTime("10:75"), null);
  assert.equal(parseTime("abc"), null);
});

test("formats durations and ranges", () => {
  assert.equal(toHHMM(540), "09:00");
  assert.equal(toHHMM(780), "13:00");
  assert.equal(formatDuration(30), "30 min");
  assert.equal(formatDuration(60), "1 hr");
  assert.equal(formatDuration(90), "1 hr 30 min");
  assert.equal(formatRange(540, 780), "9:00am – 1:00pm");
});

console.log("\njson recovery");

test("parses clean JSON", () => {
  const parsed = extractJson('{"title":"Food drive","roles":[]}') as Plan;
  assert.equal(parsed.title, "Food drive");
});

test("strips ```json fences", () => {
  const parsed = extractJson('```json\n{"title":"Fenced","roles":[]}\n```') as Plan;
  assert.equal(parsed.title, "Fenced");
});

test("pulls JSON out of surrounding prose", () => {
  const parsed = extractJson(
    'Sure! Here is the plan:\n{"title":"Chatty","roles":[]}\nLet me know if you want changes.',
  ) as Plan;
  assert.equal(parsed.title, "Chatty");
});

test("handles braces inside strings", () => {
  const parsed = extractJson(
    '{"title":"Roller derby {night}","roles":[{"name":"Door","description":"Check {tickets}","shifts":[]}]}',
  ) as Plan;
  assert.equal(parsed.title, "Roller derby {night}");
  assert.equal(parsed.roles[0].description, "Check {tickets}");
});

test("returns null on unparseable output rather than throwing", () => {
  assert.equal(extractJson("I cannot help with that."), null);
  assert.equal(extractJson("{ broken: "), null);
});

console.log("\nnormalising model output");

test("coerces loose times, headcounts, and why explanations", () => {
  const plan = normalizePlan({
    title: "Loose",
    roles: [
      {
        name: "Setup",
        description: "Set up.",
        why: "Three volunteers unload tables in 30 minutes.",
        shifts: [
          { start: "9am", end: "10:30am", headcount: "3 volunteers" },
          { start: "10:30 AM", end: "12:00 PM", headcount: 2.4 },
        ],
      },
    ],
  });
  assert.equal(plan.roles[0].shifts[0].start, "09:00");
  assert.equal(plan.roles[0].shifts[0].end, "10:30");
  assert.equal(plan.roles[0].shifts[0].headcount, 3);
  assert.equal(plan.roles[0].shifts[1].headcount, 2);
  assert.equal(plan.roles[0].why, "Three volunteers unload tables in 30 minutes.");
});

test("accepts alternate field names and synthesizes default why when omitted", () => {
  const plan = normalizePlan({
    title: "Aliases",
    roles: [
      { role: "Water station", details: "Hand out cups.", shifts: [{ from: "09:00", to: "10:00", people: 4 }] },
    ],
  });
  assert.equal(plan.roles[0].name, "Water station");
  assert.equal(plan.roles[0].description, "Hand out cups.");
  assert.equal(plan.roles[0].shifts[0].headcount, 4);
  assert.ok((plan.roles[0].why ?? "").length > 10);
});

test("never throws on a bare array or junk", () => {
  assert.equal(normalizePlan([{ name: "A", shifts: [{ start: "09:00", end: "10:00" }] }]).roles.length, 1);
  assert.equal(normalizePlan("nonsense").roles.length, 0);
  assert.equal(normalizePlan(null).roles.length, 0);
});

console.log("\nvalidation — durations");

test("accepts shifts of exactly 30 and 90 minutes", () => {
  assert.equal(errors(planOf(role("A", [shift("09:00", "09:30")]))).length, 0);
  assert.equal(errors(planOf(role("A", [shift("09:00", "10:30")]))).length, 0);
});

test("rejects shifts shorter than 30 or longer than 90 minutes", () => {
  assert.match(errors(planOf(role("A", [shift("09:00", "09:29")])))[0].message, /between 30 and 90/);
  assert.match(errors(planOf(role("A", [shift("09:00", "10:31")])))[0].message, /between 30 and 90/);
});

test("rejects a shift that ends before it starts", () => {
  assert.match(errors(planOf(role("A", [shift("10:00", "09:30")])))[0].message, /ends .* before it starts/);
});

test("rejects unreadable times", () => {
  assert.match(validatePlan(planOf(role("A", [shift("noon", "13:00")])))[0].message, /unreadable time/);
});

console.log("\nvalidation — coverage");

test("passes when one role covers the window end to end", () => {
  const plan = planOf(role("A", [shift("09:00", "10:30"), shift("10:30", "12:00")]));
  assert.equal(errors(plan, { start: 540, end: 720 }).length, 0);
});

test("passes when parallel roles cover the window together", () => {
  const plan = planOf(role("A", [shift("09:00", "10:00")]), role("B", [shift("10:00", "11:00")]));
  assert.equal(errors(plan, { start: 540, end: 660 }).length, 0);
});

test("flags a gap in the middle of the event", () => {
  const plan = planOf(role("A", [shift("09:00", "10:00"), shift("10:30", "11:30")]));
  const found = errors(plan, { start: 540, end: 690 });
  assert.equal(found.length, 1);
  assert.match(found[0].message, /Nobody is scheduled 10:00am – 10:30am/);
});

test("flags an uncovered tail", () => {
  const plan = planOf(role("A", [shift("09:00", "10:00")]));
  const found = errors(plan, { start: 540, end: 660 });
  assert.match(found[0].message, /10:00am – 11:00am/);
});

test("treats touching shifts as covered, not gapped", () => {
  const plan = planOf(role("A", [shift("09:00", "10:00"), shift("10:00", "11:00")]));
  assert.equal(errors(plan, { start: 540, end: 660 }).length, 0);
});

test("treats an overlapping union as covered", () => {
  const plan = planOf(
    role("A", [shift("09:00", "10:30")]),
    role("B", [shift("09:30", "11:00")]),
    role("C", [shift("10:30", "12:00")]),
  );
  assert.equal(errors(plan, { start: 540, end: 720 }).length, 0);
});

test("warns, but does not block, on setup time before the window", () => {
  const plan = planOf(role("A", [shift("08:00", "09:30"), shift("09:30", "11:00")]));
  assert.equal(errors(plan, { start: 540, end: 660 }).length, 0);
  assert.equal(warnings(plan, { start: 540, end: 660 }).length, 1);
  assert.equal(hasBlockingIssues(validatePlan(plan, { start: 540, end: 660 })), false);
});

test("falls back to the plan's own span when no window is given", () => {
  const plan = planOf(role("A", [shift("09:00", "10:00"), shift("11:00", "12:00")]));
  assert.match(errors(plan)[0].message, /Nobody is scheduled 10:00am – 11:00am/);
});

console.log("\nvalidation — roles and headcounts");

test("rejects duplicate role names", () => {
  const plan = planOf(role("Setup", [shift("09:00", "10:00")]), role("setup", [shift("10:00", "11:00")]));
  assert.match(errors(plan)[0].message, /used twice/);
});

test("rejects an empty role", () => {
  assert.match(errors(planOf(role("Setup", [])))[0].message, /has no shifts/);
});

test("rejects a blank title", () => {
  const plan = { title: "   ", roles: [role("A", [shift("09:00", "10:00")])] };
  assert.match(errors(plan)[0].message, /needs a title/);
});

test("rejects a zero headcount", () => {
  assert.match(errors(planOf(role("A", [shift("09:00", "10:00", 0)])))[0].message, /headcount of at least 1/);
});

test("rejects a plan with no roles at all", () => {
  const found = errors({ title: "Empty", roles: [] });
  assert.equal(found.length, 1);
  assert.match(found[0].message, /no roles/);
});

test("points at the offending row", () => {
  const plan = planOf(
    role("Fine", [shift("09:00", "10:00")]),
    role("Broken", [shift("09:00", "10:35")]), // 95 minutes
  );
  const found = errors(plan);
  assert.equal(found.length, 1);
  assert.equal(found[0].roleIndex, 1);
  assert.equal(found[0].shiftId, "09:00-10:35");
});

console.log("\ndemo planner & wire format");

test("produces a plan that passes validation and includes why on every role", () => {
  const { plan } = generateDemoPlan(
    "Saturday food drive at the library, 9am to 1pm, need 12 people",
    540,
    780,
    "2026-10-10",
  );
  assert.equal(errors(plan, { start: 540, end: 780 }).length, 0);
  assert.ok(plan.roles.length >= 4);
  assert.match(plan.title.toLowerCase(), /food drive/);
  for (const r of plan.roles) {
    assert.ok(r.why && r.why.length > 10, `missing why on ${r.name}`);
  }
  const wire = toWirePlan(plan);
  assert.equal(typeof wire.roles[0].why, "string");
});

test("distributes a requested headcount across roles", () => {
  const { plan } = generateDemoPlan(
    "Saturday food drive at the library, 9am to 1pm, need 12 people",
    540,
    780,
    "2026-10-10",
  );
  const peak = plan.roles.reduce(
    (sum, r) => sum + Math.max(...r.shifts.map((s) => s.headcount)),
    0,
  );
  assert.ok(peak >= 10 && peak <= 15, `peak concurrent headcount was ${peak}`);
});

test("scales headcount to attendance when only guest count is given", () => {
  const parsedWin = windowFromSentence("Fall carnival, 200 people, Saturday 10-4");
  assert.deepEqual(parsedWin, { start: 600, end: 960 });

  const { plan } = generateDemoPlan(
    "Fall carnival, 200 people, Saturday 10-4",
    600,
    960,
    "2026-10-17",
  );
  assert.equal(errors(plan, { start: 600, end: 960 }).length, 0);
  assert.match(plan.roles[1].why ?? "", /200/);
});

test("reads the window out of the sentence when none is supplied", () => {
  const { plan } = generateDemoPlan("Fall carnival on Friday, 3pm to 8pm", null, null, "2026-10-24");
  assert.equal(errors(plan, { start: 900, end: 1200 }).length, 0);

  const abbreviated = generateDemoPlan("Bake sale 3 to 8pm", null, null, "2026-10-24");
  assert.equal(errors(abbreviated.plan, { start: 900, end: 1200 }).length, 0);
});

test("handles a short event without producing sub-30-minute shifts", () => {
  const { plan } = generateDemoPlan("Park cleanup, 9:00 to 10:00", 540, 600, "2026-10-10");
  assert.equal(errors(plan, { start: 540, end: 600 }).length, 0);
});

test("every demo shift lands in the 30-90 minute band", () => {
  for (const sentence of [
    "5K race Sunday morning 7:30 to 11:30am",
    "Beach cleanup 9am to 4pm, 40 volunteers",
    "Bake sale 10am to 2pm",
    "Fall carnival, 200 people, Saturday 10-4",
  ]) {
    const { plan } = generateDemoPlan(sentence, null, null, "2026-11-01");
    for (const r of plan.roles) {
      for (const s of r.shifts) {
        const duration = (parseTime(s.end) ?? 0) - (parseTime(s.start) ?? 0);
        assert.ok(
          duration >= 30 && duration <= 90,
          `${sentence}: ${r.name} ${s.start}-${s.end} is ${duration} minutes`,
        );
      }
    }
  }
});

console.log("\npart 1 — clarifying questions");

test("returns up to 3 clarifying questions when key details are missing", () => {
  const result = demoClarifyEventDetails("Fall carnival, 200 people, Saturday 10-4");
  assert.equal(result.needsClarification, true);
  assert.ok(result.questions.length >= 1 && result.questions.length <= 3);
  for (const q of result.questions) {
    assert.ok(q.options.length >= 2);
  }
});

test("skips clarifying questions when the sentence already has enough detail", () => {
  const detailed = demoClarifyEventDetails(
    "Indoor pancake breakfast for 120 families and kids at the rec center, 8am to 12pm, serving hot food, 16 volunteers available.",
  );
  assert.equal(detailed.needsClarification, false);
  assert.equal(detailed.questions.length, 0);
});

test("normalises and caps clarifying questions JSON safely", () => {
  const parsed = normalizeClarifyingQuestions({
    needsClarification: true,
    questions: [
      { id: "1", question: "Indoor or outdoor?", options: ["Indoor", "Outdoor"] },
      { id: "2", question: "Food served?", options: ["Yes", "No"] },
      { id: "3", question: "Ages?", options: ["Kids", "All ages"] },
      { id: "4", question: "Extra question?", options: ["A", "B"] },
    ],
  });
  assert.equal(parsed.needsClarification, true);
  assert.equal(parsed.questions.length, 3);
});

console.log("\npart 3 — chat editing & undo diff");

test("adds a role at a requested time and explains what changed", () => {
  const { plan } = generateDemoPlan("Fall carnival, 200 people, Saturday 10-4", 600, 960, "2026-10-17");
  const edited = applyDemoChatEdit(plan, "add a cleanup crew at 3pm", { start: 600, end: 960 });
  assert.ok(edited.plan.roles.some((r) => /cleanup crew/i.test(r.name)));
  assert.match(edited.whatChanged, /Cleanup crew/i);
  assert.equal(errors(edited.plan, { start: 600, end: 960 }).length, 0);
});

test("scales down headcount when told we only have 15 volunteers", () => {
  const { plan } = generateDemoPlan("Fall carnival, 200 people, Saturday 10-4", 600, 960, "2026-10-17");
  const edited = applyDemoChatEdit(plan, "we only have 15 volunteers", { start: 600, end: 960 });
  assert.match(edited.whatChanged, /15 volunteers/i);
  for (const r of edited.plan.roles) {
    assert.match(r.why ?? "", /15-volunteer limit/);
  }
});

test("normalises chat edit JSON and computes fallback diff summary", () => {
  const before = planOf(role("Setup", [shift("09:00", "10:00", 2)]));
  const rawAfter = {
    title: "Test event",
    roles: [
      { name: "Setup", description: "Set up.", why: "2 people", shifts: [{ start: "09:00", end: "10:00", headcount: 2 }] },
      { name: "Cleanup", description: "Clean up.", why: "3 people", shifts: [{ start: "10:00", end: "11:00", headcount: 3 }] },
    ],
  };
  const result = normalizeChatEdit(rawAfter, before, "add cleanup");
  assert.equal(result.plan.roles.length, 2);
  assert.match(result.whatChanged, /added Cleanup/i);
  assert.match(summarizePlanDiff(before, result.plan), /added Cleanup/i);
});

console.log("\npart 4 — plan check & apply fix");

test("reviews a plan for gaps and resolves warnings when their fixPrompt is applied", () => {
  const { plan } = generateDemoPlan("Fall carnival, 200 people, Saturday 10-4", 600, 960, "2026-10-17");
  const initialWarnings = checkDemoPlanForGaps(plan, { start: 600, end: 960 });
  assert.ok(initialWarnings.length >= 1 && initialWarnings.length <= 3);

  const breakWarning = initialWarnings.find((w) => w.id === "no-breaks");
  assert.ok(breakWarning, "expected a break-relief warning on multi-shift plan");

  const fixed = applyDemoChatEdit(plan, breakWarning.fixPrompt, { start: 600, end: 960 });
  const nextWarnings = checkDemoPlanForGaps(fixed.plan, { start: 600, end: 960 });
  assert.equal(nextWarnings.find((w) => w.id === "no-breaks"), undefined);
});

test("normalises plan check warnings and caps at 3", () => {
  const parsed = normalizePlanWarnings({
    warnings: [
      { id: "a", title: "Gap 1", detail: "D1", fixPrompt: "Fix 1" },
      { id: "b", title: "Gap 2", detail: "D2", fixPrompt: "Fix 2" },
      { id: "c", title: "Gap 3", detail: "D3", fixPrompt: "Fix 3" },
      { id: "d", title: "Gap 4", detail: "D4", fixPrompt: "Fix 4" },
    ],
  });
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].fixPrompt, "Fix 1");
});

console.log("\npart 5 — publish copy generation");

test("generates event description, role descriptions with wear/bring, and group chat announcement", () => {
  const { plan } = generateDemoPlan("Saturday food drive at the Fremont library, 9am to 1pm, need 12 people", 540, 780, "2026-10-10");
  const copy = generateDemoPublishCopy({
    plan,
    sentence: "Saturday food drive at the Fremont library, 9am to 1pm, need 12 people",
    date: "2026-10-10",
    start: "09:00",
    end: "13:00",
  });
  assert.ok(copy.eventDescription.length > 30);
  assert.equal(copy.roleDescriptions.length, plan.roles.length);
  for (const r of copy.roleDescriptions) {
    assert.match(r.description, /wear|bring|shoes/i);
  }
  assert.ok(copy.announcement.length > 30);

  const normalized = normalizePublishCopy(copy, plan);
  assert.equal(normalized.roleDescriptions.length, plan.roles.length);
});

console.log("\npart 6 — learn from past events");

test("summarizes past event fill rates and no-shows and injects into prompt", () => {
  const summary = summarizePastEvents(
    [
      {
        id: "ev-1",
        title: "Spring Book Fair",
        starts_at: "2026-05-01T16:00:00Z",
        roles: [
          {
            id: "r-1",
            name: "Checkout",
            shifts: [
              {
                id: "s-1",
                capacity: 5,
                signups: [
                  { id: "sg-1", status: "confirmed", checkins: [{ id: "c-1", kind: "in", verified: true }] },
                  { id: "sg-2", status: "confirmed", checkins: [{ id: "c-2", kind: "in", verified: true }] },
                  { id: "sg-3", status: "confirmed", checkins: [] }, // no-show
                  { id: "sg-4", status: "confirmed", checkins: [] }, // no-show
                ],
              },
            ],
          },
        ],
      },
    ],
    new Date("2026-10-06T12:00:00Z").getTime(),
  );

  assert.ok(summary);
  assert.equal(summary.lastEventTitle, "Spring Book Fair");
  assert.equal(summary.fillRatePct, 80);
  assert.equal(summary.noShowCount, 2);
  assert.match(summary.uiNote, /Adjusted based on your last event/);

  assert.equal(SYSTEM_PROMPT, "You are an event staffing planner. Return ONLY valid JSON.");
  const prompt = buildUserPrompt({
    sentence: "Fall carnival, 200 people, Saturday 10-4",
    windowStart: 600,
    windowEnd: 960,
    eventDate: "2026-10-17",
    pastEventsSummary: summary,
  });
  assert.match(prompt, /Spring Book Fair/);
  assert.match(prompt, /80% fill rate/);
  assert.match(prompt, /2 no-shows/);
});

test("skips past events summary when there is no past data or only future events", () => {
  assert.equal(summarizePastEvents([]), null);
  assert.equal(
    summarizePastEvents(
      [
        {
          id: "ev-future",
          title: "Next Month Carnival",
          starts_at: "2026-11-15T16:00:00Z",
          roles: [
            {
              id: "r-f",
              name: "Booth",
              shifts: [{ id: "s-f", capacity: 4, signups: [] }],
            },
          ],
        },
      ],
      new Date("2026-10-06T12:00:00Z").getTime(),
    ),
    null,
  );
});

console.log("\npublish helpers");

test("slugifies titles", () => {
  assert.equal(slugify("Saturday Food Drive!"), "saturday-food-drive");
  assert.equal(slugify("  Bay   Trail 5K  "), "bay-trail-5k");
  assert.equal(slugify("Fall Carnival — Centerville"), "fall-carnival-centerville");
  assert.equal(slugify("!!!"), "event");
});

test("keeps slugs unique", () => {
  assert.equal(uniqueSlug("food-drive", []), "food-drive");
  assert.equal(uniqueSlug("food-drive", ["food-drive"]), "food-drive-2");
  assert.equal(uniqueSlug("food-drive", ["food-drive", "food-drive-2"]), "food-drive-3");
  assert.equal(uniqueSlug("Food-Drive", ["food-drive"]), "Food-Drive-2");
});

test("converts organizer-local times to UTC instants", () => {
  assert.equal(toInstant("2026-10-10", "09:00", 420), "2026-10-10T16:00:00.000Z");
  assert.equal(toInstant("2026-10-10", "09:00", 0), "2026-10-10T09:00:00.000Z");
  assert.equal(toInstant("2026-10-10", "09:00", -330), "2026-10-10T03:30:00.000Z");
  assert.equal(toInstant("2026-12-10", "09:00", 480), "2026-12-10T17:00:00.000Z");
});

test("a shift keeps its local duration across a DST boundary", () => {
  const start = toInstant("2026-11-01", "09:00", 480);
  const end = toInstant("2026-11-01", "10:30", 480);
  assert.equal(new Date(end).getTime() - new Date(start).getTime(), 90 * 60_000);
});

test("minutesToHHMM formats and falls back", () => {
  assert.equal(minutesToHHMM(540), "09:00");
  assert.equal(minutesToHHMM(90), "01:30");
  assert.equal(minutesToHHMM(null), "09:00");
  assert.equal(minutesToHHMM(null, "13:00"), "13:00");
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  console.log("Failed:");
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
