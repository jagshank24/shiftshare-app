import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { Logo } from "@/components/site/Logo";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { AuthNotConfigured } from "@/components/auth/AuthNotConfigured";
import { PlanComposer } from "@/components/plan/PlanComposer";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isClaudeConfigured } from "@/lib/ai";
import { loadOrganizerPastEventsSummary } from "@/lib/planner/past-events";
import type { PastEventsSummary } from "@/lib/planner/types";

export const metadata: Metadata = {
  title: "New event",
  description:
    "Describe your event in one sentence and get a staffing plan you can edit and publish.",
};

/** Default the date picker to a week out — events are rarely planned same-day. */
function defaultDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

export default async function NewEventPage() {
  const configured = isSupabaseConfigured;

  let role: string | null = null;
  let email: string | null = null;
  let pastEventsSummary: PastEventsSummary | null = null;

  if (configured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // The proxy already redirects, but this page holds the real check.
    if (!user) redirect("/login?next=/events/new");

    email = user.email ?? null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    role = profile?.role ?? null;

    if (role !== "volunteer") {
      pastEventsSummary = await loadOrganizerPastEventsSummary(supabase, user.id);
    }
  }

  // Volunteers can look at the planner, but publishing is organizers' work.
  const isVolunteer = role === "volunteer";

  return (
    <div className="min-h-dvh bg-cream-200">
      <header className="border-b border-navy-100 bg-cream-200/95 backdrop-blur">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex min-h-tap items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            <Logo />
            <span className="sr-only">ShiftShare home</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="hidden min-h-tap items-center rounded-full px-3.5 text-sm font-medium text-navy-700 hover:bg-navy-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream sm:inline-flex"
            >
              Dashboard
            </Link>
            {!configured && (
              <Badge tone="coral" variant="soft" size="sm">
                Not connected
              </Badge>
            )}
            {configured && <SignOutButton />}
          </div>
        </div>
      </header>

      <main className="container-page space-y-8 py-8 sm:py-10">
        <div className="max-w-2xl">
          <h1 className="text-display-sm text-navy-900 sm:text-display">
            Plan a new event
          </h1>
          <p className="mt-3 text-lg text-navy-600">
            Type one sentence. You&apos;ll get roles, shifts and headcounts you
            can adjust before anyone sees them.
          </p>
          {email && (
            <p className="mt-2 text-sm text-navy-600">
              Signed in as <span className="font-medium text-navy-900">{email}</span>
            </p>
          )}
        </div>

        {!configured && (
          <Card padding="lg">
            <AuthNotConfigured />
            <CardDescription className="mt-4">
              You can still build and edit a plan below.
            </CardDescription>
          </Card>
        )}

        {!isClaudeConfigured() && (
          <Card padding="lg" variant="outline" className="border-accent-200 bg-accent-50">
            <CardTitle as="h2" className="text-base">
              Running without Claude
            </CardTitle>
            <CardDescription className="mt-1">
              No <code className="rounded bg-cream-300 px-1.5 py-0.5">ANTHROPIC_API_KEY</code>{" "}
              is set, so plans come from a built-in demo planner — a set of role
              templates, not a language model. Add the key to{" "}
              <code className="rounded bg-cream-300 px-1.5 py-0.5">.env.local</code>{" "}
              and restart the server to use the real thing.
            </CardDescription>
          </Card>
        )}

        {isVolunteer && (
          <Card padding="lg" variant="outline" className="border-coral-200 bg-coral-50">
            <CardTitle as="h2" className="text-base">
              Your account is set up as a volunteer
            </CardTitle>
            <CardDescription className="mt-1">
              You can build and edit a plan to see how it works, but publishing
              needs an organizer account.
            </CardDescription>
            <Link
              href="/dashboard"
              className={`${buttonClasses({ variant: "secondary", size: "sm" })} mt-3`}
            >
              Back to dashboard
            </Link>
          </Card>
        )}

        <PlanComposer
          defaultDate={defaultDate()}
          canPublish={configured && !isVolunteer}
          initialPastEventsSummary={pastEventsSummary}
          publishBlockedReason={
            !configured
              ? "Publishing needs a Supabase project. Until then you can shape the plan above and copy the details out."
              : isVolunteer
                ? "Switch your account to an organizer to publish."
                : undefined
          }
        />
      </main>
    </div>
  );
}
