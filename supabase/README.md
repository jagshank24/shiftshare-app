# ShiftShare database

Schema, row-level security and tests for the Supabase project.

```
supabase/
├─ migrations/
│  ├─ 20261006120000_init.sql       ← tables, FKs, RLS, triggers
│  └─ 20261006130000_signup_rpcs.sql ← event timezone, role order, signup RPCs
└─ tests/
   ├─ 00_supabase_shim.sql          ← local stand-in for Supabase's auth schema
   ├─ 01_rls_test.sql               ← 74 assertions across anon / organizer / volunteer
   └─ 01_rls_test.output.txt        ← recorded results of a real run
```

## Applying the migration

**Supabase CLI (recommended):**

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

**Or by hand:** open the SQL editor in the dashboard, paste each file in
`migrations/` in filename order, and run them. It's idempotent-ish — it creates
objects, so re-running on a populated database will error on the first
`create type`. Reset the schema if you need a clean slate.

## The model

```
profiles ──< events ──< roles ──< shifts ──< signups ──< checkins
                                                     │
                        (a volunteer claims a shift) ┘
```

| Table      | Holds                                                              |
| ---------- | ------------------------------------------------------------------ |
| `profiles` | One row per auth user. `role` is `organizer` / `volunteer`, **null** until they choose. |
| `events`   | An event. `organizer_id` → `profiles.id`, `slug` for the public link. |
| `roles`    | A job at the event — "Check-in table", headcount in `capacity`.     |
| `shifts`   | A time slot for a role. `starts_at` / `ends_at`.                    |
| `signups`  | A volunteer claims a shift. Unique per (shift, volunteer).          |
| `checkins` | Tap in / tap out rows, then the organizer's verification.           |

`roles` is deliberately separate from `shifts`: one role ("Check-in table")
usually runs several time slots, and the headcount belongs to the role while
the times belong to the shift.

### Foreign keys

Every child row cascades from its parent, so deleting an event removes its
roles, shifts, signups and checkins in one statement — the volunteer's
`profiles` row survives, because their history is theirs.

```
profiles.id        → auth.users.id      ON DELETE CASCADE
events.organizer_id→ profiles.id        ON DELETE CASCADE
roles.event_id     → events.id          ON DELETE CASCADE
shifts.role_id     → roles.id           ON DELETE CASCADE
signups.shift_id   → shifts.id          ON DELETE CASCADE
signups.volunteer_id → profiles.id      ON DELETE CASCADE
checkins.signup_id → signups.id         ON DELETE CASCADE
checkins.verified_by → profiles.id      ON DELETE SET NULL
```

## Row-level security

All six tables have RLS enabled. The rules, in plain language:

| Table      | Read                                              | Write                                        |
| ---------- | ------------------------------------------------- | -------------------------------------------- |
| `profiles` | Yourself, or an organizer of an event you signed up for | Only yourself (`id = auth.uid()`)      |
| `events`   | Anyone, **once published** — organizers also see their own drafts | Organizer only, and only their own |
| `roles`    | Anyone, if the event is readable                   | Organizer of that event only                 |
| `shifts`   | Anyone, if the event is readable                   | Organizer of that event only                 |
| `signups`  | Your own, or the organizer of that event           | You may insert/update/delete your own; organizers may update signups on their events |
| `checkins` | Your own, or the organizer of that event           | Volunteers insert their own taps; **verification is organizer-only** (see below) |

> **"Anyone can read events" and drafts.** The event policy is
> `published or organizer_id = auth.uid()`. Unpublished events are private to
> their organizer so a half-finished draft isn't public. Anonymous visitors see
> published events only. If you want *every* event world-readable regardless of
> status, drop `and e.published` from `events_select_public_or_own` and redeploy.

### Why policies use `security definer` helper functions

A policy on `shifts` needs to know whether the current user organizes the shift's
event — which means walking `shifts → roles → events`. Written as a subquery
inside the policy, that query re-enters RLS on `events` for every row. Instead,
small `security definer` functions (`is_event_organizer`, `is_shift_organizer`,
…) do the walk once, run as the owner (bypassing RLS), are marked `STABLE` so
Postgres can cache results per statement, and pin `search_path = public` so they
can't be tricked into running someone else's function. They only read.

### Volunteers can't verify their own hours

RLS can't express this: a volunteer is allowed to update their own `checkins`
row (to fix a mistyped tap-out time) but must not be able to set `verified`.
That's enforced by a `before insert or update` trigger,
`guard_checkin_verification()`:

- On **insert**, `verified` is forced to `false` — a checkin cannot be born verified.
- On **update**, if `verified` / `verified_by` / `verified_at` differ from the
  old row, the actor must be the event's organizer; the trigger then stamps
  `verified_by = organizer` and `verified_at = now()` itself.
- Any other field can still be edited by the owner.

So a volunteer hitting `update checkins set verified = true` gets
`insufficient_privilege`, and an honest correction to `at` goes through.

## Signups run in the database, not the app

The public event page never inserts into `signups` itself. It calls three
functions from `20261006130000_signup_rpcs.sql`, because each one is an
invariant that only the database can hold:

| Function | Why it isn't app code |
| --- | --- |
| `shift_signup_counts(event_id)` | Returns *aggregates* — spots taken, people on standby. Not who. A volunteer can't read other people's signups and doesn't need to. |
| `sign_up_for_shift(shift_id)` | Checks capacity and schedule clashes and writes the row in one transaction. A read-then-write from the app would let two people claim the last spot. |
| `cancel_signup(shift_id)` | Marks the caller's own row `cancelled`. There is no volunteer-id parameter anywhere, so nobody can act for anyone else. |

Codes come back as JSON — `confirmed`, `waitlist`, `already`, `overlap`,
`past`, `not_published`, `not_found`, `unauthenticated` — and the page turns
them into sentences.

**Overlaps.** Intervals are half-open, so a shift ending at 11:00 and one
starting at 11:00 are fine; anything that genuinely intersects is refused. The
conflict is checked across *every* event, since a person can't be in two places
at once, and the refusal names the shift it clashed with.

**Standby is not a commitment.** Waiting for a place on one shift doesn't stop
you volunteering for another. But confirming a place releases any standby place
that overlaps it — otherwise promoting that standby later would double-book
you. The response says how many were released, so the page can mention it.

**Concurrency.** The shift row is locked before the capacity count, so two taps
for the last spot serialise; the volunteer's profile row is locked before the
clash check, so two overlapping requests from one person can't both pass.

**Grants.** `create function` grants EXECUTE to PUBLIC, which includes `anon`.
The migration revokes that, then grants reading counts to
`anon`/`authenticated` while claiming and releasing a spot are `authenticated`
only.

## Two columns the public page needed

- `events.timezone` — `starts_at` is a `timestamptz`: an instant, not a wall
  clock. The page has to know *which* clock to render it in, or a 9am food drive
  shows up as 4pm to anyone reading the link from another timezone. The
  organizer's browser reports its IANA zone name when the event is published.
- `roles.position` — roles are inserted in one statement, so they all share a
  `created_at` (`now()` is transaction time) and ordering by it is arbitrary.
  The order the planner produced is meaningful — Setup, then the working roles,
  then Teardown — so it's stored. Rows that predate the column are backfilled
  from the order their shifts start in.

## Running the tests

The RLS suite runs against a real Postgres. It stubs `auth.users` and
`auth.uid()` (with `auth.uid()` reading a JWT claim GUC, exactly like
PostgREST) so the policies execute as `anon` and `authenticated`, then asserts
what each person can and cannot do.

```bash
sudo -u postgres psql -c "create database shiftshare_test;"
sudo -u postgres psql -d shiftshare_test -c "create extension if not exists pgcrypto;"
sudo -u postgres psql -d shiftshare_test -f supabase/tests/00_supabase_shim.sql
sudo -u postgres psql -d shiftshare_test -f supabase/migrations/20261006120000_init.sql
sudo -u postgres psql -d shiftshare_test -f supabase/migrations/20261006130000_signup_rpcs.sql
sudo -u postgres psql -d shiftshare_test -f supabase/tests/01_rls_test.sql
```

The suite runs inside one transaction and ends with `ROLLBACK`, so it's
re-runnable. Current status: **74 passed, 0 failed**.

```
anon      sees published events · cannot see drafts · cannot read signups/profiles
organizer can update own event · cannot update/delete another's
          cannot hand an event to someone else · can read volunteers on own event
          cannot read unrelated profiles
volunteer can sign self up · cannot sign up someone else · cannot sign up for a draft
          cannot sign up twice · sees only own signups · can cancel own
checkin   volunteer can tap in · cannot self-verify · can correct a typo
          organizer can verify (stamps who/when) · unrelated organizer sees nothing
trigger   email signup saves the chosen role · Google signup gets name but no role
cascade   deleting an event removes roles/shifts/signups/checkins, keeps profiles
rpc       anon reads spot counts but cannot claim one, nor read a draft's counts
          claims an open spot · a second tap is not a second spot
          allows the shift straight after · refuses a clashing shift (and names it)
          cancels a claimed spot · the spot is free again · re-signing up works
          joins standby when full · does not queue twice · standby takes no spot
          refuses a shift that is over or on a draft · says when a shift is gone
          a standby place does not block a signup (and is released when it would)
          canceling touches only your own row
```

## Regenerating types

`src/lib/supabase/database.types.ts` is hand-written to match this migration.
Once the project is live, replace it with the generated version:

```bash
npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
```

The generated file models relationships, which the dashboard's nested selects
currently work around with a type assertion (`as unknown as {...}`).

## Notes

- **Node 22+** for the Supabase JS SDK — it warns on Node 20.
- The migration grants `select` on `events`/`roles`/`shifts` to `anon`, guarded
  by a `pg_roles` check so the file also applies on plain Postgres. Supabase's
  default grants are broader; either way RLS decides the rows.
- `updated_at` is maintained by `set_updated_at()` triggers, not by the client.
