import { calculateShiftHours, formatHoursToTwoDecimals } from "@/lib/checkin/hours";
import { eventClock, eventDay, eventTimeRange } from "@/lib/events/format";

export type SignupsOverTimePoint = {
  dateKey: string;
  label: string;
  dailySignups: number;
  cumulativeSignups: number;
};

export type RoleFillRatePoint = {
  roleId: string;
  roleName: string;
  capacity: number;
  signedUp: number;
  attended: number;
  noShow: number;
  fillRatePercent: number;
};

export type AttendanceVsSignupsPoint = {
  name: string;
  signedUp: number;
  attended: number;
  noShow: number;
};

export type EventVolunteerHourRow = {
  signupId: string;
  volunteerId: string;
  volunteerName: string;
  volunteerEmail: string;
  roleName: string;
  shiftRange: string;
  attendanceStatus: "Checked out" | "Checked in" | "Not yet arrived";
  checkedInAt: string | null;
  checkedOutAt: string | null;
  hours: number;
  verified: boolean;
  adjustedByOrganizer: boolean;
};

export type OrganizerEventAnalytics = {
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  timezone: string;
  published: boolean;
  totalCapacity: number;
  confirmedSignups: number;
  fillRatePercent: number;
  checkedInCount: number;
  noShowCount: number;
  noShowRatePercent: number;
  totalVolunteerHours: number;
  signupsOverTime: SignupsOverTimePoint[];
  fillRatePerRole: RoleFillRatePoint[];
  attendanceVsSignups: AttendanceVsSignupsPoint[];
  volunteerRows: EventVolunteerHourRow[];
};

export type RawAnalyticsEvent = {
  id: string;
  title: string;
  slug: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  timezone: string;
  published: boolean;
  created_at?: string;
};

export type RawAnalyticsRole = {
  id: string;
  event_id: string;
  name: string;
  capacity: number;
  position?: number;
};

export type RawAnalyticsShift = {
  id: string;
  role_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
};

export type RawAnalyticsSignup = {
  id: string;
  shift_id: string;
  volunteer_id: string;
  status: string;
  created_at: string;
};

export type RawAnalyticsProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
};

export type RawAnalyticsCheckin = {
  id: string;
  signup_id: string;
  kind: "in" | "out";
  at: string;
  verified?: boolean;
  method?: string | null;
  adjusted_by_organizer?: boolean;
};

function shortMonthDay(isoOrDateKey: string): string {
  const d = new Date(
    isoOrDateKey.length === 10 ? `${isoOrDateKey}T12:00:00Z` : isoOrDateKey,
  );
  if (Number.isNaN(d.getTime())) return isoOrDateKey;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/**
 * Computes comprehensive organizer analytics for an event:
 * - Fill rate, checked-in count, no-show rate, total volunteer hours
 * - Signups over time (for Recharts line/area chart)
 * - Fill rate per role (for Recharts bar chart)
 * - Attendance vs signups (for Recharts grouped bar chart)
 * - Volunteer & hours rows (for CSV export, Thank volunteers, and AI Event recap)
 */
export function buildOrganizerEventAnalytics(input: {
  event: RawAnalyticsEvent;
  roles: ReadonlyArray<RawAnalyticsRole>;
  shifts: ReadonlyArray<RawAnalyticsShift>;
  signups: ReadonlyArray<RawAnalyticsSignup>;
  profiles: ReadonlyArray<RawAnalyticsProfile>;
  checkins: ReadonlyArray<RawAnalyticsCheckin>;
}): OrganizerEventAnalytics {
  const { event } = input;
  const eventRoles = [...input.roles]
    .filter((r) => r.event_id === event.id)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const roleIds = new Set(eventRoles.map((r) => r.id));
  const eventShifts = input.shifts.filter((s) => roleIds.has(s.role_id));
  const shiftById = new Map(eventShifts.map((s) => [s.id, s]));
  const roleById = new Map(eventRoles.map((r) => [r.id, r]));
  const profileById = new Map(input.profiles.map((p) => [p.id, p]));

  const activeSignups = input.signups.filter(
    (sg) =>
      shiftById.has(sg.shift_id) &&
      (sg.status === "confirmed" || sg.status === "pending"),
  );

  const inBySignup = new Map<string, RawAnalyticsCheckin>();
  const outBySignup = new Map<string, RawAnalyticsCheckin>();

  for (const c of input.checkins) {
    if (c.kind === "in" && !inBySignup.has(c.signup_id)) {
      inBySignup.set(c.signup_id, c);
    } else if (c.kind === "out") {
      outBySignup.set(c.signup_id, c);
    }
  }

  const eventHasStartedOrCheckinsExist =
    activeSignups.some((sg) => inBySignup.has(sg.id)) ||
    new Date(event.starts_at).getTime() <= Date.now();

  // Per-role capacity & fill rate & attendance
  const fillRatePerRole: RoleFillRatePoint[] = eventRoles.map((role) => {
    const roleShifts = eventShifts.filter((s) => s.role_id === role.id);
    const shiftCapacitySum = roleShifts.reduce(
      (sum, s) => sum + (s.capacity ?? 0),
      0,
    );
    const capacity = shiftCapacitySum > 0 ? shiftCapacitySum : role.capacity || 0;

    const roleShiftIds = new Set(roleShifts.map((s) => s.id));
    const roleSignups = activeSignups.filter((sg) =>
      roleShiftIds.has(sg.shift_id),
    );
    const signedUp = roleSignups.length;
    const attended = roleSignups.filter((sg) => inBySignup.has(sg.id)).length;
    const noShow = eventHasStartedOrCheckinsExist
      ? Math.max(0, signedUp - attended)
      : 0;
    const fillRatePercent =
      capacity > 0 ? Math.min(100, Math.round((signedUp / capacity) * 100)) : 0;

    return {
      roleId: role.id,
      roleName: role.name,
      capacity,
      signedUp,
      attended,
      noShow,
      fillRatePercent,
    };
  });

  const totalCapacity = fillRatePerRole.reduce((sum, r) => sum + r.capacity, 0);
  const confirmedSignups = activeSignups.length;
  const fillRatePercent =
    totalCapacity > 0
      ? Math.min(100, Math.round((confirmedSignups / totalCapacity) * 100))
      : 0;

  let checkedInCount = 0;
  let rawHoursTotal = 0;
  const volunteerRows: EventVolunteerHourRow[] = [];

  for (const sg of activeSignups) {
    const shift = shiftById.get(sg.shift_id);
    const role = shift ? roleById.get(shift.role_id) : undefined;
    if (!shift || !role) continue;

    const profile = profileById.get(sg.volunteer_id);
    const inRow = inBySignup.get(sg.id);
    const outRow = outBySignup.get(sg.id);

    if (inRow) checkedInCount += 1;

    const hours =
      inRow && outRow ? calculateShiftHours(inRow.at, outRow.at) : 0;
    rawHoursTotal += hours;

    const attendanceStatus: EventVolunteerHourRow["attendanceStatus"] =
      inRow && outRow
        ? "Checked out"
        : inRow
          ? "Checked in"
          : "Not yet arrived";

    const adjustedByOrganizer = Boolean(
      outRow?.adjusted_by_organizer || outRow?.method === "organizer_adjusted",
    );
    const verified = Boolean(inRow && outRow);

    volunteerRows.push({
      signupId: sg.id,
      volunteerId: sg.volunteer_id,
      volunteerName:
        profile?.full_name?.trim() ||
        profile?.email?.split("@")[0] ||
        "Volunteer",
      volunteerEmail: profile?.email ?? "",
      roleName: role.name,
      shiftRange: `${eventDay(shift.starts_at, event.timezone)} · ${eventTimeRange(
        shift.starts_at,
        shift.ends_at,
        event.timezone,
      )}`,
      attendanceStatus,
      checkedInAt: inRow?.at ?? null,
      checkedOutAt: outRow?.at ?? null,
      hours,
      verified,
      adjustedByOrganizer,
    });
  }

  const noShowCount = eventHasStartedOrCheckinsExist
    ? Math.max(0, confirmedSignups - checkedInCount)
    : 0;
  const noShowRatePercent =
    eventHasStartedOrCheckinsExist && confirmedSignups > 0
      ? Math.round((noShowCount / confirmedSignups) * 100)
      : 0;
  const totalVolunteerHours = Math.round(rawHoursTotal * 100) / 100;

  // Build Signups Over Time series
  const byDate = new Map<string, number>();
  for (const sg of activeSignups) {
    const dateKey = (sg.created_at || event.starts_at).slice(0, 10);
    byDate.set(dateKey, (byDate.get(dateKey) ?? 0) + 1);
  }

  const sortedDateKeys = Array.from(byDate.keys()).sort();
  const signupsOverTime: SignupsOverTimePoint[] = [];

  if (sortedDateKeys.length === 0) {
    const baseKey = (event.created_at || event.starts_at).slice(0, 10);
    signupsOverTime.push({
      dateKey: baseKey,
      label: shortMonthDay(baseKey),
      dailySignups: 0,
      cumulativeSignups: 0,
    });
  } else {
    // Ensure at least a baseline start point if all signups landed on a single day
    if (sortedDateKeys.length === 1) {
      const onlyDate = new Date(`${sortedDateKeys[0]}T12:00:00Z`);
      const prevDate = new Date(onlyDate.getTime() - 24 * 3600 * 1000);
      const prevKey = prevDate.toISOString().slice(0, 10);
      signupsOverTime.push({
        dateKey: prevKey,
        label: shortMonthDay(prevKey),
        dailySignups: 0,
        cumulativeSignups: 0,
      });
    }

    let running = 0;
    for (const key of sortedDateKeys) {
      const daily = byDate.get(key) ?? 0;
      running += daily;
      signupsOverTime.push({
        dateKey: key,
        label: shortMonthDay(key),
        dailySignups: daily,
        cumulativeSignups: running,
      });
    }
  }

  const attendanceVsSignups: AttendanceVsSignupsPoint[] = fillRatePerRole.map(
    (r) => ({
      name: r.roleName,
      signedUp: r.signedUp,
      attended: r.attended,
      noShow: r.noShow,
    }),
  );

  return {
    eventId: event.id,
    eventTitle: event.title,
    eventSlug: event.slug,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    location: event.location,
    timezone: event.timezone,
    published: event.published,
    totalCapacity,
    confirmedSignups,
    fillRatePercent,
    checkedInCount,
    noShowCount,
    noShowRatePercent,
    totalVolunteerHours,
    signupsOverTime,
    fillRatePerRole,
    attendanceVsSignups,
    volunteerRows,
  };
}

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates an RFC-4180 CSV string of volunteers and hours for an event.
 */
export function buildEventVolunteersCsv(
  analytics: OrganizerEventAnalytics,
): string {
  const headers = [
    "Event",
    "Volunteer Name",
    "Email",
    "Role",
    "Shift",
    "Status",
    "Check-In Time",
    "Check-Out Time",
    "Hours Worked",
    "Verified",
    "Adjusted By Organizer",
  ];

  const lines = [headers.map(escapeCsvCell).join(",")];

  for (const row of analytics.volunteerRows) {
    const inStr = row.checkedInAt
      ? eventClock(row.checkedInAt, analytics.timezone)
      : "";
    const outStr = row.checkedOutAt
      ? eventClock(row.checkedOutAt, analytics.timezone)
      : "";

    lines.push(
      [
        analytics.eventTitle,
        row.volunteerName,
        row.volunteerEmail,
        row.roleName,
        row.shiftRange,
        row.attendanceStatus,
        inStr,
        outStr,
        formatHoursToTwoDecimals(row.hours),
        row.verified ? "Yes" : "No",
        row.adjustedByOrganizer ? "Yes" : "No",
      ]
        .map(escapeCsvCell)
        .join(","),
    );
  }

  return lines.join("\r\n");
}
