import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { Logo } from "@/components/site/Logo";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { CopyLinkButton } from "@/components/signup/CopyLinkButton";
import {
  ShiftActionControl,
  type ShiftAction,
} from "@/components/signup/ShiftActionControl";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  eventDayWithYear,
  eventTimeRange,
  eventZoneLabel,
  eventZoneLong,
  isPast,
  minutesBetween,
  safeZone,
} from "@/lib/events/format";
import { findConflict, toSpan, type BookedShift } from "@/lib/events/overlap";
import { formatDuration } from "@/lib/planner/time";
import type { SignupStatus } from "@/lib/supabase/database.types";

/**
 * The public event page.
 *
 * Anyone can open this — it's the link an organizer sends to volunteers, and
 * asking people to make an account before they can even see what the event is
 * would lose most of them. Signing up is what requires a session; a signed-out
 * visitor who taps a button is sent to log in and straight back here.
 *
 * The URL segment is the event's slug (`/events/bay-trail-5k`) because that's
 * what gets shared, but a raw id works too, which keeps the route useful from
 * the dashboard.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EventRecord = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  slug: string;
  published: boolean;
  timezone: string;
  organizer_id: string;
  organizer: { full_name: string | null } | null;
};

type ShiftRecord = {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
};

type RoleRecord = {
  id: string;
  name: string;
  description: string | null;
  position: number;
  shifts: ShiftRecord[];
};

type MySignupRow = {
  shift_id: string;
  status: SignupStatus;
  shift: {
    starts_at: string;
    ends_at: string;
    role: { name: string; event: { id: string; title: string; timezone: string } | null } | null;
  } | null;
};

/**
 * Wrapped in `cache` so `generateMetadata` and the page share one query —
 * and so the metadata still describes the event the visitor actually opened.
 */
const loadEvent = cache(async (id: string): Promise<EventRecord | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select(
      "id, title, description, location, starts_at, ends_at, slug, published, timezone, organizer_id, organizer:profiles(full_name)",
    )
    .eq(UUID.test(id) ? "id" : "slug", id)
    .maybeSingle();

  return (data as unknown as EventRecord | null) ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const event = await loadEvent(id);

  if (!event) return { title: "Event not found" };

  const when = eventDayWithYear(event.starts_at, event.timezone);
  const where = event.location ? ` at ${event.location}` : "";

  return {
    title: `${event.title} — ${when}`,
    description: `Volunteer shifts for ${event.title}${where}. ${when}.`,
  };
}

/** Why a shift has no button, when it has none. */
type NoAction = "draft" | "finished";

/** Decides what the one button on a shift should be — or that there is none. */
function actionFor({
  signedIn,
  published,
  finished,
  status,
  spotsLeft,
  conflict,
}: {
  signedIn: boolean;
  published: boolean;
  finished: boolean;
  status: SignupStatus | null;
  spotsLeft: number;
  conflict: BookedShift | null;
}): { action: ShiftAction | null; note: NoAction | null } {
  // A draft isn't taking signups from anyone, including its organizer.
  if (!published) return { action: null, note: "draft" };
  if (finished) return { action: null, note: "finished" };

  // Already going? Cancelling is always available, whatever else is true.
  if (status === "confirmed" || status === "pending") {
    return { action: { kind: "cancel" }, note: null };
  }
  if (status === "waitlist") {
    return { action: { kind: "leave_standby" }, note: null };
  }

  if (!signedIn) {
    return {
      action: {
        kind: "login",
        label: spotsLeft > 0 ? "Log in to sign up" : "Log in to join standby",
      },
      note: null,
    };
  }

  // Blocked before the tap, because the database would block it after the tap.
  if (conflict) {
    return {
      action: {
        kind: "blocked",
        reason: `This runs at the same time as ${conflict.label}. Cancel that one first if you'd rather do this.`,
      },
      note: null,
    };
  }

  if (spotsLeft <= 0) return { action: { kind: "standby" }, note: null };
  return { action: { kind: "signup" }, note: null };
}

export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const event = await loadEvent(id);
  if (!event) {
    if (!isSupabaseConfigured) {
      return (
        <div className="min-h-dvh bg-cream-200">
          <SiteHeader />
          <main id="main-content" className="container-page max-w-2xl py-10">
            <Card padding="lg">
              <CardTitle as="h1">This event can&apos;t load yet</CardTitle>
              <CardDescription className="mt-2">
                The database isn&apos;t connected, so there&apos;s nothing to show.
                Add your Supabase URL and anon key to{" "}
                <code className="rounded bg-cream-300 px-1.5 py-0.5 text-navy-800">
                  .env.local
                </code>{" "}
                and restart the server, or open{" "}
                <Link href="/events/fall-carnival" className="font-semibold underline">
                  /events/fall-carnival
                </Link>{" "}
                to preview the demo event.
              </CardDescription>
            </Card>
          </main>
        </div>
      );
    }
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isOrganizer = Boolean(user && user.id === event.organizer_id);

  // Roles in the order they were planned, each with its shifts in time order.
  const { data: rawRoles } = await supabase
    .from("roles")
    .select("id, name, description, position, shifts(id, starts_at, ends_at, capacity)")
    .eq("event_id", event.id)
    .order("position", { ascending: true });

  const roles = ((rawRoles ?? []) as unknown as RoleRecord[])
    .map((role) => ({
      ...role,
      shifts: [...(role.shifts ?? [])].sort(
        (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      ),
    }))
    .filter((role) => role.shifts.length > 0);

  // Spot counts come from a function, because a volunteer can't read other
  // people's signups — and shouldn't be able to.
  const { data: rawCounts } = await supabase.rpc("shift_signup_counts", {
    p_event_id: event.id,
  });
  const counts = new Map(
    (rawCounts ?? []).map((row) => [
      row.shift_id,
      { taken: row.taken, standingBy: row.standing_by },
    ]),
  );

  // Everything this volunteer is already committed to — including shifts at
  // other events, since nobody can be in two places at once.
  const myByShiftId = new Map<string, SignupStatus>();
  const booked: BookedShift[] = [];

  if (user) {
    const { data: rawMine } = await supabase
      .from("signups")
      .select(
        "shift_id, status, shift:shifts(starts_at, ends_at, role:roles(name, event:events(id, title, timezone)))",
      )
      .eq("volunteer_id", user.id)
      .neq("status", "cancelled");

    for (const row of (rawMine ?? []) as unknown as MySignupRow[]) {
      myByShiftId.set(row.shift_id, row.status);

      // A standby place is not a commitment, so it doesn't block anything —
      // the database agrees, and only overlaps with confirmed places.
      if (row.status === "waitlist") continue;

      const shift = row.shift;
      const span = shift ? toSpan(shift.starts_at, shift.ends_at) : null;
      if (!span || !shift) continue;

      const roleName = shift.role?.name ?? "A shift";
      const otherEvent = shift.role?.event;

      // Name the event only when it isn't this one — "Check-in table at the
      // food drive" on the food drive's own page is noise.
      const elsewhere = otherEvent && otherEvent.id !== event.id;
      const when = eventTimeRange(
        shift.starts_at,
        shift.ends_at,
        otherEvent?.timezone ?? event.timezone,
      );

      booked.push({
        shiftId: row.shift_id,
        label: elsewhere
          ? `${roleName} at ${otherEvent.title} (${when})`
          : `${roleName} (${when})`,
        ...span,
      });
    }
  }

  const zone = safeZone(event.timezone);
  const eventZone = eventZoneLabel(event.starts_at, zone);
  const eventRange = event.ends_at
    ? eventTimeRange(event.starts_at, event.ends_at, zone)
    : eventZoneLabel(event.starts_at, zone);

  const totalSpots = roles.reduce(
    (sum, role) => sum + role.shifts.reduce((inner, shift) => inner + shift.capacity, 0),
    0,
  );
  const totalTaken = roles.reduce(
    (sum, role) =>
      sum + role.shifts.reduce((inner, shift) => inner + (counts.get(shift.id)?.taken ?? 0), 0),
    0,
  );
  const spotsLeftOverall = Math.max(0, totalSpots - totalTaken);
  const myShiftCount = roles.reduce(
    (sum, role) =>
      sum + role.shifts.filter((shift) => myByShiftId.has(shift.id)).length,
    0,
  );
  const finished = isPast(event.ends_at ?? event.starts_at);

  return (
    <div className="min-h-dvh bg-cream-200">
      <SiteHeader signedIn={Boolean(user)} email={user?.email ?? null} />

      <main className="container-page max-w-3xl space-y-6 pb-16 pt-6">
        {!event.published && (
          <div className="rounded-2xl border-2 border-accent-300 bg-accent-50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent" variant="solid" size="sm">
                Draft
              </Badge>
              <span className="font-display text-sm font-semibold text-navy-900">
                Only you can see this
              </span>
            </div>
            <p className="mt-1.5 text-sm text-navy-700">
              Publish the event before sending the link — until then it isn&apos;t
              taking signups and visitors get a &ldquo;not found&rdquo; page.
            </p>
          </div>
        )}

        {/* Event details */}
        <Card padding="lg">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="navy" variant="soft" size="sm" dot>
              {eventDayWithYear(event.starts_at, zone)}
            </Badge>
            {finished && (
              <Badge tone="neutral" variant="soft" size="sm">
                Finished
              </Badge>
            )}
          </div>

          <CardTitle as="h1" className="mt-3">
            {event.title}
          </CardTitle>

          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-semibold text-navy-900">When</dt>
              <dd className="text-navy-700">
                {eventRange}
                {eventZone ? ` ${eventZone}` : ""}
                {event.ends_at && (
                  <span className="text-navy-600">
                    {" "}
                    · {formatDuration(minutesBetween(event.starts_at, event.ends_at))}
                  </span>
                )}
              </dd>
            </div>

            {event.location && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-semibold text-navy-900">Where</dt>
                <dd className="text-navy-700">{event.location}</dd>
              </div>
            )}

            {event.organizer?.full_name && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-semibold text-navy-900">Hosted by</dt>
                <dd className="text-navy-700">{event.organizer.full_name}</dd>
              </div>
            )}
          </dl>

          {event.description && (
            <p className="mt-4 whitespace-pre-line text-sm text-navy-700">
              {event.description}
            </p>
          )}

          <div className="mt-5 rounded-2xl bg-cream-100 p-3.5">
            <p className="font-display text-sm font-semibold text-navy-900">
              {totalSpots === 0
                ? "Shifts haven't been added yet."
                : spotsLeftOverall > 0
                  ? `${spotsLeftOverall} of ${totalSpots} spots still open across ${roles.length} role${roles.length === 1 ? "" : "s"}`
                  : `All ${totalSpots} spots are filled — you can still join standby`}
            </p>
            {myShiftCount > 0 && (
              <p className="mt-1 text-sm font-medium text-mint-700">
                You&apos;re signed up for {myShiftCount} shift
                {myShiftCount === 1 ? "" : "s"} at this event.
              </p>
            )}
          </div>

          {isOrganizer && event.published && (
            <div className="mt-3">
              <CopyLinkButton slug={event.slug} />
            </div>
          )}
        </Card>

        {/* Shifts, grouped by role */}
        {roles.length === 0 ? (
          <Card padding="lg">
            <CardTitle as="h2">No shifts yet</CardTitle>
            <CardDescription className="mt-2">
              This event doesn&apos;t have any shifts to sign up for yet.
            </CardDescription>
          </Card>
        ) : (
          <div className="space-y-6">
            <h2 className="font-display text-xl font-semibold text-navy-900">
              Shifts ({totalSpots - spotsLeftOverall}/{totalSpots} filled)
            </h2>

            {roles.map((role) => (
              <Card key={role.id} padding="lg">
                <CardTitle as="h3">{role.name}</CardTitle>
                {role.description && (
                  <CardDescription className="mt-1.5">{role.description}</CardDescription>
                )}

                <ul className="mt-4 space-y-3">
                  {role.shifts.map((shift) => {
                    const count = counts.get(shift.id);
                    const taken = count?.taken ?? 0;
                    const standingBy = count?.standingBy ?? 0;
                    const spotsLeft = Math.max(0, shift.capacity - taken);
                    const status = myByShiftId.get(shift.id) ?? null;
                    const shiftFinished = isPast(shift.ends_at);
                    const conflict =
                      user && !status
                        ? findConflict(toSpan(shift.starts_at, shift.ends_at), booked)
                        : null;

                    const { action, note } = actionFor({
                      signedIn: Boolean(user),
                      published: event.published,
                      finished: shiftFinished,
                      status,
                      spotsLeft,
                      conflict,
                    });

                    const filled = spotsLeft <= 0;
                    const filledRatio = Math.min(1, taken / Math.max(1, shift.capacity));

                    return (
                      <li
                        key={shift.id}
                        className="rounded-2xl border border-navy-100 bg-cream-100 p-3.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-display text-base font-semibold text-navy-900">
                              {eventTimeRange(shift.starts_at, shift.ends_at, zone)}
                            </p>

                            <p className="mt-0.5 text-sm text-navy-600">
                              {formatDuration(minutesBetween(shift.starts_at, shift.ends_at))}
                              {" · "}
                              {filled
                                ? `all ${shift.capacity} spots taken`
                                : spotsLeft === 1
                                  ? "1 spot left"
                                  : `${spotsLeft} of ${shift.capacity} spots left`}
                              {standingBy > 0 &&
                                ` · ${standingBy} on standby`}
                            </p>

                            <div className="mt-2 flex flex-wrap gap-2">
                              {filled && (
                                <Badge tone="coral" variant="solid" size="sm">
                                  Filled
                                </Badge>
                              )}
                              {(status === "confirmed" || status === "pending") && (
                                <Badge tone="mint" variant="solid" size="sm" dot>
                                  You&apos;re signed up
                                </Badge>
                              )}
                              {status === "waitlist" && (
                                <Badge tone="accent" variant="solid" size="sm" dot>
                                  On standby
                                </Badge>
                              )}
                              {note === "finished" && (
                                <Badge tone="neutral" variant="soft" size="sm">
                                  Finished
                                </Badge>
                              )}
                              {note === "draft" && (
                                <Badge tone="neutral" variant="soft" size="sm">
                                  Not open yet
                                </Badge>
                              )}
                            </div>
                          </div>

                          {action ? (
                            <ShiftActionControl
                              shiftId={shift.id}
                              slug={event.slug}
                              action={action}
                            />
                          ) : (
                            <p className="w-full text-sm text-navy-600 sm:w-auto sm:text-right">
                              {note === "finished"
                                ? "This shift has already finished."
                                : "Signups open when the organizer publishes."}
                            </p>
                          )}
                        </div>

                        {/* Progress meter — decorative; the line above carries the numbers. */}
                        <div
                          aria-hidden="true"
                          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-cream-300"
                        >
                          <div
                            className={
                              filled
                                ? "h-full rounded-full bg-coral-500"
                                : "h-full rounded-full bg-mint-500"
                            }
                            style={{ width: `${filledRatio * 100}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-navy-500">
          {/* An event's times belong to the event, not to whoever is reading. */}
          Times are shown in {eventZoneLong(event.starts_at, zone)}
          {eventZone ? ` (${eventZone})` : ""}.
        </p>
      </main>
    </div>
  );
}

/** Header shared by the states this page can render in. */
function SiteHeader({
  signedIn = false,
  email = null,
}: {
  signedIn?: boolean;
  email?: string | null;
}) {
  return (
    <header className="border-b border-navy-100 bg-cream-200/95 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex min-h-tap items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
        >
          <Logo />
          <span className="sr-only">ShiftShare home</span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          {signedIn ? (
            <>
              <Link
                href="/dashboard"
                className="hidden min-h-tap items-center rounded-full px-3.5 text-sm font-medium text-navy-700 hover:bg-navy-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream sm:inline-flex"
              >
                Dashboard
              </Link>
              <span className="hidden text-sm text-navy-600 lg:inline">
                {email}
              </span>
              <SignOutButton />
            </>
          ) : (
            <Link
              href="/login"
              className="inline-flex min-h-tap items-center rounded-full px-4 text-sm font-semibold text-navy-900 underline decoration-2 underline-offset-4 hover:bg-navy-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
            >
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
