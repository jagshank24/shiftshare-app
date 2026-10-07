"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { cancelVolunteerShiftFromDashboardAction } from "@/app/dashboard/actions";
import { formatHoursToTwoDecimals } from "@/lib/checkin/hours";
import {
  eventDayWithYear,
  eventTimeRange,
} from "@/lib/events/format";
import type { VolunteerDashboardStats } from "@/lib/volunteer/stats";

type Props = {
  volunteerName: string;
  verificationCode: string;
  verifyPath: string;
  verifyQrDataUrl: string;
  initialStats: VolunteerDashboardStats;
};

export function VolunteerDashboard({
  volunteerName,
  verificationCode,
  verifyPath,
  verifyQrDataUrl,
  initialStats,
}: Props) {
  const [stats, setStats] = useState<VolunteerDashboardStats>(initialStats);
  const [cancellingShiftId, setCancellingShiftId] = useState<string | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedProfileLink, setCopiedProfileLink] = useState(false);

  const distinctAttendedEvents = Array.from(
    new Map(
      stats.pastEvents
        .filter((pe) => pe.hours > 0)
        .map((pe) => [
          pe.eventId,
          { eventId: pe.eventId, eventTitle: pe.eventTitle },
        ]),
    ).values(),
  );

  const [selectedEventId, setSelectedEventId] = useState<string>(
    distinctAttendedEvents[0]?.eventId ??
      stats.pastEvents[0]?.eventId ??
      "",
  );

  const [isPending, startTransition] = useTransition();

  function handleCancelUpcomingShift(shiftId: string, roleName: string) {
    setError(null);
    setNotice(null);
    setCancellingShiftId(shiftId);

    startTransition(async () => {
      const res = await cancelVolunteerShiftFromDashboardAction(shiftId);
      setCancellingShiftId(null);
      if (!res.ok) {
        setError(res.error ?? "Couldn't cancel that shift.");
        return;
      }

      setStats((prev) => ({
        ...prev,
        upcomingShifts: prev.upcomingShifts.filter(
          (s) => s.shiftId !== shiftId,
        ),
      }));
      setNotice(`Cancelled your upcoming shift for ${roleName}.`);
    });
  }

  async function handleCopyVerifiedProfile() {
    const fullUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}${verifyPath}`
        : verifyPath;

    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedProfileLink(true);
      window.setTimeout(() => setCopiedProfileLink(false), 2500);
    } catch {
      setCopiedProfileLink(true);
    }
  }

  const totalHoursStr = formatHoursToTwoDecimals(stats.totalVerifiedHours);

  return (
    <div className="space-y-8" data-testid="volunteer-dashboard">
      {/* 1. Top Stats: Total Verified Hours, Events Volunteered At, Reliability Score */}
      <section
        aria-label="Volunteer summary statistics"
        className="grid gap-4 sm:grid-cols-3"
      >
        <Card padding="lg" className="space-y-1.5">
          <p className="text-xs font-semibold tracking-wide text-navy-500 uppercase">
            Total verified hours
          </p>
          <p
            data-testid="stat-total-verified-hours"
            className="font-display text-3xl font-bold text-navy-900 sm:text-4xl"
          >
            {totalHoursStr} hrs
          </p>
          <p className="text-xs text-navy-600">
            Calculated server-side from QR check-ins
          </p>
        </Card>

        <Card padding="lg" className="space-y-1.5">
          <p className="text-xs font-semibold tracking-wide text-navy-500 uppercase">
            Events volunteered at
          </p>
          <p
            data-testid="stat-events-volunteered"
            className="font-display text-3xl font-bold text-navy-900 sm:text-4xl"
          >
            {stats.eventsVolunteeredAt}
          </p>
          <p className="text-xs text-navy-600">
            {stats.shiftsAttended} completed{" "}
            {stats.shiftsAttended === 1 ? "shift" : "shifts"}
          </p>
        </Card>

        <Card padding="lg" className="space-y-1.5">
          <p className="text-xs font-semibold tracking-wide text-navy-500 uppercase">
            Reliability score
          </p>
          <p
            data-testid="stat-reliability-score"
            className="font-display text-3xl font-bold text-navy-900 sm:text-4xl"
          >
            {stats.reliabilityScorePercent}%
          </p>
          <p
            data-testid="stat-reliability-detail"
            className="text-xs text-navy-600"
          >
            {stats.shiftsAttended} / {stats.shiftsSignedUp} shifts attended
          </p>
        </Card>
      </section>

      {/* 2. Milestone Badges (10, 25, 50, 100 hours) shown as a simple progress bar */}
      <Card
        padding="lg"
        data-testid="milestone-badges-section"
        className="space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle as="h2">Hour milestones</CardTitle>
            <CardDescription>
              {stats.nextMilestoneHours
                ? `${formatHoursToTwoDecimals(stats.hoursToNextMilestone)} more hours until your ${stats.nextMilestoneHours}-hour milestone badge.`
                : "You've unlocked every ShiftShare milestone badge (100+ hours)!"}
            </CardDescription>
          </div>
          <Badge tone="mint" variant="soft">
            {totalHoursStr} / 100 hrs
          </Badge>
        </div>

        {/* Simple Progress Bar */}
        <div className="space-y-2">
          <div
            role="progressbar"
            aria-label="Volunteer hour milestone progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(stats.totalVerifiedHours))}
            data-testid="milestone-progress-bar"
            className="relative h-4 w-full overflow-hidden rounded-full border border-navy-200 bg-cream-200"
          >
            <div
              className="h-full rounded-full bg-mint transition-all duration-300"
              style={{
                width: `${Math.max(
                  stats.totalVerifiedHours > 0 ? 4 : 0,
                  stats.overallMilestoneProgressPercent,
                )}%`,
              }}
            />
          </div>

          {/* 10, 25, 50, 100 hour milestone badges */}
          <div className="grid grid-cols-2 gap-2.5 pt-1 sm:grid-cols-4">
            {stats.milestones.map((m) => (
              <div
                key={m.hours}
                data-testid={`milestone-badge-${m.hours}`}
                data-unlocked={m.unlocked ? "true" : "false"}
                className={[
                  "flex items-center justify-between rounded-xl border-2 px-3.5 py-2.5 text-sm transition-colors",
                  m.unlocked
                    ? "border-mint-700 bg-mint-100 text-navy-900 font-bold"
                    : "border-navy-100 bg-cream-100 text-navy-600",
                ].join(" ")}
              >
                <span className="font-display font-bold">{m.hours} hours</span>
                <Badge
                  tone={m.unlocked ? "mint" : "neutral"}
                  size="sm"
                  variant={m.unlocked ? "solid" : "soft"}
                >
                  {m.unlocked ? "Unlocked" : `${m.progressPercent}%`}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* 3. Verified Hours Certificate & Public Verification Card */}
      <Card
        padding="lg"
        data-testid="volunteer-certificate-section"
        className="space-y-5 border-2 border-navy"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">Official Hours Certificate</Badge>
              <span className="text-xs font-mono font-semibold text-navy-600">
                Code: {verificationCode}
              </span>
            </div>
            <CardTitle as="h2" className="text-2xl">
              Verified Volunteer Hours Certificate for {volunteerName}
            </CardTitle>
            <CardDescription>
              Download a one-page PDF certificate with your event table,
              organizer sign-offs, total verified hours ({totalHoursStr} hrs),
              and a scannable QR code linking to{" "}
              <code className="rounded bg-cream-200 px-1.5 py-0.5 font-mono text-navy-900">
                {verifyPath}
              </code>
              .
            </CardDescription>
          </div>

          <div className="flex items-center gap-3 self-start rounded-2xl border border-navy-100 bg-cream-100 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={verifyQrDataUrl}
              alt={`Verification QR code for ${volunteerName}`}
              width={72}
              height={72}
              className="h-16 w-16 rounded-lg border border-navy-100 bg-white p-1"
            />
            <div className="text-xs space-y-1">
              <p className="font-bold text-navy-900">Verified by ShiftShare</p>
              <Link
                href={verifyPath}
                data-testid="verified-profile-link"
                className="block font-mono text-navy-700 underline underline-offset-2 hover:text-navy-900"
              >
                {verifyPath}
              </Link>
            </div>
          </div>
        </div>

        {/* Certificate Actions: Download Certificate, Download for one event, Share Verified Profile */}
        <div className="flex flex-col gap-3 border-t border-navy-100 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={`/api/certificate?code=${encodeURIComponent(verificationCode)}`}
              download
              data-testid="download-certificate-btn"
              className={buttonClasses({ variant: "primary", size: "md" })}
            >
              Download Certificate
            </a>

            <Button
              type="button"
              variant="secondary"
              size="md"
              data-testid="share-verified-profile-btn"
              onClick={handleCopyVerifiedProfile}
            >
              {copiedProfileLink
                ? "Copied Verified Profile Link!"
                : "Share Verified Profile"}
            </Button>
          </div>

          {/* Download for one event option */}
          {distinctAttendedEvents.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-navy-100 bg-cream-100 p-2">
              <label
                htmlFor="single-event-cert-select"
                className="pl-1 text-xs font-semibold text-navy-700"
              >
                Single event:
              </label>
              <select
                id="single-event-cert-select"
                data-testid="single-event-cert-select"
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                className="min-h-tap rounded-lg border border-navy-200 bg-white px-2.5 py-1 text-xs font-semibold text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy"
              >
                {distinctAttendedEvents.map((ev) => (
                  <option key={ev.eventId} value={ev.eventId}>
                    {ev.eventTitle}
                  </option>
                ))}
              </select>
              <a
                href={`/api/certificate?eventId=${encodeURIComponent(selectedEventId)}`}
                download
                data-testid="download-single-event-cert-btn"
                className={buttonClasses({ variant: "outline", size: "sm" })}
              >
                Download for one event
              </a>
            </div>
          )}
        </div>
      </Card>

      {notice && (
        <p
          role="status"
          data-testid="volunteer-dashboard-notice"
          className="rounded-xl border-2 border-mint bg-mint-100 px-4 py-3 text-sm font-semibold text-navy-900"
        >
          {notice}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl border-2 border-coral bg-coral-100 px-4 py-3 text-sm font-semibold text-navy-900"
        >
          {error}
        </p>
      )}

      {/* 4. Upcoming Shifts & Past Events Grid */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        {/* Upcoming Shifts List with Cancel Buttons */}
        <Card
          padding="lg"
          data-testid="upcoming-shifts-section"
          className="space-y-4"
        >
          <CardHeader className="mb-0">
            <CardTitle as="h2">Upcoming shifts</CardTitle>
            <CardDescription>
              Shifts you&apos;ve claimed. Need to free up your spot? Cancel
              anytime before the shift starts.
            </CardDescription>
          </CardHeader>

          {stats.upcomingShifts.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-navy-200 p-5 text-center space-y-2">
              <p className="font-display font-bold text-navy-900">
                No upcoming shifts
              </p>
              <p className="text-sm text-navy-600">
                When you claim an open shift on an event page, it will appear
                here.
              </p>
            </div>
          ) : (
            <ul
              data-testid="upcoming-shifts-list"
              className="divide-y divide-navy-100 border-t border-navy-100"
            >
              {stats.upcomingShifts.map((shift) => (
                <li
                  key={shift.signupId}
                  data-testid={`upcoming-shift-row-${shift.shiftId}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-4 last:pb-0"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display font-bold text-navy-900">
                        {shift.roleName}
                      </span>
                      <Badge
                        tone={shift.status === "waitlist" ? "accent" : "mint"}
                        size="sm"
                      >
                        {shift.status === "waitlist" ? "Standby" : "Confirmed"}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium text-navy-800">
                      <Link
                        href={`/events/${shift.eventSlug || shift.eventId}`}
                        className="underline underline-offset-2 hover:text-navy-900"
                      >
                        {shift.eventTitle}
                      </Link>
                      {shift.location ? ` · ${shift.location}` : ""}
                    </p>
                    <p className="text-xs text-navy-600">
                      {eventDayWithYear(shift.startsAt, shift.timezone)} ·{" "}
                      {eventTimeRange(
                        shift.startsAt,
                        shift.endsAt,
                        shift.timezone,
                      )}
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    loading={isPending && cancellingShiftId === shift.shiftId}
                    data-testid={`cancel-shift-btn-${shift.shiftId}`}
                    onClick={() =>
                      handleCancelUpcomingShift(shift.shiftId, shift.roleName)
                    }
                  >
                    Cancel shift
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Past Events List with Date, Role, and Hours Each */}
        <Card
          padding="lg"
          data-testid="past-events-section"
          className="space-y-4"
        >
          <CardHeader className="mb-0">
            <CardTitle as="h2">Past events &amp; completed shifts</CardTitle>
            <CardDescription>
              Your historical service log with date, role, and verified hours
              for each event.
            </CardDescription>
          </CardHeader>

          {stats.pastEvents.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-navy-200 p-5 text-center space-y-2">
              <p className="font-display font-bold text-navy-900">
                No past events yet
              </p>
              <p className="text-sm text-navy-600">
                Completed shifts and verified hours appear here once you check
                in and out at an event.
              </p>
            </div>
          ) : (
            <ul
              data-testid="past-events-list"
              className="divide-y divide-navy-100 border-t border-navy-100"
            >
              {stats.pastEvents.map((entry) => (
                <li
                  key={entry.signupId}
                  data-testid={`past-event-row-${entry.signupId}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-4 last:pb-0"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display font-bold text-navy-900">
                        {entry.eventTitle}
                      </span>
                      <Badge
                        tone={entry.hours > 0 ? "mint" : "neutral"}
                        size="sm"
                      >
                        {entry.roleName}
                      </Badge>
                      {entry.adjustedByOrganizer && (
                        <Badge tone="coral" size="sm">
                          Adjusted by organizer
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-navy-600">
                      {eventDayWithYear(entry.eventDate, entry.timezone)} ·
                      Organizer: {entry.organizerName}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      data-testid={`past-event-hours-${entry.signupId}`}
                      className="font-display text-base font-bold text-navy-900"
                    >
                      {formatHoursToTwoDecimals(entry.hours)} hrs
                    </span>
                    {entry.hours > 0 && (
                      <a
                        href={`/api/certificate?eventId=${encodeURIComponent(entry.eventId)}`}
                        download
                        data-testid={`download-event-cert-${entry.eventId}`}
                        className="rounded-lg border border-navy-200 bg-cream-100 px-2.5 py-1.5 text-xs font-semibold text-navy-800 hover:bg-cream-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy"
                      >
                        Download for one event
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
