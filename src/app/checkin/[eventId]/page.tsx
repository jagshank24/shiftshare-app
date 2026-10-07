import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/site/Logo";
import { AuthNotConfigured } from "@/components/auth/AuthNotConfigured";
import { VolunteerCheckinView } from "@/components/checkin/VolunteerCheckinView";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { buildCheckinPath } from "@/lib/checkin/qr";
import {
  processVolunteerCheckinScan,
  validateEventCheckinToken,
} from "@/lib/checkin/service";

export const metadata: Metadata = {
  title: "Volunteer Check-In",
  description: "Scan the event QR code to check in or check out of your shift.",
};

export const dynamic = "force-dynamic";

export default async function CheckinPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { eventId } = await params;
  const { token } = await searchParams;
  const safeToken = typeof token === "string" ? token.trim() : "";

  const supabase = await createClient();

  // 1. Validate the token first. Show a clear error if it's invalid or expired.
  const validation = await validateEventCheckinToken(
    supabase,
    eventId,
    safeToken,
  );

  if (!validation.valid && !isSupabaseConfigured && validation.code === "not_found") {
    return (
      <CheckinShell>
        <Card padding="lg" className="mx-auto max-w-lg">
          <AuthNotConfigured />
        </Card>
      </CheckinShell>
    );
  }

  if (!validation.valid) {
    return (
      <CheckinShell>
        <VolunteerCheckinView
          eventId={eventId}
          token={safeToken}
          initialResult={{
            code: validation.code === "not_found" ? "not_found" : "invalid_token",
            event_id: validation.event_id,
            event_title: validation.event_title,
            event_slug: validation.event_slug,
            timezone: validation.timezone,
          }}
        />
      </CheckinShell>
    );
  }

  // 2. If the volunteer is logged out, send them to login, then back to complete the check-in.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const returnPath = buildCheckinPath(eventId, safeToken);
    redirect(`/login?next=${encodeURIComponent(returnPath)}`);
  }

  // 3. Process the volunteer's check-in or check-out scan on the server.
  const result = await processVolunteerCheckinScan(
    supabase,
    user.id,
    eventId,
    safeToken,
  );

  return (
    <CheckinShell>
      <VolunteerCheckinView
        eventId={eventId}
        token={safeToken}
        initialResult={result}
      />
    </CheckinShell>
  );
}

function CheckinShell({ children }: { children: React.ReactNode }) {
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
          <Link
            href="/dashboard"
            className="inline-flex min-h-tap items-center rounded-lg px-3 text-sm font-semibold text-navy-800 hover:text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy"
          >
            Dashboard
          </Link>
        </div>
      </header>

      <main className="container-page py-10 sm:py-14">{children}</main>
    </div>
  );
}
