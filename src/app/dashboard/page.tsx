import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/site/Logo";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { RolePrompt } from "@/components/dashboard/RolePrompt";
import { AuthNotConfigured } from "@/components/auth/AuthNotConfigured";
import { OrganizerAnalyticsDashboard } from "@/components/dashboard/OrganizerAnalyticsDashboard";
import { VolunteerDashboard } from "@/components/dashboard/VolunteerDashboard";
import type { OrganizerEventCheckinBundle } from "@/components/checkin/OrganizerCheckinDashboard";
import { createClient, getActiveDemoRole } from "@/lib/supabase/server";
import { isSupabaseConfigured, siteUrl } from "@/lib/supabase/env";
import { demoLoginAction } from "@/app/(auth)/actions";
import {
  buildCheckinPath,
  buildCheckinUrl,
  generateCheckinToken,
  generateQrCodeDataUrl,
} from "@/lib/checkin/qr";
import { loadOrganizerEventRoster } from "@/lib/checkin/service";
import {
  buildOrganizerEventAnalytics,
  type OrganizerEventAnalytics,
} from "@/lib/analytics/organizer";
import {
  buildVolunteerDashboardStats,
  type RawVolunteerSignupInput,
} from "@/lib/volunteer/stats";
import {
  buildVerifyPath,
  buildVerifyUrl,
  deriveDefaultVerificationCode,
} from "@/lib/volunteer/verification";
import { normalizeEventRecap, type EventRecap } from "@/lib/ai";
import type {
  Checkin,
  EventRow,
  Profile,
  RoleRow,
  Shift,
  Signup,
} from "@/lib/supabase/database.types";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your ShiftShare events, shifts, analytics, and verified hours.",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ published?: string; event?: string }>;
}) {
  const { published, event: selectedEventParam } = await searchParams;
  const demoRole = await getActiveDemoRole();

  if (!isSupabaseConfigured && !demoRole) {
    return (
      <DashboardShell email={null}>
        <Card padding="lg">
          <AuthNotConfigured />
        </Card>
      </DashboardShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard");
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, verification_code")
    .eq("id", user.id)
    .maybeSingle();

  const profile = profileData as Profile | null;

  const displayName =
    profile?.full_name ??
    (user.user_metadata?.full_name as string | undefined) ??
    user.email ??
    "there";

  if (!profile?.role) {
    return (
      <DashboardShell email={user.email}>
        <Card padding="lg">
          <RolePrompt name={profile?.full_name ?? null} />
        </Card>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      email={user.email}
      role={profile.role}
      name={profile.full_name}
      displayName={displayName}
      isDemo={Boolean(demoRole)}
    >
      {published && (
        <Card
          padding="lg"
          variant="outline"
          className="border-mint-200 bg-mint-50 print:hidden"
        >
          <p role="status" className="font-display font-bold text-navy-900">
            Event published
          </p>
          <p className="mt-1 text-sm text-navy-700">
            Your signup link is live at{" "}
            <Link
              href={`/events/${published}`}
              className="rounded bg-cream-300 px-1.5 py-0.5 font-mono text-navy-900 underline underline-offset-2"
            >
              /events/{published}
            </Link>{" "}
            — share it with your volunteers.
          </p>
        </Card>
      )}

      {profile.role === "organizer" ? (
        <OrganizerPanels
          userId={user.id}
          selectedSlugOrId={selectedEventParam ?? published}
        />
      ) : (
        <VolunteerPanels userId={user.id} profile={profile} />
      )}
    </DashboardShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

function DashboardShell({
  children,
  email,
  role,
  name,
  displayName,
  isDemo,
}: {
  children: React.ReactNode;
  email?: string | null;
  role?: string | null;
  name?: string | null;
  displayName?: string;
  isDemo?: boolean;
}) {
  return (
    <div className="min-h-dvh bg-cream-200 print:bg-white">
      <header className="border-b border-navy-100 bg-cream-200/95 backdrop-blur print:hidden">
        <div className="container-page flex min-h-16 flex-wrap items-center justify-between gap-2 py-2 sm:gap-4">
          <Link
            href="/"
            className="inline-flex min-h-tap items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            <Logo />
            <span className="sr-only">ShiftShare home</span>
          </Link>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {isDemo && role && (
              <form action={demoLoginAction}>
                <input
                  type="hidden"
                  name="role"
                  value={role === "organizer" ? "volunteer" : "organizer"}
                />
                <input type="hidden" name="next" value="/dashboard" />
                <button
                  type="submit"
                  data-testid="switch-demo-role-btn"
                  className="inline-flex min-h-tap items-center rounded-xl border-2 border-navy-200 bg-white px-2.5 py-1.5 text-xs font-bold text-navy-900 transition-colors hover:bg-cream-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy"
                >
                  Switch to {role === "organizer" ? "Volunteer" : "Organizer"} Demo
                </button>
              </form>
            )}
            {role && (
              <Badge
                tone={role === "organizer" ? "accent" : "mint"}
                variant="soft"
              >
                {role === "organizer" ? "Organizer" : "Volunteer"}
              </Badge>
            )}
            <SignOutButton />
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="container-page space-y-6 py-8 sm:py-10 print:py-0"
      >
        <div className="print:hidden">
          <h1 className="text-display-sm text-navy-900">
            {displayName
              ? `Hello, ${displayName.split(" ")[0]}`
              : "Your dashboard"}
          </h1>
          <p className="mt-1.5 text-navy-600">
            {email ? (
              <>
                Signed in as{" "}
                <span className="font-medium text-navy-900">{email}</span>
                {name ? ` · ${name}` : ""}
              </>
            ) : (
              "Your ShiftShare dashboard."
            )}
          </p>
        </div>

        {children}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Organizer                                                                  */
/* -------------------------------------------------------------------------- */

async function OrganizerPanels({
  userId,
  selectedSlugOrId,
}: {
  userId: string;
  selectedSlugOrId?: string;
}) {
  const supabase = await createClient();

  const { data: rawEvents } = await supabase
    .from("events")
    .select("*")
    .eq("organizer_id", userId)
    .order("starts_at", { ascending: false });

  const events = (rawEvents ?? []) as EventRow[];
  const eventIds = events.map((e) => e.id);

  const { data: rawRoles } =
    eventIds.length > 0
      ? await supabase
          .from("roles")
          .select("*")
          .in("event_id", eventIds)
          .order("position", { ascending: true })
      : { data: [] as RoleRow[] };

  const roles = (rawRoles ?? []) as RoleRow[];
  const roleIds = roles.map((r) => r.id);

  const { data: rawShifts } =
    roleIds.length > 0
      ? await supabase
          .from("shifts")
          .select("*")
          .in("role_id", roleIds)
          .order("starts_at", { ascending: true })
      : { data: [] as Shift[] };

  const shifts = (rawShifts ?? []) as Shift[];
  const shiftIds = shifts.map((s) => s.id);

  const { data: rawSignups } =
    shiftIds.length > 0
      ? await supabase
          .from("signups")
          .select("*")
          .in("shift_id", shiftIds)
      : { data: [] as Signup[] };

  const signups = (rawSignups ?? []) as Signup[];
  const volunteerIds = Array.from(
    new Set(signups.map((sg) => sg.volunteer_id)),
  );
  const signupIds = signups.map((sg) => sg.id);

  const [{ data: rawProfiles }, { data: rawCheckins }] = await Promise.all([
    volunteerIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", volunteerIds)
      : Promise.resolve({ data: [] as Profile[] }),
    signupIds.length > 0
      ? supabase
          .from("checkins")
          .select("*")
          .in("signup_id", signupIds)
      : Promise.resolve({ data: [] as Checkin[] }),
  ]);

  const profiles = (rawProfiles ?? []) as Profile[];
  const checkins = (rawCheckins ?? []) as Checkin[];

  const analyticsList: OrganizerEventAnalytics[] = events.map((ev) =>
    buildOrganizerEventAnalytics({
      event: ev,
      roles,
      shifts,
      signups,
      profiles,
      checkins,
    }),
  );

  const initialRecapsByEvent: Record<string, EventRecap> = {};
  for (const analytics of analyticsList) {
    initialRecapsByEvent[analytics.eventId] = normalizeEventRecap(null, {
      eventTitle: analytics.eventTitle,
      totalCapacity: analytics.totalCapacity,
      confirmedSignups: analytics.confirmedSignups,
      fillRatePercent: analytics.fillRatePercent,
      checkedInCount: analytics.checkedInCount,
      noShowCount: analytics.noShowCount,
      noShowRatePercent: analytics.noShowRatePercent,
      totalVolunteerHours: analytics.totalVolunteerHours,
      roles: analytics.fillRatePerRole.map((r) => ({
        roleName: r.roleName,
        capacity: r.capacity,
        signedUp: r.signedUp,
        attended: r.attended,
        fillRatePercent: r.fillRatePercent,
      })),
    });
  }

  // Build QR check-in bundles + live "Who's here" rosters for each event
  const origin = siteUrl();
  const checkinBundles: OrganizerEventCheckinBundle[] = await Promise.all(
    events.map(async (ev) => {
      let token = ev.checkin_token;
      if (!token) {
        token = generateCheckinToken();
        await supabase
          .from("events")
          .update({ checkin_token: token })
          .eq("id", ev.id);
      }

      const checkinPath = buildCheckinPath(ev.id, token);
      const checkinUrl = buildCheckinUrl(ev.id, token, origin);
      const [qrDataUrl, roster] = await Promise.all([
        generateQrCodeDataUrl(checkinUrl, 512),
        loadOrganizerEventRoster(supabase, ev.id),
      ]);

      return {
        event: { ...ev, checkin_token: token },
        qrDataUrl,
        checkinPath,
        checkinUrl,
        roster,
      };
    }),
  );

  const matchedEvent = selectedSlugOrId
    ? events.find(
        (e) => e.id === selectedSlugOrId || e.slug === selectedSlugOrId,
      )
    : undefined;

  return (
    <OrganizerAnalyticsDashboard
      analyticsList={analyticsList}
      checkinBundles={checkinBundles}
      initialRecapsByEvent={initialRecapsByEvent}
      initialEventId={matchedEvent?.id ?? events[0]?.id}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Volunteer                                                                  */
/* -------------------------------------------------------------------------- */

async function VolunteerPanels({
  userId,
  profile,
}: {
  userId: string;
  profile: Profile;
}) {
  const supabase = await createClient();

  let verificationCode = profile.verification_code?.trim();
  if (!verificationCode) {
    verificationCode = deriveDefaultVerificationCode(userId);
  }

  const { data: rawSignups } = await supabase
    .from("signups")
    .select("*")
    .eq("volunteer_id", userId)
    .order("created_at", { ascending: false });

  const signups = (rawSignups ?? []) as Signup[];
  const shiftIds = Array.from(new Set(signups.map((sg) => sg.shift_id)));
  const signupIds = signups.map((sg) => sg.id);

  const [{ data: rawShifts }, { data: rawCheckins }] = await Promise.all([
    shiftIds.length > 0
      ? supabase.from("shifts").select("*").in("id", shiftIds)
      : Promise.resolve({ data: [] as Shift[] }),
    signupIds.length > 0
      ? supabase.from("checkins").select("*").in("signup_id", signupIds)
      : Promise.resolve({ data: [] as Checkin[] }),
  ]);

  const shifts = (rawShifts ?? []) as Shift[];
  const checkins = (rawCheckins ?? []) as Checkin[];
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  const roleIds = Array.from(new Set(shifts.map((s) => s.role_id)));
  const { data: rawRoles } =
    roleIds.length > 0
      ? await supabase.from("roles").select("*").in("id", roleIds)
      : { data: [] as RoleRow[] };

  const roles = (rawRoles ?? []) as RoleRow[];
  const roleById = new Map(roles.map((r) => [r.id, r]));

  const eventIds = Array.from(new Set(roles.map((r) => r.event_id)));
  const { data: rawEvents } =
    eventIds.length > 0
      ? await supabase.from("events").select("*").in("id", eventIds)
      : { data: [] as EventRow[] };

  const events = (rawEvents ?? []) as EventRow[];
  const eventById = new Map(events.map((e) => [e.id, e]));

  const organizerIds = Array.from(new Set(events.map((e) => e.organizer_id)));
  const { data: rawOrganizers } =
    organizerIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", organizerIds)
      : { data: [] as Profile[] };

  const organizers = (rawOrganizers ?? []) as Profile[];
  const organizerById = new Map(organizers.map((o) => [o.id, o]));

  const inBySignup = new Map<string, Checkin>();
  const outBySignup = new Map<string, Checkin>();

  for (const c of checkins) {
    if (c.kind === "in" && !inBySignup.has(c.signup_id)) {
      inBySignup.set(c.signup_id, c);
    } else if (c.kind === "out") {
      outBySignup.set(c.signup_id, c);
    }
  }

  const rawItems: RawVolunteerSignupInput[] = [];
  for (const sg of signups) {
    const shift = shiftById.get(sg.shift_id);
    const role = shift ? roleById.get(shift.role_id) : undefined;
    const event = role ? eventById.get(role.event_id) : undefined;
    if (!shift || !role || !event) continue;

    const org = organizerById.get(event.organizer_id);
    const inRow = inBySignup.get(sg.id);
    const outRow = outBySignup.get(sg.id);

    rawItems.push({
      signupId: sg.id,
      shiftId: shift.id,
      status: sg.status,
      startsAt: shift.starts_at,
      endsAt: shift.ends_at,
      roleName: role.name,
      eventId: event.id,
      eventTitle: event.title,
      eventSlug: event.slug,
      eventStartsAt: event.starts_at,
      location: event.location,
      timezone: event.timezone,
      organizerName:
        org?.full_name?.trim() ||
        org?.email?.split("@")[0] ||
        "Event Organizer",
      checkedInAt: inRow?.at ?? null,
      checkedOutAt: outRow?.at ?? null,
      verified: Boolean(inRow?.verified && (outRow ? outRow.verified : true)),
      adjustedByOrganizer: Boolean(
        outRow?.adjusted_by_organizer || outRow?.method === "organizer_adjusted",
      ),
    });
  }

  const initialStats = buildVolunteerDashboardStats(rawItems);
  const verifyPath = buildVerifyPath(verificationCode);
  const verifyUrl = buildVerifyUrl(verificationCode, siteUrl());
  const verifyQrDataUrl = await generateQrCodeDataUrl(verifyUrl, 240);

  const volunteerName =
    profile.full_name?.trim() ||
    profile.email?.split("@")[0] ||
    "Volunteer";

  return (
    <VolunteerDashboard
      volunteerName={volunteerName}
      verificationCode={verificationCode}
      verifyPath={verifyPath}
      verifyQrDataUrl={verifyQrDataUrl}
      initialStats={initialStats}
    />
  );
}
