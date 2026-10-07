"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import {
  Card,
  CardDescription,
  CardTitle,
} from "@/components/ui/Card";
import {
  OrganizerCheckinDashboard,
  type OrganizerEventCheckinBundle,
} from "@/components/checkin/OrganizerCheckinDashboard";
import {
  generateEventRecapAction,
  generateVolunteerThankYousAction,
} from "@/app/dashboard/actions";
import {
  buildEventVolunteersCsv,
  type OrganizerEventAnalytics,
} from "@/lib/analytics/organizer";
import { formatHoursToTwoDecimals } from "@/lib/checkin/hours";
import { eventDayWithYear } from "@/lib/events/format";
import type {
  EventRecap,
  VolunteerThankYouMessage,
} from "@/lib/ai";

type Props = {
  analyticsList: OrganizerEventAnalytics[];
  checkinBundles: OrganizerEventCheckinBundle[];
  initialRecapsByEvent: Record<string, EventRecap>;
  initialEventId?: string;
};

const emptySubscribe = () => () => {};

export function OrganizerAnalyticsDashboard({
  analyticsList,
  checkinBundles,
  initialRecapsByEvent,
  initialEventId,
}: Props) {
  const isChartsMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const [selectedEventId, setSelectedEventId] = useState<string>(
    initialEventId && analyticsList.some((a) => a.eventId === initialEventId)
      ? initialEventId
      : (analyticsList[0]?.eventId ?? ""),
  );

  // Thank Volunteers state per event
  const [thankYousByEvent, setThankYousByEvent] = useState<
    Record<string, VolunteerThankYouMessage[]>
  >({});
  const [thankYouError, setThankYouError] = useState<string | null>(null);
  const [copiedVolunteerId, setCopiedVolunteerId] = useState<string | null>(
    null,
  );
  const [copiedAllThankYous, setCopiedAllThankYous] = useState(false);
  const [isGeneratingThankYous, startThankYouTransition] = useTransition();

  // AI Event Recap state per event
  const [recapsByEvent, setRecapsByEvent] =
    useState<Record<string, EventRecap>>(initialRecapsByEvent);
  const [recapError, setRecapError] = useState<string | null>(null);
  const [isGeneratingRecap, startRecapTransition] = useTransition();

  // CSV Export feedback
  const [lastExportedCsv, setLastExportedCsv] = useState<string | null>(null);

  const activeAnalytics =
    analyticsList.find((a) => a.eventId === selectedEventId) ??
    analyticsList[0] ??
    null;

  if (!activeAnalytics) {
    return (
      <Card padding="lg" className="text-center space-y-4">
        <CardTitle as="h2">No events yet</CardTitle>
        <CardDescription>
          Write one sentence about your event and ShiftShare turns it into
          shifts you can post.
        </CardDescription>
        <div className="flex justify-center">
          <Link
            href="/events/new"
            className={buttonClasses({ variant: "primary", size: "md" })}
          >
            Plan your first event
          </Link>
        </div>
      </Card>
    );
  }

  const activeThankYous = thankYousByEvent[activeAnalytics.eventId] ?? null;
  const activeRecap = recapsByEvent[activeAnalytics.eventId] ?? null;

  function handleExportCsv() {
    if (!activeAnalytics) return;
    const csvContent = buildEventVolunteersCsv(activeAnalytics);
    setLastExportedCsv(csvContent);

    if (typeof window !== "undefined") {
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeAnalytics.eventSlug || "event"}-volunteers-hours.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  function handleThankVolunteers() {
    if (!activeAnalytics) return;
    setThankYouError(null);

    const eventId = activeAnalytics.eventId;
    const groupedByVolunteer = new Map<
      string,
      {
        volunteerId: string;
        volunteerName: string;
        attendedRoles: Set<string>;
        allRoles: Set<string>;
        hours: number;
      }
    >();

    for (const row of activeAnalytics.volunteerRows) {
      const existing = groupedByVolunteer.get(row.volunteerId);
      if (existing) {
        existing.allRoles.add(row.roleName);
        if (row.hours > 0) existing.attendedRoles.add(row.roleName);
        existing.hours = Math.round((existing.hours + row.hours) * 100) / 100;
      } else {
        const attendedRoles = new Set<string>();
        if (row.hours > 0) attendedRoles.add(row.roleName);
        groupedByVolunteer.set(row.volunteerId, {
          volunteerId: row.volunteerId,
          volunteerName: row.volunteerName,
          attendedRoles,
          allRoles: new Set([row.roleName]),
          hours: row.hours,
        });
      }
    }

    const volunteersInput = Array.from(groupedByVolunteer.values()).map(
      (item) => ({
        volunteerId: item.volunteerId,
        volunteerName: item.volunteerName,
        roleName: Array.from(
          item.attendedRoles.size > 0 ? item.attendedRoles : item.allRoles,
        ).join(" & "),
        hours: item.hours,
      }),
    );

    startThankYouTransition(async () => {
      const res = await generateVolunteerThankYousAction({
        eventTitle: activeAnalytics.eventTitle,
        eventDate: eventDayWithYear(
          activeAnalytics.startsAt,
          activeAnalytics.timezone,
        ),
        volunteers: volunteersInput,
      });

      if (!res.ok) {
        setThankYouError(
          res.error ?? "Couldn't generate thank-you messages. Tap Retry.",
        );
        return;
      }

      setThankYousByEvent((prev) => ({
        ...prev,
        [eventId]: res.messages,
      }));
    });
  }

  function handleEditThankYouMessage(volunteerId: string, nextText: string) {
    if (!activeAnalytics) return;
    const eventId = activeAnalytics.eventId;
    setThankYousByEvent((prev) => ({
      ...prev,
      [eventId]: (prev[eventId] ?? []).map((m) =>
        m.volunteerId === volunteerId ? { ...m, message: nextText } : m,
      ),
    }));
  }

  async function handleCopySingleThankYou(
    volunteerId: string,
    messageText: string,
  ) {
    try {
      await navigator.clipboard.writeText(messageText);
    } catch {
      // Fallback if clipboard API is restricted
    }
    setCopiedVolunteerId(volunteerId);
    window.setTimeout(() => setCopiedVolunteerId(null), 2000);
  }

  async function handleCopyAllThankYous() {
    if (!activeThankYous) return;
    const combined = activeThankYous
      .map((m) => `${m.volunteerName} (${m.roleName}):\n${m.message}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(combined);
    } catch {
      // Fallback
    }
    setCopiedAllThankYous(true);
    window.setTimeout(() => setCopiedAllThankYous(false), 2000);
  }

  function handleRegenerateRecap() {
    if (!activeAnalytics) return;
    setRecapError(null);
    const eventId = activeAnalytics.eventId;

    startRecapTransition(async () => {
      const res = await generateEventRecapAction({
        eventTitle: activeAnalytics.eventTitle,
        totalCapacity: activeAnalytics.totalCapacity,
        confirmedSignups: activeAnalytics.confirmedSignups,
        fillRatePercent: activeAnalytics.fillRatePercent,
        checkedInCount: activeAnalytics.checkedInCount,
        noShowCount: activeAnalytics.noShowCount,
        noShowRatePercent: activeAnalytics.noShowRatePercent,
        totalVolunteerHours: activeAnalytics.totalVolunteerHours,
        roles: activeAnalytics.fillRatePerRole.map((r) => ({
          roleName: r.roleName,
          capacity: r.capacity,
          signedUp: r.signedUp,
          attended: r.attended,
          fillRatePercent: r.fillRatePercent,
        })),
      });

      if (!res.ok) {
        setRecapError(res.error ?? "Couldn't generate the event recap.");
        return;
      }

      setRecapsByEvent((prev) => ({
        ...prev,
        [eventId]: res.recap,
      }));
    });
  }

  return (
    <div className="space-y-8" data-testid="organizer-analytics-dashboard">
      {/* 1. List of Organizer's Events with Fill Rate, Checked-in Count, and No-Show Rate */}
      <Card
        padding="lg"
        data-testid="organizer-events-card"
        className="space-y-5 print:hidden"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle as="h2">Your events</CardTitle>
            <CardDescription>
              Select an event to inspect fill rates, check-ins, no-show rates,
              Recharts analytics, AI recap, and QR check-in.
            </CardDescription>
          </div>
          <Link
            href="/events/new"
            className={buttonClasses({ variant: "primary", size: "sm" })}
          >
            New event
          </Link>
        </div>

        <ul
          data-testid="organizer-events-list"
          className="divide-y divide-navy-100 border-t border-navy-100"
        >
          {analyticsList.map((ev) => {
            const isSelected = ev.eventId === activeAnalytics.eventId;
            return (
              <li
                key={ev.eventId}
                data-testid={`organizer-event-row-${ev.eventId}`}
                className={[
                  "flex flex-col gap-3 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between",
                  isSelected ? "bg-cream-100/70 -mx-3 px-3 rounded-xl" : "",
                ].join(" ")}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEventId(ev.eventId);
                        setThankYouError(null);
                        setRecapError(null);
                        setLastExportedCsv(null);
                      }}
                      className="font-display text-lg font-bold text-navy-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy rounded text-left"
                    >
                      {ev.eventTitle}
                    </button>
                    <Badge
                      tone={ev.published ? "mint" : "neutral"}
                      size="sm"
                      variant="soft"
                    >
                      {ev.published ? "Published" : "Draft"}
                    </Badge>
                    <Link
                      href={`/events/${ev.eventSlug || ev.eventId}`}
                      className="text-xs font-semibold text-navy-600 underline underline-offset-2 hover:text-navy-900"
                    >
                      Public page
                    </Link>
                  </div>
                  <p className="text-xs text-navy-600">
                    {eventDayWithYear(ev.startsAt, ev.timezone)}
                    {ev.location ? ` · ${ev.location}` : ""}
                  </p>
                </div>

                {/* Fill rate, checked-in count, and no-show rate pills */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone="navy"
                    variant="soft"
                    data-testid={`event-fill-rate-${ev.eventId}`}
                  >
                    Fill rate: {ev.fillRatePercent}% ({ev.confirmedSignups}/
                    {ev.totalCapacity})
                  </Badge>
                  <Badge
                    tone="mint"
                    variant="soft"
                    data-testid={`event-checked-in-${ev.eventId}`}
                  >
                    {ev.checkedInCount} checked in
                  </Badge>
                  <Badge
                    tone={ev.noShowRatePercent > 20 ? "coral" : "neutral"}
                    variant="soft"
                    data-testid={`event-no-show-rate-${ev.eventId}`}
                  >
                    No-show rate: {ev.noShowRatePercent}%
                  </Badge>
                  <Button
                    type="button"
                    variant={isSelected ? "primary" : "secondary"}
                    size="sm"
                    data-testid={`select-event-analytics-btn-${ev.eventId}`}
                    onClick={() => {
                      setSelectedEventId(ev.eventId);
                      setThankYouError(null);
                      setRecapError(null);
                      setLastExportedCsv(null);
                    }}
                  >
                    {isSelected ? "Viewing" : "View analytics"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* 2. Event Detail Analytics Header + KPI Strip + Export CSV + Thank Volunteers */}
      <section
        aria-label={`Analytics for ${activeAnalytics.eventTitle}`}
        data-testid="event-detail-analytics"
        className="space-y-6 print:hidden"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Badge tone="accent">Event analytics &amp; AI tools</Badge>
            <h2 className="mt-1.5 font-display text-2xl font-bold text-navy-900 sm:text-3xl">
              {activeAnalytics.eventTitle}
            </h2>
            <p className="text-sm text-navy-600">
              {eventDayWithYear(
                activeAnalytics.startsAt,
                activeAnalytics.timezone,
              )}
              {activeAnalytics.location ? ` · ${activeAnalytics.location}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              type="button"
              variant="secondary"
              size="md"
              data-testid="export-csv-btn"
              onClick={handleExportCsv}
            >
              Export CSV
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              loading={isGeneratingThankYous}
              data-testid="thank-volunteers-btn"
              onClick={handleThankVolunteers}
            >
              Thank volunteers
            </Button>
          </div>
        </div>

        {/* Hidden/inspectable CSV output preview when Export CSV is clicked */}
        {lastExportedCsv && (
          <Card
            padding="md"
            data-testid="exported-csv-preview"
            className="space-y-2 border-2 border-mint bg-mint-50"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-navy-900 uppercase">
                CSV exported ({activeAnalytics.volunteerRows.length} volunteer
                rows)
              </p>
              <button
                type="button"
                onClick={() => setLastExportedCsv(null)}
                className="text-xs font-semibold text-navy-600 underline"
              >
                Dismiss
              </button>
            </div>
            <pre
              data-testid="exported-csv-text"
              className="max-h-36 overflow-auto rounded-lg border border-navy-100 bg-white p-3 font-mono text-xs text-navy-800"
            >
              {lastExportedCsv}
            </pre>
          </Card>
        )}

        {/* KPI Summary Cards: Fill Rate, Checked-In Count, No-Show Rate, Total Volunteer Hours Contributed */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card padding="md" className="space-y-1">
            <p className="text-xs font-semibold tracking-wide text-navy-500 uppercase">
              Fill rate
            </p>
            <p
              data-testid="analytics-fill-rate"
              className="font-display text-3xl font-bold text-navy-900"
            >
              {activeAnalytics.fillRatePercent}%
            </p>
            <p className="text-xs text-navy-600">
              {activeAnalytics.confirmedSignups} of{" "}
              {activeAnalytics.totalCapacity} spots claimed
            </p>
          </Card>

          <Card padding="md" className="space-y-1">
            <p className="text-xs font-semibold tracking-wide text-navy-500 uppercase">
              Checked-in count
            </p>
            <p
              data-testid="analytics-checked-in-count"
              className="font-display text-3xl font-bold text-navy-900"
            >
              {activeAnalytics.checkedInCount}
            </p>
            <p className="text-xs text-navy-600">
              Arrived and scanned QR check-in
            </p>
          </Card>

          <Card padding="md" className="space-y-1">
            <p className="text-xs font-semibold tracking-wide text-navy-500 uppercase">
              No-show rate
            </p>
            <p
              data-testid="analytics-no-show-rate"
              className="font-display text-3xl font-bold text-navy-900"
            >
              {activeAnalytics.noShowRatePercent}%
            </p>
            <p className="text-xs text-navy-600">
              {activeAnalytics.noShowCount} unexcused{" "}
              {activeAnalytics.noShowCount === 1 ? "no-show" : "no-shows"}
            </p>
          </Card>

          <Card padding="md" className="space-y-1 border-2 border-navy bg-accent-50">
            <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
              Total volunteer hours contributed
            </p>
            <p
              data-testid="analytics-total-hours"
              className="font-display text-3xl font-bold text-navy-900"
            >
              {formatHoursToTwoDecimals(activeAnalytics.totalVolunteerHours)}{" "}
              hrs
            </p>
            <p className="text-xs text-navy-600">
              Verified server-side from timestamps
            </p>
          </Card>
        </div>

        {/* 3. Recharts Charts: Signups Over Time, Fill Rate Per Role, Attendance vs Signups */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Chart 1: Signups Over Time */}
          <Card
            padding="md"
            data-testid="chart-signups-over-time"
            className="space-y-3"
          >
            <div>
              <CardTitle as="h3" className="text-base">
                Signups over time
              </CardTitle>
              <CardDescription className="text-xs">
                Cumulative volunteer signups leading up to the event.
              </CardDescription>
            </div>
            <div className="h-56 w-full">
              {isChartsMounted ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={220} minHeight={180}>
                  <AreaChart
                    data={activeAnalytics.signupsOverTime}
                    margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E6E9F0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#3E4E6C", fontSize: 11 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: "#3E4E6C", fontSize: 11 }}
                    />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="cumulativeSignups"
                      name="Cumulative signups"
                      stroke="#1B2A49"
                      strokeWidth={2.5}
                      fill="#FFC93C"
                      fillOpacity={0.45}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full w-full animate-pulse rounded-xl bg-cream-200" />
              )}
            </div>
          </Card>

          {/* Chart 2: Fill Rate Per Role */}
          <Card
            padding="md"
            data-testid="chart-fill-rate-per-role"
            className="space-y-3"
          >
            <div>
              <CardTitle as="h3" className="text-base">
                Fill rate per role (%)
              </CardTitle>
              <CardDescription className="text-xs">
                Percentage of shift spots claimed for each role.
              </CardDescription>
            </div>
            <div className="h-56 w-full">
              {isChartsMounted ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={220} minHeight={180}>
                  <BarChart
                    data={activeAnalytics.fillRatePerRole}
                    margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E6E9F0" />
                    <XAxis
                      dataKey="roleName"
                      tick={{ fill: "#3E4E6C", fontSize: 11 }}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: "#3E4E6C", fontSize: 11 }}
                    />
                    <Tooltip />
                    <Bar
                      dataKey="fillRatePercent"
                      name="Fill rate (%)"
                      fill="#2EC4B6"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full w-full animate-pulse rounded-xl bg-cream-200" />
              )}
            </div>
          </Card>

          {/* Chart 3: Attendance vs Signups */}
          <Card
            padding="md"
            data-testid="chart-attendance-vs-signups"
            className="space-y-3"
          >
            <div>
              <CardTitle as="h3" className="text-base">
                Attendance vs signups
              </CardTitle>
              <CardDescription className="text-xs">
                Confirmed signups compared against checked-in attendance.
              </CardDescription>
            </div>
            <div className="h-56 w-full">
              {isChartsMounted ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={220} minHeight={180}>
                  <BarChart
                    data={activeAnalytics.attendanceVsSignups}
                    margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E6E9F0" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: "#3E4E6C", fontSize: 11 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: "#3E4E6C", fontSize: 11 }}
                    />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      dataKey="signedUp"
                      name="Signed up"
                      fill="#1B2A49"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="attended"
                      name="Attended"
                      fill="#2EC4B6"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full w-full animate-pulse rounded-xl bg-cream-200" />
              )}
            </div>
          </Card>
        </div>

        {/* 4. AI "Event Recap" Card */}
        <Card
          padding="lg"
          data-testid="ai-event-recap-card"
          className="space-y-4 border-2 border-navy bg-cream-100"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Badge tone="accent">AI Event recap</Badge>
                <span className="text-xs font-medium text-navy-600">
                  Powered by Claude · Based on live signup &amp; check-in data
                </span>
              </div>
              <CardTitle as="h3" className="mt-1.5">
                Performance summary &amp; next-time suggestions
              </CardTitle>
            </div>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={isGeneratingRecap}
              data-testid="generate-event-recap-btn"
              onClick={handleRegenerateRecap}
            >
              {activeRecap ? "Refresh recap" : "Generate recap"}
            </Button>
          </div>

          {recapError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-coral bg-coral-100 px-4 py-3 text-sm text-navy-900"
            >
              <span className="font-semibold">{recapError}</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="event-recap-retry-btn"
                onClick={handleRegenerateRecap}
              >
                Retry
              </Button>
            </div>
          )}

          {activeRecap && (
            <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
              <div className="rounded-2xl border border-navy-100 bg-white p-4">
                <p className="text-xs font-bold tracking-wide text-navy-500 uppercase">
                  3–4 Sentence Performance Summary
                </p>
                <p
                  data-testid="event-recap-summary"
                  className="mt-2 text-sm leading-relaxed text-navy-800"
                >
                  {activeRecap.summary}
                </p>
              </div>

              <div className="rounded-2xl border border-navy-100 bg-white p-4 space-y-2">
                <p className="text-xs font-bold tracking-wide text-navy-500 uppercase">
                  2 Suggestions for Next Time
                </p>
                <ol
                  data-testid="event-recap-suggestions"
                  className="list-decimal pl-5 space-y-1.5 text-sm text-navy-800"
                >
                  {activeRecap.suggestions.map((suggestion, idx) => (
                    <li
                      key={idx}
                      data-testid={`event-recap-suggestion-${idx}`}
                    >
                      {suggestion}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </Card>

        {/* 5. Personalized "Thank Volunteers" Panel (Claude API) */}
        {(thankYouError || activeThankYous) && (
          <Card
            padding="lg"
            data-testid="thank-volunteers-panel"
            className="space-y-4 border-2 border-navy"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Badge tone="mint">Personalized Volunteer Thank-Yous</Badge>
                <CardTitle as="h3" className="mt-1.5">
                  Thank-you messages for {activeAnalytics.eventTitle}
                </CardTitle>
                <CardDescription>
                  Claude drafted a note for each volunteer based on their role
                  and verified hours. Edit any message below and copy it.
                </CardDescription>
              </div>

              {activeThankYous && activeThankYous.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="copy-all-thank-yous-btn"
                  onClick={handleCopyAllThankYous}
                >
                  {copiedAllThankYous
                    ? "Copied all messages!"
                    : "Copy all messages"}
                </Button>
              )}
            </div>

            {thankYouError && (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-coral bg-coral-100 px-4 py-3 text-sm text-navy-900"
              >
                <span className="font-semibold">{thankYouError}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="thank-volunteers-retry-btn"
                  onClick={handleThankVolunteers}
                >
                  Retry
                </Button>
              </div>
            )}

            {activeThankYous && activeThankYous.length === 0 && (
              <p className="text-sm text-navy-600">
                No confirmed volunteers on this event yet.
              </p>
            )}

            {activeThankYous && activeThankYous.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {activeThankYous.map((item) => (
                  <div
                    key={item.volunteerId}
                    data-testid={`thank-you-card-${item.volunteerId}`}
                    className="rounded-2xl border border-navy-100 bg-cream-100 p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-display font-bold text-navy-900">
                          {item.volunteerName}
                        </p>
                        <p className="text-xs text-navy-600">
                          {item.roleName} ·{" "}
                          {formatHoursToTwoDecimals(item.hours)} hrs
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        data-testid={`copy-thank-you-btn-${item.volunteerId}`}
                        onClick={() =>
                          handleCopySingleThankYou(
                            item.volunteerId,
                            item.message,
                          )
                        }
                      >
                        {copiedVolunteerId === item.volunteerId
                          ? "Copied!"
                          : "Copy"}
                      </Button>
                    </div>

                    <textarea
                      rows={4}
                      value={item.message}
                      aria-label={`Thank-you message for ${item.volunteerName}`}
                      data-testid={`thank-you-textarea-${item.volunteerId}`}
                      onChange={(e) =>
                        handleEditThankYouMessage(
                          item.volunteerId,
                          e.target.value,
                        )
                      }
                      className="w-full rounded-xl border-2 border-navy-200 bg-white p-3 text-sm text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy"
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </section>

      {/* 6. Organizer QR Check-In & Live "Who's here" Roster */}
      {checkinBundles.length > 0 && (
        <OrganizerCheckinDashboard
          bundles={checkinBundles}
          initialEventId={activeAnalytics.eventId}
        />
      )}
    </div>
  );
}
