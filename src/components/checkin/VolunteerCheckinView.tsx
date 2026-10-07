"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { triggerVolunteerScanAction } from "@/app/checkin/actions";
import {
  eventClock,
  eventDayWithYear,
  eventTimeRange,
} from "@/lib/events/format";
import { formatHoursToTwoDecimals } from "@/lib/checkin/hours";
import type { QrScanCheckinResult } from "@/lib/supabase/database.types";

const CONFETTI_PIECES = [
  { left: "6%", delay: "0ms", duration: "2400ms", color: "#FFC93C", rotate: "-18deg" },
  { left: "14%", delay: "120ms", duration: "2600ms", color: "#2EC4B6", rotate: "24deg" },
  { left: "22%", delay: "60ms", duration: "2300ms", color: "#FF6B6B", rotate: "-32deg" },
  { left: "30%", delay: "200ms", duration: "2700ms", color: "#1B2A49", rotate: "15deg" },
  { left: "38%", delay: "40ms", duration: "2500ms", color: "#FFC93C", rotate: "40deg" },
  { left: "46%", delay: "180ms", duration: "2400ms", color: "#2EC4B6", rotate: "-22deg" },
  { left: "54%", delay: "90ms", duration: "2650ms", color: "#FF6B6B", rotate: "28deg" },
  { left: "62%", delay: "150ms", duration: "2350ms", color: "#1B2A49", rotate: "-14deg" },
  { left: "70%", delay: "30ms", duration: "2550ms", color: "#FFC93C", rotate: "35deg" },
  { left: "78%", delay: "210ms", duration: "2450ms", color: "#2EC4B6", rotate: "-28deg" },
  { left: "86%", delay: "75ms", duration: "2600ms", color: "#FF6B6B", rotate: "19deg" },
  { left: "93%", delay: "140ms", duration: "2500ms", color: "#FFC93C", rotate: "-25deg" },
];

function CheckinConfetti() {
  return (
    <div
      aria-hidden="true"
      data-testid="checkin-confetti"
      className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden"
    >
      <style>{`
        @keyframes shiftshare-confetti-fall {
          0% {
            transform: translate3d(0, -24px, 0) rotate(0deg) scale(0.9);
            opacity: 1;
          }
          75% {
            opacity: 1;
          }
          100% {
            transform: translate3d(0, 230px, 0) rotate(320deg) scale(1);
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .shiftshare-confetti-piece {
            animation: none !important;
            opacity: 0.35;
          }
        }
      `}</style>
      {CONFETTI_PIECES.map((piece, idx) => (
        <span
          key={idx}
          className="shiftshare-confetti-piece absolute top-0 h-3.5 w-2.5 rounded-xs"
          style={{
            left: piece.left,
            backgroundColor: piece.color,
            transform: `rotate(${piece.rotate})`,
            animation: `shiftshare-confetti-fall ${piece.duration} cubic-bezier(0.22, 1, 0.36, 1) ${piece.delay} both`,
          }}
        />
      ))}
    </div>
  );
}

function LargeCheckmark() {
  return (
    <div
      data-testid="checkin-large-checkmark"
      className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-4 border-navy bg-mint text-navy-900 shadow-card"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-11 w-11"
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </div>
  );
}

type Props = {
  eventId: string;
  token: string;
  initialResult: QrScanCheckinResult;
};

export function VolunteerCheckinView({
  eventId,
  token,
  initialResult,
}: Props) {
  const [result, setResult] = useState<QrScanCheckinResult>(initialResult);
  const [isPending, startTransition] = useTransition();

  // Notify any open Organizer Dashboard tabs in the same browser via BroadcastChannel
  useEffect(() => {
    if (
      (result.code === "checked_in" || result.code === "checked_out") &&
      typeof window !== "undefined" &&
      "BroadcastChannel" in window
    ) {
      const bc = new BroadcastChannel("shiftshare-checkin-updates");
      bc.postMessage({
        eventId: result.event_id ?? eventId,
        code: result.code,
        at: Date.now(),
      });
      bc.close();
    }
  }, [result, eventId]);

  const eventHref = `/events/${result.event_slug || result.event_id || eventId}`;

  // 1. Invalid or expired token
  if (result.code === "invalid_token" || result.code === "not_found") {
    return (
      <Card
        padding="lg"
        data-testid="checkin-invalid-token"
        className="mx-auto max-w-lg text-center space-y-5"
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 border-coral bg-coral-100 text-coral-800">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            className="h-8 w-8"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
        </div>

        <CardHeader className="mb-0 items-center text-center">
          <Badge tone="coral">Invalid or expired QR code</Badge>
          <CardTitle as="h1" className="mt-2 text-2xl sm:text-3xl">
            This check-in code is no longer valid
          </CardTitle>
          <CardDescription className="mt-2 text-base">
            {result.code === "not_found"
              ? "We couldn't find that event. Check the QR code at the event check-in desk."
              : "The organizer may have refreshed the QR code for this event, or the check-in link is incomplete. Please scan the current QR poster at the check-in desk."}
          </CardDescription>
        </CardHeader>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {result.event_slug && (
            <Link
              href={eventHref}
              className={buttonClasses({ variant: "secondary", size: "md" })}
            >
              View event page
            </Link>
          )}
          <Link
            href="/dashboard"
            className={buttonClasses({ variant: "ghost", size: "md" })}
          >
            Go to dashboard
          </Link>
        </div>
      </Card>
    );
  }

  // 2. Volunteer is not signed up for this event
  if (result.code === "not_signed_up") {
    return (
      <Card
        padding="lg"
        data-testid="checkin-not-signed-up"
        className="mx-auto max-w-lg text-center space-y-5"
      >
        <CardHeader className="mb-0 items-center text-center">
          <Badge tone="accent">
            {result.event_title ?? "Volunteer check-in"}
          </Badge>
          <CardTitle as="h1" className="mt-2 text-2xl sm:text-3xl">
            You&apos;re not signed up for this event
          </CardTitle>
          <CardDescription className="mt-2 text-base">
            Claim an open shift on the event page first, then scan the QR code
            again to check in.
          </CardDescription>
        </CardHeader>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link
            href={eventHref}
            data-testid="browse-open-shifts-btn"
            className={buttonClasses({ variant: "primary", size: "lg" })}
          >
            Browse open shifts
          </Link>
          <Link
            href="/dashboard"
            className={buttonClasses({ variant: "ghost", size: "md" })}
          >
            Go to dashboard
          </Link>
        </div>
      </Card>
    );
  }

  // 3. Volunteer is outside the [-30 min, +30 min] shift check-in window
  if (result.code === "outside_window") {
    const tz = result.timezone ?? "UTC";
    const windowOpenStr = result.window_opens_at
      ? eventClock(result.window_opens_at, tz)
      : "30 minutes before start";
    const windowCloseStr = result.window_closes_at
      ? eventClock(result.window_closes_at, tz)
      : "30 minutes after start";
    const shiftRangeStr =
      result.shift_starts_at && result.shift_ends_at
        ? eventTimeRange(result.shift_starts_at, result.shift_ends_at, tz)
        : "";
    const shiftDayStr = result.shift_starts_at
      ? eventDayWithYear(result.shift_starts_at, tz)
      : "";

    const mailtoHref = `mailto:${result.organizer_email || "organizer@shiftshare.app"}?subject=${encodeURIComponent(
      `Check-in help: ${result.event_title ?? "Event"} (${result.role_name ?? "Shift"})`,
    )}`;

    return (
      <Card
        padding="lg"
        data-testid="checkin-outside-window"
        className="mx-auto max-w-lg space-y-5"
      >
        <CardHeader className="mb-0">
          <Badge tone="accent">{result.event_title ?? "Event check-in"}</Badge>
          <CardTitle as="h1" className="mt-2 text-2xl sm:text-3xl">
            You&apos;re outside the check-in window for your shift
          </CardTitle>
          <CardDescription className="mt-1 text-base">
            Check-in opens <strong>30 minutes before</strong> your shift starts
            and closes <strong>30 minutes after</strong> it starts.
          </CardDescription>
        </CardHeader>

        <div className="rounded-2xl border-2 border-navy-100 bg-cream-100 p-4 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-navy-600">Your role</span>
            <span className="font-bold text-navy-900">{result.role_name}</span>
          </div>
          {shiftDayStr && (
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-navy-600">Date</span>
              <span className="font-semibold text-navy-900">{shiftDayStr}</span>
            </div>
          )}
          {shiftRangeStr && (
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-navy-600">Scheduled shift</span>
              <span className="font-semibold text-navy-900">
                {shiftRangeStr}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-navy-100 pt-2">
            <span className="font-medium text-navy-600">
              Allowed check-in window
            </span>
            <span
              data-testid="allowed-window-range"
              className="font-bold text-navy-900"
            >
              {windowOpenStr} – {windowCloseStr}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-navy-100 bg-white p-4 space-y-3">
          <p className="text-sm text-navy-700">
            Arrived early or running late? Reach out to{" "}
            <strong className="text-navy-900">
              {result.organizer_name || "the event organizer"}
            </strong>
            {result.organizer_email ? ` (${result.organizer_email})` : ""} and
            they can assist you at the check-in desk.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={mailtoHref}
              data-testid="contact-organizer-link"
              className={buttonClasses({ variant: "primary", size: "md" })}
            >
              Contact organizer
            </a>
            <Link
              href={eventHref}
              className={buttonClasses({ variant: "secondary", size: "md" })}
            >
              View event details
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  // 4. Checked in! Show satisfying big success screen with large checkmark, confetti, role, time, and "Your hours are being verified."
  if (result.code === "checked_in") {
    const tz = result.timezone ?? "UTC";
    const checkinClockStr = result.checked_in_at
      ? eventClock(result.checked_in_at, tz)
      : "";
    const shiftRangeStr =
      result.shift_starts_at && result.shift_ends_at
        ? eventTimeRange(result.shift_starts_at, result.shift_ends_at, tz)
        : "";

    return (
      <Card
        padding="lg"
        data-testid="checkin-success-screen"
        className="relative mx-auto max-w-lg overflow-hidden text-center space-y-6 border-2 border-navy"
      >
        <CheckinConfetti />

        <div className="relative z-10 pt-2 space-y-4">
          <LargeCheckmark />

          <div className="space-y-2">
            <Badge tone="mint" size="md">
              Checked in
            </Badge>
            <h1 className="font-display text-3xl font-bold text-navy-900 sm:text-4xl">
              You&apos;re checked in!
            </h1>
            <p
              data-testid="hours-verified-line"
              className="text-base font-semibold text-mint-800"
            >
              Your hours are being verified.
            </p>
          </div>

          <div className="rounded-2xl border-2 border-navy-100 bg-cream-100 p-5 text-left space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold tracking-wide text-navy-500 uppercase">
                Event
              </span>
              <span className="font-semibold text-navy-900">
                {result.event_title}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold tracking-wide text-navy-500 uppercase">
                Role
              </span>
              <span
                data-testid="checkin-role-name"
                className="font-display text-base font-bold text-navy-900"
              >
                {result.role_name}
              </span>
            </div>

            {shiftRangeStr && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold tracking-wide text-navy-500 uppercase">
                  Shift window
                </span>
                <span className="font-medium text-navy-800">
                  {shiftRangeStr}
                </span>
              </div>
            )}

            {checkinClockStr && (
              <div className="flex items-center justify-between gap-2 border-t border-navy-100 pt-2.5">
                <span className="text-xs font-semibold tracking-wide text-navy-500 uppercase">
                  Checked in at
                </span>
                <span
                  data-testid="checkin-timestamp"
                  className="font-display text-lg font-bold text-navy-900"
                >
                  {checkinClockStr}
                </span>
              </div>
            )}
          </div>

          <p className="text-xs text-navy-600">
            Scan the event QR code again when your shift finishes (or tap below)
            to check out and lock in your hours.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="md"
              loading={isPending}
              data-testid="checkout-now-btn"
              onClick={() => {
                startTransition(async () => {
                  const next = await triggerVolunteerScanAction(eventId, token);
                  setResult(next);
                });
              }}
            >
              Done with your shift? Check out
            </Button>
            <Link
              href="/dashboard"
              className={buttonClasses({ variant: "ghost", size: "md" })}
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  // 5. Checked out (or idempotent already_checked_out): show hours worked for that shift (to 2 decimals) and running total!
  const tz = result.timezone ?? "UTC";
  const inClock = result.checked_in_at
    ? eventClock(result.checked_in_at, tz)
    : "—";
  const outClock = result.checked_out_at
    ? eventClock(result.checked_out_at, tz)
    : "—";
  const shiftHoursFormatted = formatHoursToTwoDecimals(result.shift_hours);
  const totalHoursFormatted = formatHoursToTwoDecimals(result.total_hours);

  return (
    <Card
      padding="lg"
      data-testid="checkout-success-screen"
      className="relative mx-auto max-w-lg overflow-hidden text-center space-y-6 border-2 border-navy"
    >
      <CheckinConfetti />

      <div className="relative z-10 pt-2 space-y-4">
        <LargeCheckmark />

        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Badge tone="accent" size="md">
              Checked out
            </Badge>
            {result.code === "already_checked_out" && (
              <Badge
                tone="neutral"
                size="sm"
                data-testid="already-checked-out-badge"
              >
                Already recorded
              </Badge>
            )}
          </div>
          <h1 className="font-display text-3xl font-bold text-navy-900 sm:text-4xl">
            Shift complete!
          </h1>
          <p
            data-testid="hours-verified-line"
            className="text-base font-semibold text-mint-800"
          >
            Your hours are being verified.
          </p>
        </div>

        {/* Hours summary cards: shift hours (2 decimals) & running total (2 decimals) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border-2 border-navy bg-accent-50 p-4 text-center">
            <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
              This shift
            </p>
            <p
              data-testid="checkout-shift-hours"
              className="mt-1 font-display text-3xl font-bold text-navy-900"
            >
              {shiftHoursFormatted}
            </p>
            <p className="text-xs font-medium text-navy-600">hours worked</p>
          </div>

          <div className="rounded-2xl border-2 border-navy-100 bg-cream-100 p-4 text-center">
            <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
              Running total
            </p>
            <p
              data-testid="checkout-total-hours"
              className="mt-1 font-display text-3xl font-bold text-navy-900"
            >
              {totalHoursFormatted}
            </p>
            <p className="text-xs font-medium text-navy-600">total hours</p>
          </div>
        </div>

        <div className="rounded-2xl border-2 border-navy-100 bg-cream-100 p-4 text-left space-y-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-navy-600">Event</span>
            <span className="font-semibold text-navy-900">
              {result.event_title}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-navy-600">Role</span>
            <span
              data-testid="checkout-role-name"
              className="font-bold text-navy-900"
            >
              {result.role_name}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-navy-600">Checked in</span>
            <span className="font-semibold text-navy-900">{inClock}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-navy-600">Checked out</span>
            <span className="font-semibold text-navy-900">{outClock}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <Link
            href="/dashboard"
            className={buttonClasses({ variant: "primary", size: "md" })}
          >
            View your dashboard
          </Link>
          <Link
            href={eventHref}
            className={buttonClasses({ variant: "ghost", size: "md" })}
          >
            Event page
          </Link>
        </div>
      </div>
    </Card>
  );
}
