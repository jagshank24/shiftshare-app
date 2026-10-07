import { Badge } from "@/components/ui/Badge";
import { CheckIcon } from "@/components/site/icons";
import { DemoBox } from "@/components/landing/DemoBox";

const PROMISES = [
  "Free to set up",
  "Volunteers sign up straight from a link",
  "Editable on a phone, in a parking lot",
];

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* Decoration only */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full bg-accent-500/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-carnival-dots text-navy-900/[0.05]"
      />

      <div className="container-page relative grid gap-10 py-12 lg:grid-cols-[1fr_1.1fr] lg:items-start lg:gap-14 lg:py-20">
        <div>
          <Badge tone="mint" variant="soft" dot>
            Built for food drives, races and school events
          </Badge>

          <h1 className="mt-5 text-display text-navy-900 sm:text-display-lg">
            Staff your community event in minutes.
          </h1>

          <p className="mt-5 max-w-xl text-lg text-navy-600">
            Write one sentence about your event. ShiftShare splits it into
            shifts with times and headcounts, gives you a signup link to send,
            and records each volunteer&apos;s hours as they happen.
          </p>

          <ul className="mt-6 space-y-2.5">
            {PROMISES.map((promise) => (
              <li key={promise} className="flex items-start gap-2.5">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-mint-500 text-navy-900">
                  <CheckIcon className="size-3.5" strokeWidth="2.6" />
                </span>
                <span className="text-navy-700">{promise}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:sticky lg:top-24">
          <DemoBox />
          <p className="mt-3 text-center text-sm text-navy-600 lg:text-left">
            This demo uses one of three sample plans. Your real event gets its
            own.
          </p>
        </div>
      </div>
    </section>
  );
}
