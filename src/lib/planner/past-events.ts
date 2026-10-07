import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { PastEventsSummary } from "@/lib/planner/types";

export type RawPastEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  roles?: {
    id: string;
    name: string;
    shifts?: {
      id: string;
      capacity: number;
      signups?: {
        id: string;
        status: string;
        checkins?: { id: string; kind: string; verified?: boolean }[];
      }[];
    }[];
  }[];
};

/**
 * Pure calculation for Part 6 (Learn from past events).
 *
 * Computes fill rates and no-show counts across the organizer's past events
 * (events whose `starts_at` is in the past relative to `nowMs`).
 * Returns null when there are no past events with shifts.
 */
export function summarizePastEvents(
  events: RawPastEvent[],
  nowMs: number = Date.now(),
): PastEventsSummary | null {
  if (!Array.isArray(events) || events.length === 0) return null;

  const pastOnly = events
    .filter((event) => {
      const t = new Date(event.ends_at ?? event.starts_at).getTime();
      return Number.isFinite(t) && t <= nowMs;
    })
    .sort(
      (a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime(),
    );

  if (pastOnly.length === 0) return null;

  let totalCapacity = 0;
  let filledCount = 0;
  let noShowCount = 0;
  let eventsWithShifts = 0;
  let lastEventTitle = "";

  for (const event of pastOnly) {
    const roles = event.roles ?? [];
    const shifts = roles.flatMap((r) => r.shifts ?? []);
    if (shifts.length === 0) continue;

    eventsWithShifts += 1;
    if (!lastEventTitle) lastEventTitle = event.title;

    for (const shift of shifts) {
      totalCapacity += Math.max(1, Number(shift.capacity) || 1);
      const signups = shift.signups ?? [];
      for (const signup of signups) {
        if (signup.status === "confirmed" || signup.status === "pending") {
          filledCount += 1;
          if (signup.status === "confirmed") {
            const checkedIn = (signup.checkins ?? []).some((c) => c.kind === "in");
            if (!checkedIn) {
              noShowCount += 1;
            }
          }
        }
      }
    }
  }

  if (eventsWithShifts === 0 || totalCapacity === 0) return null;

  const fillRatePct = Math.min(100, Math.round((filledCount / totalCapacity) * 100));

  const promptSummary = `Across ${eventsWithShifts} past event${eventsWithShifts === 1 ? "" : "s"} (most recently "${lastEventTitle}"), ${filledCount} of ${totalCapacity} shift spots were filled (${fillRatePct}% fill rate) with ${noShowCount} no-show${noShowCount === 1 ? "" : "s"}. Adjust headcounts and shift structure with this fill rate and no-show history in mind.`;

  const uiNote = `Adjusted based on your last event ("${lastEventTitle}" — ${fillRatePct}% fill rate, ${noShowCount} no-show${noShowCount === 1 ? "" : "s"}).`;

  return {
    eventCount: eventsWithShifts,
    lastEventTitle,
    totalCapacity,
    filledCount,
    fillRatePct,
    noShowCount,
    promptSummary,
    uiNote,
  };
}

/**
 * Loads the signed-in organizer's past events from Supabase and summarizes
 * their fill rates and no-show counts. Returns null if there is no past data.
 */
export async function loadOrganizerPastEventsSummary(
  supabase: SupabaseClient<Database>,
  organizerId: string,
): Promise<PastEventsSummary | null> {
  try {
    const { data, error } = await supabase
      .from("events")
      .select(
        "id, title, starts_at, ends_at, roles(id, name, shifts(id, capacity, signups(id, status, checkins(id, kind, verified))))",
      )
      .eq("organizer_id", organizerId)
      .order("starts_at", { ascending: false })
      .limit(10);

    if (error || !data || data.length === 0) return null;

    return summarizePastEvents(data as unknown as RawPastEvent[]);
  } catch {
    return null;
  }
}
