import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/site/Logo";

export const metadata: Metadata = {
  title: "Account",
};

/**
 * Shared chrome for /login and /signup. No navbar — nothing to navigate to
 * mid-signup except the way back.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col bg-cream-200">
      <header className="container-page py-5">
        <Link
          href="/"
          className="inline-flex min-h-tap items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
        >
          <Logo />
          <span className="sr-only">ShiftShare home</span>
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-16 sm:items-center">
        <div className="w-full max-w-md">{children}</div>
      </main>

      <footer className="container-page py-6 text-center text-sm text-navy-600">
        <p>
          Trouble signing in?{" "}
          <a
            href="mailto:hello@shiftshare.app"
            className="rounded text-navy-900 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            hello@shiftshare.app
          </a>
        </p>
      </footer>
    </div>
  );
}
