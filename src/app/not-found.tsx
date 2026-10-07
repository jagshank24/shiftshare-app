import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";

export const metadata: Metadata = {
  title: "Page not found",
  description: "We couldn't find the ShiftShare page or event you were looking for.",
};

export default function NotFound() {
  return (
    <div className="min-h-dvh flex flex-col bg-cream-200">
      <Navbar />

      <main
        id="main-content"
        data-testid="not-found-page"
        className="container-page flex flex-1 items-center justify-center py-12 sm:py-16"
      >
        <Card
          padding="lg"
          className="mx-auto max-w-lg space-y-5 border-2 border-navy text-center"
        >
          <div className="flex justify-center">
            <Badge tone="accent">404 · Page not found</Badge>
          </div>
          <CardTitle as="h1" className="text-2xl sm:text-3xl">
            We couldn&apos;t find that page
          </CardTitle>
          <CardDescription className="text-base text-navy-700">
            The event link or page you opened may have moved or hasn&apos;t been
            published yet.
          </CardDescription>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/"
              className={buttonClasses({ variant: "primary", size: "md" })}
            >
              Back to home
            </Link>
            <Link
              href="/events/fall-carnival"
              className={buttonClasses({ variant: "secondary", size: "md" })}
            >
              View Fall Carnival
            </Link>
            <Link
              href="/login"
              className={buttonClasses({ variant: "outline", size: "md" })}
            >
              Try the demo
            </Link>
          </div>
        </Card>
      </main>

      <Footer />
    </div>
  );
}
