"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { Logo } from "@/components/site/Logo";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-dvh bg-cream-200">
      <header className="border-b border-navy-100 bg-cream-200/95">
        <div className="container-page flex h-16 items-center">
          <Link
            href="/"
            className="inline-flex min-h-tap items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy"
          >
            <Logo />
            <span className="sr-only">ShiftShare home</span>
          </Link>
        </div>
      </header>

      <main id="main-content" className="container-page py-12 sm:py-16">
        <Card
          padding="lg"
          role="alert"
          data-testid="route-error-boundary"
          className="mx-auto max-w-lg space-y-5 border-2 border-coral text-center"
        >
          <div className="flex justify-center">
            <Badge tone="coral">Something went wrong</Badge>
          </div>
          <CardTitle as="h1" className="text-2xl sm:text-3xl">
            We couldn&apos;t load this page
          </CardTitle>
          <CardDescription className="text-base text-navy-700">
            {error?.message && error.message.length < 160
              ? error.message
              : "A temporary issue prevented this view from loading. Try again or head back to your dashboard."}
          </CardDescription>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button type="button" variant="primary" onClick={() => reset()}>
              Try again
            </Button>
            <Link
              href="/dashboard"
              className={buttonClasses({ variant: "secondary" })}
            >
              Go to dashboard
            </Link>
            <Link href="/" className={buttonClasses({ variant: "outline" })}>
              Home
            </Link>
          </div>
        </Card>
      </main>
    </div>
  );
}
