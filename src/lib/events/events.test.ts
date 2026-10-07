/**
 * Unit tests for the public event page's pure logic — timezone-aware time
 * formatting and the "can't be in two places at once" rule.
 *
 *   npm test
 *
 * Plain node:assert, same style as the planner suite.
 */

import assert from "node:assert/strict";
import {
  eventClock,
  eventDay,
  eventTimeRange,
  eventZoneLabel,
  isPast,
  minutesBetween,
  safeZone,
  sameEventDay,
} from "./format";
import {
  findConflict,
  spansOverlap,
  toSpan,
  type BookedShift,
} from "./overlap";

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

const LA = "America/Los_Angeles";

// 16:00Z on a Saturday in October — 9:00am in California.
const SATURDAY_9AM = "2026-10-10T16:00:00.000Z";
const SATURDAY_1PM = "2026-10-10T20:00:00.000Z";

console.log("\nevent formatting");

test("falls back to UTC for a missing or bogus zone", () => {
  assert.equal(safeZone(LA), LA);
  assert.equal(safeZone(null), "UTC");
  assert.equal(safeZone(undefined), "UTC");
  assert.equal(safeZone(""), "UTC");
  assert.equal(safeZone("Mars/Olympus_Mons"), "UTC");
});

test("renders the event's wall clock, not the reader's", () => {
  // The same instant, read in three places.
  assert.equal(eventClock(SATURDAY_9AM, LA), "9:00am");
  assert.equal(eventClock(SATURDAY_9AM, "UTC"), "4:00pm");
  assert.equal(eventClock(SATURDAY_9AM, "Asia/Kolkata"), "9:30pm");
});

test("formats the day the event is actually on", () => {
  assert.equal(eventDay(SATURDAY_9AM, LA), "Saturday, October 10");
  // Same instant, read from Kolkata: late on the same Saturday evening.
  assert.equal(eventDay(SATURDAY_9AM, "Asia/Kolkata"), "Saturday, October 10");
  // The 1pm finish is 1:30am Sunday there — a different day entirely.
  assert.equal(eventDay(SATURDAY_1PM, "Asia/Kolkata"), "Sunday, October 11");
});

test("names the zone so the clock is unambiguous", () => {
  assert.equal(eventZoneLabel(SATURDAY_9AM, LA), "PDT");
  // Winter in California.
  assert.equal(eventZoneLabel("2026-12-10T17:00:00.000Z", LA), "PST");
});

test("crossing a daylight-saving boundary still reads correctly", () => {
  // US clocks go back on 2026-11-01 at 02:00 local, so this instant is PST.
  assert.equal(eventClock("2026-11-01T16:00:00.000Z", LA), "8:00am");
  assert.equal(eventZoneLabel("2026-11-01T16:00:00.000Z", LA), "PST");
});

test("renders a time range on one line", () => {
  assert.equal(eventTimeRange(SATURDAY_9AM, SATURDAY_1PM, LA), "9:00am – 1:00pm");
});

test("spells out the date on a range that runs past midnight", () => {
  // 11:00pm Saturday to 12:30am Sunday, in California.
  const range = eventTimeRange(
    "2026-10-11T06:00:00.000Z",
    "2026-10-11T07:30:00.000Z",
    LA,
  );
  assert.equal(range, "11:00pm – Sunday, October 11 12:30am");
});

test("compares days in the event's zone", () => {
  // 9:00am and 1:00pm on the same California Saturday.
  assert.equal(sameEventDay(SATURDAY_9AM, SATURDAY_1PM, LA), true);
  // 11:00pm Saturday to 12:30am Sunday is not.
  assert.equal(
    sameEventDay("2026-10-11T06:00:00.000Z", "2026-10-11T07:30:00.000Z", LA),
    false,
  );
  // And the same two instants *are* one day in Los Angeles but two in Kolkata:
  // the day boundary moves with the zone.
  assert.equal(sameEventDay(SATURDAY_9AM, SATURDAY_1PM, LA), true);
  assert.equal(sameEventDay(SATURDAY_9AM, SATURDAY_1PM, "Asia/Kolkata"), false);
});

test("measures durations in whole minutes", () => {
  assert.equal(minutesBetween(SATURDAY_9AM, SATURDAY_1PM), 240);
  assert.equal(minutesBetween(SATURDAY_9AM, SATURDAY_9AM), 0);
  assert.equal(minutesBetween("nonsense", SATURDAY_9AM), 0);
});

test("knows when an event has already happened", () => {
  const now = new Date(SATURDAY_9AM);
  assert.equal(isPast("2026-10-09T16:00:00.000Z", now), true);
  assert.equal(isPast(SATURDAY_1PM, now), false);
});

console.log("\noverlap detection");

test("back-to-back shifts do not overlap", () => {
  const first = { startMs: 0, endMs: 90 };
  const second = { startMs: 90, endMs: 180 };
  assert.equal(spansOverlap(first, second), false);
  assert.equal(spansOverlap(second, first), false);
});

test("a shift starting inside another one overlaps", () => {
  assert.equal(
    spansOverlap({ startMs: 0, endMs: 90 }, { startMs: 45, endMs: 135 }),
    true,
  );
});

test("nested, identical and one-minute overlaps all count", () => {
  assert.equal(
    spansOverlap({ startMs: 0, endMs: 120 }, { startMs: 30, endMs: 60 }),
    true,
  );
  assert.equal(spansOverlap({ startMs: 0, endMs: 90 }, { startMs: 0, endMs: 90 }), true);
  assert.equal(
    spansOverlap({ startMs: 0, endMs: 90 }, { startMs: 89, endMs: 200 }),
    true,
  );
});

test("reads spans from ISO strings", () => {
  const span = toSpan(SATURDAY_9AM, SATURDAY_1PM);
  assert.equal(span?.startMs, Date.parse(SATURDAY_9AM));
  assert.equal(span?.endMs, Date.parse(SATURDAY_1PM));
  // Unusable inputs are null rather than NaN leaking into a comparison.
  assert.equal(toSpan("nope", SATURDAY_1PM), null);
  assert.equal(toSpan(SATURDAY_1PM, SATURDAY_9AM), null);
  assert.equal(toSpan(SATURDAY_1PM, SATURDAY_1PM), null);
});

test("finds the clashing shift, and says nothing when there is none", () => {
  const booked: BookedShift[] = [
    {
      shiftId: "b",
      label: "Teardown",
      startMs: 9 * 60,
      endMs: 11 * 60,
    },
    {
      shiftId: "a",
      label: "Check-in table",
      startMs: 8 * 60,
      endMs: 9 * 60 + 30,
    },
  ];

  // Overlaps both — the earlier one is the one worth naming.
  const conflict = findConflict({ startMs: 8 * 60 + 45, endMs: 10 * 60 }, booked);
  assert.equal(conflict?.shiftId, "a");
  assert.equal(conflict?.label, "Check-in table");

  // Clear of everything.
  assert.equal(findConflict({ startMs: 11 * 60, endMs: 12 * 60 }, booked), null);
  // No schedule at all, or no target.
  assert.equal(findConflict({ startMs: 0, endMs: 600 }, []), null);
  assert.equal(findConflict(null, booked), null);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  console.log("Failed:");
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
