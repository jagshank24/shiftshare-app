import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_EMAIL_FROM,
  buildEventPageUrl,
  buildShiftReminderEmail,
  buildSignupConfirmationEmail,
  buildStandbyPromotionEmail,
  formatShiftTimeForEmail,
  getEmailFrom,
  notifyConfirmedSignup,
  notifyStandbyPromotion,
  sendDueShiftReminders,
  sendEmail,
  setEmailTransportForTests,
  type SendEmailPayload,
} from "@/lib/email";
import { createDemoSupabaseClient, resetDemoState } from "@/lib/demo/client";

describe("Resend Email Service (lib/email.ts)", () => {
  const originalEmailFrom = process.env.EMAIL_FROM;
  const originalResendKey = process.env.RESEND_API_KEY;

  afterEach(() => {
    setEmailTransportForTests(null);
    if (originalEmailFrom === undefined) {
      delete process.env.EMAIL_FROM;
    } else {
      process.env.EMAIL_FROM = originalEmailFrom;
    }
    if (originalResendKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalResendKey;
    }
    resetDemoState();
  });

  it("defaults EMAIL_FROM to 'ShiftShare <onboarding@resend.dev>' and respects env override", async () => {
    delete process.env.EMAIL_FROM;
    assert.equal(getEmailFrom(), "ShiftShare <onboarding@resend.dev>");
    assert.equal(DEFAULT_EMAIL_FROM, "ShiftShare <onboarding@resend.dev>");

    process.env.EMAIL_FROM = "ShiftShare Alerts <alerts@shiftshare.app>";
    assert.equal(getEmailFrom(), "ShiftShare Alerts <alerts@shiftshare.app>");

    const sentPayloads: SendEmailPayload[] = [];
    setEmailTransportForTests(async (payload) => {
      sentPayloads.push(payload);
      return { id: "email-123" };
    });

    const res = await sendEmail(
      "carol.diaz@demo.shiftshare.app",
      "Test Subject",
      "<p>Hello</p>",
    );
    assert.equal(res.ok, true);
    assert.equal(res.id, "email-123");
    assert.equal(sentPayloads.length, 1);
    assert.equal(
      sentPayloads[0].from,
      "ShiftShare Alerts <alerts@shiftshare.app>",
    );
    assert.equal(sentPayloads[0].to, "carol.diaz@demo.shiftshare.app");
  });

  it("never throws when RESEND_API_KEY is missing or transport fails", async () => {
    delete process.env.RESEND_API_KEY;
    setEmailTransportForTests(null);

    const missingKeyRes = await sendEmail(
      "carol.diaz@demo.shiftshare.app",
      "No Key Test",
      "<p>Body</p>",
    );
    assert.equal(missingKeyRes.ok, false);
    assert.equal(missingKeyRes.skipped, true);

    setEmailTransportForTests(async () => {
      throw new Error("Simulated Resend network failure");
    });

    const failureRes = await sendEmail(
      "carol.diaz@demo.shiftshare.app",
      "Transport Failure Test",
      "<p>Body</p>",
    );
    assert.equal(failureRes.ok, false);
    assert.match(failureRes.error ?? "", /Simulated Resend network failure/);
  });

  it("renders mobile-friendly HTML templates in ShiftShare brand colors for all 3 emails", () => {
    const details = {
      volunteerName: "Carol Diaz",
      eventTitle: "Fall Carnival",
      roleName: "Registration",
      shiftTime: formatShiftTimeForEmail(
        "2026-10-17T16:00:00.000Z",
        "2026-10-17T17:00:00.000Z",
        "America/Los_Angeles",
      ),
      location: "Central Park Pavilion, Fremont, CA",
      eventUrl: buildEventPageUrl("fall-carnival", "https://shiftshare.app"),
    };

    // 1. Sign-up confirmation
    const confirmation = buildSignupConfirmationEmail(details);
    assert.match(confirmation.subject, /You're signed up: Registration at Fall Carnival/);
    assert.ok(confirmation.html.includes("Fall Carnival"));
    assert.ok(confirmation.html.includes("Registration"));
    assert.ok(confirmation.html.includes("Central Park Pavilion, Fremont, CA"));
    assert.ok(confirmation.html.includes("https://shiftshare.app/events/fall-carnival"));
    assert.ok(confirmation.html.includes("#1B2A49"));
    assert.ok(confirmation.html.includes("#FFC93C"));
    assert.ok(confirmation.html.includes("#FAF8F3"));
    assert.ok(confirmation.html.includes("#2EC4B6"));

    // 2. Standby promotion
    const promotion = buildStandbyPromotionEmail(details);
    assert.match(promotion.subject, /A spot opened up, you're in/);
    assert.ok(promotion.html.includes("A spot opened up, you're in"));
    assert.ok(promotion.html.includes("Fall Carnival"));
    assert.ok(promotion.html.includes("Registration"));
    assert.ok(promotion.html.includes("https://shiftshare.app/events/fall-carnival"));

    // 3. 24-hour reminder
    const reminder = buildShiftReminderEmail(details);
    assert.match(reminder.subject, /Reminder: Registration at Fall Carnival starts within 24 hours/);
    assert.ok(reminder.html.includes("Fall Carnival"));
    assert.ok(reminder.html.includes("Registration"));
    assert.ok(reminder.html.includes("24 hours"));
    assert.ok(reminder.html.includes("https://shiftshare.app/events/fall-carnival"));
  });

  it("sends sign-up confirmation on confirmed signup and standby promotion when a confirmed volunteer cancels", async () => {
    const sentPayloads: SendEmailPayload[] = [];
    setEmailTransportForTests(async (payload) => {
      sentPayloads.push(payload);
      return { id: `msg-${sentPayloads.length}` };
    });

    const supabase = createDemoSupabaseClient("volunteer");

    // 1. Notify confirmed signup for Carol Diaz on Fall Carnival shift #1
    const confirmRes = await notifyConfirmedSignup({
      supabase,
      shiftId: "f0000000-0000-4000-8000-000000000001",
      volunteerId: "de000000-0000-4000-8000-000000000101",
    });
    assert.equal(confirmRes.ok, true);
    assert.equal(sentPayloads.length, 1);
    assert.equal(sentPayloads[0].to, "carol.diaz@demo.shiftshare.app");
    assert.match(sentPayloads[0].subject, /You're signed up: Registration at Fall Carnival/);

    // 2. Cancel Carol Diaz's confirmed spot on shift #1 (which has a standby volunteer waiting!)
    const { data: cancelData } = await supabase.rpc("cancel_signup", {
      p_shift_id: "f0000000-0000-4000-8000-000000000001",
    });
    assert.ok(cancelData?.promoted, "Expected standby volunteer to be promoted when Carol cancels shift #1");

    const promoRes = await notifyStandbyPromotion({
      supabase,
      shiftId: "f0000000-0000-4000-8000-000000000001",
      promoted: cancelData.promoted,
    });
    assert.equal(promoRes.ok, true);
    assert.equal(sentPayloads.length, 2);
    assert.equal(sentPayloads[1].to, "tariq.johnson@demo.shiftshare.app");
    assert.match(sentPayloads[1].subject, /A spot opened up, you're in/);
    assert.ok(sentPayloads[1].html.includes("A spot opened up, you're in"));
  });

  it("finds confirmed signups within 24 hours with reminder_sent = false, emails them, and sets reminder_sent = true", async () => {
    const sentPayloads: SendEmailPayload[] = [];
    setEmailTransportForTests(async (payload) => {
      sentPayloads.push(payload);
      return { id: `rem-${sentPayloads.length}` };
    });

    const supabase = createDemoSupabaseClient("organizer");
    // Fall Carnival shifts start on 2026-10-17 between 15:00Z and 23:00Z.
    // Simulate running the cron job at 2026-10-16T23:30:00.000Z (within 24h of all 33 shifts).
    const simulatedNow = new Date("2026-10-16T23:30:00.000Z");

    const firstRun = await sendDueShiftReminders(supabase, simulatedNow);
    assert.equal(firstRun.ok, true);
    assert.equal(firstRun.checked, 60);
    assert.equal(firstRun.sent, 60);
    assert.equal(firstRun.failed, 0);
    assert.equal(sentPayloads.length, 60);

    // Running again immediately for the same 24h window sends 0 duplicates because reminder_sent = true
    const secondRun = await sendDueShiftReminders(supabase, simulatedNow);
    assert.equal(secondRun.checked, 0);
    assert.equal(secondRun.sent, 0);
    assert.equal(sentPayloads.length, 60);
  });

  it("never imports lib/email.ts in client components and configures vercel.json & .env.example", () => {
    const srcRoot = path.join(process.cwd(), "src");

    function walkFiles(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...walkFiles(full));
        } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          files.push(full);
        }
      }
      return files;
    }

    for (const file of walkFiles(srcRoot)) {
      const content = fs.readFileSync(file, "utf8");
      const isClientComponent =
        content.startsWith('"use client"') || content.startsWith("'use client'");
      if (isClientComponent) {
        assert.ok(
          !content.includes("@/lib/email") &&
            !content.includes("lib/email") &&
            !content.includes('from "resend"'),
          `Client component ${file} must never import lib/email.ts or resend`,
        );
      }
    }

    const envExample = fs.readFileSync(
      path.join(process.cwd(), ".env.example"),
      "utf8",
    );
    assert.ok(envExample.includes("RESEND_API_KEY="));
    assert.ok(envExample.includes("EMAIL_FROM="));
    assert.ok(envExample.includes("CRON_SECRET="));

    const vercelJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
    );
    assert.ok(Array.isArray(vercelJson.crons));
    assert.equal(vercelJson.crons[0].path, "/api/cron/reminders");
    assert.equal(vercelJson.crons[0].schedule, "0 15 * * *");
  });
});
