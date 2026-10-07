import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardDescription } from "@/components/ui/Card";
import { SignUpForm } from "@/components/auth/EmailAuthForm";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { AuthNotConfigured } from "@/components/auth/AuthNotConfigured";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Sign up",
  description:
    "Create a ShiftShare account as an organizer or a volunteer. Free to set up.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; role?: string }>;
}) {
  const { next, role } = await searchParams;
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const defaultRole =
    role === "organizer" || role === "volunteer" ? role : undefined;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-display-sm text-navy-900">Create your account</h1>
        <p className="text-navy-600">
          Takes about a minute. You can switch between organizing and
          volunteering later.
        </p>
      </div>

      <Card padding="lg" className="space-y-5">
        {!isSupabaseConfigured && <AuthNotConfigured />}

        <GoogleAuthButton next={safeNext} label="Sign up with Google" />
        <p className="text-xs text-navy-600">
          Google sign-ups pick a role on the next screen — we don&apos;t get to
          ask before you leave for Google.
        </p>

        <div className="flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-navy-200" />
          <span className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
            or use email
          </span>
          <span className="h-px flex-1 bg-navy-200" />
        </div>

        <SignUpForm next={safeNext} defaultRole={defaultRole} />
      </Card>

      <CardDescription className="text-center">
        Already have an account?{" "}
        <Link
          href="/login"
          className="rounded font-semibold text-navy-900 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
        >
          Log in
        </Link>
      </CardDescription>
    </div>
  );
}
