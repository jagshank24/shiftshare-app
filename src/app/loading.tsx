import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/site/Logo";

export default function RootLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading page"
      className="min-h-dvh bg-cream-200"
    >
      <header className="border-b border-navy-100 bg-cream-200/95">
        <div className="container-page flex h-16 items-center justify-between">
          <Logo />
          <div className="h-8 w-24 animate-pulse rounded-xl bg-cream-300" />
        </div>
      </header>

      <main id="main-content" className="container-page space-y-6 py-10">
        <div className="space-y-3">
          <div className="h-9 w-64 animate-pulse rounded-xl bg-cream-300" />
          <div className="h-5 w-96 max-w-full animate-pulse rounded-lg bg-cream-300" />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} padding="lg" className="space-y-3">
              <div className="h-4 w-28 animate-pulse rounded bg-cream-300" />
              <div className="h-9 w-24 animate-pulse rounded-lg bg-cream-300" />
              <div className="h-4 w-40 animate-pulse rounded bg-cream-300" />
            </Card>
          ))}
        </div>

        <Card padding="lg" className="space-y-4">
          <div className="h-6 w-48 animate-pulse rounded-lg bg-cream-300" />
          <div className="h-28 w-full animate-pulse rounded-xl bg-cream-300" />
        </Card>
      </main>
    </div>
  );
}
