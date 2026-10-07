import { buttonClasses } from "@/components/ui/Button";
import { ArrowRightIcon, CheckIcon } from "@/components/site/icons";

const INCLUDED = [
  "Unlimited volunteer signups",
  "Shift reminders by text and email",
  "Verified hours and certificates",
];

export function FinalCta() {
  return (
    <section id="get-started" className="scroll-mt-20 pb-16 sm:pb-24">
      <div className="container-page">
        <div className="on-dark relative overflow-hidden rounded-3xl bg-navy-900 px-6 py-12 text-center sm:px-12 sm:py-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-16 -left-10 size-56 rounded-full bg-accent-500/15 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -bottom-20 size-64 rounded-full bg-mint-500/15 blur-3xl"
          />

          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-display-sm text-cream-200 sm:text-display">
              Write your first event sentence
            </h2>
            <p className="mt-4 text-lg text-navy-200">
              It takes about two minutes. You don&apos;t need a credit card, and
              you can delete the event if the plan isn&apos;t useful.
            </p>

            <ul className="mt-7 flex flex-col items-center justify-center gap-3 text-left sm:flex-row sm:flex-wrap sm:gap-x-6">
              {INCLUDED.map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-cream-200">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-500 text-navy-900">
                    <CheckIcon className="size-3.5" strokeWidth="2.6" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href="/signup"
                className={buttonClasses({
                  variant: "primary",
                  size: "lg",
                  className: "w-full sm:w-auto",
                })}
              >
                Start free
                <ArrowRightIcon className="size-4" />
              </a>
              <a
                href="/login"
                className={buttonClasses({
                  variant: "outline",
                  size: "lg",
                  className:
                    "w-full border-cream-200 text-cream-200 hover:bg-cream-200/10 focus-visible:ring-accent focus-visible:ring-offset-navy-900 sm:w-auto",
                })}
              >
                Log in
              </a>
            </div>

            <p className="mt-5 text-sm text-navy-200">
              Organizers with an account can also{" "}
              <a
                href="#how-it-works"
                className="rounded text-accent-500 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
              >
                copy a past event
              </a>{" "}
              instead of starting from scratch.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
