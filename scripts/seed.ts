import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  DEMO_CHECKINS,
  DEMO_EVENTS,
  DEMO_PASSWORD,
  DEMO_PROFILES,
  DEMO_ROLES,
  DEMO_SHIFTS,
  DEMO_SIGNUPS,
  FALL_CARNIVAL_EVENT_ID,
} from "../src/lib/demo/seed-data";

function sqlStr(val: string | null | undefined): string {
  if (val === null || val === undefined) return "null";
  return `'${String(val).replace(/'/g, "''")}'`;
}

function sqlBool(val: boolean | null | undefined): string {
  return val ? "true" : "false";
}

export function generateSeedSql(): string {
  const lines: string[] = [
    "-- ============================================================================",
    "-- ShiftShare — Demo Seed Data (supabase/seed.sql)",
    "-- Creates:",
    "--   * 1 organizer account (Maya Lin) and 15 volunteer accounts with realistic names",
    "--   * 'Fall Carnival' event with 6 roles (Registration, Food Stand, Games,",
    "--     Setup, Cleanup, First Aid Helpers), 33 shifts (30+ shifts), mostly filled,",
    "--     with full shifts that have standby (waitlist) volunteers",
    "--   * Past completed events with check-in and check-out timestamps so the",
    "--     organizer analytics charts, volunteer dashboard, and PDF certificate",
    "--     look real immediately.",
    "-- ============================================================================",
    "",
    "begin;",
    "",
    "-- 1. Auth users & Profiles (1 organizer + 15 volunteers)",
  ];

  for (const p of DEMO_PROFILES) {
    const meta = JSON.stringify({
      full_name: p.full_name,
      role: p.role,
    });
    lines.push(
      `insert into auth.users (id, email, raw_user_meta_data, created_at) values (${sqlStr(
        p.id,
      )}, ${sqlStr(p.email)}, ${sqlStr(meta)}::jsonb, ${sqlStr(
        p.created_at,
      )}) on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;`,
    );
    lines.push(
      `insert into public.profiles (id, email, full_name, role, verification_code, created_at) values (${sqlStr(
        p.id,
      )}, ${sqlStr(p.email)}, ${sqlStr(p.full_name)}, ${sqlStr(
        p.role,
      )}, ${sqlStr(p.verification_code)}, ${sqlStr(
        p.created_at,
      )}) on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;`,
    );
  }

  lines.push("", "-- 2. Events (Fall Carnival + Past Completed Events)");
  for (const ev of DEMO_EVENTS) {
    lines.push(
      `insert into public.events (id, organizer_id, slug, title, description, location, timezone, starts_at, ends_at, published, checkin_token, created_at) values (${sqlStr(
        ev.id,
      )}, ${sqlStr(ev.organizer_id)}, ${sqlStr(ev.slug)}, ${sqlStr(
        ev.title,
      )}, ${sqlStr(ev.description)}, ${sqlStr(ev.location)}, ${sqlStr(
        ev.timezone,
      )}, ${sqlStr(ev.starts_at)}, ${sqlStr(ev.ends_at)}, ${sqlBool(
        ev.published,
      )}, ${sqlStr(ev.checkin_token)}, ${sqlStr(
        ev.created_at,
      )}) on conflict (id) do update set title = excluded.title, description = excluded.description, location = excluded.location, published = excluded.published, checkin_token = excluded.checkin_token;`,
    );
  }

  lines.push("", "-- 3. Roles (6 on Fall Carnival + Past Event Roles)");
  for (const role of DEMO_ROLES) {
    lines.push(
      `insert into public.roles (id, event_id, name, description, capacity, position, created_at) values (${sqlStr(
        role.id,
      )}, ${sqlStr(role.event_id)}, ${sqlStr(role.name)}, ${sqlStr(
        role.description,
      )}, ${role.capacity}, ${role.position}, ${sqlStr(
        role.created_at,
      )}) on conflict (id) do update set name = excluded.name, description = excluded.description, capacity = excluded.capacity, position = excluded.position;`,
    );
  }

  lines.push("", `-- 4. Shifts (${DEMO_SHIFTS.length} total; 33 on Fall Carnival)`);
  for (const sh of DEMO_SHIFTS) {
    lines.push(
      `insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values (${sqlStr(
        sh.id,
      )}, ${sqlStr(sh.role_id)}, ${sqlStr(sh.starts_at)}, ${sqlStr(
        sh.ends_at,
      )}, ${sh.capacity}, ${sqlStr(
        sh.created_at,
      )}) on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;`,
    );
  }

  lines.push("", `-- 5. Signups (${DEMO_SIGNUPS.length} total, including standby/waitlist on full shifts)`);
  for (const sg of DEMO_SIGNUPS) {
    lines.push(
      `insert into public.signups (id, shift_id, volunteer_id, status, created_at) values (${sqlStr(
        sg.id,
      )}, ${sqlStr(sg.shift_id)}, ${sqlStr(sg.volunteer_id)}, ${sqlStr(
        sg.status,
      )}, ${sqlStr(
        sg.created_at,
      )}) on conflict (id) do update set status = excluded.status;`,
    );
  }

  lines.push("", `-- 6. Check-ins & Check-outs (${DEMO_CHECKINS.length} total on past completed events)`);
  for (const ck of DEMO_CHECKINS) {
    lines.push(
      `insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values (${sqlStr(
        ck.id,
      )}, ${sqlStr(ck.signup_id)}, ${sqlStr(ck.kind)}, ${sqlStr(
        ck.method,
      )}, ${sqlBool(ck.verified)}, ${sqlBool(
        ck.adjusted_by_organizer,
      )}, ${sqlStr(
        ck.at,
      )}) on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;`,
    );
  }

  lines.push("", "commit;", "");
  return lines.join("\n");
}

async function seedRemoteSupabaseIfConfigured() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return false;
  }

  console.log(`Seeding live Supabase project at ${supabaseUrl}...`);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const profile of DEMO_PROFILES) {
    await admin.auth.admin.createUser({
      id: profile.id,
      email: profile.email ?? undefined,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: profile.full_name,
        role: profile.role,
      },
    });
  }

  await admin.from("profiles").upsert(DEMO_PROFILES, { onConflict: "id" });
  await admin.from("events").upsert(DEMO_EVENTS, { onConflict: "id" });
  await admin.from("roles").upsert(DEMO_ROLES, { onConflict: "id" });
  await admin.from("shifts").upsert(DEMO_SHIFTS, { onConflict: "id" });
  await admin.from("signups").upsert(DEMO_SIGNUPS, { onConflict: "id" });
  await admin.from("checkins").upsert(DEMO_CHECKINS, { onConflict: "id" });

  console.log("Live Supabase seed complete.");
  return true;
}

async function main() {
  const sql = generateSeedSql();
  const outPath = path.resolve(process.cwd(), "supabase/seed.sql");
  fs.writeFileSync(outPath, sql, "utf8");

  const organizerCount = DEMO_PROFILES.filter((p) => p.role === "organizer").length;
  const volunteerCount = DEMO_PROFILES.filter((p) => p.role === "volunteer").length;
  const fallRoles = DEMO_ROLES.filter((r) => r.event_id === FALL_CARNIVAL_EVENT_ID);
  const fallRoleIds = new Set(fallRoles.map((r) => r.id));
  const fallShifts = DEMO_SHIFTS.filter((s) => fallRoleIds.has(s.role_id));
  const fallShiftIds = new Set(fallShifts.map((s) => s.id));
  const fallSignups = DEMO_SIGNUPS.filter((sg) => fallShiftIds.has(sg.shift_id));
  const standbyCount = fallSignups.filter((sg) => sg.status === "waitlist").length;

  console.log("Generated supabase/seed.sql:");
  console.log(`  - Organizers: ${organizerCount} (${DEMO_PROFILES[0].full_name})`);
  console.log(`  - Volunteers: ${volunteerCount}`);
  console.log(
    `  - Fall Carnival roles: ${fallRoles.length} (${fallRoles.map((r) => r.name).join(", ")})`,
  );
  console.log(`  - Fall Carnival shifts: ${fallShifts.length}`);
  console.log(
    `  - Fall Carnival signups: ${fallSignups.length} (${standbyCount} standby/waitlist on full shifts)`,
  );
  console.log(`  - Total events: ${DEMO_EVENTS.length}`);
  console.log(`  - Total check-in/out records: ${DEMO_CHECKINS.length}`);

  await seedRemoteSupabaseIfConfigured();
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]).endsWith("seed.ts");
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
