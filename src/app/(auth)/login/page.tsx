import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription } from "@/components/ui/Card";
import { SignInForm } from "@/components/auth/EmailAuthForm";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { demoLoginAction } from "@/app/(auth)/actions";

export const metadata: Metadata = {
  title: "Log in",
  description:
    "Log in to ShiftShare to manage your events, volunteer shifts, and verified hours — or try the instant judge demo.",
};

function Or({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-navy-200" />
      <span className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
        {label}
      </span>
      <span className="h-px flex-1 bg-navy-200" />
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext =
    next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-display-sm text-navy-900">Welcome back</h1>
        <p className="text-navy-700">
          Pick up where you left off — your events, shifts, and verified hours
          are where you left them.
        </p>
      </div>

      {/* Instant Demo Login Card for Judges — No Signup Needed */}
      <Card
        padding="lg"
        variant="tinted"
        data-testid="try-demo-section"
        className="space-y-3.5 border-2 border-navy"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge tone="navy" size="sm">
            Instant Judge Access · No signup needed
          </Badge>
          <span className="text-xs font-semibold text-navy-700">
            1 organizer · 15 volunteers · 33-shift Fall Carnival
          </span>
        </div>

        <p className="text-sm text-navy-800">
          Explore ShiftShare immediately with pre-loaded events, Recharts
          analytics, AI event recaps, QR check-in, and verified PDF hours
          certificates.
        </p>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <form action={demoLoginAction}>
            <input type="hidden" name="role" value="organizer" />
            <input type="hidden" name="next" value={safeNext} />
            <Button
              type="submit"
              variant="primary"
              fullWidth
              data-testid="try-demo-btn"
            >
              Try the demo
            </Button>
          </form>

          <form action={demoLoginAction}>
            <input type="hidden" name="role" value="volunteer" />
            <input type="hidden" name="next" value={safeNext} />
            <Button
              type="submit"
              variant="secondary"
              fullWidth
              data-testid="try-demo-volunteer-btn"
            >
              Try volunteer demo
            </Button>
          </form>
        </div>
      </Card>

      <Card padding="lg" className="space-y-5">
        <GoogleAuthButton next={safeNext} label="Continue with Google" />
        <Or label="or sign in with email" />
        <SignInForm next={safeNext} />
      </Card>

      <CardDescription className="text-center text-navy-700">
        New here?{" "}
        <Link
          href="/signup"
          className="rounded font-semibold text-navy-900 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
        >
          Create an account
        </Link>
      </CardDescription>
    </div>
  );
}
