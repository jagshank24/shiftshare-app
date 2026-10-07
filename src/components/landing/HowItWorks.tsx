"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHeading } from "@/components/site/SectionHeading";

type Role = "organizer" | "volunteer";

const CONTENT: Record<
  Role,
  { label: string; steps: { title: string; body: string }[] }
> = {
  organizer: {
    label: "I'm organizing",
    steps: [
      {
        title: "Describe the event",
        body: "Type the date, the place and how many people you need. ShiftShare turns it into shifts of two to four hours, each with a role name and a headcount.",
      },
      {
        title: "Check the plan and open signups",
        body: "Rename a shift, move a time, drop one you don't need. Then post it and send the link — email, group chat or printed on the flyer.",
      },
      {
        title: "Watch spots fill, then confirm",
        body: "See who claimed what, who is confirmed and who still hasn't shown up. Reminders go out the day before each shift, so you're not chasing anyone.",
      },
    ],
  },
  volunteer: {
    label: "I'm volunteering",
    steps: [
      {
        title: "Open the link and pick a shift",
        body: "No account needed to look. You see the role, the time it runs, the address and how many spots are left before you commit.",
      },
      {
        title: "Get a reminder the day before",
        body: "One text with the time, the address and the name of the person to ask for when you arrive. Reply to drop out if something comes up.",
      },
      {
        title: "Check in, check out, keep your hours",
        body: "Tap in when you arrive and out when you leave. Your hours add up automatically and you can download the certificate whenever you need it.",
      },
    ],
  },
};

export function HowItWorks() {
  const [role, setRole] = useState<Role>("organizer");
  const tabRefs = useRef<Record<Role, HTMLButtonElement | null>>({
    organizer: null,
    volunteer: null,
  });
  const roles: Role[] = ["organizer", "volunteer"];

  /** Left/right arrows move between tabs, and focus follows the selection. */
  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next: Role = event.key === "ArrowRight" ? "volunteer" : "organizer";
    setRole(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <section
      id="how-it-works"
      className="scroll-mt-20 border-y border-navy-100 bg-surface"
    >
      <div className="container-page py-14 sm:py-20">
        <SectionHeading
          eyebrow="How it works"
          tone="navy"
          title="Three steps, whichever side you're on"
          lede="Organizers get a filled schedule. Volunteers get a time, a place and proof they showed up."
        />

        {/* Tabs — the same three steps from each person's point of view. */}
        <div
          role="tablist"
          aria-label="Choose your role"
          className="mx-auto mt-8 flex w-full max-w-xs gap-1 rounded-full border border-navy-100 bg-cream-200 p-1"
        >
          {roles.map((key) => {
            const selected = role === key;
            return (
              <button
                key={key}
                ref={(node) => {
                  tabRefs.current[key] = node;
                }}
                id={`tab-${key}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={`panel-${key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setRole(key)}
                onKeyDown={onKeyDown}
                className={cn(
                  "min-h-tap flex-1 rounded-full px-4 font-display text-sm font-semibold transition-colors duration-150 ease-smooth",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream",
                  selected
                    ? "bg-navy-900 text-cream-200"
                    : "text-navy-700 hover:bg-navy-900/5",
                )}
              >
                {CONTENT[key].label}
              </button>
            );
          })}
        </div>

        <div
          id={`panel-${role}`}
          role="tabpanel"
          aria-labelledby={`tab-${role}`}
          className="mt-10 grid gap-5 md:grid-cols-3 md:gap-6"
        >
          {CONTENT[role].steps.map((step, index) => (
            <div
              key={step.title}
              className="rounded-2xl border border-navy-100 bg-cream-100 p-5 sm:p-6"
            >
              <span className="grid size-10 place-items-center rounded-xl bg-accent-500 font-display text-lg font-bold text-navy-900">
                {index + 1}
              </span>
              <h3 className="mt-4 text-lg text-navy-900 sm:text-xl">
                {step.title}
              </h3>
              <p className="mt-2 text-navy-600">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
