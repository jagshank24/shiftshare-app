import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Logo } from "@/components/site/Logo";
import { AuthNotConfigured } from "@/components/auth/AuthNotConfigured";
import { createClient } from "@/lib/supabase/server";
import { createDemoSupabaseClient } from "@/lib/demo/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { eventDayWithYear } from "@/lib/events/format";
import { formatHoursToTwoDecimals } from "@/lib/checkin/hours";
import { resolveCertificateByVerificationCode } from "@/lib/volunteer/verification";

export const metadata: Metadata = {
  title: "Verify Volunteer Hours",
  description:
    "Publicly verify a volunteer's hours certificate issued by ShiftShare.",
};

export const dynamic = "force-dynamic";

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawParam } = await params;
  const decodedCode = decodeURIComponent(rawParam ?? "").trim();

  const supabase = await createClient();
  let result = await resolveCertificateByVerificationCode(
    supabase,
    decodedCode,
  );
  if (!result.valid) {
    result = await resolveCertificateByVerificationCode(
      createDemoSupabaseClient(null),
      decodedCode,
    );
  }

  if (!result.valid && !isSupabaseConfigured && !decodedCode.toUpperCase().startsWith("SS-")) {
    return (
      <VerifyShell>
        <Card padding="lg" className="mx-auto max-w-2xl">
          <AuthNotConfigured />
        </Card>
      </VerifyShell>
    );
  }

  if (!result.valid) {
    return (
      <VerifyShell>
        <Card
          padding="lg"
          data-testid="verify-invalid-code"
          className="mx-auto max-w-lg text-center space-y-5 border-2 border-coral"
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
              <path d="m15 9-6 6M9 9l6 6" />
            </svg>
          </div>

          <CardHeader className="mb-0 items-center text-center">
            <Badge tone="coral" data-testid="invalid-code-badge">
              Invalid code
            </Badge>
            <CardTitle as="h1" className="mt-2 text-2xl sm:text-3xl">
              Invalid verification code
            </CardTitle>
            <CardDescription className="mt-2 text-base">
              We couldn&apos;t find a verified ShiftShare certificate matching{" "}
              <code className="rounded bg-cream-300 px-1.5 py-0.5 font-mono text-navy-900">
                {decodedCode || "—"}
              </code>
              . Double-check the code printed at the bottom of the certificate.
            </CardDescription>
          </CardHeader>

          <div className="flex justify-center pt-2">
            <Link
              href="/"
              className={buttonClasses({ variant: "secondary", size: "md" })}
            >
              Back to ShiftShare home
            </Link>
          </div>
        </Card>
      </VerifyShell>
    );
  }

  const events = result.events ?? [];
  const totalHoursStr = formatHoursToTwoDecimals(result.total_hours);

  return (
    <VerifyShell>
      <div
        data-testid="verify-valid-certificate"
        className="mx-auto max-w-3xl space-y-6"
      >
        <Card padding="lg" className="space-y-6 border-2 border-navy">
          {/* Verified Status Header */}
          <div className="flex flex-col gap-4 border-b border-navy-100 pb-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div
                data-testid="verified-by-shiftshare-badge"
                className="inline-flex items-center gap-2 rounded-full border-2 border-mint-700 bg-mint-100 px-3.5 py-1.5 text-xs font-bold tracking-wide text-mint-800 uppercase"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 text-mint-700"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Verified by ShiftShare
              </div>

              <h1
                data-testid="verified-volunteer-name"
                className="font-display text-3xl font-bold text-navy-900 sm:text-4xl"
              >
                {result.volunteer_name}
              </h1>
              <p className="text-sm text-navy-600">
                Official volunteer service record verified directly from
                server-timestamped check-in and check-out logs.
              </p>
            </div>

            <div className="shrink-0 rounded-2xl border-2 border-navy bg-accent-50 px-5 py-4 text-center">
              <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
                Total verified hours
              </p>
              <p
                data-testid="verified-total-hours"
                className="mt-1 font-display text-3xl font-bold text-navy-900"
              >
                {totalHoursStr} hrs
              </p>
              <p className="text-xs text-navy-600">
                {events.length} verified{" "}
                {events.length === 1 ? "shift" : "shifts"}
              </p>
            </div>
          </div>

          {/* Verified Events Table */}
          <div className="space-y-3">
            <h2 className="font-display text-lg font-bold text-navy-900">
              Verified event history
            </h2>

            {events.length === 0 ? (
              <div className="rounded-xl border border-navy-100 bg-cream-100 p-5 text-center text-sm text-navy-600">
                No completed shifts recorded on this certificate yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-navy-100">
                <table
                  data-testid="verified-events-table"
                  className="w-full border-collapse text-left text-sm"
                >
                  <thead>
                    <tr className="border-b border-navy-100 bg-navy-900 text-xs font-semibold tracking-wide text-cream-100 uppercase">
                      <th className="px-4 py-3">Event</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Organizer</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3 text-right">Hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100 bg-white">
                    {events.map((ev, index) => (
                      <tr
                        key={`${ev.event_id}-${index}`}
                        data-testid={`verified-event-row-${index}`}
                      >
                        <td className="px-4 py-3 font-semibold text-navy-900">
                          {ev.event_title}
                        </td>
                        <td className="px-4 py-3 text-navy-600">
                          {eventDayWithYear(ev.event_date, ev.timezone)}
                        </td>
                        <td className="px-4 py-3 text-navy-700">
                          {ev.organizer_name}
                        </td>
                        <td className="px-4 py-3 text-navy-800">
                          {ev.role_name}
                        </td>
                        <td className="px-4 py-3 text-right font-display font-bold text-navy-900">
                          {formatHoursToTwoDecimals(ev.hours)} hrs
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Footer metadata + PDF download */}
          <div className="flex flex-col gap-3 border-t border-navy-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-navy-600 space-y-0.5">
              <p>
                Verification code:{" "}
                <code
                  data-testid="verified-code"
                  className="rounded bg-cream-200 px-1.5 py-0.5 font-mono font-bold text-navy-900"
                >
                  {result.code}
                </code>
              </p>
              <p>
                Colleges, schools, and employers can bookmark this URL to
                confirm authenticity at any time.
              </p>
            </div>

            <a
              href={`/api/certificate?code=${encodeURIComponent(result.code)}`}
              data-testid="verify-download-pdf-btn"
              className={buttonClasses({ variant: "primary", size: "sm" })}
            >
              Download Certificate PDF
            </a>
          </div>
        </Card>
      </div>
    </VerifyShell>
  );
}

function VerifyShell({ children }: { children: React.ReactNode }) {
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
          <span className="text-xs font-semibold tracking-wide text-navy-500 uppercase">
            Public Certificate Verification
          </span>
        </div>
      </header>

      <main className="container-page py-10 sm:py-14">{children}</main>
    </div>
  );
}
