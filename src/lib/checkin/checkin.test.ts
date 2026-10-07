import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateRunningTotalHours,
  calculateShiftHours,
  checkShiftWindow,
  formatHoursToTwoDecimals,
  resolveCheckoutInstantFromWallClock,
  wallClockTimeInZone,
} from "./hours";
import {
  buildCheckinPath,
  buildCheckinUrl,
  generateCheckinToken,
  generateQrCodeDataUrl,
  generateQrCodeSvg,
  isValidCheckinToken,
} from "./qr";
import { buildWhosHereRoster } from "./roster";

describe("QR check-in token & qrcode generation", () => {
  it("builds /checkin/[eventId]?token=[signed token] paths and URLs", () => {
    const eventId = "e0000000-0000-4000-8000-0000000000c1";
    const token = "secret-token-abc";

    assert.equal(
      buildCheckinPath(eventId, token),
      `/checkin/${eventId}?token=${token}`,
    );
    assert.equal(
      buildCheckinUrl(eventId, token, "https://shiftshare.app/"),
      `https://shiftshare.app/checkin/${eventId}?token=${token}`,
    );
    assert.equal(
      buildCheckinUrl(eventId, token, ""),
      `/checkin/${eventId}?token=${token}`,
    );
  });

  it("generates unique 64-character random tokens and validates them safely", () => {
    const t1 = generateCheckinToken();
    const t2 = generateCheckinToken();

    assert.equal(t1.length, 64);
    assert.equal(t2.length, 64);
    assert.notEqual(t1, t2);

    assert.equal(isValidCheckinToken(t1, t1), true);
    assert.equal(isValidCheckinToken(t1, t2), false);
    assert.equal(isValidCheckinToken("", t1), false);
    assert.equal(isValidCheckinToken(null, t1), false);
  });

  it("generates PNG data URL and SVG using the qrcode npm package", async () => {
    const url = buildCheckinUrl(
      "e0000000-0000-4000-8000-0000000000c1",
      "token-xyz",
      "http://localhost:3000",
    );
    const dataUrl = await generateQrCodeDataUrl(url, 256);
    const svg = await generateQrCodeSvg(url);

    assert.ok(dataUrl.startsWith("data:image/png;base64,"));
    assert.ok(svg.includes("<svg"));
  });
});

describe("Shift [-30 min, +30 min] check-in window", () => {
  const shiftStart = "2026-10-10T16:00:00.000Z"; // 9:00am PDT

  it("allows check-in exactly 30 minutes before shift start", () => {
    const res = checkShiftWindow(shiftStart, "2026-10-10T15:30:00.000Z");
    assert.equal(res.allowed, true);
    assert.equal(res.status, "open");
  });

  it("allows check-in at shift start and 30 minutes after shift start", () => {
    assert.equal(checkShiftWindow(shiftStart, shiftStart).allowed, true);
    const plus30 = checkShiftWindow(shiftStart, "2026-10-10T16:30:00.000Z");
    assert.equal(plus30.allowed, true);
    assert.equal(plus30.status, "open");
  });

  it("rejects check-in more than 30 minutes before shift start as early", () => {
    const early = checkShiftWindow(shiftStart, "2026-10-10T15:29:59.000Z");
    assert.equal(early.allowed, false);
    assert.equal(early.status, "early");
  });

  it("rejects check-in more than 30 minutes after shift start as late", () => {
    const late = checkShiftWindow(shiftStart, "2026-10-10T16:30:01.000Z");
    assert.equal(late.allowed, false);
    assert.equal(late.status, "late");
  });
});

describe("Server-side hours calculation (timestamps only, 2 decimals)", () => {
  it("calculates shift hours to 2 decimal places from check-in and check-out timestamps", () => {
    const inAt = "2026-10-10T16:00:00.000Z";
    const outAt90m = "2026-10-10T17:30:00.000Z";
    const outAt80m = "2026-10-10T17:20:00.000Z";

    assert.equal(calculateShiftHours(inAt, outAt90m), 1.5);
    assert.equal(formatHoursToTwoDecimals(calculateShiftHours(inAt, outAt90m)), "1.50");

    assert.equal(calculateShiftHours(inAt, outAt80m), 1.33);
    assert.equal(formatHoursToTwoDecimals(calculateShiftHours(inAt, outAt80m)), "1.33");
  });

  it("returns 0 when checkout is missing or not after checkin", () => {
    assert.equal(calculateShiftHours("2026-10-10T16:00:00Z", null), 0);
    assert.equal(
      calculateShiftHours("2026-10-10T16:00:00Z", "2026-10-10T15:00:00Z"),
      0,
    );
    assert.equal(formatHoursToTwoDecimals(0), "0.00");
  });

  it("computes running total hours across multiple shifts to 2 decimals", () => {
    const total = calculateRunningTotalHours([
      {
        checkedInAt: "2026-10-03T16:00:00.000Z",
        checkedOutAt: "2026-10-03T18:15:00.000Z", // 2.25 hrs
      },
      {
        checkedInAt: "2026-10-10T16:00:00.000Z",
        checkedOutAt: "2026-10-10T17:30:00.000Z", // 1.50 hrs
      },
      {
        checkedInAt: "2026-10-10T19:00:00.000Z",
        checkedOutAt: null, // still checked in -> 0
      },
    ]);
    assert.equal(total, 3.75);
    assert.equal(formatHoursToTwoDecimals(total), "3.75");
  });

  it("resolves manual organizer check-out wall-clock times on the event timezone", () => {
    const checkedInIso = "2026-10-10T16:00:00.000Z"; // 09:00 in America/Los_Angeles
    assert.equal(
      wallClockTimeInZone(checkedInIso, "America/Los_Angeles"),
      "09:00",
    );

    const resolved = resolveCheckoutInstantFromWallClock(
      checkedInIso,
      "10:30",
      "America/Los_Angeles",
    );
    assert.equal(resolved, "2026-10-10T17:30:00.000Z");
    assert.equal(calculateShiftHours(checkedInIso, resolved), 1.5);
  });
});

describe("Live 'Who's here' roster builder", () => {
  it("classifies volunteers into checked in, not yet arrived, and checked out with adjusted flag", () => {
    const roster = buildWhosHereRoster({
      roles: [{ id: "r1", name: "Welcome Booth", position: 0 }],
      shifts: [
        {
          id: "s1",
          role_id: "r1",
          starts_at: "2026-10-10T16:00:00.000Z",
          ends_at: "2026-10-10T17:30:00.000Z",
        },
      ],
      signups: [
        { id: "sg1", shift_id: "s1", volunteer_id: "v1", status: "confirmed" },
        { id: "sg2", shift_id: "s1", volunteer_id: "v2", status: "confirmed" },
        { id: "sg3", shift_id: "s1", volunteer_id: "v3", status: "confirmed" },
      ],
      profiles: [
        { id: "v1", full_name: "Carol Diaz", email: "carol@example.com" },
        { id: "v2", full_name: "Dave Patel", email: "dave@example.com" },
        { id: "v3", full_name: "Erin Kim", email: "erin@example.com" },
      ],
      checkins: [
        {
          id: "c1",
          signup_id: "sg1",
          kind: "in",
          at: "2026-10-10T15:55:00.000Z",
        },
        {
          id: "c2",
          signup_id: "sg3",
          kind: "in",
          at: "2026-10-10T16:00:00.000Z",
        },
        {
          id: "c3",
          signup_id: "sg3",
          kind: "out",
          at: "2026-10-10T17:30:00.000Z",
          method: "organizer_adjusted",
          adjusted_by_organizer: true,
        },
      ],
    });

    assert.equal(roster.length, 3);

    // Checked in comes first
    assert.equal(roster[0].volunteerName, "Carol Diaz");
    assert.equal(roster[0].status, "checked_in");
    assert.equal(roster[0].statusLabel, "checked in");

    // Not yet arrived comes second
    assert.equal(roster[1].volunteerName, "Dave Patel");
    assert.equal(roster[1].status, "not_yet_arrived");
    assert.equal(roster[1].statusLabel, "not yet arrived");

    // Checked out comes third, with hours and adjustedByOrganizer flag
    assert.equal(roster[2].volunteerName, "Erin Kim");
    assert.equal(roster[2].status, "checked_out");
    assert.equal(roster[2].statusLabel, "checked out");
    assert.equal(roster[2].hoursWorked, 1.5);
    assert.equal(roster[2].adjustedByOrganizer, true);
  });
});
