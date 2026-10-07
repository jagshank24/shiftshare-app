"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PlanEditor } from "@/components/plan/PlanEditor";
import { windowFromSentence } from "@/lib/planner/demo";
import { parseTime, toHHMM } from "@/lib/planner/time";
import type {
  ClarifyingQuestion,
  PastEventsSummary,
  Plan,
  PlanIssue,
} from "@/lib/planner/types";
import { publishEventAction } from "@/app/events/actions";

/**
 * The /events/new flow:
 *   1. Describe the event in one sentence (+ quick-tap clarifying questions when details are missing)
 *   2. Generate staffing plan (with `why` per role & past-event adjustment note)
 *   3. Edit manually or via plain-English chat with "what changed" + Undo
 *   4. Plan check panel (up to 3 warnings, each with "Apply fix")
 *   5. Publish review (AI event description, role guides, and group-chat announcement) → save to Supabase
 */

const EXAMPLES: { label: string; sentence: string }[] = [
  {
    label: "Fall carnival",
    sentence: "Fall carnival, 200 people, Saturday 10-4",
  },
  {
    label: "Food drive",
    sentence: "Saturday food drive at the Fremont library, 9am to 1pm, need 12 people.",
  },
  {
    label: "Pancake breakfast (detailed)",
    sentence:
      "Indoor pancake breakfast for 120 families and kids at the rec center, 8am to 12pm, serving hot food, 16 volunteers available.",
  },
];

type ClarifyApiResponse = {
  ok: boolean;
  mode?: "claude" | "demo";
  needsClarification?: boolean;
  questions?: ClarifyingQuestion[];
  error?: string;
  hint?: string;
};

type GenerateApiResponse = {
  ok: boolean;
  mode?: "claude" | "demo";
  plan?: Plan;
  issues?: PlanIssue[];
  note?: string;
  adjustedFromPastEvent?: string;
  pastEventsSummary?: PastEventsSummary | null;
  error?: string;
  hint?: string;
};

export function PlanComposer({
  defaultDate,
  canPublish,
  publishBlockedReason,
  initialPastEventsSummary,
}: {
  defaultDate: string;
  canPublish: boolean;
  publishBlockedReason?: string;
  initialPastEventsSummary?: PastEventsSummary | null;
}) {
  const [sentence, setSentence] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("13:00");

  // Clarifying questions state (Step 1)
  const [clarifyLoading, setClarifyLoading] = useState(false);
  const [clarifyError, setClarifyError] = useState<{
    message: string;
    hint?: string;
  } | null>(null);
  const [questions, setQuestions] = useState<ClarifyingQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Plan generation state (Step 2)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<{
    plan: Plan;
    issues: PlanIssue[];
    mode: "claude" | "demo";
    note?: string;
    adjustedFromPastEvent?: string;
  } | null>(null);

  const windowStart = parseTime(start);
  const windowEnd = parseTime(end);

  function handleSentenceChange(nextSentence: string) {
    setSentence(nextSentence);
    // Sync the Opens/Closes time inputs when the sentence states a window like "10-4" or "9am to 1pm"
    const parsedWindow = windowFromSentence(nextSentence);
    if (parsedWindow) {
      setStart(toHHMM(parsedWindow.start));
      setEnd(toHHMM(parsedWindow.end));
    }
  }

  /**
   * Step 1: Ask for up to 3 clarifying questions if key details are missing.
   * If the sentence already has enough detail, skip straight to generating the plan.
   */
  async function startPlanning() {
    const parsedWindow = windowFromSentence(sentence);
    const effectiveStart = parsedWindow ? toHHMM(parsedWindow.start) : start;
    const effectiveEnd = parsedWindow ? toHHMM(parsedWindow.end) : end;
    if (parsedWindow) {
      setStart(effectiveStart);
      setEnd(effectiveEnd);
    }

    setClarifyLoading(true);
    setClarifyError(null);
    setError(null);
    setQuestions(null);
    setAnswers({});

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clarify",
          sentence,
          date,
          start: effectiveStart,
          end: effectiveEnd,
        }),
      });

      const data = (await response.json()) as ClarifyApiResponse;

      if (!response.ok || !data.ok) {
        setClarifyError({
          message: data.error ?? `Couldn't check event details (${response.status}).`,
          hint: data.hint,
        });
        return;
      }

      const returnedQuestions = data.questions ?? [];
      if (!data.needsClarification || returnedQuestions.length === 0) {
        // Sentence has enough detail — skip clarifying questions and generate immediately
        await generate({}, effectiveStart, effectiveEnd);
        return;
      }

      setQuestions(returnedQuestions.slice(0, 3));
    } catch {
      setClarifyError({
        message: "Couldn't reach the server.",
        hint: "Check your connection and tap Retry.",
      });
    } finally {
      setClarifyLoading(false);
    }
  }

  /**
   * Step 2: Generate the staffing plan.
   */
  async function generate(
    chosenClarifications: Record<string, string> = answers,
    overrideStart?: string,
    overrideEnd?: string,
  ) {
    const effectiveStart = overrideStart ?? start;
    const effectiveEnd = overrideEnd ?? end;

    setLoading(true);
    setError(null);
    setClarifyError(null);
    setQuestions(null);
    setResult(null);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          sentence,
          date,
          start: effectiveStart,
          end: effectiveEnd,
          clarifications: chosenClarifications,
        }),
      });

      const data = (await response.json()) as GenerateApiResponse;

      if (!response.ok || !data.ok || !data.plan) {
        setError({
          message: data.error ?? `Something went wrong (${response.status}).`,
          hint: data.hint,
        });
        return;
      }

      setResult({
        plan: data.plan,
        issues: data.issues ?? [],
        mode: data.mode ?? "claude",
        note: data.note,
        adjustedFromPastEvent:
          data.adjustedFromPastEvent ?? initialPastEventsSummary?.uiNote,
      });
    } catch {
      setError({
        message: "Couldn't reach the server.",
        hint: "Check your connection and try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  function toggleAnswer(questionText: string, option: string) {
    setAnswers((current) => {
      if (current[questionText] === option) {
        const next = { ...current };
        delete next[questionText];
        return next;
      }
      return { ...current, [questionText]: option };
    });
  }

  const busy = clarifyLoading || loading;

  return (
    <div className="space-y-8">
      {/* Past events notice (Part 6) if organizer already has past events in Supabase */}
      {initialPastEventsSummary && !result && (
        <div
          role="status"
          data-testid="past-events-banner"
          className="rounded-2xl border-2 border-mint-200 bg-mint-50 px-4 py-3.5"
        >
          <p className="flex flex-wrap items-center gap-2 font-display text-sm font-bold text-navy-900">
            <Badge tone="mint" variant="solid" size="sm">
              Past event data found
            </Badge>
            <span>{initialPastEventsSummary.uiNote}</span>
          </p>
        </div>
      )}

      {/* Step 1 — describe */}
      <Card padding="lg" className="space-y-4">
        <div>
          <CardTitle as="h2">Describe the event</CardTitle>
          <CardDescription className="mt-1">
            One sentence: the day, the place, the hours, and how many people you
            expect.
          </CardDescription>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) startPlanning();
          }}
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="event-sentence"
              className="mb-1.5 block font-display text-sm font-semibold text-navy-900"
            >
              What&apos;s happening?
            </label>
            <textarea
              id="event-sentence"
              rows={3}
              value={sentence}
              onChange={(event) => handleSentenceChange(event.target.value)}
              placeholder="Fall carnival, 200 people, Saturday 10-4"
              className="w-full rounded-2xl border-2 border-navy-100 bg-surface px-3.5 py-3 text-base text-navy-900 transition-colors placeholder:text-navy-400 focus-visible:border-navy-900 focus-visible:ring-4 focus-visible:ring-navy-900/20 focus-visible:outline-none"
            />
            <p className="mt-1.5 text-sm text-navy-600">
              {sentence.length}/600 characters
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="Date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <Input
              label="Opens"
              type="time"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
            <Input
              label="Closes"
              type="time"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              hint="Shifts must cover this window."
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-navy-600">
            <span>Examples:</span>
            {EXAMPLES.map((example) => (
              <button
                key={example.label}
                type="button"
                onClick={() => handleSentenceChange(example.sentence)}
                className="inline-flex min-h-tap items-center rounded-full border border-navy-200 px-3.5 text-sm font-medium text-navy-700 transition-colors hover:border-navy-900 hover:bg-navy-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
              >
                {example.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              size="lg"
              loading={busy}
              loadingLabel={
                clarifyLoading ? "Checking event details" : "Building your plan"
              }
              disabled={!sentence.trim()}
            >
              Build the plan
            </Button>
          </div>
        </form>
      </Card>

      {/* Clarifying questions error */}
      {clarifyError && (
        <Card padding="lg" variant="outline" className="border-coral-200 bg-coral-50">
          <p role="alert" className="font-display font-bold text-coral-800">
            {clarifyError.message}
          </p>
          {clarifyError.hint && (
            <p className="mt-1 text-sm text-coral-800">{clarifyError.hint}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={startPlanning}>
              Retry
            </Button>
            <Button variant="ghost" size="sm" onClick={() => generate({})}>
              Skip &amp; build plan anyway
            </Button>
          </div>
        </Card>
      )}

      {/* Step 1b — Clarifying questions quick-tap card */}
      {!busy && questions && questions.length > 0 && (
        <Card
          padding="lg"
          data-testid="clarifying-questions"
          className="space-y-5 border-2 border-navy-900"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <Badge tone="accent" variant="solid" size="sm">
                Quick details
              </Badge>
              <CardTitle as="h2" className="mt-2">
                A few quick questions to size your shifts
              </CardTitle>
              <CardDescription className="mt-1">
                Tap an option for any detail you know, or skip to build right away.
              </CardDescription>
            </div>
          </div>

          <div className="space-y-4">
            {questions.map((q) => {
              const selected = answers[q.question];
              return (
                <div
                  key={q.id}
                  className="rounded-2xl border border-navy-100 bg-cream-100 p-4"
                >
                  <p className="font-display text-sm font-semibold text-navy-900">
                    {q.question}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {q.options.map((option) => {
                      const active = selected === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleAnswer(q.question, option)}
                          className={cn(
                            "inline-flex min-h-tap items-center rounded-full border-2 px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream",
                            active
                              ? "border-navy-900 bg-navy-900 text-cream-100"
                              : "border-navy-200 bg-surface text-navy-800 hover:border-navy-900",
                          )}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="lg"
              onClick={() => generate(answers)}
              loading={loading}
              loadingLabel="Building your plan"
            >
              Generate plan
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => generate({})}
              disabled={loading}
            >
              Skip &amp; build with defaults
            </Button>
          </div>
        </Card>
      )}

      {/* Plan generation error */}
      {error && (
        <Card padding="lg" variant="outline" className="border-coral-200 bg-coral-50">
          <p role="alert" className="font-display font-bold text-coral-800">
            {error.message}
          </p>
          {error.hint && <p className="mt-1 text-sm text-coral-800">{error.hint}</p>}
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => generate(answers)}
          >
            Try again
          </Button>
        </Card>
      )}

      {/* Loading */}
      {loading && <PlanSkeleton />}

      {/* Step 2 — edit, chat-edit, plan-check, and publish */}
      {!loading && result && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-display-sm text-navy-900">Check and adjust</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => generate(answers)}
              disabled={busy}
            >
              Regenerate
            </Button>
          </div>

          {!canPublish && publishBlockedReason && (
            <Card padding="lg" variant="outline" className="border-accent-200 bg-accent-50">
              <p className="font-display font-bold text-navy-900">
                You can edit the plan here
              </p>
              <p className="mt-1 text-sm text-navy-700">{publishBlockedReason}</p>
            </Card>
          )}

          <PlanEditor
            key={`${result.mode}-${result.plan.roles.length}-${result.plan.title}`}
            plan={result.plan}
            sentence={sentence}
            date={date}
            start={start}
            end={end}
            window={{ start: windowStart, end: windowEnd }}
            issues={result.issues}
            note={result.note}
            adjustedFromPastEvent={result.adjustedFromPastEvent}
            mode={result.mode}
            onPublish={async (plan, publishDetails) =>
              publishEventAction({
                plan,
                date,
                start,
                end,
                tzOffset: new Date().getTimezoneOffset(),
                tzName: Intl.DateTimeFormat().resolvedOptions().timeZone,
                eventDescription: publishDetails?.eventDescription,
                location: publishDetails?.location,
              })
            }
          />
        </>
      )}
    </div>
  );
}

function PlanSkeleton() {
  return (
    <Card padding="lg" aria-busy="true" className="space-y-5">
      <div role="status" className="sr-only">
        Building your staffing plan
      </div>
      <div className="h-6 w-56 animate-pulse rounded-md bg-cream-300" />
      <div className="h-24 animate-pulse rounded-xl bg-cream-300" />
      {[0, 1].map((card) => (
        <div key={card} className="space-y-3 rounded-2xl border border-navy-100 p-4">
          <div className="h-5 w-40 animate-pulse rounded-md bg-cream-300" />
          <div className="h-14 animate-pulse rounded-xl bg-cream-300" />
          <div className="h-14 animate-pulse rounded-xl bg-cream-300" />
        </div>
      ))}
    </Card>
  );
}
