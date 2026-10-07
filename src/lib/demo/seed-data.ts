import type {
  Checkin,
  EventRow,
  Profile,
  RoleRow,
  Shift,
  Signup,
} from "@/lib/supabase/database.types";

export const DEMO_PASSWORD = "ShiftShareDemo2026!";
export const DEMO_COOKIE_NAME = "shiftshare_demo_role";

export const DEMO_ORGANIZER_ID = "de000000-0000-4000-8000-000000000001";
export const DEMO_VOLUNTEER_ID = "de000000-0000-4000-8000-000000000101";

export const FALL_CARNIVAL_EVENT_ID = "e0000000-0000-4000-8000-00000000f001";
export const PAST_HARVEST_EVENT_ID = "e0000000-0000-4000-8000-00000000f002";
export const PAST_LIBRARY_EVENT_ID = "e0000000-0000-4000-8000-00000000f003";
export const PAST_PARK_EVENT_ID = "e0000000-0000-4000-8000-00000000f004";

function makeProfile(
  row: Omit<Profile, "phone" | "updated_at"> & { phone?: string | null },
): Profile {
  return {
    phone: row.phone ?? null,
    updated_at: row.created_at,
    ...row,
  };
}

function makeEvent(row: Omit<EventRow, "updated_at">): EventRow {
  return {
    updated_at: row.created_at,
    ...row,
  };
}

function makeRole(row: Omit<RoleRow, "updated_at">): RoleRow {
  return {
    updated_at: row.created_at,
    ...row,
  };
}

function makeShift(row: Omit<Shift, "updated_at">): Shift {
  return {
    updated_at: row.created_at,
    ...row,
  };
}

function makeSignup(
  row: Omit<Signup, "note" | "updated_at"> & { note?: string | null },
): Signup {
  return {
    note: row.note ?? null,
    reminder_sent: row.reminder_sent ?? false,
    updated_at: row.created_at,
    ...row,
  };
}

function makeCheckin(
  row: Omit<Checkin, "verified_by" | "verified_at" | "created_at">,
): Checkin {
  return {
    verified_by: null,
    verified_at: row.at,
    created_at: row.at,
    ...row,
  };
}

/**
 * 1 Organizer + 15 Volunteer accounts with realistic names.
 */
export const DEMO_PROFILES: Profile[] = [
  makeProfile({
    id: DEMO_ORGANIZER_ID,
    email: "maya.lin@demo.shiftshare.app",
    full_name: "Maya Lin",
    role: "organizer",
    verification_code: "SS-DE00000001",
    created_at: "2026-08-15T16:00:00.000Z",
  }),
  makeProfile({
    id: DEMO_VOLUNTEER_ID,
    email: "carol.diaz@demo.shiftshare.app",
    full_name: "Carol Diaz",
    role: "volunteer",
    verification_code: "SS-DE00000101",
    created_at: "2026-08-16T16:00:00.000Z",
  }),
  makeProfile({
    id: "de000000-0000-4000-8000-000000000102",
    email: "marcus.vance@demo.shiftshare.app",
    full_name: "Marcus Vance",
    role: "volunteer",
    verification_code: "SS-DE00000102",
    created_at: "2026-08-17T16:00:00.000Z",
  }),
  makeProfile({
    id: "de000000-0000-4000-8000-000000000103",
    email: "priya.nair@demo.shiftshare.app",
    full_name: "Priya Nair",
    role: "volunteer",
    verification_code: "SS-DE00000103",
    created_at: "2026-08-18T16:00:00.000Z",
  }),
  makeProfile({
    id: "de000000-0000-4000-8000-000000000104",
    email: "elena.rostova@demo.shiftshare.app",
    full_name: "Elena Rostova",
    role: "volunteer",
    verification_code: "SS-DE00000104",
    created_at: "2026-08-19T16:00:00.000Z",
  }),
  makeProfile({
    id: "de000000-0000-4000-8000-000000000105",
    email: "jordan.brooks@demo.shiftshare.app",
    full_name: "Jordan Brooks",
    role: "volunteer",
    verification_code: "SS-DE00000105",
    created_at: "2026-08-20T16:00:00.000Z",
  }),
  makeProfile({
    id: "de000000-0000-4000-8000-000000000106",
    email: "samira.haddad@demo.shiftshare.app",
    full_name: "Samira Haddad",
    role: "volunteer",
    verification_code: "SS-DE00000106",
    created_at: "2026-08-21T16:00:00.000Z",
  }),
  makeProfile({
    id: "de000000-0000-4000-8000-000000000107",
    email: "devon.patel@demo.shiftshare.app",
    full_name: "Devon Patel",
    role: "volunteer",
    verification_code: "SS-DE00000107",
    created_at: "2026-08-22T16:00:00.000Z",
  }),
  makeProfile({
    id: "de000000-0000-4000-8000-000000000108",
    email: "hannah.kim@demo.shiftshare.app",
    full_name: "Hannah Kim",
    role: "volunteer",
    verification_code: "SS-DE00000108",
    created_at: "2026-08-23T16:00:00.000Z",
  }),
  makeProfile({
    id: "de000000-0000-4000-8000-000000000109",
    email: "liam.oconnor@demo.shiftshare.app",
    full_name: "Liam O'Connor",
    role: "volunteer",
    verification_code: "SS-DE00000109",
    created_at: "2026-08-24T16:00:00.000Z",
  }),
  makeProfile({
    id: "de000000-0000-4000-8000-000000000110",
    email: "nadia.almansoor@demo.shiftshare.app",
    full_name: "Nadia Al-Mansoor",
    role: "volunteer",
    verification_code: "SS-DE00000110",
    created_at: "2026-08-25T16:00:00.000Z",
  }),
  makeProfile({
    id: "de000000-0000-4000-8000-000000000111",
    email: "mateo.morales@demo.shiftshare.app",
    full_name: "Mateo Morales",
    role: "volunteer",
    verification_code: "SS-DE00000111",
    created_at: "2026-08-26T16:00:00.000Z",
  }),
  makeProfile({
    id: "de000000-0000-4000-8000-000000000112",
    email: "chloe.bennett@demo.shiftshare.app",
    full_name: "Chloe Bennett",
    role: "volunteer",
    verification_code: "SS-DE00000112",
    created_at: "2026-08-27T16:00:00.000Z",
  }),
  makeProfile({
    id: "de000000-0000-4000-8000-000000000113",
    email: "tariq.johnson@demo.shiftshare.app",
    full_name: "Tariq Johnson",
    role: "volunteer",
    verification_code: "SS-DE00000113",
    created_at: "2026-08-28T16:00:00.000Z",
  }),
  makeProfile({
    id: "de000000-0000-4000-8000-000000000114",
    email: "grace.cho@demo.shiftshare.app",
    full_name: "Grace Cho",
    role: "volunteer",
    verification_code: "SS-DE00000114",
    created_at: "2026-08-29T16:00:00.000Z",
  }),
  makeProfile({
    id: "de000000-0000-4000-8000-000000000115",
    email: "lucas.ferreira@demo.shiftshare.app",
    full_name: "Lucas Ferreira",
    role: "volunteer",
    verification_code: "SS-DE00000115",
    created_at: "2026-08-30T16:00:00.000Z",
  }),
];

export const DEMO_EVENTS: EventRow[] = [
  makeEvent({
    id: FALL_CARNIVAL_EVENT_ID,
    organizer_id: DEMO_ORGANIZER_ID,
    slug: "fall-carnival",
    title: "Fall Carnival",
    description:
      "Annual school and neighborhood Fall Carnival at Central Park Pavilion with game booths, apple cider & food stands, prize tables, and family activities.",
    location: "Central Park Pavilion, Fremont, CA",
    timezone: "America/Los_Angeles",
    starts_at: "2026-10-17T15:00:00.000Z",
    ends_at: "2026-10-17T23:00:00.000Z",
    published: true,
    checkin_token:
      "fc11223344556677889900aabbccddeeff11223344556677889900aabbccddee",
    created_at: "2026-09-25T16:00:00.000Z",
  }),
  makeEvent({
    id: PAST_HARVEST_EVENT_ID,
    organizer_id: DEMO_ORGANIZER_ID,
    slug: "neighborhood-harvest-festival",
    title: "Neighborhood Harvest & Book Festival",
    description:
      "Community book swap, harvest produce tables, and family reading corners at Fremont Main Library Plaza.",
    location: "Fremont Main Library Plaza, Fremont, CA",
    timezone: "America/Los_Angeles",
    starts_at: "2026-09-26T16:00:00.000Z",
    ends_at: "2026-09-26T22:00:00.000Z",
    published: true,
    checkin_token:
      "nh11223344556677889900aabbccddeeff11223344556677889900aabbccddee",
    created_at: "2026-09-10T16:00:00.000Z",
  }),
  makeEvent({
    id: PAST_LIBRARY_EVENT_ID,
    organizer_id: DEMO_ORGANIZER_ID,
    slug: "fremont-library-book-drive",
    title: "Fremont Library Book Sorting & Drive",
    description:
      "Cataloging donated children's books and packing classroom literacy crates for local elementary schools.",
    location: "Fremont Main Library, Fremont, CA",
    timezone: "America/Los_Angeles",
    starts_at: "2026-09-12T15:00:00.000Z",
    ends_at: "2026-09-13T03:00:00.000Z",
    published: true,
    checkin_token:
      "lb11223344556677889900aabbccddeeff11223344556677889900aabbccddee",
    created_at: "2026-09-01T16:00:00.000Z",
  }),
  makeEvent({
    id: PAST_PARK_EVENT_ID,
    organizer_id: DEMO_ORGANIZER_ID,
    slug: "lake-elizabeth-shoreline-cleanup",
    title: "Lake Elizabeth Shoreline Cleanup",
    description:
      "Morning shoreline restoration, mulch spreading, and native plant care around Lake Elizabeth.",
    location: "Lake Elizabeth Boathouse, Fremont, CA",
    timezone: "America/Los_Angeles",
    starts_at: "2026-09-19T15:00:00.000Z",
    ends_at: "2026-09-20T02:00:00.000Z",
    published: true,
    checkin_token:
      "pk11223344556677889900aabbccddeeff11223344556677889900aabbccddee",
    created_at: "2026-09-05T16:00:00.000Z",
  }),
];

/**
 * Roles:
 * - 6 roles on "Fall Carnival": Registration, Food Stand, Games, Setup, Cleanup, First Aid Helpers
 * - 4 roles on "Neighborhood Harvest & Book Festival" (past completed event)
 * - 1 role each on the two additional past events for rich volunteer history
 */
export const DEMO_ROLES: RoleRow[] = [
  makeRole({
    id: "d0000000-0000-4000-8000-000000000201",
    event_id: FALL_CARNIVAL_EVENT_ID,
    name: "Registration",
    description:
      "Greet families at the main gate, scan tickets, and hand out carnival wristbands and maps.",
    capacity: 12,
    position: 0,
    created_at: "2026-09-25T16:00:00.000Z",
  }),
  makeRole({
    id: "d0000000-0000-4000-8000-000000000202",
    event_id: FALL_CARNIVAL_EVENT_ID,
    name: "Food Stand",
    description:
      "Serve warm apple cider, popcorn, and bake-sale treats; keep serving counters restocked.",
    capacity: 12,
    position: 1,
    created_at: "2026-09-25T16:00:00.000Z",
  }),
  makeRole({
    id: "d0000000-0000-4000-8000-000000000203",
    event_id: FALL_CARNIVAL_EVENT_ID,
    name: "Games",
    description:
      "Run ring toss, pumpkin bowling, and bean-bag booths; reset game props and award stamps.",
    capacity: 12,
    position: 2,
    created_at: "2026-09-25T16:00:00.000Z",
  }),
  makeRole({
    id: "d0000000-0000-4000-8000-000000000204",
    event_id: FALL_CARNIVAL_EVENT_ID,
    name: "Setup",
    description:
      "Unload canopies, arrange tables and directional signs, and set up booth banners before doors open.",
    capacity: 10,
    position: 3,
    created_at: "2026-09-25T16:00:00.000Z",
  }),
  makeRole({
    id: "d0000000-0000-4000-8000-000000000205",
    event_id: FALL_CARNIVAL_EVENT_ID,
    name: "Cleanup",
    description:
      "Fold tables, pack game crates, sort recycling and compost, and leave the pavilion spotless.",
    capacity: 10,
    position: 4,
    created_at: "2026-09-25T16:00:00.000Z",
  }),
  makeRole({
    id: "d0000000-0000-4000-8000-000000000206",
    event_id: FALL_CARNIVAL_EVENT_ID,
    name: "First Aid Helpers",
    description:
      "Staff the shade & water station, hand out bandages and ice packs, and assist lost-and-found.",
    capacity: 10,
    position: 5,
    created_at: "2026-09-25T16:00:00.000Z",
  }),

  makeRole({
    id: "d0000000-0000-4000-8000-000000000301",
    event_id: PAST_HARVEST_EVENT_ID,
    name: "Welcome & Check-in Desk",
    description: "Check in attendees and distribute book-swap tokens.",
    capacity: 4,
    position: 0,
    created_at: "2026-09-10T16:00:00.000Z",
  }),
  makeRole({
    id: "d0000000-0000-4000-8000-000000000302",
    event_id: PAST_HARVEST_EVENT_ID,
    name: "Book Exchange Booth",
    description: "Sort incoming books by grade level and help families browse.",
    capacity: 4,
    position: 1,
    created_at: "2026-09-10T16:00:00.000Z",
  }),
  makeRole({
    id: "d0000000-0000-4000-8000-000000000303",
    event_id: PAST_HARVEST_EVENT_ID,
    name: "Cider & Bake Stand",
    description: "Pour hot apple cider and manage the community bake table.",
    capacity: 4,
    position: 2,
    created_at: "2026-09-10T16:00:00.000Z",
  }),
  makeRole({
    id: "d0000000-0000-4000-8000-000000000304",
    event_id: PAST_HARVEST_EVENT_ID,
    name: "Teardown & Cleanup Crew",
    description: "Box leftover books for library donation and fold tables.",
    capacity: 4,
    position: 3,
    created_at: "2026-09-10T16:00:00.000Z",
  }),

  makeRole({
    id: "d0000000-0000-4000-8000-000000000401",
    event_id: PAST_LIBRARY_EVENT_ID,
    name: "Book Sorting Lead",
    description: "Lead volunteer sorting teams and label school literacy boxes.",
    capacity: 4,
    position: 0,
    created_at: "2026-09-01T16:00:00.000Z",
  }),
  makeRole({
    id: "d0000000-0000-4000-8000-000000000501",
    event_id: PAST_PARK_EVENT_ID,
    name: "Shoreline Stewardship Lead",
    description: "Coordinate trail teams and tool check-out at the boathouse.",
    capacity: 4,
    position: 0,
    created_at: "2026-09-05T16:00:00.000Z",
  }),
];

function buildDemoShiftsAndSignups() {
  const shifts: Shift[] = [];
  const signups: Signup[] = [];
  const checkins: Checkin[] = [];

  const volunteerIds = DEMO_PROFILES.filter((p) => p.role === "volunteer").map(
    (p) => p.id,
  );

  const fallRoleSpecs = [
    {
      roleId: "d0000000-0000-4000-8000-000000000201", // Registration (6 shifts)
      hoursUtc: [16, 17, 18, 19, 20, 21],
    },
    {
      roleId: "d0000000-0000-4000-8000-000000000202", // Food Stand (6 shifts)
      hoursUtc: [16, 17, 18, 19, 20, 21],
    },
    {
      roleId: "d0000000-0000-4000-8000-000000000203", // Games (6 shifts)
      hoursUtc: [16, 17, 18, 19, 20, 21],
    },
    {
      roleId: "d0000000-0000-4000-8000-000000000204", // Setup (5 shifts)
      hoursUtc: [15, 16, 17, 18, 19],
    },
    {
      roleId: "d0000000-0000-4000-8000-000000000205", // Cleanup (5 shifts)
      hoursUtc: [18, 19, 20, 21, 22],
    },
    {
      roleId: "d0000000-0000-4000-8000-000000000206", // First Aid Helpers (5 shifts)
      hoursUtc: [16, 17, 18, 19, 20],
    },
  ];

  const volunteerBusyHours = new Map<string, Set<number>>();
  for (const vid of volunteerIds) {
    volunteerBusyHours.set(vid, new Set());
  }

  let shiftCounter = 1;
  let signupCounter = 1;

  for (const spec of fallRoleSpecs) {
    for (const h of spec.hoursUtc) {
      const shiftId = `f0000000-0000-4000-8000-${String(shiftCounter).padStart(12, "0")}`;
      shiftCounter++;

      const startStr = `2026-10-17T${String(h).padStart(2, "0")}:00:00.000Z`;
      const endStr = `2026-10-17T${String(h + 1).padStart(2, "0")}:00:00.000Z`;

      shifts.push(
        makeShift({
          id: shiftId,
          role_id: spec.roleId,
          starts_at: startStr,
          ends_at: endStr,
          capacity: 2,
          created_at: "2026-09-25T16:00:00.000Z",
        }),
      );

      const idx = shiftCounter - 1;
      const desiredConfirmed = idx % 5 === 0 ? 1 : 2;
      let addedConfirmed = 0;

      const candidateOrder =
        idx === 1 || idx === 9
          ? volunteerIds
          : [
              ...volunteerIds.slice((idx * 2) % volunteerIds.length),
              ...volunteerIds.slice(0, (idx * 2) % volunteerIds.length),
            ];

      for (const vid of candidateOrder) {
        if (addedConfirmed >= desiredConfirmed) break;
        const busy = volunteerBusyHours.get(vid)!;
        if (busy.has(h)) continue;
        busy.add(h);
        addedConfirmed++;

        const dayOffset = (signupCounter % 6) + 1;
        signups.push(
          makeSignup({
            id: `a0000000-0000-4000-8000-${String(signupCounter).padStart(12, "0")}`,
            shift_id: shiftId,
            volunteer_id: vid,
            status: "confirmed",
            created_at: `2026-10-0${dayOffset}T14:00:00.000Z`,
          }),
        );
        signupCounter++;
      }

      if ((idx === 1 || idx === 7 || idx === 13) && addedConfirmed === 2) {
        const standbyVid = volunteerIds[(idx + 11) % volunteerIds.length];
        signups.push(
          makeSignup({
            id: `a0000000-0000-4000-8000-${String(signupCounter).padStart(12, "0")}`,
            shift_id: shiftId,
            volunteer_id: standbyVid,
            status: "waitlist",
            created_at: "2026-10-05T18:00:00.000Z",
          }),
        );
        signupCounter++;
      }
    }
  }

  const harvestShiftSpecs: Array<{
    id: string;
    roleId: string;
    startsAt: string;
    endsAt: string;
    capacity: number;
    volunteers: Array<{
      vid: string;
      attended: boolean;
      createdDay: string;
      adjusted?: boolean;
    }>;
  }> = [
    {
      id: "f0000000-0000-4000-8000-000000000301",
      roleId: "d0000000-0000-4000-8000-000000000301",
      startsAt: "2026-09-26T16:00:00.000Z",
      endsAt: "2026-09-26T19:00:00.000Z",
      capacity: 2,
      volunteers: [
        { vid: volunteerIds[0], attended: true, createdDay: "2026-09-20" },
        { vid: volunteerIds[1], attended: true, createdDay: "2026-09-20", adjusted: true },
      ],
    },
    {
      id: "f0000000-0000-4000-8000-000000000302",
      roleId: "d0000000-0000-4000-8000-000000000301",
      startsAt: "2026-09-26T19:00:00.000Z",
      endsAt: "2026-09-26T22:00:00.000Z",
      capacity: 2,
      volunteers: [
        { vid: volunteerIds[2], attended: true, createdDay: "2026-09-21" },
        { vid: volunteerIds[3], attended: true, createdDay: "2026-09-21" },
      ],
    },
    {
      id: "f0000000-0000-4000-8000-000000000303",
      roleId: "d0000000-0000-4000-8000-000000000302",
      startsAt: "2026-09-26T16:00:00.000Z",
      endsAt: "2026-09-26T19:00:00.000Z",
      capacity: 2,
      volunteers: [
        { vid: volunteerIds[4], attended: true, createdDay: "2026-09-22" },
        { vid: volunteerIds[5], attended: true, createdDay: "2026-09-22" },
      ],
    },
    {
      id: "f0000000-0000-4000-8000-000000000304",
      roleId: "d0000000-0000-4000-8000-000000000302",
      startsAt: "2026-09-26T19:00:00.000Z",
      endsAt: "2026-09-26T22:00:00.000Z",
      capacity: 2,
      volunteers: [
        { vid: volunteerIds[6], attended: true, createdDay: "2026-09-23" },
        { vid: volunteerIds[7], attended: true, createdDay: "2026-09-23" },
      ],
    },
    {
      id: "f0000000-0000-4000-8000-000000000305",
      roleId: "d0000000-0000-4000-8000-000000000303",
      startsAt: "2026-09-26T16:00:00.000Z",
      endsAt: "2026-09-26T19:00:00.000Z",
      capacity: 2,
      volunteers: [
        { vid: volunteerIds[8], attended: true, createdDay: "2026-09-24" },
        { vid: volunteerIds[9], attended: true, createdDay: "2026-09-24" },
      ],
    },
    {
      id: "f0000000-0000-4000-8000-000000000306",
      roleId: "d0000000-0000-4000-8000-000000000303",
      startsAt: "2026-09-26T19:00:00.000Z",
      endsAt: "2026-09-26T22:00:00.000Z",
      capacity: 2,
      volunteers: [
        { vid: volunteerIds[10], attended: true, createdDay: "2026-09-24" },
      ],
    },
    {
      id: "f0000000-0000-4000-8000-000000000307",
      roleId: "d0000000-0000-4000-8000-000000000304",
      startsAt: "2026-09-26T19:00:00.000Z",
      endsAt: "2026-09-26T22:00:00.000Z",
      capacity: 2,
      volunteers: [
        { vid: volunteerIds[11], attended: true, createdDay: "2026-09-25" },
        { vid: volunteerIds[12], attended: false, createdDay: "2026-09-25" },
      ],
    },
    {
      id: "f0000000-0000-4000-8000-000000000308",
      roleId: "d0000000-0000-4000-8000-000000000304",
      startsAt: "2026-09-26T20:00:00.000Z",
      endsAt: "2026-09-26T22:00:00.000Z",
      capacity: 2,
      volunteers: [
        { vid: volunteerIds[13], attended: false, createdDay: "2026-09-25" },
      ],
    },
  ];

  let checkinCounter = 1;

  for (const spec of harvestShiftSpecs) {
    shifts.push(
      makeShift({
        id: spec.id,
        role_id: spec.roleId,
        starts_at: spec.startsAt,
        ends_at: spec.endsAt,
        capacity: spec.capacity,
        created_at: "2026-09-10T16:00:00.000Z",
      }),
    );

    for (const v of spec.volunteers) {
      const signupId = `a0000000-0000-4000-8000-${String(signupCounter).padStart(12, "0")}`;
      signupCounter++;

      signups.push(
        makeSignup({
          id: signupId,
          shift_id: spec.id,
          volunteer_id: v.vid,
          status: "confirmed",
          created_at: `${v.createdDay}T15:00:00.000Z`,
        }),
      );

      if (v.attended) {
        checkins.push(
          makeCheckin({
            id: `c0000000-0000-4000-8000-${String(checkinCounter++).padStart(12, "0")}`,
            signup_id: signupId,
            kind: "in",
            method: "qr",
            verified: true,
            adjusted_by_organizer: false,
            at: spec.startsAt,
          }),
        );
        checkins.push(
          makeCheckin({
            id: `c0000000-0000-4000-8000-${String(checkinCounter++).padStart(12, "0")}`,
            signup_id: signupId,
            kind: "out",
            method: v.adjusted ? "organizer_adjusted" : "qr",
            verified: true,
            adjusted_by_organizer: Boolean(v.adjusted),
            at: spec.endsAt,
          }),
        );
      }
    }
  }

  const shiftLibraryId = "f0000000-0000-4000-8000-000000000401";
  shifts.push(
    makeShift({
      id: shiftLibraryId,
      role_id: "d0000000-0000-4000-8000-000000000401",
      starts_at: "2026-09-12T15:00:00.000Z",
      ends_at: "2026-09-13T03:00:00.000Z",
      capacity: 4,
      created_at: "2026-09-01T16:00:00.000Z",
    }),
  );
  for (const vid of [
    DEMO_VOLUNTEER_ID,
    volunteerIds[1],
    volunteerIds[2],
    volunteerIds[3],
  ]) {
    const signupLibraryId = `a0000000-0000-4000-8000-${String(signupCounter++).padStart(12, "0")}`;
    signups.push(
      makeSignup({
        id: signupLibraryId,
        shift_id: shiftLibraryId,
        volunteer_id: vid,
        status: "confirmed",
        created_at: "2026-09-05T15:00:00.000Z",
      }),
    );
    checkins.push(
      makeCheckin({
        id: `c0000000-0000-4000-8000-${String(checkinCounter++).padStart(12, "0")}`,
        signup_id: signupLibraryId,
        kind: "in",
        method: "qr",
        verified: true,
        adjusted_by_organizer: false,
        at: "2026-09-12T15:00:00.000Z",
      }),
      makeCheckin({
        id: `c0000000-0000-4000-8000-${String(checkinCounter++).padStart(12, "0")}`,
        signup_id: signupLibraryId,
        kind: "out",
        method: "qr",
        verified: true,
        adjusted_by_organizer: false,
        at: "2026-09-13T03:00:00.000Z",
      }),
    );
  }

  const shiftParkId = "f0000000-0000-4000-8000-000000000501";
  shifts.push(
    makeShift({
      id: shiftParkId,
      role_id: "d0000000-0000-4000-8000-000000000501",
      starts_at: "2026-09-19T15:00:00.000Z",
      ends_at: "2026-09-20T02:30:00.000Z",
      capacity: 4,
      created_at: "2026-09-05T16:00:00.000Z",
    }),
  );
  for (const vid of [
    DEMO_VOLUNTEER_ID,
    volunteerIds[4],
    volunteerIds[5],
    volunteerIds[6],
  ]) {
    const signupParkId = `a0000000-0000-4000-8000-${String(signupCounter++).padStart(12, "0")}`;
    signups.push(
      makeSignup({
        id: signupParkId,
        shift_id: shiftParkId,
        volunteer_id: vid,
        status: "confirmed",
        created_at: "2026-09-10T15:00:00.000Z",
      }),
    );
    checkins.push(
      makeCheckin({
        id: `c0000000-0000-4000-8000-${String(checkinCounter++).padStart(12, "0")}`,
        signup_id: signupParkId,
        kind: "in",
        method: "qr",
        verified: true,
        adjusted_by_organizer: false,
        at: "2026-09-19T15:00:00.000Z",
      }),
      makeCheckin({
        id: `c0000000-0000-4000-8000-${String(checkinCounter++).padStart(12, "0")}`,
        signup_id: signupParkId,
        kind: "out",
        method: "qr",
        verified: true,
        adjusted_by_organizer: false,
        at: "2026-09-20T02:30:00.000Z",
      }),
    );
  }

  return { shifts, signups, checkins };
}

const built = buildDemoShiftsAndSignups();

export const DEMO_SHIFTS: Shift[] = built.shifts;
export const DEMO_SIGNUPS: Signup[] = built.signups;
export const DEMO_CHECKINS: Checkin[] = built.checkins;
