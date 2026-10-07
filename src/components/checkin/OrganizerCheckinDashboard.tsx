"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import {
  fetchEventRosterAction,
  organizerSetCheckoutAction,
  refreshEventQrTokenAction,
} from "@/app/checkin/actions";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  eventClock,
  eventDayWithYear,
  eventTimeRange,
} from "@/lib/events/format";
import {
  formatHoursToTwoDecimals,
  resolveCheckoutInstantFromWallClock,
  wallClockTimeInZone,
} from "@/lib/checkin/hours";
import type { WhosHereEntry } from "@/lib/checkin/roster";
import type { EventRow } from "@/lib/supabase/database.types";

export type OrganizerEventCheckinBundle = {
  event: EventRow;
  qrDataUrl: string;
  checkinPath: string;
  checkinUrl: string;
  roster: WhosHereEntry[];
};

type Props = {
  bundles: OrganizerEventCheckinBundle[];
  initialEventId?: string;
};

export function OrganizerCheckinDashboard({
  bundles: initialBundles,
  initialEventId,
}: Props) {
  const [bundles, setBundles] =
    useState<OrganizerEventCheckinBundle[]>(initialBundles);
  const [selectedEventId, setSelectedEventId] = useState<string>(
    initialEventId && initialBundles.some((b) => b.event.id === initialEventId)
      ? initialEventId
      : (initialBundles[0]?.event.id ?? ""),
  );

  const [showPoster, setShowPoster] = useState(false);
  const [showFullScreen, setShowFullScreen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingSignupId, setEditingSignupId] = useState<string | null>(null);
  const [checkoutTimeInput, setCheckoutTimeInput] = useState<string>("");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const [isRefreshingQr, startRefreshQr] = useTransition();
  const [isSavingCheckout, startSaveCheckout] = useTransition();

  const activeBundle = useMemo(
    () =>
      bundles.find((b) => b.event.id === selectedEventId) ?? bundles[0] ?? null,
    [bundles, selectedEventId],
  );

  const refreshActiveRoster = useCallback(async (eventId: string) => {
    try {
      const res = await fetchEventRosterAction(eventId);
      if (res.ok) {
        setBundles((prev) =>
          prev.map((b) =>
            b.event.id === eventId ? { ...b, roster: res.roster } : b,
          ),
        );
      }
    } catch {
      // Keep current roster if transient network error occurs
    }
  }, []);

  // Realtime subscription + BroadcastChannel + lightweight poll for live updates
  useEffect(() => {
    if (!activeBundle) return;
    const eventId = activeBundle.event.id;

    let channelCleanup: (() => void) | undefined;
    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        const channel = supabase
          .channel(`event-whos-here-${eventId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "checkins" },
            () => {
              void refreshActiveRoster(eventId);
            },
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "signups" },
            () => {
              void refreshActiveRoster(eventId);
            },
          )
          .subscribe();

        channelCleanup = () => {
          void supabase.removeChannel(channel);
        };
      } catch {
        // Ignore if realtime websocket is unavailable in local environment
      }
    }

    let bc: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      bc = new BroadcastChannel("shiftshare-checkin-updates");
      bc.onmessage = (ev) => {
        if (!ev.data?.eventId || ev.data.eventId === eventId) {
          void refreshActiveRoster(eventId);
        }
      };
    }

    const intervalId = window.setInterval(() => {
      void refreshActiveRoster(eventId);
    }, 3000);

    return () => {
      channelCleanup?.();
      bc?.close();
      window.clearInterval(intervalId);
    };
  }, [activeBundle, refreshActiveRoster]);

  // Close full-screen QR modal on Escape
  useEffect(() => {
    if (!showFullScreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowFullScreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showFullScreen]);

  if (!activeBundle) {
    return null;
  }

  const { event, qrDataUrl, checkinPath, roster } = activeBundle;

  const counts = {
    checkedIn: roster.filter((r) => r.status === "checked_in").length,
    notYetArrived: roster.filter((r) => r.status === "not_yet_arrived").length,
    checkedOut: roster.filter((r) => r.status === "checked_out").length,
  };

  function handleRefreshQr() {
    setError(null);
    setNotice(null);
    const origin =
      typeof window !== "undefined" ? window.location.origin : undefined;

    startRefreshQr(async () => {
      const res = await refreshEventQrTokenAction(event.id, origin);
      if (
        !res.ok ||
        !res.token ||
        !res.qrDataUrl ||
        !res.checkinPath ||
        !res.checkinUrl
      ) {
        setError(res.error ?? "Couldn't refresh the QR code.");
        return;
      }

      setBundles((prev) =>
        prev.map((b) =>
          b.event.id === event.id
            ? {
                ...b,
                event: { ...b.event, checkin_token: res.token! },
                qrDataUrl: res.qrDataUrl!,
                checkinPath: res.checkinPath!,
                checkinUrl: res.checkinUrl!,
              }
            : b,
        ),
      );
      setNotice(
        "QR code refreshed. Previous QR codes for this event are now disabled.",
      );
    });
  }

  function openManualCheckoutEditor(entry: WhosHereEntry) {
    setEditingSignupId(entry.signupId);
    setCheckoutError(null);
    const defaultTime = entry.checkedOutAt
      ? wallClockTimeInZone(entry.checkedOutAt, event.timezone)
      : wallClockTimeInZone(entry.shiftEndsAt, event.timezone);
    setCheckoutTimeInput(defaultTime);
  }

  function handleSaveManualCheckout(entry: WhosHereEntry) {
    if (!entry.checkedInAt) return;
    setCheckoutError(null);

    const resolvedIso = resolveCheckoutInstantFromWallClock(
      entry.checkedInAt,
      checkoutTimeInput,
      event.timezone,
    );

    if (!resolvedIso) {
      setCheckoutError(
        "Enter a valid check-out time (HH:MM) after the volunteer's check-in time.",
      );
      return;
    }

    startSaveCheckout(async () => {
      const res = await organizerSetCheckoutAction(
        event.id,
        entry.signupId,
        resolvedIso,
      );
      if (!res.ok || !res.roster) {
        setCheckoutError(res.error ?? "Couldn't save the check-out time.");
        return;
      }

      setBundles((prev) =>
        prev.map((b) =>
          b.event.id === event.id ? { ...b, roster: res.roster! } : b,
        ),
      );
      setEditingSignupId(null);
      setNotice(
        `Updated check-out time for ${entry.volunteerName} (flagged as adjusted by organizer).`,
      );
    });
  }

  return (
    <section
      aria-labelledby="checkin-dashboard-heading"
      data-testid="organizer-checkin-dashboard"
      className="space-y-6"
    >
      {/* Event selector if organizer has multiple events */}
      {bundles.length > 1 && (
        <div
          className="flex flex-wrap items-center gap-2 print:hidden"
          role="tablist"
          aria-label="Select event for QR check-in"
        >
          <span className="text-xs font-semibold tracking-wide text-navy-500 uppercase mr-1">
            Event check-in:
          </span>
          {bundles.map((b) => {
            const selected = b.event.id === event.id;
            return (
              <button
                key={b.event.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setSelectedEventId(b.event.id);
                  setNotice(null);
                  setError(null);
                  setEditingSignupId(null);
                }}
                className={[
                  "min-h-tap rounded-xl border-2 px-3.5 py-2 text-sm font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream",
                  selected
                    ? "border-navy bg-navy text-cream-100"
                    : "border-navy-100 bg-white text-navy-800 hover:border-navy-300",
                ].join(" ")}
              >
                {b.event.title}
              </button>
            );
          })}
        </div>
      )}

      {/* Main QR + Who's Here Grid (hidden when printing poster) */}
      <div className="grid gap-6 lg:grid-cols-12 print:hidden">
        {/* Left column: Event QR code card */}
        <Card padding="lg" className="space-y-5 lg:col-span-5">
          <CardHeader className="mb-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Badge tone="accent">Event QR check-in</Badge>
                <CardTitle id="checkin-dashboard-heading" className="mt-2">
                  {event.title}
                </CardTitle>
                <CardDescription className="mt-1">
                  {eventDayWithYear(event.starts_at, event.timezone)}
                  {event.location ? ` · ${event.location}` : ""}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <div className="flex flex-col items-center rounded-2xl border-2 border-navy-100 bg-cream-100 p-5 text-center">
            <div className="rounded-2xl border-2 border-navy bg-white p-3 shadow-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt={`Check-in QR code for ${event.title}`}
                data-testid="event-qr-image"
                width={220}
                height={220}
                className="h-52 w-52 object-contain"
              />
            </div>

            <p className="mt-3 text-xs font-medium text-navy-600">
              Volunteers scan this code with their phone camera to check in and
              check out.
            </p>

            <div className="mt-2 w-full rounded-lg border border-navy-100 bg-white px-3 py-2 text-left">
              <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
                Encoded check-in link
              </p>
              <code
                data-testid="qr-checkin-path"
                className="mt-0.5 block break-all font-mono text-xs text-navy-800"
              >
                {checkinPath}
              </code>
            </div>
          </div>

          {notice && (
            <p
              role="status"
              data-testid="qr-status-notice"
              className="rounded-xl border-2 border-mint bg-mint-100 px-3.5 py-2.5 text-sm font-medium text-navy-900"
            >
              {notice}
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-xl border-2 border-coral bg-coral-100 px-3.5 py-2.5 text-sm font-medium text-navy-900"
            >
              {error}
            </p>
          )}

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="refresh-qr-btn"
              loading={isRefreshingQr}
              onClick={handleRefreshQr}
              className="w-full"
            >
              Refresh QR
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="print-poster-btn"
              onClick={() => setShowPoster((v) => !v)}
              className="w-full"
            >
              Print poster
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              data-testid="fullscreen-qr-btn"
              onClick={() => setShowFullScreen(true)}
              className="w-full"
            >
              Full screen
            </Button>
          </div>

          <p className="text-xs text-navy-500">
            Refreshing generates a new secret token and disables previous QR
            codes so the code can&apos;t be shared around after the event.
          </p>
        </Card>

        {/* Right column: Live "Who's here" roster */}
        <Card
          padding="lg"
          data-testid="whos-here-section"
          className="space-y-5 lg:col-span-7"
        >
          <CardHeader className="mb-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Who&apos;s here</CardTitle>
                  <span
                    data-testid="realtime-live-indicator"
                    className="inline-flex items-center gap-1.5 rounded-full border border-mint-600 bg-mint-100 px-2.5 py-0.5 text-xs font-semibold text-navy-900"
                  >
                    <span
                      className="h-2 w-2 rounded-full bg-mint-600 animate-pulse"
                      aria-hidden="true"
                    />
                    Live
                  </span>
                </div>
                <CardDescription className="mt-1">
                  Updates in realtime as volunteers scan the QR code to check in
                  and out.
                </CardDescription>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                <Badge tone="mint" data-testid="count-checked-in">
                  {counts.checkedIn} checked in
                </Badge>
                <Badge tone="neutral" data-testid="count-not-arrived">
                  {counts.notYetArrived} not yet arrived
                </Badge>
                <Badge tone="accent" data-testid="count-checked-out">
                  {counts.checkedOut} checked out
                </Badge>
              </div>
            </div>
          </CardHeader>

          {roster.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-navy-200 bg-cream-100 p-6 text-center space-y-2">
              <p className="font-semibold text-navy-900">
                No confirmed volunteers on this event yet
              </p>
              <p className="text-sm text-navy-600">
                Share{" "}
                <Link
                  href={`/events/${event.slug || event.id}`}
                  className="font-semibold text-navy-900 underline underline-offset-4"
                >
                  your public signup page
                </Link>{" "}
                so volunteers can claim shifts.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-navy-100" data-testid="whos-here-list">
              {roster.map((entry) => {
                const isEditing = editingSignupId === entry.signupId;
                const badgeTone =
                  entry.status === "checked_in"
                    ? "mint"
                    : entry.status === "checked_out"
                      ? "accent"
                      : "neutral";

                return (
                  <li
                    key={entry.signupId}
                    data-testid={`roster-row-${entry.signupId}`}
                    className="py-4 first:pt-0 last:pb-0 space-y-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            data-testid={`roster-name-${entry.signupId}`}
                            className="font-semibold text-navy-900"
                          >
                            {entry.volunteerName}
                          </span>
                          <Badge
                            tone={badgeTone}
                            data-testid={`roster-status-${entry.signupId}`}
                          >
                            {entry.statusLabel}
                          </Badge>
                          {entry.adjustedByOrganizer && (
                            <span
                              data-testid={`adjusted-flag-${entry.signupId}`}
                              className="inline-flex items-center rounded-full border border-coral bg-coral-100 px-2.5 py-0.5 text-xs font-semibold text-navy-900"
                            >
                              Adjusted by organizer
                            </span>
                          )}
                        </div>

                        <p
                          data-testid={`roster-shift-${entry.signupId}`}
                          className="text-sm text-navy-600"
                        >
                          <span className="font-medium text-navy-800">
                            {entry.roleName}
                          </span>{" "}
                          ·{" "}
                          {eventTimeRange(
                            entry.shiftStartsAt,
                            entry.shiftEndsAt,
                            event.timezone,
                          )}
                        </p>

                        <p
                          data-testid={`roster-checkin-time-${entry.signupId}`}
                          className="text-xs text-navy-500"
                        >
                          {entry.checkedInAt ? (
                            <>
                              Checked in at{" "}
                              <span className="font-semibold text-navy-800">
                                {eventClock(entry.checkedInAt, event.timezone)}
                              </span>
                              {entry.checkedOutAt && (
                                <>
                                  {" · "}Checked out at{" "}
                                  <span className="font-semibold text-navy-800">
                                    {eventClock(
                                      entry.checkedOutAt,
                                      event.timezone,
                                    )}
                                  </span>
                                  {" · "}
                                  <span className="font-semibold text-navy-900">
                                    {formatHoursToTwoDecimals(
                                      entry.hoursWorked,
                                    )}{" "}
                                    hrs
                                  </span>
                                </>
                              )}
                            </>
                          ) : (
                            "Check-in time: —"
                          )}
                        </p>
                      </div>

                      {/* Manual check-out button if volunteer checked in (or to adjust check-out) */}
                      {entry.checkedInAt && !isEditing && (
                        <div className="shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            data-testid={`manual-checkout-btn-${entry.signupId}`}
                            onClick={() => openManualCheckoutEditor(entry)}
                            className="border border-navy-200 bg-cream-100 text-xs"
                          >
                            {entry.checkedOutAt
                              ? "Adjust check-out"
                              : "Set check-out time"}
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Inline Manual Check-Out Editor */}
                    {isEditing && (
                      <div
                        data-testid={`manual-checkout-editor-${entry.signupId}`}
                        className="rounded-xl border-2 border-navy-200 bg-cream-100 p-3.5 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label
                            htmlFor={`checkout-time-${entry.signupId}`}
                            className="text-xs font-semibold text-navy-800"
                          >
                            Set check-out time for {entry.volunteerName} (marks
                            record &ldquo;adjusted by organizer&rdquo;):
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              setCheckoutTimeInput(
                                wallClockTimeInZone(
                                  entry.shiftEndsAt,
                                  event.timezone,
                                ),
                              )
                            }
                            className="text-xs font-semibold text-navy-700 underline underline-offset-2 hover:text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy rounded"
                          >
                            Use shift end (
                            {eventClock(entry.shiftEndsAt, event.timezone)})
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            id={`checkout-time-${entry.signupId}`}
                            type="time"
                            value={checkoutTimeInput}
                            onChange={(e) =>
                              setCheckoutTimeInput(e.target.value)
                            }
                            data-testid={`manual-checkout-input-${entry.signupId}`}
                            className="min-h-tap rounded-xl border-2 border-navy-200 bg-white px-3 py-1.5 text-sm font-semibold text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy"
                          />
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            loading={isSavingCheckout}
                            data-testid={`save-checkout-btn-${entry.signupId}`}
                            onClick={() => handleSaveManualCheckout(entry)}
                          >
                            Save check-out
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingSignupId(null);
                              setCheckoutError(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>

                        {checkoutError && (
                          <p
                            role="alert"
                            className="text-xs font-semibold text-coral-600"
                          >
                            {checkoutError}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* Print Poster Layout — visible when toggled OR when printing */}
      <div
        data-testid="print-poster-view"
        className={[
          showPoster ? "block" : "hidden print:block",
          "rounded-2xl border-2 border-navy bg-white p-8 text-navy-900 shadow-card print:border-0 print:p-0 print:shadow-none",
        ].join(" ")}
      >
        <div className="mx-auto max-w-xl text-center space-y-6">
          <div className="flex items-center justify-between gap-3 border-b border-navy-100 pb-4 print:hidden">
            <span className="text-xs font-semibold tracking-wide text-navy-500 uppercase">
              Print-ready check-in poster preview
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="poster-print-now-btn"
                onClick={() => window.print()}
              >
                Print now
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="poster-close-btn"
                onClick={() => setShowPoster(false)}
              >
                Close poster
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold tracking-widest text-navy-500 uppercase">
              Volunteer Check-In &amp; Check-Out
            </p>
            <h2
              data-testid="poster-event-title"
              className="font-display text-3xl font-bold text-navy-900 sm:text-4xl"
            >
              {event.title}
            </h2>
            <p className="text-base font-medium text-navy-600">
              {eventDayWithYear(event.starts_at, event.timezone)}
              {event.location ? ` · ${event.location}` : ""}
            </p>
          </div>

          <div className="mx-auto inline-block rounded-3xl border-4 border-navy bg-white p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt={`Printable check-in QR code for ${event.title}`}
              width={320}
              height={320}
              className="h-72 w-72 object-contain sm:h-80 sm:w-80"
            />
          </div>

          <div
            data-testid="poster-instructions"
            className="mx-auto max-w-md rounded-2xl border-2 border-navy-100 bg-cream-100 p-5 text-left space-y-3"
          >
            <p className="font-display text-base font-bold text-navy-900">
              How to check in and log your hours:
            </p>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm text-navy-800">
              <li>
                Open your phone camera and point it at the QR code above.
              </li>
              <li>
                Log in to your ShiftShare account if prompted (you can check in
                from <strong>30 minutes before</strong> to{" "}
                <strong>30 minutes after</strong> your shift starts).
              </li>
              <li>
                <strong>Scan again when your shift ends</strong> to check out
                and automatically verify your volunteer hours.
              </li>
            </ol>
          </div>
        </div>
      </div>

      {/* Full Screen Projection Modal */}
      {showFullScreen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Full screen check-in QR code for ${event.title}`}
          data-testid="fullscreen-qr-modal"
          className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-navy-900 p-6 text-cream-100 sm:p-10 print:hidden"
        >
          <div className="flex w-full max-w-5xl items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent font-display text-base font-bold text-navy-900">
                S
              </span>
              <div>
                <p className="text-xs font-semibold tracking-wider text-cream-300 uppercase">
                  Volunteer Check-In Projection
                </p>
                <p className="font-display text-lg font-bold text-white">
                  {event.title}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={isRefreshingQr}
                onClick={handleRefreshQr}
              >
                Refresh QR
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                data-testid="exit-fullscreen-qr-btn"
                onClick={() => setShowFullScreen(false)}
              >
                Exit full screen
              </Button>
            </div>
          </div>

          <div className="my-auto flex flex-col items-center text-center space-y-6">
            <div className="space-y-2">
              <h2 className="font-display text-3xl font-bold text-white sm:text-5xl">
                Scan to check in or check out
              </h2>
              <p className="text-base text-cream-200 sm:text-lg">
                Point your phone camera at the QR code below when you arrive and
                when you finish your shift.
              </p>
            </div>

            <div className="rounded-3xl border-4 border-accent bg-white p-6 shadow-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt={`Full screen check-in QR code for ${event.title}`}
                data-testid="fullscreen-qr-image"
                width={384}
                height={384}
                className="h-72 w-72 object-contain sm:h-96 sm:w-96"
              />
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-mint px-4 py-1.5 text-sm font-bold text-navy-900">
                <span className="h-2.5 w-2.5 rounded-full bg-navy-900 animate-ping" />
                {counts.checkedIn} currently checked in
              </span>
              <span className="rounded-full bg-navy-800 px-4 py-1.5 text-sm font-semibold text-cream-200">
                {counts.checkedOut} checked out
              </span>
            </div>
          </div>

          <p className="text-xs text-cream-300">
            Check-in window: 30 minutes before to 30 minutes after your shift
            start time.
          </p>
        </div>
      )}
    </section>
  );
}
