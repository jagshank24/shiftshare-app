"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { IssueList, Timeline } from "@/components/plan/Timeline";
import { formatDuration, parseTime, toFriendlyTime } from "@/lib/planner/time";
import {
  shiftId,
  type Plan,
  type PlanIssue,
  type PlanWarning,
  type PlanWindow,
  type PublishCopy,
} from "@/lib/planner/types";
import { validatePlan } from "@/lib/planner/validate";

const CHAT_SUGGESTIONS = [
  "Add a cleanup crew at 3pm",
  "We only have 15 volunteers",
  "Add a break relief float role",
];

type ChatEditApiResponse = {
  ok: boolean;
  mode?: "claude" | "demo";
  plan?: Plan;
  whatChanged?: string;
  issues?: PlanIssue[];
  error?: string;
  hint?: string;
};

type PlanCheckApiResponse = {
  ok: boolean;
  mode?: "claude" | "demo";
  warnings?: PlanWarning[];
  error?: string;
  hint?: string;
};

type PublishCopyApiResponse = {
  ok: boolean;
  mode?: "claude" | "demo";
  copy?: PublishCopy;
  error?: string;
  hint?: string;
};

type HistoryEntry = {
  plan: Plan;
  whatChanged: string;
};

/**
 * The editable plan with:
 * - Manual editing (title, role name, role description, shift times, ± headcount, add/delete shifts)
 * - "why" helper text under each role explaining the headcount
 * - Plain-English chat editing with "what changed" summary and Undo
 * - Plan check panel (second call after generation/edit) with up to 3 warnings and "Apply fix"
 * - Publish review panel (AI event description, role guides, and group-chat announcement) before saving to Supabase
 */
export function PlanEditor({
  plan: initialPlan,
  sentence,
  date,
  start,
  end,
  window: windowRange,
  issues: initialIssues,
  note,
  adjustedFromPastEvent,
  mode,
  onPublish,
}: {
  plan: Plan;
  sentence?: string;
  date?: string;
  start?: string;
  end?: string;
  window: PlanWindow;
  issues: PlanIssue[];
  note?: string;
  adjustedFromPastEvent?: string;
  mode: "claude" | "demo";
  onPublish: (
    plan: Plan,
    publishDetails?: { eventDescription?: string; location?: string },
  ) => Promise<{ error?: string } | void>;
}) {
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [touched, setTouched] = useState(false);

  // Chat editing state (Part 3)
  const [chatInput, setChatInput] = useState("");
  const [lastChatInstruction, setLastChatInstruction] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<{
    message: string;
    hint?: string;
  } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [whatChanged, setWhatChanged] = useState<string | null>(null);

  // Plan check state (Part 4)
  const [checkLoading, setCheckLoading] = useState(true);
  const [checkError, setCheckError] = useState<{
    message: string;
    hint?: string;
  } | null>(null);
  const [planWarnings, setPlanWarnings] = useState<PlanWarning[]>([]);
  const [fixingPrompt, setFixingPrompt] = useState<string | null>(null);

  // Publish copy & final save state (Part 5)
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyError, setCopyError] = useState<{
    message: string;
    hint?: string;
  } | null>(null);
  const [publishCopyReady, setPublishCopyReady] = useState(false);
  const [eventDescription, setEventDescription] = useState("");
  const [location, setLocation] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);
  const announcementRef = useRef<HTMLTextAreaElement>(null);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Re-validate locally on every edit.
  const issues = useMemo(
    () => validatePlan(plan, windowRange),
    [plan, windowRange],
  );
  const blocking = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");
  const publishable = blocking.length === 0;

  const totalPeople = plan.roles.reduce(
    (sum, role) =>
      sum + role.shifts.reduce((s, shift) => s + shift.headcount, 0),
    0,
  );
  const totalShifts = plan.roles.reduce(
    (sum, role) => sum + role.shifts.length,
    0,
  );

  /**
   * Part 4: Second Claude call that reviews the plan for gaps (no breaks,
   * missing setup/cleanup, understaffed busy hours) and returns up to 3 warnings.
   */
  const runPlanCheck = useCallback(
    async (targetPlan: Plan) => {
      setCheckLoading(true);
      setCheckError(null);

      try {
        const response = await fetch("/api/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "check",
            plan: targetPlan,
            sentence,
            start,
            end,
          }),
        });

        const data = (await response.json()) as PlanCheckApiResponse;
        if (!response.ok || !data.ok) {
          setCheckError({
            message:
              data.error ?? `Couldn't run plan check (${response.status}).`,
            hint: data.hint,
          });
          return;
        }

        setPlanWarnings((data.warnings ?? []).slice(0, 3));
      } catch {
        setCheckError({
          message: "Couldn't reach the server for plan check.",
          hint: "Check your connection and tap Retry.",
        });
      } finally {
        setCheckLoading(false);
      }
    },
    [sentence, start, end],
  );

  // Run the initial Plan Check right after initial plan generation mounts.
  useEffect(() => {
    let cancelled = false;

    async function initialCheck() {
      try {
        const response = await fetch("/api/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "check",
            plan: initialPlan,
            sentence,
            start,
            end,
          }),
        });
        const data = (await response.json()) as PlanCheckApiResponse;
        if (cancelled) return;

        if (!response.ok || !data.ok) {
          setCheckError({
            message:
              data.error ?? `Couldn't run plan check (${response.status}).`,
            hint: data.hint,
          });
        } else {
          setPlanWarnings((data.warnings ?? []).slice(0, 3));
        }
      } catch {
        if (!cancelled) {
          setCheckError({
            message: "Couldn't reach the server for plan check.",
            hint: "Check your connection and tap Retry.",
          });
        }
      } finally {
        if (!cancelled) {
          setCheckLoading(false);
        }
      }
    }

    initialCheck();
    return () => {
      cancelled = true;
    };
  }, [initialPlan, sentence, start, end]);

  /* ------------------------------------------------------------------------ */
  /* Manual edit handlers (Part 2)                                            */
  /* ------------------------------------------------------------------------ */

  function updateRole(index: number, patch: Partial<Plan["roles"][number]>) {
    setTouched(true);
    setPlan((current) => ({
      ...current,
      roles: current.roles.map((role, i) =>
        i === index ? { ...role, ...patch } : role,
      ),
    }));
  }

  function updateShift(
    roleIndex: number,
    id: string,
    patch: Partial<{ start: string; end: string; headcount: number }>,
  ) {
    setTouched(true);
    setPlan((current) => ({
      ...current,
      roles: current.roles.map((role, i) =>
        i === roleIndex
          ? {
              ...role,
              shifts: role.shifts.map((shift) =>
                shift.id === id ? { ...shift, ...patch } : shift,
              ),
            }
          : role,
      ),
    }));
  }

  function addShift(roleIndex: number) {
    setTouched(true);
    setPlan((current) => ({
      ...current,
      roles: current.roles.map((role, i) => {
        if (i !== roleIndex) return role;
        const last = role.shifts[role.shifts.length - 1];
        const lastEnd = parseTime(last?.end ?? "") ?? null;
        const nextStart = lastEnd ?? (windowRange.start ?? 9 * 60);
        return {
          ...role,
          shifts: [
            ...role.shifts,
            {
              id: shiftId(),
              start: minutesToInput(nextStart),
              end: minutesToInput(Math.min(nextStart + 60, 24 * 60 - 1)),
              headcount: last?.headcount ?? 2,
            },
          ],
        };
      }),
    }));
  }

  function deleteShift(roleIndex: number, id: string) {
    setTouched(true);
    setPlan((current) => ({
      ...current,
      roles: current.roles.map((role, i) =>
        i === roleIndex
          ? { ...role, shifts: role.shifts.filter((shift) => shift.id !== id) }
          : role,
      ),
    }));
  }

  /* ------------------------------------------------------------------------ */
  /* Chat editing + Undo (Part 3) & Apply Fix from Plan Check (Part 4)        */
  /* ------------------------------------------------------------------------ */

  async function applyChatEdit(rawInstruction?: string) {
    const instruction = (rawInstruction ?? chatInput).trim();
    if (!instruction) return;

    setLastChatInstruction(instruction);
    setChatLoading(true);
    setChatError(null);
    if (rawInstruction) {
      setFixingPrompt(rawInstruction);
    }

    const snapshotPlan = plan;

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          plan: snapshotPlan,
          instruction,
          start,
          end,
        }),
      });

      const data = (await response.json()) as ChatEditApiResponse;
      if (!response.ok || !data.ok || !data.plan) {
        setChatError({
          message: data.error ?? `Couldn't apply that change (${response.status}).`,
          hint: data.hint,
        });
        return;
      }

      const summary =
        data.whatChanged ?? `Updated the plan for "${instruction}".`;

      setHistory((prev) => [
        ...prev,
        { plan: snapshotPlan, whatChanged: summary },
      ]);
      setPlan(data.plan);
      setWhatChanged(summary);
      setTouched(true);
      if (!rawInstruction) {
        setChatInput("");
      }

      // Trigger the second Claude call (Plan Check) on the newly edited plan
      await runPlanCheck(data.plan);
    } catch {
      setChatError({
        message: "Couldn't reach the server to update the plan.",
        hint: "Check your connection and tap Retry.",
      });
    } finally {
      setChatLoading(false);
      setFixingPrompt(null);
    }
  }

  function handleUndo() {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    const remaining = history.slice(0, -1);

    setPlan(previous.plan);
    setHistory(remaining);
    setWhatChanged(
      remaining.length > 0
        ? remaining[remaining.length - 1].whatChanged
        : null,
    );
    void runPlanCheck(previous.plan);
  }

  /* ------------------------------------------------------------------------ */
  /* Publish Copy Generation & Final Save (Part 5)                            */
  /* ------------------------------------------------------------------------ */

  async function preparePublishCopy() {
    setCopyLoading(true);
    setCopyError(null);
    setPublishError(null);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish-copy",
          plan,
          sentence,
          date,
          start,
          end,
          location,
        }),
      });

      const data = (await response.json()) as PublishCopyApiResponse;
      if (!response.ok || !data.ok || !data.copy) {
        setCopyError({
          message:
            data.error ??
            `Couldn't generate publish descriptions (${response.status}).`,
          hint: data.hint,
        });
        return;
      }

      const copy = data.copy;
      setEventDescription(copy.eventDescription);
      if (copy.location && !location) {
        setLocation(copy.location);
      }
      setAnnouncement(copy.announcement);

      // Apply the generated plain-language role descriptions (what to do, what to wear/bring)
      // to the editable plan roles so the organizer can review and edit them before saving.
      const byName = new Map(
        copy.roleDescriptions.map((r) => [
          r.name.trim().toLowerCase(),
          r.description,
        ]),
      );
      setPlan((current) => ({
        ...current,
        roles: current.roles.map((role, idx) => {
          const generatedDesc =
            byName.get(role.name.trim().toLowerCase()) ??
            copy.roleDescriptions[idx]?.description;
          return generatedDesc
            ? { ...role, description: generatedDesc }
            : role;
        }),
      }));

      setPublishCopyReady(true);
    } catch {
      setCopyError({
        message: "Couldn't reach the server to generate event descriptions.",
        hint: "Check your connection and tap Retry.",
      });
    } finally {
      setCopyLoading(false);
    }
  }

  async function copyAnnouncementToClipboard() {
    try {
      await navigator.clipboard.writeText(announcement);
      setCopiedNotice("Announcement copied. Paste it into your group chat.");
    } catch {
      announcementRef.current?.select();
      setCopiedNotice(
        "This browser blocked the clipboard. The announcement is selected — press Ctrl/⌘ + C to copy it.",
      );
    }
    setTimeout(() => setCopiedNotice(null), 5000);
  }

  async function saveAndPublish() {
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await onPublish(plan, {
        eventDescription,
        location,
      });
      if (result?.error) {
        setPublishError(result.error);
        setPublishing(false);
      }
    } catch {
      setPublishError("Couldn't save the event. Check your connection and try again.");
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-6">
      {mode === "demo" && (
        <div className="rounded-2xl border-2 border-accent-200 bg-accent-50 px-4 py-3.5">
          <p className="flex items-center gap-2 font-display text-sm font-bold text-navy-900">
            <Badge tone="coral" variant="solid" size="sm">
              Demo plan
            </Badge>
            Not from Claude
          </p>
          <p className="mt-1.5 text-sm text-navy-700">
            {note ??
              "No ANTHROPIC_API_KEY is set, so this plan came from the built-in demo planner. Add a key to .env.local and restart to use Claude."}
          </p>
        </div>
      )}

      {/* Part 6 — Past events adjustment note */}
      {adjustedFromPastEvent && (
        <div
          role="status"
          data-testid="past-events-note"
          className="rounded-2xl border-2 border-mint-200 bg-mint-50 px-4 py-3.5"
        >
          <p className="flex flex-wrap items-center gap-2 font-display text-sm font-bold text-navy-900">
            <Badge tone="mint" variant="solid" size="sm">
              Adjusted based on your last event
            </Badge>
            <span>Past fill rate &amp; no-shows factored in</span>
          </p>
          <p className="mt-1 text-sm text-navy-700">{adjustedFromPastEvent}</p>
        </div>
      )}

      {/* Validation summary */}
      {(blocking.length > 0 || warnings.length > 0) && (
        <div
          className={cn(
            "rounded-2xl border-2 px-4 py-3.5",
            blocking.length > 0
              ? "border-coral-200 bg-coral-50"
              : "border-navy-100 bg-cream-100",
          )}
        >
          <p className="font-display text-sm font-bold text-navy-900">
            {blocking.length > 0
              ? `${blocking.length} thing${blocking.length === 1 ? "" : "s"} to fix before publishing`
              : `${warnings.length} note${warnings.length === 1 ? "" : "s"}`}
          </p>
          <div className="mt-2">
            <IssueList issues={issues.length ? issues : initialIssues} />
          </div>
        </div>
      )}

      <Timeline
        plan={plan}
        windowStart={windowRange.start}
        windowEnd={windowRange.end}
      />

      {/* Event title */}
      <Card padding="lg" className="space-y-5">
        <Input
          label="Event title"
          value={plan.title}
          onChange={(event) => {
            setTouched(true);
            setPlan((current) => ({ ...current, title: event.target.value }));
          }}
          placeholder="Saturday food drive"
        />

        <div className="flex flex-wrap items-center gap-2 text-sm text-navy-600">
          <Badge tone="navy" variant="soft" size="sm">
            {plan.roles.length} role{plan.roles.length === 1 ? "" : "s"}
          </Badge>
          <Badge tone="mint" variant="soft" size="sm">
            {totalShifts} shift{totalShifts === 1 ? "" : "s"}
          </Badge>
          <Badge tone="accent" variant="soft" size="sm">
            {totalPeople} spot{totalPeople === 1 ? "" : "s"} to fill
          </Badge>
        </div>
      </Card>

      {/* Part 2 — Editable Roles & Shifts with "why" helper text */}
      <div className="space-y-4">
        {plan.roles.map((role, roleIndex) => (
          <Card
            key={`${roleIndex}-${role.name}`}
            padding="lg"
            className="space-y-4"
          >
            <div className="space-y-3">
              <Input
                label="Role"
                value={role.name}
                onChange={(event) =>
                  updateRole(roleIndex, { name: event.target.value })
                }
                placeholder="Check-in table"
              />
              <Input
                label="What this role does"
                value={role.description}
                onChange={(event) =>
                  updateRole(roleIndex, { description: event.target.value })
                }
                placeholder="Greet volunteers and sign people in and out."
              />

              {/* Small helper text under each role explaining the headcount ("why") */}
              {role.why && (
                <p
                  data-testid={`role-why-${roleIndex}`}
                  className="rounded-xl bg-cream-200/80 px-3 py-2 text-xs text-navy-600"
                >
                  <span className="font-display font-semibold text-navy-900">
                    Why this headcount:{" "}
                  </span>
                  {role.why}
                </p>
              )}
            </div>

            <ul className="space-y-3">
              {role.shifts.map((shift) => {
                const sStart = parseTime(shift.start);
                const sEnd = parseTime(shift.end);
                const minutes =
                  sStart !== null && sEnd !== null && sEnd > sStart
                    ? sEnd - sStart
                    : null;
                const bad =
                  minutes !== null && (minutes < 30 || minutes > 90);

                return (
                  <li
                    key={shift.id}
                    className="rounded-2xl border border-navy-100 bg-cream-100 p-3.5"
                  >
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="w-[7.5rem]">
                        <label
                          htmlFor={`${shift.id}-start`}
                          className="mb-1 block font-display text-xs font-semibold text-navy-700"
                        >
                          Starts
                        </label>
                        <input
                          id={`${shift.id}-start`}
                          type="time"
                          value={shift.start}
                          onChange={(event) =>
                            updateShift(roleIndex, shift.id, {
                              start: event.target.value,
                            })
                          }
                          className="min-h-tap w-full rounded-xl border-2 border-navy-100 bg-surface px-2.5 py-2 text-sm text-navy-900 focus-visible:border-navy-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-navy-900/20"
                        />
                      </div>
                      <div className="w-[7.5rem]">
                        <label
                          htmlFor={`${shift.id}-end`}
                          className="mb-1 block font-display text-xs font-semibold text-navy-700"
                        >
                          Ends
                        </label>
                        <input
                          id={`${shift.id}-end`}
                          type="time"
                          value={shift.end}
                          onChange={(event) =>
                            updateShift(roleIndex, shift.id, {
                              end: event.target.value,
                            })
                          }
                          className="min-h-tap w-full rounded-xl border-2 border-navy-100 bg-surface px-2.5 py-2 text-sm text-navy-900 focus-visible:border-navy-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-navy-900/20"
                        />
                      </div>

                      <div className="shrink-0">
                        <span className="mb-1 block font-display text-xs font-semibold text-navy-700">
                          People
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`One fewer person for ${role.name} at ${shift.start}`}
                            onClick={() =>
                              updateShift(roleIndex, shift.id, {
                                headcount: Math.max(1, shift.headcount - 1),
                              })
                            }
                            disabled={shift.headcount <= 1}
                            className="grid min-h-tap min-w-tap shrink-0 place-items-center rounded-xl border-2 border-navy-100 bg-surface font-display text-lg text-navy-900 transition-colors hover:border-navy-900 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={99}
                            value={shift.headcount}
                            aria-label={`People needed for ${role.name} at ${shift.start}`}
                            onChange={(event) =>
                              updateShift(roleIndex, shift.id, {
                                headcount: Math.max(
                                  1,
                                  Math.min(99, Number(event.target.value) || 1),
                                ),
                              })
                            }
                            className="min-h-tap w-12 rounded-xl border-2 border-navy-100 bg-surface text-center text-sm tabular-nums text-navy-900 focus-visible:border-navy-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-navy-900/20"
                          />
                          <button
                            type="button"
                            aria-label={`One more person for ${role.name} at ${shift.start}`}
                            onClick={() =>
                              updateShift(roleIndex, shift.id, {
                                headcount: Math.min(99, shift.headcount + 1),
                              })
                            }
                            className="grid min-h-tap min-w-tap shrink-0 place-items-center rounded-xl border-2 border-navy-100 bg-surface font-display text-lg text-navy-900 transition-colors hover:border-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-1 basis-full items-center justify-end gap-3 sm:basis-auto">
                        {minutes !== null && (
                          <span
                            className={cn(
                              "text-xs tabular-nums",
                              bad
                                ? "font-semibold text-coral-700"
                                : "text-navy-600",
                            )}
                          >
                            {formatDuration(minutes)}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteShift(roleIndex, shift.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>

                    {sStart !== null && minutes !== null && (
                      <p className="mt-2 text-xs text-navy-600">
                        {toFriendlyTime(sStart)} · {shift.headcount} volunteer
                        {shift.headcount === 1 ? "" : "s"} needed
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            <Button
              variant="outline"
              size="sm"
              className="max-w-full whitespace-normal! text-left"
              onClick={() => addShift(roleIndex)}
            >
              Add a shift to {role.name || "this role"}
            </Button>
          </Card>
        ))}
      </div>

      {/* Part 3 — Chat Editing */}
      <Card
        padding="lg"
        data-testid="chat-edit-panel"
        className="space-y-4"
      >
        <div>
          <CardTitle as="h3">Ask for a change</CardTitle>
          <CardDescription className="mt-1">
            Type a plain-English change like &ldquo;add a cleanup crew at
            3pm&rdquo; or &ldquo;we only have 15 volunteers.&rdquo; Manual edits
            above keep working too.
          </CardDescription>
        </div>

        {/* "What changed" summary + Undo button */}
        {whatChanged && history.length > 0 && (
          <div
            role="status"
            data-testid="chat-change-summary"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-mint-200 bg-mint-50 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="font-display text-xs font-bold uppercase tracking-wider text-mint-800">
                What changed
              </p>
              <p className="mt-0.5 text-sm font-medium text-navy-900">
                {whatChanged}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleUndo}
              disabled={chatLoading}
            >
              Undo
            </Button>
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!chatLoading && chatInput.trim()) {
              void applyChatEdit();
            }
          }}
          className="space-y-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <label htmlFor="chat-edit-input" className="sr-only">
                Plain-English change to the plan
              </label>
              <input
                id="chat-edit-input"
                type="text"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="e.g. Add a cleanup crew at 3pm, or we only have 15 volunteers"
                disabled={chatLoading}
                className="min-h-tap w-full rounded-xl border-2 border-navy-100 bg-surface px-3.5 py-2.5 text-base text-navy-900 placeholder:text-navy-400 focus-visible:border-navy-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-navy-900/20 disabled:opacity-60"
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              size="md"
              loading={chatLoading && !fixingPrompt}
              loadingLabel="Updating plan"
              disabled={!chatInput.trim() || chatLoading}
            >
              Apply change
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-navy-600">
            <span>Try:</span>
            {CHAT_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={chatLoading}
                onClick={() => {
                  setChatInput(suggestion);
                  void applyChatEdit(suggestion);
                }}
                className="inline-flex min-h-tap items-center rounded-full border border-navy-200 bg-cream-100 px-3 text-xs font-medium text-navy-700 transition-colors hover:border-navy-900 hover:bg-navy-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </form>

        {chatError && (
          <div className="rounded-xl border-2 border-coral-200 bg-coral-50 px-4 py-3">
            <p role="alert" className="font-display text-sm font-bold text-coral-800">
              {chatError.message}
            </p>
            {chatError.hint && (
              <p className="mt-1 text-xs text-coral-800">{chatError.hint}</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2.5"
              onClick={() => void applyChatEdit(lastChatInstruction || chatInput)}
            >
              Retry
            </Button>
          </div>
        )}
      </Card>

      {/* Part 4 — Plan Check Panel */}
      <Card
        padding="lg"
        data-testid="plan-check-panel"
        className="space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle as="h3">Plan check</CardTitle>
              {!checkLoading && !checkError && (
                <Badge
                  tone={planWarnings.length > 0 ? "accent" : "mint"}
                  variant="soft"
                  size="sm"
                >
                  {planWarnings.length === 0
                    ? "All clear"
                    : `${planWarnings.length} suggestion${planWarnings.length === 1 ? "" : "s"}`}
                </Badge>
              )}
            </div>
            <CardDescription className="mt-1">
              Reviews your schedule for missing breaks, setup or cleanup gaps,
              and understaffed busy hours.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void runPlanCheck(plan)}
            disabled={checkLoading || chatLoading}
          >
            Re-check plan
          </Button>
        </div>

        {checkLoading && (
          <div
            role="status"
            aria-busy="true"
            className="rounded-2xl border border-navy-100 bg-cream-100 p-4 text-sm text-navy-600"
          >
            Checking the plan for break gaps, setup/cleanup coverage, and peak
            hours…
          </div>
        )}

        {!checkLoading && checkError && (
          <div className="rounded-xl border-2 border-coral-200 bg-coral-50 px-4 py-3">
            <p role="alert" className="font-display text-sm font-bold text-coral-800">
              {checkError.message}
            </p>
            {checkError.hint && (
              <p className="mt-1 text-xs text-coral-800">{checkError.hint}</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2.5"
              onClick={() => void runPlanCheck(plan)}
            >
              Retry
            </Button>
          </div>
        )}

        {!checkLoading && !checkError && planWarnings.length === 0 && (
          <div className="rounded-2xl border border-mint-200 bg-mint-50 px-4 py-3 text-sm font-medium text-navy-900">
            No staffing gaps found — setup, cleanup, break coverage, and busy
            hours look well balanced.
          </div>
        )}

        {!checkLoading && !checkError && planWarnings.length > 0 && (
          <ul className="space-y-3">
            {planWarnings.map((warning) => {
              const isFixingThis =
                chatLoading && fixingPrompt === warning.fixPrompt;
              return (
                <li
                  key={warning.id}
                  data-testid={`plan-warning-${warning.id}`}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border-2 border-accent-200 bg-accent-50 p-4"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-display text-sm font-bold text-navy-900">
                      {warning.title}
                    </p>
                    <p className="text-sm text-navy-700">{warning.detail}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={isFixingThis}
                    loadingLabel="Applying fix"
                    disabled={chatLoading}
                    onClick={() => void applyChatEdit(warning.fixPrompt)}
                  >
                    Apply fix
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Part 5 — Publish (Generate Event Description, Role Guides, Announcement → Edit → Save to Supabase) */}
      <Card
        variant={publishable ? "tinted" : "default"}
        padding="lg"
        data-testid="publish-section"
        className="space-y-5"
      >
        <div>
          <CardTitle as="h3">
            {publishable ? "Ready to publish" : "Fix the plan first"}
          </CardTitle>
          <CardDescription className="mt-1">
            {publishable
              ? `Publishing prepares a friendly event description, role instructions (what to do, what to wear or bring), and a group-chat announcement for your ${plan.roles.length} roles and ${totalShifts} shifts.`
              : "Every minute of the event needs someone scheduled, and each shift has to run 30 to 90 minutes."}
          </CardDescription>
        </div>

        {copyError && (
          <div className="rounded-xl border-2 border-coral-200 bg-coral-50 px-4 py-3">
            <p role="alert" className="font-display text-sm font-bold text-coral-800">
              {copyError.message}
            </p>
            {copyError.hint && (
              <p className="mt-1 text-xs text-coral-800">{copyError.hint}</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2.5"
              onClick={() => void preparePublishCopy()}
            >
              Retry
            </Button>
          </div>
        )}

        {!publishCopyReady ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              onClick={() => void preparePublishCopy()}
              disabled={!publishable || copyLoading}
              loading={copyLoading}
              loadingLabel="Writing event descriptions"
            >
              Publish event
            </Button>
            {touched && (
              <span className="text-sm text-navy-600">
                Unsaved changes stay on this page.
              </span>
            )}
          </div>
        ) : (
          <div
            data-testid="publish-review-panel"
            className="space-y-5 border-t border-navy-100 pt-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Badge tone="mint" variant="solid" size="sm">
                  Review &amp; edit before saving
                </Badge>
                <p className="mt-1.5 font-display text-base font-bold text-navy-900">
                  Check what volunteers will read
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void preparePublishCopy()}
                disabled={copyLoading || publishing}
              >
                Regenerate copy
              </Button>
            </div>

            {/* Friendly event description */}
            <div>
              <label
                htmlFor="publish-event-description"
                className="mb-1.5 block font-display text-sm font-semibold text-navy-900"
              >
                Event description
              </label>
              <textarea
                id="publish-event-description"
                rows={3}
                value={eventDescription}
                onChange={(event) => setEventDescription(event.target.value)}
                className="w-full rounded-2xl border-2 border-navy-100 bg-surface px-3.5 py-3 text-sm text-navy-900 focus-visible:border-navy-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-navy-900/20"
              />
              <p className="mt-1 text-xs text-navy-600">
                Shown at the top of your public signup page.
              </p>
            </div>

            {/* Optional location */}
            <Input
              label="Location (optional)"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Fremont Main Library, 2400 Stevenson Blvd"
            />

            {/* Plain-language role descriptions (what to do, what to wear or bring) */}
            <div className="space-y-3">
              <p className="font-display text-sm font-semibold text-navy-900">
                Role descriptions (what to do, what to wear or bring)
              </p>
              {plan.roles.map((role, idx) => (
                <div
                  key={`${idx}-${role.name}`}
                  className="rounded-2xl border border-navy-100 bg-surface p-3.5"
                >
                  <label
                    htmlFor={`publish-role-desc-${idx}`}
                    className="mb-1 block font-display text-xs font-bold text-navy-900"
                  >
                    {role.name}
                  </label>
                  <textarea
                    id={`publish-role-desc-${idx}`}
                    rows={2}
                    value={role.description}
                    onChange={(event) =>
                      updateRole(idx, { description: event.target.value })
                    }
                    className="w-full rounded-xl border-2 border-navy-100 bg-cream-100 px-3 py-2 text-sm text-navy-900 focus-visible:border-navy-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-navy-900/20"
                  />
                </div>
              ))}
            </div>

            {/* Short announcement message for group chat */}
            <div className="rounded-2xl border border-navy-100 bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="publish-announcement"
                  className="font-display text-sm font-semibold text-navy-900"
                >
                  Group-chat announcement
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyAnnouncementToClipboard()}
                >
                  Copy announcement
                </Button>
              </div>
              <textarea
                id="publish-announcement"
                ref={announcementRef}
                rows={3}
                value={announcement}
                onChange={(event) => setAnnouncement(event.target.value)}
                className="mt-2 w-full rounded-xl border-2 border-navy-100 bg-cream-100 px-3 py-2.5 text-sm text-navy-900 focus-visible:border-navy-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-navy-900/20"
              />
              {copiedNotice && (
                <p
                  role="status"
                  className="mt-2 text-xs font-medium text-mint-700"
                >
                  {copiedNotice}
                </p>
              )}
            </div>

            {publishError && (
              <div className="rounded-xl border-2 border-coral-200 bg-coral-50 px-3.5 py-3">
                <p
                  role="alert"
                  className="text-sm font-medium text-coral-800"
                >
                  {publishError}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2.5"
                  onClick={() => void saveAndPublish()}
                >
                  Retry saving
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={() => void saveAndPublish()}
                disabled={!publishable}
                loading={publishing}
                loadingLabel="Publishing your event"
              >
                Save &amp; publish event
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPublishCopyReady(false)}
                disabled={publishing}
              >
                Hide preview
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/** 540 → "09:00" for <input type="time">. */
function minutesToInput(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
