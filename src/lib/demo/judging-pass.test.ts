import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEMO_CHECKINS,
  DEMO_EVENTS,
  DEMO_PROFILES,
  DEMO_ROLES,
  DEMO_SHIFTS,
  DEMO_SIGNUPS,
  FALL_CARNIVAL_EVENT_ID,
  PAST_HARVEST_EVENT_ID,
} from "./seed-data";
import {
  AI_INPUT_LIMITS,
  checkRateLimit,
  resetRateLimiterForTests,
  validateInputLength,
} from "../rate-limit";
import { ABOUT_SECTIONS } from "../../app/about/page";

describe("Demo Seed Data — 1 organizer, 15 volunteers, Fall Carnival & past event", () => {
  it("creates 1 organizer account and 15 volunteer accounts with realistic names", () => {
    const organizers = DEMO_PROFILES.filter((p) => p.role === "organizer");
    const volunteers = DEMO_PROFILES.filter((p) => p.role === "volunteer");

    assert.equal(organizers.length, 1);
    assert.equal(organizers[0].full_name, "Maya Lin");
    assert.equal(volunteers.length, 15);
    assert.ok(volunteers.every((v) => v.full_name && v.full_name.includes(" ")));
  });

  it("creates 'Fall Carnival' with 6 required roles, 30+ shifts, mostly filled, and standby volunteers on full shifts", () => {
    const fallCarnival = DEMO_EVENTS.find((e) => e.id === FALL_CARNIVAL_EVENT_ID);
    assert.ok(fallCarnival);
    assert.equal(fallCarnival.title, "Fall Carnival");

    const roles = DEMO_ROLES.filter((r) => r.event_id === FALL_CARNIVAL_EVENT_ID);
    assert.deepEqual(
      roles.map((r) => r.name),
      [
        "Registration",
        "Food Stand",
        "Games",
        "Setup",
        "Cleanup",
        "First Aid Helpers",
      ],
    );

    const roleIds = new Set(roles.map((r) => r.id));
    const shifts = DEMO_SHIFTS.filter((s) => roleIds.has(s.role_id));
    assert.ok(
      shifts.length >= 30,
      `Expected 30+ shifts on Fall Carnival, got ${shifts.length}`,
    );

    const shiftIds = new Set(shifts.map((s) => s.id));
    const signups = DEMO_SIGNUPS.filter((sg) => shiftIds.has(sg.shift_id));
    const confirmed = signups.filter((sg) => sg.status === "confirmed");
    const standby = signups.filter((sg) => sg.status === "waitlist");

    const totalCapacity = shifts.reduce((sum, s) => sum + s.capacity, 0);
    assert.ok(
      confirmed.length / totalCapacity >= 0.7,
      "Expected Fall Carnival shifts to be mostly filled (>= 70%)",
    );
    assert.ok(
      standby.length >= 2,
      "Expected a couple of full shifts with standby volunteers",
    );
  });

  it("creates a past completed event with check-in and check-out data", () => {
    const pastEvent = DEMO_EVENTS.find((e) => e.id === PAST_HARVEST_EVENT_ID);
    assert.ok(pastEvent);

    const pastRoleIds = new Set(
      DEMO_ROLES.filter((r) => r.event_id === PAST_HARVEST_EVENT_ID).map(
        (r) => r.id,
      ),
    );
    const pastShiftIds = new Set(
      DEMO_SHIFTS.filter((s) => pastRoleIds.has(s.role_id)).map((s) => s.id),
    );
    const pastSignupIds = new Set(
      DEMO_SIGNUPS.filter((sg) => pastShiftIds.has(sg.shift_id)).map(
        (sg) => sg.id,
      ),
    );
    const pastCheckins = DEMO_CHECKINS.filter((ck) =>
      pastSignupIds.has(ck.signup_id),
    );

    const checkIns = pastCheckins.filter((ck) => ck.kind === "in");
    const checkOuts = pastCheckins.filter((ck) => ck.kind === "out");
    assert.ok(checkIns.length >= 10);
    assert.equal(checkIns.length, checkOuts.length);
  });
});

describe("AI Route Rate Limiting, Input Length Limits & API Key Security", () => {
  it("enforces sliding-window rate limits per client", () => {
    resetRateLimiterForTests();
    const cfg = { max: 3, windowMs: 60_000 };
    const t0 = 1_700_000_000_000;

    assert.equal(checkRateLimit("user:test", cfg, t0).allowed, true);
    assert.equal(checkRateLimit("user:test", cfg, t0 + 100).allowed, true);
    assert.equal(checkRateLimit("user:test", cfg, t0 + 200).allowed, true);

    const blocked = checkRateLimit("user:test", cfg, t0 + 300);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(blocked.retryAfterSeconds > 0);
  });

  it("enforces input length limits on AI prompt fields", () => {
    const valid = validateInputLength(
      "Fall carnival, 200 people, Saturday 10am to 4pm.",
      "description",
      AI_INPUT_LIMITS.MAX_SENTENCE_LENGTH,
    );
    assert.equal(valid.ok, true);

    const tooLong = validateInputLength(
      "x".repeat(AI_INPUT_LIMITS.MAX_SENTENCE_LENGTH + 1),
      "description",
      AI_INPUT_LIMITS.MAX_SENTENCE_LENGTH,
    );
    assert.equal(tooLong.ok, false);
  });

  it("never exposes ANTHROPIC_API_KEY as a NEXT_PUBLIC_ variable or in client components", () => {
    const srcDir = path.resolve(process.cwd(), "src");

    function walk(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...walk(full));
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          if (!entry.name.endsWith(".test.ts")) files.push(full);
        }
      }
      return files;
    }

    for (const file of walk(srcDir)) {
      const content = fs.readFileSync(file, "utf8");
      assert.ok(
        !content.includes("NEXT_PUBLIC_ANTHROPIC"),
        `Found NEXT_PUBLIC_ANTHROPIC in ${file}`,
      );
      if (content.includes('"use client"') || content.includes("'use client'")) {
        assert.ok(
          !content.includes("process.env.ANTHROPIC_API_KEY"),
          `Client component ${file} must not read process.env.ANTHROPIC_API_KEY`,
        );
        assert.ok(
          !content.includes("@anthropic-ai/sdk"),
          `Client component ${file} must not import @anthropic-ai/sdk`,
        );
      }
    }
  });
});

describe("/about page word count constraint", () => {
  it("explains the problem, the solution, and the tech in under 200 words", () => {
    const combined = `${ABOUT_SECTIONS.problem} ${ABOUT_SECTIONS.solution} ${ABOUT_SECTIONS.tech}`;
    const wordCount = combined.trim().split(/\s+/).length;
    assert.ok(
      wordCount < 200,
      `Expected /about explanation to be under 200 words, got ${wordCount} words`,
    );
  });
});
