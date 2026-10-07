"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import {
  ArrowRightIcon,
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  MapPinIcon,
} from "@/components/site/icons";
import {
  EXAMPLE_SENTENCES,
  pickPlan,
  type SamplePlan,
} from "@/lib/sample-plans";

/**
 * The hero demo.
 *
 * Real behaviour: type an event sentence, press the button, watch a plan appear.
 * Fake behaviour: the plan itself is hardcoded (see `lib/sample-plans.ts`) — we
 * match a few keywords so the right sample shows up, then wait ~700ms so the
 * reveal reads as work being done rather than a swap.
 */
export function DemoBox() {
  const [text, setText] = useState<string>(EXAMPLE_SENTENCES[0].text);
  const [plan, setPlan] = useState<SamplePlan>(() => pickPlan(EXAMPLE_SENTENCES[0].text));
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildCount, setBuildCount] = useState(0);

  function build(nextText: string) {
    setText(nextText);
    setIsBuilding(true);
    window.setTimeout(() => {
      setPlan(pickPlan(nextText));
      setIsBuilding(false);
      setBuildCount((n) => n + 1);
    }, 700);
  }

  return (
    <Card variant="elevated" padding="none" className="overflow-hidden">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          build(text);
        }}
        className="border-b border-navy-100 bg-surface p-5 sm:p-6"
      >
        <label
          htmlFor="event-sentence"
          className="font-display text-base font-bold text-navy-900 sm:text-lg"
        >
          Describe your event
        </label>
        <p className="mt-1 text-sm text-navy-600">
          One sentence is enough. Include the day, the place, and how many people
          you need.
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Input
            id="event-sentence"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Saturday food drive at the library, 9am to 1pm, need 12 people."
            containerClassName="sm:flex-1"
            aria-describedby="event-sentence-examples"
          />
          <Button
            type="submit"
            loading={isBuilding}
            loadingLabel="Building your plan"
            rightIcon={<ArrowRightIcon />}
            className="sm:w-auto"
            fullWidth
          >
            Build my plan
          </Button>
        </div>

        <div
          id="event-sentence-examples"
          className="mt-3 flex flex-wrap items-center gap-2 text-sm text-navy-600"
        >
          <span>Or try one:</span>
          {EXAMPLE_SENTENCES.map((example) => (
            <button
              key={example.label}
              type="button"
              onClick={() => build(example.text)}
              className="inline-flex min-h-9 items-center rounded-full border border-navy-200 px-3.5 text-sm font-medium text-navy-700 transition-colors duration-150 ease-smooth hover:border-navy-900 hover:bg-navy-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
            >
              {example.label}
            </button>
          ))}
        </div>
      </form>

      {/* Output */}
      <div className="bg-cream-100 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-sm font-bold tracking-wide text-navy-600 uppercase">
            Staffing plan
          </h3>
          <Badge tone="neutral" variant="outline" size="sm">
            Sample output
          </Badge>
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {isBuilding ? "Building your staffing plan." : `Showing ${plan.title}.`}
        </div>

        {isBuilding ? (
          <PlanSkeleton />
        ) : (
          <div key={buildCount} className="animate-fade-up">
            <PlanCard plan={plan} />
          </div>
        )}
      </div>
    </Card>
  );
}

function PlanCard({ plan }: { plan: SamplePlan }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const linkRef = useRef<HTMLElement>(null);
  const link = `shiftshare.app/e/${plan.slug}`;

  /** Last resort when the Clipboard API is unavailable: select the text for them. */
  function selectLink() {
    const node = linkRef.current;
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  async function copyLink() {
    // No Clipboard API at all (insecure origin, older browser).
    if (!navigator.clipboard?.writeText) {
      selectLink();
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 3000);
      return;
    }

    try {
      await navigator.clipboard.writeText(`https://${link}`);
      setCopyState("copied");
    } catch {
      // Permission denied — e.g. a sandboxed iframe without clipboard access.
      selectLink();
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 3000);
  }


  const label =
    copyState === "copied"
      ? "Link copied"
      : copyState === "failed"
        ? "Copy the selected link"
        : "Copy signup link";

  return (
    <div className="mt-3 rounded-2xl border border-navy-100 bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-display text-lg font-bold text-navy-900 sm:text-xl">
            {plan.title}
          </h4>
          <dl className="mt-2 space-y-1 text-sm text-navy-600">
            <div className="flex items-center gap-2">
              <MapPinIcon className="size-4 shrink-0 text-navy-400" />
              <dt className="sr-only">Where</dt>
              <dd>{plan.where}</dd>
            </div>
            <div className="flex items-center gap-2">
              <CalendarIcon className="size-4 shrink-0 text-navy-400" />
              <dt className="sr-only">When</dt>
              <dd>{plan.when}</dd>
            </div>
          </dl>
        </div>
        <Badge tone="accent" variant="solid">
          {plan.total} spots
        </Badge>
      </div>

      <ul className="mt-4 divide-y divide-navy-100 border-t border-navy-100">
        {plan.shifts.map((shift) => (
          <li
            key={shift.role}
            className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
          >
            <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 sm:col-span-1">
              <span className="font-display font-semibold text-navy-900">
                {shift.role}
              </span>
              {shift.note && (
                <Badge tone="coral" variant="soft" size="sm">
                  {shift.note}
                </Badge>
              )}
            </div>
            <span className="text-sm tabular-nums text-navy-600 sm:text-right">
              {shift.time}
            </span>
            <Badge tone="mint" variant="soft" size="sm">
              {shift.spots} spots
            </Badge>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col gap-3 border-t border-navy-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <code
          ref={linkRef}
          className="truncate rounded-lg bg-cream-300 px-2.5 py-1.5 text-xs text-navy-700"
        >
          {link}
        </code>
        <Button
          variant="secondary"
          onClick={copyLink}
          leftIcon={copyState === "copied" ? <CheckIcon /> : <CopyIcon />}
          aria-live="polite"
        >
          {label}
        </Button>
      </div>

      {copyState === "failed" && (
        <p className="mt-2 text-xs text-coral-700 sm:text-right">
          Your browser blocked automatic copying. The link above is highlighted
          — press Ctrl+C or ⌘C, or press and hold it to copy.
        </p>
      )}
    </div>
  );
}

function PlanSkeleton() {
  return (
    <div className="mt-3 rounded-2xl border border-navy-100 bg-surface p-4 shadow-sm sm:p-5">
      <div className="h-6 w-48 animate-pulse rounded-md bg-cream-300" />
      <div className="mt-3 h-4 w-56 animate-pulse rounded-md bg-cream-300" />
      <div className="mt-5 space-y-3 border-t border-navy-100 pt-4">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center justify-between gap-3">
            <div className="h-4 w-40 animate-pulse rounded-md bg-cream-300" />
            <div className="h-4 w-24 animate-pulse rounded-md bg-cream-300" />
          </div>
        ))}
      </div>
      <p className={cn("mt-5 text-sm text-navy-600")}>
        Splitting 12 spots into shifts…
      </p>
    </div>
  );
}
