import { calculateShiftHours } from "./hours";

export type WhosHereStatus = "checked_in" | "not_yet_arrived" | "checked_out";
export type WhosHereStatusLabel = "checked in" | "not yet arrived" | "checked out";

export type WhosHereEntry = {
  signupId: string;
  volunteerId: string;
  volunteerName: string;
  volunteerEmail: string | null;
  roleId: string;
  roleName: string;
  shiftId: string;
  shiftStartsAt: string;
  shiftEndsAt: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  status: WhosHereStatus;
  statusLabel: WhosHereStatusLabel;
  hoursWorked: number | null;
  adjustedByOrganizer: boolean;
  verified: boolean;
};

export type RawRosterSignup = {
  id: string;
  shift_id: string;
  volunteer_id: string;
  status: string;
};

export type RawRosterShift = {
  id: string;
  role_id: string;
  starts_at: string;
  ends_at: string;
};

export type RawRosterRole = {
  id: string;
  name: string;
  position?: number;
};

export type RawRosterProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
};

export type RawRosterCheckin = {
  id: string;
  signup_id: string;
  kind: "in" | "out";
  at: string;
  verified?: boolean;
  method?: string | null;
  adjusted_by_organizer?: boolean;
};

export function statusToLabel(status: WhosHereStatus): WhosHereStatusLabel {
  switch (status) {
    case "checked_in":
      return "checked in";
    case "checked_out":
      return "checked out";
    case "not_yet_arrived":
      return "not yet arrived";
  }
}

/**
 * Builds the live "Who's here" list for an event from roles, shifts,
 * confirmed signups, volunteer profiles, and check-in records.
 */
export function buildWhosHereRoster(input: {
  roles: ReadonlyArray<RawRosterRole>;
  shifts: ReadonlyArray<RawRosterShift>;
  signups: ReadonlyArray<RawRosterSignup>;
  profiles: ReadonlyArray<RawRosterProfile>;
  checkins: ReadonlyArray<RawRosterCheckin>;
}): WhosHereEntry[] {
  const roleById = new Map(input.roles.map((r) => [r.id, r]));
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]));
  const profileById = new Map(input.profiles.map((p) => [p.id, p]));

  const inBySignup = new Map<string, RawRosterCheckin>();
  const outBySignup = new Map<string, RawRosterCheckin>();

  for (const c of input.checkins) {
    if (c.kind === "in") {
      const existing = inBySignup.get(c.signup_id);
      if (!existing || new Date(c.at).getTime() < new Date(existing.at).getTime()) {
        inBySignup.set(c.signup_id, c);
      }
    } else if (c.kind === "out") {
      const existing = outBySignup.get(c.signup_id);
      if (!existing || new Date(c.at).getTime() > new Date(existing.at).getTime()) {
        outBySignup.set(c.signup_id, c);
      }
    }
  }

  const entries: WhosHereEntry[] = [];

  for (const signup of input.signups) {
    if (signup.status !== "confirmed" && signup.status !== "pending") continue;
    const shift = shiftById.get(signup.shift_id);
    if (!shift) continue;
    const role = roleById.get(shift.role_id);
    if (!role) continue;
    const profile = profileById.get(signup.volunteer_id);

    const checkinIn = inBySignup.get(signup.id);
    const checkinOut = outBySignup.get(signup.id);

    const checkedInAt = checkinIn?.at ?? null;
    const checkedOutAt = checkinOut?.at ?? null;

    let status: WhosHereStatus = "not_yet_arrived";
    if (checkedInAt && checkedOutAt) {
      status = "checked_out";
    } else if (checkedInAt) {
      status = "checked_in";
    }

    const hoursWorked =
      checkedInAt && checkedOutAt
        ? calculateShiftHours(checkedInAt, checkedOutAt)
        : null;

    const adjustedByOrganizer = Boolean(
      checkinOut?.adjusted_by_organizer ||
        checkinOut?.method === "organizer_adjusted",
    );

    const verified = Boolean(
      (checkinIn?.verified ?? false) && (checkinOut ? checkinOut.verified : true),
    );

    const volunteerName =
      profile?.full_name?.trim() ||
      profile?.email?.split("@")[0] ||
      "Volunteer";

    entries.push({
      signupId: signup.id,
      volunteerId: signup.volunteer_id,
      volunteerName,
      volunteerEmail: profile?.email ?? null,
      roleId: role.id,
      roleName: role.name,
      shiftId: shift.id,
      shiftStartsAt: shift.starts_at,
      shiftEndsAt: shift.ends_at,
      checkedInAt,
      checkedOutAt,
      status,
      statusLabel: statusToLabel(status),
      hoursWorked,
      adjustedByOrganizer,
      verified,
    });
  }

  // Sort: checked_in first, then not_yet_arrived by shift start, then checked_out
  const statusRank: Record<WhosHereStatus, number> = {
    checked_in: 0,
    not_yet_arrived: 1,
    checked_out: 2,
  };

  entries.sort((a, b) => {
    const rankDiff = statusRank[a.status] - statusRank[b.status];
    if (rankDiff !== 0) return rankDiff;
    const startDiff =
      new Date(a.shiftStartsAt).getTime() - new Date(b.shiftStartsAt).getTime();
    if (startDiff !== 0) return startDiff;
    return a.volunteerName.localeCompare(b.volunteerName);
  });

  return entries;
}
