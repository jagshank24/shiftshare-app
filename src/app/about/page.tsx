import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";

export const metadata: Metadata = {
  title: "About ShiftShare",
  description:
    "Why we built ShiftShare: the problem with community volunteer scheduling, our QR-verified solution, and the tech stack behind it.",
};

export const ABOUT_SECTIONS = {
  problem:
    "Community organizers spend hours wrestling with spreadsheets, group texts, and last-minute no-shows just to staff a Saturday food drive or school carnival. Volunteers arrive unsure where to go, and students leave without a verifiable record of their service hours for school or employers.",
  solution:
    "ShiftShare turns a one-sentence event description into a complete, gap-checked shift schedule in seconds. Organizers publish a public signup link where volunteers claim non-overlapping shifts or join automatic standby lists. On event day, volunteers scan a rotating QR code to check in and check out, producing server-timestamped hours, a one-page PDF certificate, and a public /verify/[code] link.",
  tech: "Built with Next.js 16 (App Router and Server Actions), React 19, TypeScript, Tailwind CSS, Supabase (PostgreSQL, Row-Level Security, and Realtime), Anthropic Claude via @anthropic-ai/sdk with strict JSON validation, @react-pdf/renderer, Recharts, and qrcode.",
} as const;

export default function AboutPage() {
  return (
    <div id="top" className="min-h-dvh flex flex-col bg-cream-200">
      <Navbar />

      <main
        id="main-content"
        data-testid="about-page-content"
        className="container-page flex-1 py-12 sm:py-16"
      >
        <div className="mx-auto max-w-3xl space-y-8">
          <div className="space-y-3">
            <Badge tone="accent">About ShiftShare</Badge>
            <h1 className="text-display-md text-navy-900">
              Plain volunteer scheduling and hours you can prove.
            </h1>
          </div>

          <div
            data-testid="about-explanation-body"
            className="grid gap-5 sm:grid-cols-3"
          >
            <Card padding="lg" className="space-y-2.5">
              <h2 className="font-display text-lg font-bold text-navy-900">
                The problem
              </h2>
              <p className="text-sm leading-relaxed text-navy-800">
                {ABOUT_SECTIONS.problem}
              </p>
            </Card>

            <Card padding="lg" className="space-y-2.5 border-2 border-navy">
              <h2 className="font-display text-lg font-bold text-navy-900">
                The solution
              </h2>
              <p className="text-sm leading-relaxed text-navy-800">
                {ABOUT_SECTIONS.solution}
              </p>
            </Card>

            <Card padding="lg" className="space-y-2.5">
              <h2 className="font-display text-lg font-bold text-navy-900">
                The tech
              </h2>
              <p className="text-sm leading-relaxed text-navy-800">
                {ABOUT_SECTIONS.tech}
              </p>
            </Card>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/login"
              className={buttonClasses({ variant: "primary", size: "md" })}
            >
              Try the demo
            </Link>
            <Link
              href="/events/fall-carnival"
              className={buttonClasses({ variant: "secondary", size: "md" })}
            >
              View Fall Carnival event
            </Link>
            <Link
              href="/verify/SS-DE00000101"
              className={buttonClasses({ variant: "outline", size: "md" })}
            >
              Verify sample certificate
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
