import {
  calculateRunningTotalHours,
  calculateShiftHours,
} from "@/lib/checkin/hours";

export const HOUR_MILESTONES = [10, 25, 50, 100] as const;

export type MilestoneBadgeStatus = {
  hours: (typeof HOUR_MILESTONES)[number];
  label: string;
  unlocked: boolean;
  progressPercent: number;
};

export type VolunteerUpcomingShift = {
  signupId: string;
  shiftId: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  location: string | null;
  timezone: string;
  roleName: string;
  startsAt: string;
  endsAt: string;
  status: "confirmed" | "pending" | "waitlist";
};

export type VolunteerPastEventEntry = {
  signupId: string;
  shiftId: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  eventDate: string;
  location: string | null;
  timezone: string;
  organizerName: string;
  roleName: string;
  startsAt: string;
  endsAt: string;
  hours: number;
  attended: boolean;
  verified: boolean;
  adjustedByOrganizer: boolean;
};

export type VolunteerDashboardStats = {
  totalVerifiedHours: number;
  eventsVolunteeredAt: number;
  shiftsAttended: number;
  shiftsSignedUp: number;
  reliabilityScorePercent: number;
  reliabilityRatio: number;
  overallMilestoneProgressPercent: number;
  nextMilestoneHours: number | null;
  hoursToNextMilestone: number;
  milestones: MilestoneBadgeStatus[];
  upcomingShifts: VolunteerUpcomingShift[];
  pastEvents: VolunteerPastEventEntry[];
};

export function calculateReliabilityScore(
  shiftsAttended: number,
  shiftsSignedUp: number,
): {
  attended: number;
  signedUp: number;
  ratio: number;
  percent: number;
} {
  const safeAttended = Math.max(0, shiftsAttended);
  const safeSignedUp = Math.max(0, shiftsSignedUp);
  if (safeSignedUp === 0) {
    return { attended: 0, signedUp: 0, ratio: 1, percent: 100 };
  }
  const ratio = Math.min(1, safeAttended / safeSignedUp);
  const percent = Math.round(ratio * 100);
  return {
    attended: safeAttended,
    signedUp: safeSignedUp,
    ratio: Math.round(ratio * 1000) / 1000,
    percent,
  };
}

export function buildMilestoneProgress(totalHours: number): {
  overallProgressPercent: number;
  nextMilestoneHours: number | null;
  hoursToNextMilestone: number;
  milestones: MilestoneBadgeStatus[];
} {
  const safeHours = Math.max(0, totalHours);
  const maxMilestone = HOUR_MILESTONES[HOUR_MILESTONES.length - 1];
  const overallProgressPercent = Math.min(
    100,
    Math.round((safeHours / maxMilestone) * 100),
  );

  const milestones: MilestoneBadgeStatus[] = HOUR_MILESTONES.map((m) => ({
    hours: m,
    label: `${m} hrs`,
    unlocked: safeHours >= m,
    progressPercent: Math.min(100, Math.round((safeHours / m) * 100)),
  }));

  const next = HOUR_MILESTONES.find((m) => safeHours < m) ?? null;
  const hoursToNextMilestone =
    next !== null ? Math.max(0, Math.round((next - safeHours) * 100) / 100) : 0;

  return {
    overallProgressPercent,
    nextMilestoneHours: next,
    hoursToNextMilestone,
    milestones,
  };
}

export type RawVolunteerSignupInput = {
  signupId: string;
  shiftId: string;
  status: "confirmed" | "pending" | "waitlist" | "cancelled";
  startsAt: string;
  endsAt: string;
  roleName: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  eventStartsAt: string;
  location: string | null;
  timezone: string;
  organizerName: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  verified: boolean;
  adjustedByOrganizer: boolean;
};

/**
 * Computes all Volunteer Dashboard stats, upcoming shifts, past events, and
 * milestone badges from raw signup + check-in records.
 */
export function buildVolunteerDashboardStats(
  items: ReadonlyArray<RawVolunteerSignupInput>,
  now: Date = new Date(),
): VolunteerDashboardStats {
  const nowMs = now.getTime();
  const activeItems = items.filter((item) => item.status !== "cancelled");

  const upcomingShifts: VolunteerUpcomingShift[] = [];
  const pastEvents: VolunteerPastEventEntry[] = [];

  for (const item of activeItems) {
    const endMs = new Date(item.endsAt).getTime();
    const hasCompletedCheckin = Boolean(item.checkedInAt && item.checkedOutAt);
    const hasCheckedIn = Boolean(item.checkedInAt);
    const isPastShift = endMs <= nowMs || hasCompletedCheckin;

    if (!isPastShift && !hasCheckedIn) {
      upcomingShifts.push({
        signupId: item.signupId,
        shiftId: item.shiftId,
        eventId: item.eventId,
        eventTitle: item.eventTitle,
        eventSlug: item.eventSlug,
        location: item.location,
        timezone: item.timezone,
        roleName: item.roleName,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        status: item.status === "cancelled" ? "confirmed" : item.status,
      });
    } else if (item.status === "confirmed" || item.status === "pending") {
      const hours = calculateShiftHours(item.checkedInAt, item.checkedOutAt);
      pastEvents.push({
        signupId: item.signupId,
        shiftId: item.shiftId,
        eventId: item.eventId,
        eventTitle: item.eventTitle,
        eventSlug: item.eventSlug,
        eventDate: item.eventStartsAt || item.startsAt,
        location: item.location,
        timezone: item.timezone,
        organizerName: item.organizerName || "Event Organizer",
        roleName: item.roleName,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        hours,
        attended: hasCheckedIn,
        verified: item.verified || hasCompletedCheckin,
        adjustedByOrganizer: item.adjustedByOrganizer,
      });
    }
  }

  upcomingShifts.sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  pastEvents.sort(
    (a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
  );

  const totalVerifiedHours = calculateRunningTotalHours(
    pastEvents.map((pe) => {
      const match = activeItems.find((i) => i.signupId === pe.signupId);
      return {
        checkedInAt: match?.checkedInAt ?? null,
        checkedOutAt: match?.checkedOutAt ?? null,
      };
    }),
  );

  const attendedEventsSet = new Set(
    pastEvents.filter((pe) => pe.attended && pe.hours > 0).map((pe) => pe.eventId),
  );
  const eventsVolunteeredAt = attendedEventsSet.size;

  // Reliability score: shifts attended divided by shifts signed up (for past/attended shifts,
  // or all confirmed signups if none have occurred yet)
  const confirmedPastCount = pastEvents.length;
  const shiftsAttended = pastEvents.filter((pe) => pe.attended).length;
  const shiftsSignedUp =
    confirmedPastCount > 0
      ? confirmedPastCount
      : activeItems.filter((i) => i.status === "confirmed").length;

  const reliability = calculateReliabilityScore(shiftsAttended, shiftsSignedUp);
  const milestoneInfo = buildMilestoneProgress(totalVerifiedHours);

  return {
    totalVerifiedHours,
    eventsVolunteeredAt,
    shiftsAttended: reliability.attended,
    shiftsSignedUp: reliability.signedUp,
    reliabilityScorePercent: reliability.percent,
    reliabilityRatio: reliability.ratio,
    overallMilestoneProgressPercent: milestoneInfo.overallProgressPercent,
    nextMilestoneHours: milestoneInfo.nextMilestoneHours,
    hoursToNextMilestone: milestoneInfo.hoursToNextMilestone,
    milestones: milestoneInfo.milestones,
    upcomingShifts,
    pastEvents,
  };
}
