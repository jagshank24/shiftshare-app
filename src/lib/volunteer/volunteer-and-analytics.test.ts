import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildMilestoneProgress,
  buildVolunteerDashboardStats,
  calculateReliabilityScore,
} from "./stats";
import {
  buildVerifyPath,
  buildVerifyUrl,
  deriveDefaultVerificationCode,
  formatCertificateVerificationCode,
  parseVerificationCode,
} from "./verification";
import { renderCertificatePdfBuffer } from "./certificate-pdf";
import {
  buildEventVolunteersCsv,
  buildOrganizerEventAnalytics,
} from "../analytics/organizer";
import {
  generateEventRecap,
  generateVolunteerThankYous,
  normalizeEventRecap,
  normalizeThankYouMessages,
} from "../ai";
import { generateQrCodeDataUrl } from "../checkin/qr";

describe("Volunteer dashboard stats & milestone badges", () => {
  it("computes total verified hours, events volunteered at, and reliability score (attended / signed up)", () => {
    const now = new Date("2026-10-06T18:00:00.000Z");

    const stats = buildVolunteerDashboardStats(
      [
        // Past shift 1: attended 12.50 hours
        {
          signupId: "sg-1",
          shiftId: "sh-1",
          status: "confirmed",
          startsAt: "2026-09-20T08:00:00.000Z",
          endsAt: "2026-09-20T20:30:00.000Z",
          roleName: "Welcome Desk",
          eventId: "ev-1",
          eventTitle: "Spring Book Fair",
          eventSlug: "spring-book-fair",
          eventStartsAt: "2026-09-20T08:00:00.000Z",
          location: "Fremont Library",
          timezone: "America/Los_Angeles",
          organizerName: "Alice Ortiz",
          checkedInAt: "2026-09-20T08:00:00.000Z",
          checkedOutAt: "2026-09-20T20:30:00.000Z",
          verified: true,
          adjustedByOrganizer: false,
        },
        // Past shift 2: attended 2.25 hours on a second event
        {
          signupId: "sg-2",
          shiftId: "sh-2",
          status: "confirmed",
          startsAt: "2026-10-01T16:00:00.000Z",
          endsAt: "2026-10-01T18:15:00.000Z",
          roleName: "Food Booth",
          eventId: "ev-2",
          eventTitle: "Fall Harvest Carnival",
          eventSlug: "fall-harvest-carnival",
          eventStartsAt: "2026-10-01T16:00:00.000Z",
          location: "Central Park",
          timezone: "America/Los_Angeles",
          organizerName: "Alice Ortiz",
          checkedInAt: "2026-10-01T16:00:00.000Z",
          checkedOutAt: "2026-10-01T18:15:00.000Z",
          verified: true,
          adjustedByOrganizer: false,
        },
        // Past shift 3: no-show (signed up, did not check in)
        {
          signupId: "sg-3",
          shiftId: "sh-3",
          status: "confirmed",
          startsAt: "2026-10-03T16:00:00.000Z",
          endsAt: "2026-10-03T18:00:00.000Z",
          roleName: "Cleanup Crew",
          eventId: "ev-2",
          eventTitle: "Fall Harvest Carnival",
          eventSlug: "fall-harvest-carnival",
          eventStartsAt: "2026-10-01T16:00:00.000Z",
          location: "Central Park",
          timezone: "America/Los_Angeles",
          organizerName: "Alice Ortiz",
          checkedInAt: null,
          checkedOutAt: null,
          verified: false,
          adjustedByOrganizer: false,
        },
        // Upcoming shift: future shift with cancel button
        {
          signupId: "sg-4",
          shiftId: "sh-4",
          status: "confirmed",
          startsAt: "2026-10-12T16:00:00.000Z",
          endsAt: "2026-10-12T18:00:00.000Z",
          roleName: "Ticket Booth",
          eventId: "ev-3",
          eventTitle: "Winter Coat Drive",
          eventSlug: "winter-coat-drive",
          eventStartsAt: "2026-10-12T16:00:00.000Z",
          location: "Community Hall",
          timezone: "America/Los_Angeles",
          organizerName: "Alice Ortiz",
          checkedInAt: null,
          checkedOutAt: null,
          verified: false,
          adjustedByOrganizer: false,
        },
      ],
      now,
    );

    assert.equal(stats.totalVerifiedHours, 14.75);
    assert.equal(stats.eventsVolunteeredAt, 2);
    assert.equal(stats.shiftsAttended, 2);
    assert.equal(stats.shiftsSignedUp, 3);
    assert.equal(stats.reliabilityScorePercent, 67);
    assert.equal(stats.upcomingShifts.length, 1);
    assert.equal(stats.upcomingShifts[0].roleName, "Ticket Booth");
    assert.equal(stats.pastEvents.length, 3);

    // 14.75 hours -> 10h milestone unlocked, 25/50/100 locked
    assert.equal(stats.milestones.length, 4);
    assert.deepEqual(
      stats.milestones.map((m) => ({ hours: m.hours, unlocked: m.unlocked })),
      [
        { hours: 10, unlocked: true },
        { hours: 25, unlocked: false },
        { hours: 50, unlocked: false },
        { hours: 100, unlocked: false },
      ],
    );
    assert.equal(stats.nextMilestoneHours, 25);
    assert.equal(stats.hoursToNextMilestone, 10.25);
  });

  it("calculates reliability score and milestone progress across all thresholds", () => {
    assert.equal(calculateReliabilityScore(0, 0).percent, 100);
    assert.equal(calculateReliabilityScore(4, 5).percent, 80);

    const m100 = buildMilestoneProgress(105);
    assert.equal(m100.overallProgressPercent, 100);
    assert.equal(m100.nextMilestoneHours, null);
    assert.ok(m100.milestones.every((m) => m.unlocked));
  });
});

describe("Verification codes & @react-pdf/renderer Certificate PDF", () => {
  it("builds and parses full-profile and single-event verification codes", () => {
    const userId = "ca401000-0000-4000-8000-000000000003";
    const eventId = "e0000000-0000-4000-8000-0000000000c1";

    const base = deriveDefaultVerificationCode(userId);
    assert.equal(base, "SS-CA40100003");

    const singleCode = formatCertificateVerificationCode(base, eventId);
    assert.equal(singleCode, `SS-CA40100003--${eventId}`);

    const parsedFull = parseVerificationCode(base);
    assert.equal(parsedFull.validFormat, true);
    assert.equal(parsedFull.baseCode, "SS-CA40100003");
    assert.equal(parsedFull.eventId, null);

    const parsedSingle = parseVerificationCode(singleCode);
    assert.equal(parsedSingle.validFormat, true);
    assert.equal(parsedSingle.baseCode, "SS-CA40100003");
    assert.equal(parsedSingle.eventId, eventId);

    const invalid = parseVerificationCode("bad-code-123");
    assert.equal(invalid.validFormat, false);

    assert.equal(
      buildVerifyUrl(base, "https://shiftshare.app"),
      `https://shiftshare.app${buildVerifyPath(base)}`,
    );
  });

  it("renders a 1-page PDF certificate for 15 events using @react-pdf/renderer", async () => {
    const qrDataUrl = await generateQrCodeDataUrl(
      "https://shiftshare.app/verify/SS-CA40100003",
      200,
    );

    const fifteenEvents = Array.from({ length: 15 }, (_, idx) => ({
      eventId: `ev-${idx + 1}`,
      eventName: `Community Service Event #${idx + 1}`,
      dateFormatted: "Saturday, October 3, 2026",
      organizerName: "Alice Ortiz",
      roleName: "Welcome & Check-in Desk",
      hours: 2.0,
    }));

    const pdfBuffer = await renderCertificatePdfBuffer({
      volunteerName: "Carol Diaz",
      events: fifteenEvents,
      totalVerifiedHours: 30.0,
      dateIssued: "October 6, 2026",
      verificationCode: "SS-CA40100003",
      verifyUrl: "https://shiftshare.app/verify/SS-CA40100003",
      verifyQrDataUrl: qrDataUrl,
    });

    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.ok(pdfBuffer.byteLength > 2000);

    const pdfStr = pdfBuffer.toString("latin1");
    assert.ok(pdfStr.startsWith("%PDF-1."));
    // Count "/Type /Page" (not "/Type /Pages") -> must be exactly 1 page for 15 events
    const pageMatches = pdfStr.match(/\/Type\s*\/Page\b(?!s)/g) ?? [];
    assert.equal(
      pageMatches.length,
      1,
      "Certificate must fit on 1 page for up to 15 events",
    );
  });
});

describe("Organizer analytics, CSV export, Thank volunteers & AI Event recap", () => {
  const analytics = buildOrganizerEventAnalytics({
    event: {
      id: "ev-1",
      title: "Fall Harvest Carnival",
      slug: "fall-harvest-carnival",
      starts_at: "2026-10-06T16:00:00.000Z",
      ends_at: "2026-10-06T20:00:00.000Z",
      location: "Central Park Pavilion",
      timezone: "America/Los_Angeles",
      published: true,
    },
    roles: [
      { id: "r1", event_id: "ev-1", name: "Welcome Desk", capacity: 2, position: 0 },
      { id: "r2", event_id: "ev-1", name: "Teardown Crew", capacity: 2, position: 1 },
    ],
    shifts: [
      {
        id: "s1",
        role_id: "r1",
        starts_at: "2026-10-06T16:00:00.000Z",
        ends_at: "2026-10-06T17:30:00.000Z",
        capacity: 2,
      },
      {
        id: "s2",
        role_id: "r2",
        starts_at: "2026-10-06T18:30:00.000Z",
        ends_at: "2026-10-06T20:00:00.000Z",
        capacity: 2,
      },
    ],
    signups: [
      {
        id: "sg1",
        shift_id: "s1",
        volunteer_id: "v1",
        status: "confirmed",
        created_at: "2026-10-04T12:00:00.000Z",
      },
      {
        id: "sg2",
        shift_id: "s1",
        volunteer_id: "v2",
        status: "confirmed",
        created_at: "2026-10-05T12:00:00.000Z",
      },
      {
        id: "sg3",
        shift_id: "s2",
        volunteer_id: "v3",
        status: "confirmed",
        created_at: "2026-10-05T15:00:00.000Z",
      },
    ],
    profiles: [
      { id: "v1", full_name: "Carol Diaz", email: "carol@example.com" },
      { id: "v2", full_name: "Dave Patel", email: "dave@example.com" },
      { id: "v3", full_name: "Erin Kim", email: "erin@example.com" },
    ],
    checkins: [
      { id: "c1", signup_id: "sg1", kind: "in", at: "2026-10-06T16:00:00.000Z" },
      { id: "c2", signup_id: "sg1", kind: "out", at: "2026-10-06T17:30:00.000Z" },
      { id: "c3", signup_id: "sg2", kind: "in", at: "2026-10-06T16:00:00.000Z" },
      {
        id: "c4",
        signup_id: "sg2",
        kind: "out",
        at: "2026-10-06T17:30:00.000Z",
        adjusted_by_organizer: true,
      },
    ],
  });

  it("computes fill rate, checked-in count, no-show rate, role fill rates, signups over time, and total hours", () => {
    assert.equal(analytics.totalCapacity, 4);
    assert.equal(analytics.confirmedSignups, 3);
    assert.equal(analytics.fillRatePercent, 75);
    assert.equal(analytics.checkedInCount, 2);
    assert.equal(analytics.noShowCount, 1);
    assert.equal(analytics.noShowRatePercent, 33);
    assert.equal(analytics.totalVolunteerHours, 3.0);

    assert.equal(analytics.fillRatePerRole.length, 2);
    assert.equal(analytics.fillRatePerRole[0].fillRatePercent, 100);
    assert.equal(analytics.fillRatePerRole[1].fillRatePercent, 50);

    assert.equal(analytics.signupsOverTime.length, 2);
    assert.equal(analytics.signupsOverTime[1].cumulativeSignups, 3);
  });

  it("exports volunteers and hours to CSV", () => {
    const csv = buildEventVolunteersCsv(analytics);
    assert.ok(csv.includes("Volunteer Name,Email,Role,Shift,Status"));
    assert.ok(csv.includes("Carol Diaz,carol@example.com,Welcome Desk"));
    assert.ok(csv.includes("1.50,Yes,No"));
    assert.ok(csv.includes("Dave Patel,dave@example.com,Welcome Desk"));
    assert.ok(csv.includes("1.50,Yes,Yes"));
  });

  it("generates personalized volunteer thank-you messages and AI event recap", async () => {
    const thankYouRes = await generateVolunteerThankYous({
      eventTitle: analytics.eventTitle,
      volunteers: analytics.volunteerRows.map((r) => ({
        volunteerId: r.volunteerId,
        volunteerName: r.volunteerName,
        roleName: r.roleName,
        hours: r.hours,
      })),
    });

    assert.equal(thankYouRes.ok, true);
    if (thankYouRes.ok) {
      assert.equal(thankYouRes.messages.length, 3);
      assert.ok(thankYouRes.messages[0].message.includes("Carol Diaz"));
      assert.ok(thankYouRes.messages[0].message.includes("Welcome Desk"));
      assert.ok(thankYouRes.messages[0].message.includes("1.50"));
    }

    const recapRes = await generateEventRecap({
      eventTitle: analytics.eventTitle,
      totalCapacity: analytics.totalCapacity,
      confirmedSignups: analytics.confirmedSignups,
      fillRatePercent: analytics.fillRatePercent,
      checkedInCount: analytics.checkedInCount,
      noShowCount: analytics.noShowCount,
      noShowRatePercent: analytics.noShowRatePercent,
      totalVolunteerHours: analytics.totalVolunteerHours,
      roles: analytics.fillRatePerRole,
    });

    assert.equal(recapRes.ok, true);
    if (recapRes.ok) {
      assert.ok(recapRes.recap.summary.includes("Fall Harvest Carnival"));
      assert.ok(recapRes.recap.summary.includes("75%"));
      assert.equal(recapRes.recap.suggestions.length, 2);
    }

    // Also test JSON normalizers with custom Claude output
    const normThanks = normalizeThankYouMessages(
      {
        messages: [
          {
            volunteerId: "v1",
            volunteerName: "Carol Diaz",
            roleName: "Welcome Desk",
            hours: 1.5,
            message: "Custom thank you Carol!",
          },
        ],
      },
      {
        eventTitle: "Carnival",
        volunteers: [
          {
            volunteerId: "v1",
            volunteerName: "Carol Diaz",
            roleName: "Welcome Desk",
            hours: 1.5,
          },
        ],
      },
    );
    assert.equal(normThanks[0].message, "Custom thank you Carol!");

    const normRecap = normalizeEventRecap(
      {
        summary:
          "Sentence one with numbers. Sentence two with attendance. Sentence three with hours.",
        suggestions: ["First suggestion", "Second suggestion"],
      },
      {
        eventTitle: "Carnival",
        totalCapacity: 4,
        confirmedSignups: 3,
        fillRatePercent: 75,
        checkedInCount: 2,
        noShowCount: 1,
        noShowRatePercent: 33,
        totalVolunteerHours: 3,
        roles: [],
      },
    );
    assert.equal(normRecap.suggestions[0], "First suggestion");
    assert.equal(normRecap.suggestions[1], "Second suggestion");
  });
});
