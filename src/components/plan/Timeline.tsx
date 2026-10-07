"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { parseTime, toFriendlyTime } from "@/lib/planner/time";
import type { Plan, PlanIssue } from "@/lib/planner/types";

/**
 * Coverage picture. Each role gets a track; shifts are blocks positioned by
 * time. The bottom bar is the union of every shift — where it's coral, nobody
 * is scheduled.
 *
 * This is the fastest way to see whether a plan "covers the full event", which
 * is otherwise invisible in a list of times.
 */

const ROLE_COLORS = [
  "bg-accent-500",
  "bg-mint-500",
  "bg-coral-500",
  "bg-navy-400",
  "bg-accent-300",
  "bg-mint-300",
  "bg-navy-200",
];

export function Timeline({
  plan,
  windowStart,
  windowEnd,
}: {
  plan: Plan;
  windowStart: number | null;
  windowEnd: number | null;
}) {
  // Labels need room: on a narrow phone a 3-hour event can't fit four of them.
  // Measure the track and only label the hours that are far enough apart,
  // always keeping the two ends so the window is still readable.
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    const element = trackRef.current;
    if (!element) return;
    const measure = () => setTrackWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const intervals = plan.roles.flatMap((role) =>
    role.shifts.flatMap((shift) => {
      const start = parseTime(shift.start);
      const end = parseTime(shift.end);
      return start !== null && end !== null && end > start ? [{ start, end }] : [];
    }),
  );

  if (intervals.length === 0) return null;

  const from =
    windowStart ?? Math.min(...intervals.map((i) => i.start));
  const to = windowEnd ?? Math.max(...intervals.map((i) => i.end));
  const span = Math.max(1, to - from);

  const pct = (minutes: number) => ((minutes - from) / span) * 100;

  // Union coverage → gaps.
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }

  const gaps: { start: number; end: number }[] = [];
  let cursor = from;
  for (const span2 of merged) {
    if (span2.start > cursor) gaps.push({ start: cursor, end: Math.min(span2.start, to) });
    cursor = Math.max(cursor, span2.end);
  }
  if (cursor < to) gaps.push({ start: cursor, end: to });

  // Hour gridlines across the window.
  const ticks: number[] = [];
  for (let t = Math.ceil(from / 60) * 60; t <= to; t += 60) ticks.push(t);

  const LABEL_GAP_PX = 54; // a "10:30am" label plus breathing room
  const labelledTicks: number[] = [];
  let lastLabelPx = Number.NEGATIVE_INFINITY;
  const windowSpan = Math.max(1, to - from);
  ticks.forEach((tick, index) => {
    const px = ((tick - from) / windowSpan) * (trackWidth || 0);
    const isFirst = index === 0;
    const isLast = index === ticks.length - 1;
    if (isFirst || isLast) {
      labelledTicks.push(tick);
      lastLabelPx = px;
      return;
    }
    // Out in the middle: needs clearance on both sides.
    const endPx = ((ticks[ticks.length - 1] - from) / windowSpan) * (trackWidth || 0);
    if (trackWidth > 0 && px - lastLabelPx >= LABEL_GAP_PX && endPx - px >= LABEL_GAP_PX) {
      labelledTicks.push(tick);
      lastLabelPx = px;
    }
  });

  return (
    <figure className="space-y-2">
      <div className="relative overflow-hidden rounded-xl border border-navy-100 bg-cream-100 p-3">
        {/* gridlines */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-3">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute top-0 bottom-0 w-px bg-navy-100"
              style={{ left: `${pct(tick)}%` }}
            />
          ))}
        </div>

        <div className="relative space-y-1.5">
          {plan.roles.map((role, roleIndex) => (
            <div key={`${role.name}-${roleIndex}`} className="flex items-center gap-2">
              <span className="w-20 shrink-0 truncate text-right text-xs font-medium text-navy-600 sm:w-28">
                {role.name}
              </span>
              <div className="relative h-6 flex-1 rounded-md bg-cream-300/70">
                {role.shifts.map((shift) => {
                  const start = parseTime(shift.start);
                  const end = parseTime(shift.end);
                  if (start === null || end === null || end <= start) return null;
                  const left = pct(start);
                  const width = Math.max(1.5, pct(end) - left);
                  return (
                    <span
                      key={shift.id}
                      title={`${role.name} ${shift.start}–${shift.end} · ${shift.headcount} needed`}
                      className={cn(
                        "absolute top-0 bottom-0 rounded-md border border-navy-900/10",
                        ROLE_COLORS[roleIndex % ROLE_COLORS.length],
                        left < 0.5 && "rounded-l-none",
                      )}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* coverage strip */}
        <div className="relative mt-3 flex items-center gap-2">
          <span className="w-20 shrink-0 text-right text-xs font-semibold text-navy-900 sm:w-28">
            Covered
          </span>
          <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-cream-300">
            <span className="absolute inset-0 bg-mint-500" />
            {gaps.map((gap) => (
              <span
                key={gap.start}
                className="absolute top-0 bottom-0 bg-coral-500"
                style={{
                  left: `${pct(gap.start)}%`,
                  width: `${Math.max(0.6, pct(gap.end) - pct(gap.start))}%`,
                }}
              />
            ))}
          </div>
        </div>

        {/* axis */}
        <div className="relative mt-1.5 flex items-center gap-2">
          <span className="w-20 shrink-0 sm:w-28" />
          <div ref={trackRef} className="relative h-4 flex-1">
            {labelledTicks.map((tick) => {
              // Centre each hour under its gridline, except the ones at the
              // edges — centring those would push the text outside the track.
              const position = pct(tick);
              const shift =
                position <= 2
                  ? "translate-x-0"
                  : position >= 98
                    ? "-translate-x-full"
                    : "-translate-x-1/2";

              return (
                <span
                  key={tick}
                  className={`absolute ${shift} text-xs tabular-nums text-navy-600`}
                  style={{ left: `${position}%` }}
                >
                  {toFriendlyTime(tick)}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <figcaption className="text-xs text-navy-600">
        {gaps.length === 0
          ? "Every minute of the event is covered."
          : `${gaps.length} uncovered stretch${gaps.length === 1 ? "" : "es"} shown in coral.`}
      </figcaption>
    </figure>
  );
}

/** Flat list of error/warning messages for the banner above the editor. */
export function IssueList({ issues }: { issues: PlanIssue[] }) {
  if (issues.length === 0) return null;

  return (
    <ul className="space-y-1.5">
      {issues.map((issue, index) => (
        <li
          key={`${issue.message}-${index}`}
          className={cn(
            "flex gap-2 text-sm",
            issue.level === "error" ? "text-coral-800" : "text-navy-700",
          )}
        >
          <span aria-hidden="true" className="mt-0.5 shrink-0">
            {issue.level === "error" ? "●" : "○"}
          </span>
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}
