-- ============================================================================
-- ShiftShare — initial schema
-- ============================================================================
-- Tables: profiles, events, roles, shifts, signups, checkins
-- Includes: foreign keys, indexes, row-level security, and triggers that keep
-- profiles in sync with auth.users and stop volunteers from verifying their own
-- hours.
--
-- Apply with the Supabase CLI:
--   supabase link --project-ref <ref>
--   supabase db push
-- …or paste into the SQL editor in the Supabase dashboard.
--
-- Model
--   events   ──< roles   a "role" is a job at the event ("Check-in table")
--                       with a total headcount
--   roles    ──< shifts  a "shift" is a time slot for that role
--   shifts   ──< signups a volunteer claims a shift
--   signups  ──< checkins tap in / tap out, then organizer verification
--   profiles 1─< everything (organizers own events, volunteers own signups)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('organizer', 'volunteer');

create type public.signup_status as enum (
  'pending',    -- claimed, waiting on the organizer
  'confirmed',  -- organizer approved
  'cancelled',  -- volunteer dropped out
  'waitlist'    -- shift was full
);

create type public.checkin_kind as enum ('in', 'out');


-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  -- Null until the person tells us. Email signups set it at signup time;
  -- Google sign-ins land on the dashboard with a one-question prompt.
  role       public.user_role,
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user. `role` is null until the person picks organizer or volunteer.';

create index profiles_role_idx on public.profiles (role);


-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------

create table public.events (
  id           uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles (id) on delete cascade,
  title        text not null check (length(trim(title)) > 0),
  description  text,
  location     text,
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  slug         text not null unique,
  published    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint events_time_order check (ends_at is null or ends_at >= starts_at)
);

create index events_organizer_idx on public.events (organizer_id);
create index events_starts_at_idx on public.events (starts_at);
create index events_published_starts_at_idx
  on public.events (starts_at) where published;


-- ---------------------------------------------------------------------------
-- roles — a job at the event, e.g. "Check-in table" (3 people needed)
-- ---------------------------------------------------------------------------

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  description text,
  capacity    integer not null default 1 check (capacity > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint roles_unique_name_per_event unique (event_id, name)
);

create index roles_event_idx on public.roles (event_id);


-- ---------------------------------------------------------------------------
-- shifts — a time slot for a role
-- ---------------------------------------------------------------------------

create table public.shifts (
  id         uuid primary key default gen_random_uuid(),
  role_id    uuid not null references public.roles (id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  capacity   integer not null default 1 check (capacity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_time_order check (ends_at > starts_at)
);

create index shifts_role_idx on public.shifts (role_id);
create index shifts_starts_at_idx on public.shifts (starts_at);


-- ---------------------------------------------------------------------------
-- signups — a volunteer claims a shift
-- ---------------------------------------------------------------------------

create table public.signups (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid not null references public.shifts (id) on delete cascade,
  volunteer_id uuid not null references public.profiles (id) on delete cascade,
  status       public.signup_status not null default 'confirmed',
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One signup per person per shift.
  constraint signups_unique_volunteer_per_shift unique (shift_id, volunteer_id)
);

create index signups_volunteer_idx on public.signups (volunteer_id);
create index signups_shift_idx on public.signups (shift_id);


-- ---------------------------------------------------------------------------
-- checkins — tap in / tap out, then organizer verification
-- ---------------------------------------------------------------------------

create table public.checkins (
  id          uuid primary key default gen_random_uuid(),
  signup_id   uuid not null references public.signups (id) on delete cascade,
  kind        public.checkin_kind not null,
  at          timestamptz not null default now(),
  verified    boolean not null default false,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  method      text,
  created_at  timestamptz not null default now(),
  -- verified_by / verified_at only make sense alongside verified = true.
  constraint checkins_verification_consistent check (
    (verified and verified_by is not null and verified_at is not null)
    or (not verified and verified_by is null and verified_at is null)
  )
);

create index checkins_signup_idx on public.checkins (signup_id);
create index checkins_unverified_idx on public.checkins (signup_id) where not verified;


-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

create trigger shifts_set_updated_at
  before update on public.shifts
  for each row execute function public.set_updated_at();

create trigger signups_set_updated_at
  before update on public.signups
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- Internal helpers (SECURITY DEFINER, so RLS doesn't recurse)
-- ---------------------------------------------------------------------------
-- Policies on child tables need to ask "does the current user own the event
-- this row belongs to?". Doing that with a subquery inside the policy would
-- re-enter RLS on `events` for every row. These functions run as the owner
-- (which bypasses RLS) and are STABLE, so Postgres can cache them per statement.
--
-- `security definer` + a pinned `search_path` is the standard Supabase pattern.
-- Never make these functions do anything but read.
-- ---------------------------------------------------------------------------

-- Is the current user the organizer of this event?
create function public.is_event_organizer(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.organizer_id = auth.uid()
  );
$$;

-- Is this event published (visible to everyone)?
create function public.is_event_public(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.published
  );
$$;

-- Can the current user read this event: it's public, or they organize it.
create function public.can_read_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_event_public(p_event_id)
      or public.is_event_organizer(p_event_id);
$$;

-- Event id behind a role / shift / signup. Null when the row is gone.
create function public.event_id_of_role(p_role_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.event_id from public.roles r where r.id = p_role_id;
$$;

create function public.event_id_of_shift(p_shift_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.event_id
  from public.shifts s
  join public.roles r on r.id = s.role_id
  where s.id = p_shift_id;
$$;

create function public.event_id_of_signup(p_signup_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.event_id
  from public.signups sg
  join public.shifts s on s.id = sg.shift_id
  join public.roles r on r.id = s.role_id
  where sg.id = p_signup_id;
$$;

-- Convenience wrappers so policies read as one line.
create function public.is_role_organizer(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_event_organizer(public.event_id_of_role(p_role_id));
$$;

create function public.is_shift_organizer(p_shift_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_event_organizer(public.event_id_of_shift(p_shift_id));
$$;

-- Shift belongs to a published event — i.e. it's open for signups.
create function public.is_shift_public(p_shift_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_event_public(public.event_id_of_shift(p_shift_id));
$$;

create function public.is_shift_readable(p_shift_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_read_event(public.event_id_of_shift(p_shift_id));
$$;

create function public.is_signup_volunteer(p_signup_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.signups sg
    where sg.id = p_signup_id
      and sg.volunteer_id = auth.uid()
  );
$$;

create function public.is_signup_event_organizer(p_signup_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_event_organizer(public.event_id_of_signup(p_signup_id));
$$;

-- A profile is visible to: the person themselves, or an organizer of an event
-- that person has signed up for (they need names and contact details to run
-- their event). Nobody else.
create function public.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_profile_id = auth.uid()
      or exists (
        select 1
        from public.signups sg
        join public.shifts s on s.id = sg.shift_id
        join public.roles r on r.id = s.role_id
        where sg.volunteer_id = p_profile_id
          and r.event_id in (
            select e.id from public.events e where e.organizer_id = auth.uid()
          )
      );
$$;


-- ---------------------------------------------------------------------------
-- New auth user → profile row
-- ---------------------------------------------------------------------------
-- Runs on every signup, including Google. Reads the role and name we pass in
-- `options.data` at signup time; Google has no role, so it stays null and the
-- dashboard prompts for it.
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    )), ''),
    case
      when new.raw_user_meta_data ->> 'role' in ('organizer', 'volunteer')
        then (new.raw_user_meta_data ->> 'role')::public.user_role
      else null
    end
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(public.profiles.full_name, excluded.full_name),
        updated_at = now();

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- Volunteers can't verify their own hours
-- ---------------------------------------------------------------------------
-- RLS alone can't express this: a volunteer may update their own checkin row
-- (to fix a mistyped tap-out) but must not be able to flip `verified`. Only the
-- event's organizer can do that, and we stamp who and when.
-- ---------------------------------------------------------------------------

create function public.guard_checkin_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organizer uuid;
  v_actor     uuid := auth.uid();
begin
  select e.organizer_id into v_organizer
  from public.signups sg
  join public.shifts s on s.id = sg.shift_id
  join public.roles r on r.id = s.role_id
  join public.events e on e.id = r.event_id
  where sg.id = new.signup_id;

  -- A checkin must stay attached to the signup it was created for.
  if tg_op = 'UPDATE' and new.signup_id is distinct from old.signup_id then
    raise exception 'checkins.signup_id cannot be changed'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.verified then
      raise exception 'A checkin cannot be created already verified'
        using errcode = 'check_violation';
    end if;
    new.verified    := false;
    new.verified_by := null;
    new.verified_at := null;
    return new;
  end if;

  -- UPDATE: only the organizer may touch the verification fields.
  if new.verified is distinct from old.verified
     or new.verified_by is distinct from old.verified_by
     or new.verified_at is distinct from old.verified_at
  then
    if v_actor is null or v_actor is distinct from v_organizer then
      raise exception 'Only the event organizer can verify hours'
        using errcode = 'insufficient_privilege';
    end if;

    if new.verified then
      new.verified_by := v_organizer;
      new.verified_at := coalesce(new.verified_at, now());
    else
      new.verified_by := null;
      new.verified_at := null;
    end if;
  end if;

  return new;
end;
$$;

create trigger checkins_guard_verification
  before insert or update on public.checkins
  for each row execute function public.guard_checkin_verification();


-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
-- Rules of the house:
--   * events, roles and shifts are readable by anyone once the event is
--     published (organizers can also read their own drafts)
--   * only the organizer writes their own event, roles and shifts
--   * volunteers own their signups; organizers can read and update the signups
--     on their events (to confirm or move someone)
--   * checkins belong to the volunteer, verification belongs to the organizer
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.events   enable row level security;
alter table public.roles    enable row level security;
alter table public.shifts   enable row level security;
alter table public.signups  enable row level security;
alter table public.checkins enable row level security;

-- profiles ------------------------------------------------------------------
create policy "profiles_select_self_or_organizer"
  on public.profiles for select
  to anon, authenticated
  using (public.can_view_profile(id));

create policy "profiles_insert_self"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- events --------------------------------------------------------------------
-- "Anyone can read events" — with one guard: unpublished drafts stay private
-- to the organizer. To make every event readable regardless of `published`,
-- drop `and e.published` from the policy below and redeploy.
create policy "events_select_public_or_own"
  on public.events for select
  to anon, authenticated
  using (published or organizer_id = auth.uid());

create policy "events_insert_own"
  on public.events for insert
  to authenticated
  with check (organizer_id = auth.uid());

create policy "events_update_own"
  on public.events for update
  to authenticated
  using (organizer_id = auth.uid())
  with check (organizer_id = auth.uid());

create policy "events_delete_own"
  on public.events for delete
  to authenticated
  using (organizer_id = auth.uid());

-- roles ---------------------------------------------------------------------
create policy "roles_select_readable_event"
  on public.roles for select
  to anon, authenticated
  using (public.can_read_event(event_id));

create policy "roles_insert_own_event"
  on public.roles for insert
  to authenticated
  with check (public.is_event_organizer(event_id));

create policy "roles_update_own_event"
  on public.roles for update
  to authenticated
  using (public.is_event_organizer(event_id))
  with check (public.is_event_organizer(event_id));

create policy "roles_delete_own_event"
  on public.roles for delete
  to authenticated
  using (public.is_event_organizer(event_id));

-- shifts --------------------------------------------------------------------
create policy "shifts_select_readable_event"
  on public.shifts for select
  to anon, authenticated
  using (public.is_shift_readable(id));

create policy "shifts_insert_own_event"
  on public.shifts for insert
  to authenticated
  with check (public.is_role_organizer(role_id));

create policy "shifts_update_own_event"
  on public.shifts for update
  to authenticated
  using (public.is_role_organizer(role_id))
  with check (public.is_role_organizer(role_id));

create policy "shifts_delete_own_event"
  on public.shifts for delete
  to authenticated
  using (public.is_role_organizer(role_id));

-- signups -------------------------------------------------------------------
create policy "signups_select_own_or_event_organizer"
  on public.signups for select
  to authenticated
  using (
    volunteer_id = auth.uid()
    or public.is_shift_organizer(shift_id)
  );

-- You may only sign yourself up, and only for a published event's shift.
create policy "signups_insert_self"
  on public.signups for insert
  to authenticated
  with check (
    volunteer_id = auth.uid()
    and public.is_shift_public(shift_id)
  );

create policy "signups_update_own_or_event_organizer"
  on public.signups for update
  to authenticated
  using (
    volunteer_id = auth.uid()
    or public.is_shift_organizer(shift_id)
  )
  with check (
    volunteer_id = auth.uid()
    or public.is_shift_organizer(shift_id)
  );

create policy "signups_delete_own"
  on public.signups for delete
  to authenticated
  using (volunteer_id = auth.uid());

-- checkins ------------------------------------------------------------------
create policy "checkins_select_own_or_event_organizer"
  on public.checkins for select
  to authenticated
  using (
    public.is_signup_volunteer(signup_id)
    or public.is_signup_event_organizer(signup_id)
  );

create policy "checkins_insert_own_signup"
  on public.checkins for insert
  to authenticated
  with check (public.is_signup_volunteer(signup_id));

create policy "checkins_update_own_or_event_organizer"
  on public.checkins for update
  to authenticated
  using (
    public.is_signup_volunteer(signup_id)
    or public.is_signup_event_organizer(signup_id)
  )
  with check (
    public.is_signup_volunteer(signup_id)
    or public.is_signup_event_organizer(signup_id)
  );

create policy "checkins_delete_own_signup"
  on public.checkins for delete
  to authenticated
  using (public.is_signup_volunteer(signup_id));


-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Supabase already grants this by default; repeating it here means the
-- migration also works on a plain Postgres instance (and documents what the
-- API roles are allowed to touch — RLS decides which rows).
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated')
  then
    grant usage on schema public to anon, authenticated;

    grant select on public.events, public.roles, public.shifts to anon;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  end if;
end
$$;
-- ============================================================================
-- ShiftShare — signup RPCs
-- ============================================================================
-- The public event page needs two things row-level security deliberately
-- hides: how many spots are left on a shift, and a way to claim one without
-- racing another volunteer for the last place.
--
-- Both live here as functions rather than in the app, because both are
-- invariants that only the database can hold:
--
--   * `shift_signup_counts` returns *aggregates* — how many spots are taken,
--     how many people are standing by. Not who. A volunteer can't read other
--     people's signups, and shouldn't need to.
--
--   * `sign_up_for_shift` checks capacity and schedule clashes and writes the
--     row in one transaction, taking locks so two people tapping "Sign up" for
--     the last spot can't both get it. Doing this with a read-then-write from
--     the app would be a race.
--
-- Apply after 20261006120000_init.sql.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- events.timezone — which clock the event's times are on
-- ---------------------------------------------------------------------------
-- `starts_at` is a timestamptz: an instant, not a wall clock. "9:00am" means
-- 9:00am where the event is, so the public page has to know *which* timezone to
-- render in — otherwise a Saturday 9am food drive shows up as 4pm to anyone
-- whose browser is elsewhere.
--
-- The organizer's browser reports its IANA zone name ("America/Los_Angeles")
-- when the event is published. Default 'UTC' is a placeholder for rows created
-- before this column existed.
alter table public.events
  add column if not exists timezone text not null default 'UTC';

comment on column public.events.timezone is
  'IANA timezone name the event''s wall-clock times are expressed in.';


-- ---------------------------------------------------------------------------
-- roles.position — keep the planner's order
-- ---------------------------------------------------------------------------
-- Roles are inserted in one statement, so they all share a `created_at` (now()
-- is transaction time) and ordering by it is arbitrary. But the order the
-- planner produced is meaningful — Setup, then the working roles, then
-- Teardown — and the public page should read in that order, not alphabetically.
alter table public.roles
  add column if not exists position integer not null default 0;

comment on column public.roles.position is
  'Order this role appears in, as planned. Zero-based.';


-- ---------------------------------------------------------------------------
-- Backfill: existing events have no recorded order, so fall back to the order
-- their shifts start in, which is a reasonable guess at intent.
-- ---------------------------------------------------------------------------
with ordered as (
  select r.id,
         row_number() over (
           partition by r.event_id
           order by coalesce(min(s.starts_at), r.created_at), r.name
         ) - 1 as position
  from public.roles r
  left join public.shifts s on s.role_id = r.id
  group by r.id, r.event_id, r.created_at, r.name
)
update public.roles r
   set position = ordered.position
  from ordered
 where ordered.id = r.id
   and r.position = 0
   and ordered.position <> 0;


-- ---------------------------------------------------------------------------
-- shift_signup_counts — public spot counts for one event
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because it counts rows the caller cannot select. That is
-- the point: it exposes a number, never a person. Guarded by `can_read_event`,
-- so a draft's numbers stay private to its organizer.
--
-- "Taken" includes 'pending' — a claimed spot is still a held spot. Waitlisted
-- people are counted separately: they are not occupying a place.
create or replace function public.shift_signup_counts(p_event_id uuid)
returns table (shift_id uuid, taken integer, standing_by integer)
language sql
stable
security definer
set search_path = public
as $$
  select s.id,
         count(sg.id) filter (where sg.status in ('confirmed', 'pending'))::int,
         count(sg.id) filter (where sg.status = 'waitlist')::int
  from public.shifts s
  join public.roles r on r.id = s.role_id
  left join public.signups sg on sg.shift_id = s.id
  where r.event_id = p_event_id
    and public.can_read_event(p_event_id)
  group by s.id;
$$;


-- ---------------------------------------------------------------------------
-- sign_up_for_shift — claim a spot, or join standby if the shift is full
-- ---------------------------------------------------------------------------
-- Returns a code the caller maps to copy. Never takes a volunteer id: the
-- actor is always `auth.uid()`, so this cannot be used to sign up someone else.
--
-- Codes:
--   confirmed        spot claimed
--   waitlist         shift was full; joined standby
--   already          already signed up for this shift
--   already_waitlist already on standby for this shift
--   overlap          clashes with a shift they're already confirmed for
--   not_found        no such shift
--   not_published    the event is still a draft
--   past             the shift has already finished
--   unauthenticated  no session
--
-- Confirming a place also releases any standby place that overlaps it, so a
-- volunteer can't end up holding two places at the same time.
--
-- Concurrency: the shift row is locked before the capacity count, and the
-- volunteer's profile row is locked before the overlap check. Two taps for the
-- same last spot serialise, and so do two overlapping signups by one person.
create or replace function public.sign_up_for_shift(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_shift    public.shifts%rowtype;
  v_event    public.events%rowtype;
  v_existing public.signups%rowtype;
  v_taken    integer;
  v_status   public.signup_status;
  v_conflict jsonb;
  v_released integer := 0;
begin
  if v_uid is null then
    return jsonb_build_object('code', 'unauthenticated');
  end if;

  -- Serialise signups for this shift: everyone queues on this lock, so the
  -- capacity read below is always fresh.
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then
    return jsonb_build_object('code', 'not_found');
  end if;

  select e.* into v_event
  from public.events e
  join public.roles r on r.event_id = e.id
  where r.id = v_shift.role_id;

  if v_event.id is null then
    return jsonb_build_object('code', 'not_found');
  end if;

  -- Drafts are invisible to the public; their shifts are not open.
  if not v_event.published then
    return jsonb_build_object('code', 'not_published');
  end if;

  -- A shift that has already finished can't be signed up for. A shift that is
  -- under way still can: someone turning up mid-event is exactly who you want
  -- to be able to claim the rest of it.
  if v_shift.ends_at <= now() then
    return jsonb_build_object('code', 'past');
  end if;

  -- Serialise this volunteer's own signups, so two overlapping requests from
  -- the same person can't both pass the clash check below.
  perform 1 from public.profiles where id = v_uid for update;

  select * into v_existing
  from public.signups
  where shift_id = p_shift_id and volunteer_id = v_uid;

  if found then
    if v_existing.status in ('confirmed', 'pending') then
      return jsonb_build_object('code', 'already');
    end if;
    if v_existing.status = 'waitlist' then
      return jsonb_build_object('code', 'already_waitlist');
    end if;
    -- 'cancelled' falls through: this is someone changing their mind, and the
    -- unique (shift_id, volunteer_id) constraint means we reactivate the row.
  end if;

  -- Overlap: half-open intervals [starts_at, ends_at) so a shift ending at
  -- 11:00 and one starting at 11:00 do not clash. Checked across every event —
  -- a person cannot be in two places at once, wherever the shifts are.
  --
  -- Only confirmed places count. Standby is not a commitment, so waiting for a
  -- place on one shift must not stop someone volunteering for another.
  select jsonb_build_object(
           'role', r.name,
           'event_title', e.title,
           'starts_at', s.starts_at,
           'ends_at', s.ends_at,
           -- So the caller can render the clash in the *other* event's own
           -- timezone without a second round trip.
           'timezone', e.timezone
         )
  into v_conflict
  from public.signups sg
  join public.shifts s on s.id = sg.shift_id
  join public.roles r on r.id = s.role_id
  join public.events e on e.id = r.event_id
  where sg.volunteer_id = v_uid
    and sg.shift_id <> p_shift_id
    and sg.status in ('confirmed', 'pending')
    and s.starts_at < v_shift.ends_at
    and s.ends_at > v_shift.starts_at
  order by s.starts_at
  limit 1;

  if v_conflict is not null then
    return jsonb_build_object('code', 'overlap', 'conflict', v_conflict);
  end if;

  select count(*) into v_taken
  from public.signups
  where shift_id = p_shift_id and status in ('confirmed', 'pending');

  v_status := case
    when v_taken >= v_shift.capacity then 'waitlist'::public.signup_status
    else 'confirmed'::public.signup_status
  end;

  if v_existing.id is not null then
    update public.signups
       set status = v_status
     where id = v_existing.id;
  else
    insert into public.signups (shift_id, volunteer_id, status)
    values (p_shift_id, v_uid, v_status);
  end if;

  -- Standby didn't block this signup, but leaving an overlapping standby place
  -- in place would double-book them the moment the organizer promoted it. So
  -- take it back — and say so, because quietly dropping it would be a surprise.
  if v_status = 'confirmed' then
    update public.signups sg
       set status = 'cancelled'
      from public.shifts s
     where sg.shift_id = s.id
       and sg.volunteer_id = v_uid
       and sg.status = 'waitlist'
       and sg.shift_id <> p_shift_id
       and s.starts_at < v_shift.ends_at
       and s.ends_at > v_shift.starts_at;

    get diagnostics v_released = row_count;
  end if;

  return jsonb_build_object(
    'code', v_status::text,
    'taken', v_taken + case when v_status = 'confirmed' then 1 else 0 end,
    'capacity', v_shift.capacity,
    'released_standby', v_released
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- cancel_signup — give up a spot with one tap
-- ---------------------------------------------------------------------------
-- Marks the row 'cancelled' rather than deleting it: the organizer can see who
-- dropped out, and the volunteer can change their mind again without tripping
-- the unique constraint. Cancelling a standby place works the same way.
create or replace function public.cancel_signup(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_updated integer;
begin
  if v_uid is null then
    return jsonb_build_object('code', 'unauthenticated');
  end if;

  -- No "for update" needed: this only ever touches the caller's own row.
  update public.signups
     set status = 'cancelled'
   where shift_id = p_shift_id
     and volunteer_id = v_uid
     and status <> 'cancelled';

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('code', 'not_signed_up');
  end if;

  return jsonb_build_object('code', 'cancelled');
end;
$$;


-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
-- `create function` grants EXECUTE to PUBLIC by default, which includes anon.
-- Take that back and hand out exactly what each role needs.
revoke all on function public.shift_signup_counts(uuid) from public;
revoke all on function public.sign_up_for_shift(uuid) from public;
revoke all on function public.cancel_signup(uuid) from public;

-- Reading counts is public: that is the whole point of a shareable event page.
grant execute on function public.shift_signup_counts(uuid) to anon, authenticated, service_role;

-- Claiming and releasing a spot requires a session.
grant execute on function public.sign_up_for_shift(uuid) to authenticated, service_role;
grant execute on function public.cancel_signup(uuid) to authenticated, service_role;
-- ============================================================================
-- ShiftShare — QR check-in & check-out system
-- ============================================================================
-- Adds:
--   * `events.checkin_token` — rotatable secret token encoded in the event's
--     QR code (`/checkin/<event_id>?token=<checkin_token>`).
--   * `checkins.adjusted_by_organizer` + unique `(signup_id, kind)` constraint
--     so duplicate check-ins and check-outs are impossible.
--   * `shift_hours_worked` / `volunteer_total_hours` — server-side hour
--     calculations from timestamps only (rounded to 2 decimals).
--   * `validate_checkin_token` — checks an event's QR token before/after login.
--   * `refresh_checkin_token` — organizer rotates the event's QR secret.
--   * `qr_scan_checkin` — atomic, idempotent volunteer check-in / check-out
--     within the [-30 min, +30 min] start window.
--   * `organizer_set_checkout` — organizer manually sets a forgotten check-out
--     time and flags the record `adjusted_by_organizer = true`.
--
-- Apply after 20261006130000_signup_rpcs.sql.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. events.checkin_token — rotatable secret for QR check-ins
-- ---------------------------------------------------------------------------
alter table public.events
  add column if not exists checkin_token text not null
  default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

comment on column public.events.checkin_token is
  'Random secret encoded in the event QR code. Rotated by refresh_checkin_token.';


-- ---------------------------------------------------------------------------
-- 2. checkins safeguards — unique (signup_id, kind) & adjusted_by_organizer
-- ---------------------------------------------------------------------------
alter table public.checkins
  add column if not exists adjusted_by_organizer boolean not null default false;

comment on column public.checkins.adjusted_by_organizer is
  'True when the event organizer manually set or adjusted the check-out time.';

alter table public.checkins
  drop constraint if exists checkins_unique_kind_per_signup;

alter table public.checkins
  add constraint checkins_unique_kind_per_signup unique (signup_id, kind);


-- ---------------------------------------------------------------------------
-- 3. Server-side hours calculation (from timestamps only, 2 decimal places)
-- ---------------------------------------------------------------------------
create or replace function public.shift_hours_worked(p_signup_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select round(
        greatest(
          0,
          extract(epoch from (c_out.at - c_in.at)) / 3600.0
        )::numeric,
        2
      )
      from public.checkins c_in
      join public.checkins c_out
        on c_out.signup_id = c_in.signup_id
       and c_out.kind = 'out'
      where c_in.signup_id = p_signup_id
        and c_in.kind = 'in'
      limit 1
    ),
    0.00
  );
$$;

create or replace function public.volunteer_total_hours(p_volunteer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    round(
      sum(
        greatest(
          0,
          extract(epoch from (c_out.at - c_in.at)) / 3600.0
        )
      )::numeric,
      2
    ),
    0.00
  )
  from public.signups sg
  join public.checkins c_in
    on c_in.signup_id = sg.id
   and c_in.kind = 'in'
  join public.checkins c_out
    on c_out.signup_id = sg.id
   and c_out.kind = 'out'
  where sg.volunteer_id = p_volunteer_id;
$$;


-- ---------------------------------------------------------------------------
-- 4. validate_checkin_token — checks QR token validity (callable before login)
-- ---------------------------------------------------------------------------
create or replace function public.validate_checkin_token(
  p_event_id uuid,
  p_token    text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
begin
  select * into v_event
  from public.events
  where id = p_event_id
    and public.can_read_event(p_event_id);

  if not found then
    return jsonb_build_object(
      'valid', false,
      'code', 'not_found'
    );
  end if;

  if p_token is null or length(trim(p_token)) = 0 or v_event.checkin_token <> p_token then
    return jsonb_build_object(
      'valid', false,
      'code', 'invalid_token',
      'event_id', v_event.id,
      'event_title', v_event.title,
      'event_slug', v_event.slug
    );
  end if;

  return jsonb_build_object(
    'valid', true,
    'code', 'ok',
    'event_id', v_event.id,
    'event_title', v_event.title,
    'event_slug', v_event.slug,
    'timezone', v_event.timezone
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. refresh_checkin_token — organizer rotates the QR secret
-- ---------------------------------------------------------------------------
create or replace function public.refresh_checkin_token(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_token text;
begin
  if v_uid is null then
    return jsonb_build_object('code', 'unauthenticated');
  end if;

  if not public.is_event_organizer(p_event_id) then
    return jsonb_build_object('code', 'forbidden');
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  update public.events
     set checkin_token = v_token
   where id = p_event_id;

  if not found then
    return jsonb_build_object('code', 'not_found');
  end if;

  return jsonb_build_object(
    'code', 'refreshed',
    'token', v_token
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. qr_scan_checkin — atomic, idempotent volunteer check-in / check-out
-- ---------------------------------------------------------------------------
-- Codes returned:
--   unauthenticated      volunteer must log in first
--   not_found            event doesn't exist or isn't published
--   invalid_token        token missing, wrong, or expired (rotated)
--   not_signed_up        volunteer has no confirmed signup on this event
--   checked_in           checked in to shift within [-30m, +30m] of start
--   checked_out          was checked in -> now checked out with hours
--   already_checked_out  all shifts on this event already checked in & out
--   outside_window       has a shift, but current time is outside [-30m, +30m]
create or replace function public.qr_scan_checkin(
  p_event_id uuid,
  p_token    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_now           timestamptz := now();
  v_event         public.events%rowtype;
  v_organizer     public.profiles%rowtype;
  v_signup_count  integer;
  v_match         record;
  v_in_at         timestamptz;
  v_out_at        timestamptz;
  v_shift_hours   numeric;
  v_total_hours   numeric;
begin
  if v_uid is null then
    return jsonb_build_object('code', 'unauthenticated');
  end if;

  select * into v_event
  from public.events
  where id = p_event_id
    and public.can_read_event(p_event_id);

  if not found then
    return jsonb_build_object('code', 'not_found');
  end if;

  if p_token is null or length(trim(p_token)) = 0 or v_event.checkin_token <> p_token then
    return jsonb_build_object(
      'code', 'invalid_token',
      'event_id', v_event.id,
      'event_title', v_event.title,
      'event_slug', v_event.slug,
      'timezone', v_event.timezone
    );
  end if;

  -- Serialize this volunteer's check-in actions.
  perform 1 from public.profiles where id = v_uid for update;

  -- Does the volunteer have any confirmed/pending signup on this event?
  select count(*) into v_signup_count
  from public.signups sg
  join public.shifts s on s.id = sg.shift_id
  join public.roles r on r.id = s.role_id
  where r.event_id = p_event_id
    and sg.volunteer_id = v_uid
    and sg.status in ('confirmed', 'pending');

  if v_signup_count = 0 then
    return jsonb_build_object(
      'code', 'not_signed_up',
      'event_id', v_event.id,
      'event_title', v_event.title,
      'event_slug', v_event.slug,
      'timezone', v_event.timezone
    );
  end if;

  -- Case 1: Already checked in on a shift (has 'in', no 'out') -> Check them out!
  select sg.id as signup_id,
         r.name as role_name,
         s.starts_at as shift_starts_at,
         s.ends_at as shift_ends_at,
         c_in.at as checked_in_at
    into v_match
    from public.signups sg
    join public.shifts s on s.id = sg.shift_id
    join public.roles r on r.id = s.role_id
    join public.checkins c_in
      on c_in.signup_id = sg.id
     and c_in.kind = 'in'
    left join public.checkins c_out
      on c_out.signup_id = sg.id
     and c_out.kind = 'out'
   where r.event_id = p_event_id
     and sg.volunteer_id = v_uid
     and sg.status in ('confirmed', 'pending')
     and c_out.id is null
   order by c_in.at asc
   limit 1;

  if v_match.signup_id is not null then
    insert into public.checkins (signup_id, kind, at, method)
    values (v_match.signup_id, 'out', v_now, 'qr')
    on conflict (signup_id, kind) do nothing;

    select at into v_out_at
    from public.checkins
    where signup_id = v_match.signup_id and kind = 'out';

    v_shift_hours := public.shift_hours_worked(v_match.signup_id);
    v_total_hours := public.volunteer_total_hours(v_uid);

    return jsonb_build_object(
      'code', 'checked_out',
      'signup_id', v_match.signup_id,
      'role_name', v_match.role_name,
      'event_id', v_event.id,
      'event_title', v_event.title,
      'event_slug', v_event.slug,
      'timezone', v_event.timezone,
      'shift_starts_at', v_match.shift_starts_at,
      'shift_ends_at', v_match.shift_ends_at,
      'checked_in_at', v_match.checked_in_at,
      'checked_out_at', v_out_at,
      'shift_hours', v_shift_hours,
      'total_hours', v_total_hours
    );
  end if;

  -- Case 2: Has a confirmed shift within [-30 min, +30 min] of start and not checked in -> Check in!
  select sg.id as signup_id,
         r.name as role_name,
         s.starts_at as shift_starts_at,
         s.ends_at as shift_ends_at
    into v_match
    from public.signups sg
    join public.shifts s on s.id = sg.shift_id
    join public.roles r on r.id = s.role_id
    left join public.checkins c_in
      on c_in.signup_id = sg.id
     and c_in.kind = 'in'
   where r.event_id = p_event_id
     and sg.volunteer_id = v_uid
     and sg.status in ('confirmed', 'pending')
     and c_in.id is null
     and v_now >= (s.starts_at - interval '30 minutes')
     and v_now <= (s.starts_at + interval '30 minutes')
   order by s.starts_at asc
   limit 1;

  if v_match.signup_id is not null then
    insert into public.checkins (signup_id, kind, at, method)
    values (v_match.signup_id, 'in', v_now, 'qr')
    on conflict (signup_id, kind) do nothing;

    select at into v_in_at
    from public.checkins
    where signup_id = v_match.signup_id and kind = 'in';

    return jsonb_build_object(
      'code', 'checked_in',
      'signup_id', v_match.signup_id,
      'role_name', v_match.role_name,
      'event_id', v_event.id,
      'event_title', v_event.title,
      'event_slug', v_event.slug,
      'timezone', v_event.timezone,
      'shift_starts_at', v_match.shift_starts_at,
      'shift_ends_at', v_match.shift_ends_at,
      'checked_in_at', v_in_at
    );
  end if;

  -- Case 3: Has an un-checked-in shift, but outside the [-30 min, +30 min] window
  select sg.id as signup_id,
         r.name as role_name,
         s.starts_at as shift_starts_at,
         s.ends_at as shift_ends_at
    into v_match
    from public.signups sg
    join public.shifts s on s.id = sg.shift_id
    join public.roles r on r.id = s.role_id
    left join public.checkins c_in
      on c_in.signup_id = sg.id
     and c_in.kind = 'in'
   where r.event_id = p_event_id
     and sg.volunteer_id = v_uid
     and sg.status in ('confirmed', 'pending')
     and c_in.id is null
   order by abs(extract(epoch from (s.starts_at - v_now))) asc
   limit 1;

  if v_match.signup_id is not null then
    select * into v_organizer
    from public.profiles
    where id = v_event.organizer_id;

    return jsonb_build_object(
      'code', 'outside_window',
      'signup_id', v_match.signup_id,
      'role_name', v_match.role_name,
      'event_id', v_event.id,
      'event_title', v_event.title,
      'event_slug', v_event.slug,
      'timezone', v_event.timezone,
      'shift_starts_at', v_match.shift_starts_at,
      'shift_ends_at', v_match.shift_ends_at,
      'window_opens_at', v_match.shift_starts_at - interval '30 minutes',
      'window_closes_at', v_match.shift_starts_at + interval '30 minutes',
      'organizer_name', v_organizer.full_name,
      'organizer_email', v_organizer.email
    );
  end if;

  -- Case 4: All shifts on this event are already checked in and checked out (idempotent)
  select sg.id as signup_id,
         r.name as role_name,
         s.starts_at as shift_starts_at,
         s.ends_at as shift_ends_at,
         c_in.at as checked_in_at,
         c_out.at as checked_out_at
    into v_match
    from public.signups sg
    join public.shifts s on s.id = sg.shift_id
    join public.roles r on r.id = s.role_id
    join public.checkins c_in
      on c_in.signup_id = sg.id
     and c_in.kind = 'in'
    join public.checkins c_out
      on c_out.signup_id = sg.id
     and c_out.kind = 'out'
   where r.event_id = p_event_id
     and sg.volunteer_id = v_uid
     and sg.status in ('confirmed', 'pending')
   order by c_out.at desc
   limit 1;

  v_shift_hours := public.shift_hours_worked(v_match.signup_id);
  v_total_hours := public.volunteer_total_hours(v_uid);

  return jsonb_build_object(
    'code', 'already_checked_out',
    'signup_id', v_match.signup_id,
    'role_name', v_match.role_name,
    'event_id', v_event.id,
    'event_title', v_event.title,
    'event_slug', v_event.slug,
    'timezone', v_event.timezone,
    'shift_starts_at', v_match.shift_starts_at,
    'shift_ends_at', v_match.shift_ends_at,
    'checked_in_at', v_match.checked_in_at,
    'checked_out_at', v_match.checked_out_at,
    'shift_hours', v_shift_hours,
    'total_hours', v_total_hours
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. organizer_set_checkout — manual check-out for forgotten check-outs
-- ---------------------------------------------------------------------------
create or replace function public.organizer_set_checkout(
  p_signup_id   uuid,
  p_checkout_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_event_id    uuid;
  v_organizer   uuid;
  v_in          public.checkins%rowtype;
  v_shift_hours numeric;
begin
  if v_uid is null then
    return jsonb_build_object('code', 'unauthenticated');
  end if;

  select e.id, e.organizer_id
    into v_event_id, v_organizer
    from public.signups sg
    join public.shifts s on s.id = sg.shift_id
    join public.roles r on r.id = s.role_id
    join public.events e on e.id = r.event_id
   where sg.id = p_signup_id;

  if v_event_id is null then
    return jsonb_build_object('code', 'not_found');
  end if;

  if v_organizer is distinct from v_uid then
    return jsonb_build_object('code', 'forbidden');
  end if;

  select * into v_in
  from public.checkins
  where signup_id = p_signup_id and kind = 'in';

  if not found then
    return jsonb_build_object('code', 'not_checked_in');
  end if;

  if p_checkout_at is null or p_checkout_at <= v_in.at then
    return jsonb_build_object('code', 'invalid_time');
  end if;

  insert into public.checkins (signup_id, kind, at, method, adjusted_by_organizer)
  values (p_signup_id, 'out', p_checkout_at, 'organizer_adjusted', true)
  on conflict (signup_id, kind) do update
    set at                    = excluded.at,
        method                = 'organizer_adjusted',
        adjusted_by_organizer = true;

  -- Stamp organizer verification on both in and out rows.
  update public.checkins
     set verified    = true,
         verified_by = v_uid,
         verified_at = now()
   where signup_id = p_signup_id;

  v_shift_hours := public.shift_hours_worked(p_signup_id);

  return jsonb_build_object(
    'code', 'adjusted',
    'signup_id', p_signup_id,
    'checked_in_at', v_in.at,
    'checked_out_at', p_checkout_at,
    'shift_hours', v_shift_hours,
    'adjusted_by_organizer', true
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. Permissions
-- ---------------------------------------------------------------------------
revoke all on function public.shift_hours_worked(uuid) from public;
revoke all on function public.volunteer_total_hours(uuid) from public;
revoke all on function public.validate_checkin_token(uuid, text) from public;
revoke all on function public.refresh_checkin_token(uuid) from public;
revoke all on function public.qr_scan_checkin(uuid, text) from public;
revoke all on function public.organizer_set_checkout(uuid, timestamptz) from public;

grant execute on function public.validate_checkin_token(uuid, text) to anon, authenticated, service_role;
grant execute on function public.shift_hours_worked(uuid) to authenticated, service_role;
grant execute on function public.volunteer_total_hours(uuid) to authenticated, service_role;
grant execute on function public.refresh_checkin_token(uuid) to authenticated, service_role;
grant execute on function public.qr_scan_checkin(uuid, text) to authenticated, service_role;
grant execute on function public.organizer_set_checkout(uuid, timestamptz) to authenticated, service_role;
-- ============================================================================
-- ShiftShare — Volunteer verification codes & public certificate verification
-- ============================================================================
-- Adds:
--   * `profiles.verification_code` — unique code printed on a volunteer's
--     hours certificate and encoded in its `/verify/[code]` QR link.
--   * `verify_volunteer_certificate(p_code text)` — public (`anon` +
--     `authenticated`) RPC that returns the volunteer's name, verified event
--     list (event, date, organizer, role, server-calculated hours), and total
--     verified hours, or `{ "valid": false, "code": "invalid_code" }`.
--
-- Apply after 20261006140000_qr_checkins.sql.
-- ============================================================================

alter table public.profiles
  add column if not exists verification_code text unique not null
  default ('SS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)));

comment on column public.profiles.verification_code is
  'Unique public verification code for the volunteer''s hours certificate (/verify/[code]).';

create index if not exists profiles_verification_code_idx
  on public.profiles (upper(verification_code));


create or replace function public.verify_volunteer_certificate(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_raw        text := trim(coalesce(p_code, ''));
  v_base_code  text;
  v_event_part text;
  v_event_id   uuid := null;
  v_profile    public.profiles%rowtype;
  v_events     jsonb;
  v_total      numeric;
begin
  if length(v_raw) < 4 then
    return jsonb_build_object(
      'valid', false,
      'code', 'invalid_code'
    );
  end if;

  -- Support optional single-event suffix: "<BASE_CODE>--<EVENT_UUID>"
  if position('--' in v_raw) > 0 then
    v_base_code  := upper(split_part(v_raw, '--', 1));
    v_event_part := split_part(v_raw, '--', 2);
    begin
      v_event_id := v_event_part::uuid;
    exception when others then
      return jsonb_build_object(
        'valid', false,
        'code', 'invalid_code'
      );
    end;
  else
    v_base_code := upper(v_raw);
  end if;

  select * into v_profile
  from public.profiles
  where upper(verification_code) = v_base_code
  limit 1;

  if not found then
    return jsonb_build_object(
      'valid', false,
      'code', 'invalid_code'
    );
  end if;

  with completed_shifts as (
    select
      e.id as event_id,
      e.title as event_title,
      e.starts_at as event_date,
      e.timezone as timezone,
      coalesce(org.full_name, org.email, 'Event Organizer') as organizer_name,
      r.name as role_name,
      s.starts_at as shift_starts_at,
      round(
        greatest(
          0,
          extract(epoch from (c_out.at - c_in.at)) / 3600.0
        )::numeric,
        2
      ) as hours
    from public.signups sg
    join public.shifts s on s.id = sg.shift_id
    join public.roles r on r.id = s.role_id
    join public.events e on e.id = r.event_id
    left join public.profiles org on org.id = e.organizer_id
    join public.checkins c_in
      on c_in.signup_id = sg.id
     and c_in.kind = 'in'
    join public.checkins c_out
      on c_out.signup_id = sg.id
     and c_out.kind = 'out'
    where sg.volunteer_id = v_profile.id
      and (v_event_id is null or e.id = v_event_id)
    order by s.starts_at desc
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'event_id', cs.event_id,
          'event_title', cs.event_title,
          'event_date', cs.event_date,
          'timezone', cs.timezone,
          'organizer_name', cs.organizer_name,
          'role_name', cs.role_name,
          'hours', cs.hours
        )
      ),
      '[]'::jsonb
    ),
    coalesce(round(sum(cs.hours)::numeric, 2), 0.00)
  into v_events, v_total
  from completed_shifts cs;

  return jsonb_build_object(
    'valid', true,
    'code', v_raw,
    'verification_code', v_profile.verification_code,
    'volunteer_id', v_profile.id,
    'volunteer_name', coalesce(v_profile.full_name, v_profile.email, 'Volunteer'),
    'total_hours', v_total,
    'events', v_events
  );
end;
$$;

revoke all on function public.verify_volunteer_certificate(text) from public;
grant execute on function public.verify_volunteer_certificate(text) to anon, authenticated, service_role;
-- ============================================================================
-- ShiftShare — Email Notifications (Resend), 24h Reminders & Standby Promotion
-- ============================================================================
-- 1. Adds `reminder_sent boolean not null default false` to `public.signups`
--    for the daily `/api/cron/reminders` job.
-- 2. Updates `sign_up_for_shift` so reactivated signups reset `reminder_sent`.
-- 3. Updates `cancel_signup` so cancelling a confirmed spot automatically
--    promotes the earliest non-conflicting standby (`waitlist`) volunteer to
--    `confirmed` and returns their contact details so the server can send the
--    "A spot opened up, you're in" email via Resend.
-- ============================================================================

-- 1. Add `reminder_sent` column to `public.signups`
alter table public.signups
  add column if not exists reminder_sent boolean not null default false;

comment on column public.signups.reminder_sent is
  'True once the 24-hour pre-shift reminder email has been sent.';

create index if not exists signups_pending_reminders_idx
  on public.signups (shift_id)
  where status = 'confirmed' and reminder_sent = false;


-- 2. Update `sign_up_for_shift` to reset `reminder_sent` when reactivating
create or replace function public.sign_up_for_shift(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_shift    public.shifts%rowtype;
  v_event    public.events%rowtype;
  v_existing public.signups%rowtype;
  v_taken    integer;
  v_status   public.signup_status;
  v_conflict jsonb;
  v_released integer := 0;
begin
  if v_uid is null then
    return jsonb_build_object('code', 'unauthenticated');
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then
    return jsonb_build_object('code', 'not_found');
  end if;

  select e.* into v_event
  from public.events e
  join public.roles r on r.event_id = e.id
  where r.id = v_shift.role_id;

  if v_event.id is null then
    return jsonb_build_object('code', 'not_found');
  end if;

  if not v_event.published then
    return jsonb_build_object('code', 'not_published');
  end if;

  if v_shift.ends_at <= now() then
    return jsonb_build_object('code', 'past');
  end if;

  perform 1 from public.profiles where id = v_uid for update;

  select * into v_existing
  from public.signups
  where shift_id = p_shift_id and volunteer_id = v_uid;

  if found then
    if v_existing.status in ('confirmed', 'pending') then
      return jsonb_build_object('code', 'already');
    end if;
    if v_existing.status = 'waitlist' then
      return jsonb_build_object('code', 'already_waitlist');
    end if;
  end if;

  select jsonb_build_object(
           'role', r.name,
           'event_title', e.title,
           'starts_at', s.starts_at,
           'ends_at', s.ends_at,
           'timezone', e.timezone
         )
  into v_conflict
  from public.signups sg
  join public.shifts s on s.id = sg.shift_id
  join public.roles r on r.id = s.role_id
  join public.events e on e.id = r.event_id
  where sg.volunteer_id = v_uid
    and sg.shift_id <> p_shift_id
    and sg.status in ('confirmed', 'pending')
    and s.starts_at < v_shift.ends_at
    and s.ends_at > v_shift.starts_at
  order by s.starts_at
  limit 1;

  if v_conflict is not null then
    return jsonb_build_object('code', 'overlap', 'conflict', v_conflict);
  end if;

  select count(*) into v_taken
  from public.signups
  where shift_id = p_shift_id and status in ('confirmed', 'pending');

  v_status := case
    when v_taken >= v_shift.capacity then 'waitlist'::public.signup_status
    else 'confirmed'::public.signup_status
  end;

  if v_existing.id is not null then
    update public.signups
       set status = v_status,
           reminder_sent = false
     where id = v_existing.id;
  else
    insert into public.signups (shift_id, volunteer_id, status, reminder_sent)
    values (p_shift_id, v_uid, v_status, false);
  end if;

  if v_status = 'confirmed' then
    update public.signups sg
       set status = 'cancelled'
      from public.shifts s
     where sg.shift_id = s.id
       and sg.volunteer_id = v_uid
       and sg.status = 'waitlist'
       and sg.shift_id <> p_shift_id
       and s.starts_at < v_shift.ends_at
       and s.ends_at > v_shift.starts_at;

    get diagnostics v_released = row_count;
  end if;

  return jsonb_build_object(
    'code', v_status::text,
    'taken', v_taken + case when v_status = 'confirmed' then 1 else 0 end,
    'capacity', v_shift.capacity,
    'released_standby', v_released
  );
end;
$$;


-- 3. Update `cancel_signup` to auto-promote the next standby volunteer
create or replace function public.cancel_signup(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid              uuid := auth.uid();
  v_shift            public.shifts%rowtype;
  v_existing         public.signups%rowtype;
  v_taken            integer;
  v_promoted_signup  public.signups%rowtype;
  v_promoted_profile public.profiles%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('code', 'unauthenticated');
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;

  select * into v_existing
  from public.signups
  where shift_id = p_shift_id
    and volunteer_id = v_uid
    and status <> 'cancelled'
  for update;

  if not found then
    return jsonb_build_object('code', 'not_signed_up');
  end if;

  update public.signups
     set status = 'cancelled'
   where id = v_existing.id;

  -- If the cancelled signup held a confirmed/pending spot, promote the earliest
  -- waitlisted volunteer who does not have an overlapping confirmed shift.
  if v_existing.status in ('confirmed', 'pending') and v_shift.id is not null then
    select count(*) into v_taken
    from public.signups
    where shift_id = p_shift_id and status in ('confirmed', 'pending');

    if v_taken < v_shift.capacity then
      select sg.*
      into v_promoted_signup
      from public.signups sg
      where sg.shift_id = p_shift_id
        and sg.status = 'waitlist'
        and not exists (
          select 1
          from public.signups other_sg
          join public.shifts other_s on other_s.id = other_sg.shift_id
          where other_sg.volunteer_id = sg.volunteer_id
            and other_sg.shift_id <> p_shift_id
            and other_sg.status in ('confirmed', 'pending')
            and other_s.starts_at < v_shift.ends_at
            and other_s.ends_at > v_shift.starts_at
        )
      order by sg.created_at asc
      limit 1
      for update;

      if v_promoted_signup.id is not null then
        update public.signups
           set status = 'confirmed',
               reminder_sent = false
         where id = v_promoted_signup.id;

        -- Release any overlapping standby rows for the newly promoted volunteer
        update public.signups sg
           set status = 'cancelled'
          from public.shifts s
         where sg.shift_id = s.id
           and sg.volunteer_id = v_promoted_signup.volunteer_id
           and sg.status = 'waitlist'
           and sg.shift_id <> p_shift_id
           and s.starts_at < v_shift.ends_at
           and s.ends_at > v_shift.starts_at;

        select * into v_promoted_profile
        from public.profiles
        where id = v_promoted_signup.volunteer_id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'code', 'cancelled',
    'promoted', case
      when v_promoted_signup.id is not null then jsonb_build_object(
        'signup_id', v_promoted_signup.id,
        'volunteer_id', v_promoted_signup.volunteer_id,
        'volunteer_email', v_promoted_profile.email,
        'volunteer_name', v_promoted_profile.full_name
      )
      else null
    end
  );
end;
$$;

revoke all on function public.sign_up_for_shift(uuid) from public;
revoke all on function public.cancel_signup(uuid) from public;
grant execute on function public.sign_up_for_shift(uuid) to authenticated, service_role;
grant execute on function public.cancel_signup(uuid) to authenticated, service_role;
-- ============================================================================
-- ShiftShare — Demo Seed Data (supabase/seed.sql)
-- Creates:
--   * 1 organizer account (Maya Lin) and 15 volunteer accounts with realistic names
--   * 'Fall Carnival' event with 6 roles (Registration, Food Stand, Games,
--     Setup, Cleanup, First Aid Helpers), 33 shifts (30+ shifts), mostly filled,
--     with full shifts that have standby (waitlist) volunteers
--   * Past completed events with check-in and check-out timestamps so the
--     organizer analytics charts, volunteer dashboard, and PDF certificate
--     look real immediately.
-- ============================================================================

begin;

-- 1. Auth users & Profiles (1 organizer + 15 volunteers)
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000001', 'maya.lin@demo.shiftshare.app', '{"full_name":"Maya Lin","role":"organizer"}'::jsonb, '2026-08-15T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000001', 'maya.lin@demo.shiftshare.app', 'Maya Lin', 'organizer', 'SS-DE00000001', '2026-08-15T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000101', 'carol.diaz@demo.shiftshare.app', '{"full_name":"Carol Diaz","role":"volunteer"}'::jsonb, '2026-08-16T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000101', 'carol.diaz@demo.shiftshare.app', 'Carol Diaz', 'volunteer', 'SS-DE00000101', '2026-08-16T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000102', 'marcus.vance@demo.shiftshare.app', '{"full_name":"Marcus Vance","role":"volunteer"}'::jsonb, '2026-08-17T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000102', 'marcus.vance@demo.shiftshare.app', 'Marcus Vance', 'volunteer', 'SS-DE00000102', '2026-08-17T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000103', 'priya.nair@demo.shiftshare.app', '{"full_name":"Priya Nair","role":"volunteer"}'::jsonb, '2026-08-18T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000103', 'priya.nair@demo.shiftshare.app', 'Priya Nair', 'volunteer', 'SS-DE00000103', '2026-08-18T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000104', 'elena.rostova@demo.shiftshare.app', '{"full_name":"Elena Rostova","role":"volunteer"}'::jsonb, '2026-08-19T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000104', 'elena.rostova@demo.shiftshare.app', 'Elena Rostova', 'volunteer', 'SS-DE00000104', '2026-08-19T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000105', 'jordan.brooks@demo.shiftshare.app', '{"full_name":"Jordan Brooks","role":"volunteer"}'::jsonb, '2026-08-20T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000105', 'jordan.brooks@demo.shiftshare.app', 'Jordan Brooks', 'volunteer', 'SS-DE00000105', '2026-08-20T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000106', 'samira.haddad@demo.shiftshare.app', '{"full_name":"Samira Haddad","role":"volunteer"}'::jsonb, '2026-08-21T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000106', 'samira.haddad@demo.shiftshare.app', 'Samira Haddad', 'volunteer', 'SS-DE00000106', '2026-08-21T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000107', 'devon.patel@demo.shiftshare.app', '{"full_name":"Devon Patel","role":"volunteer"}'::jsonb, '2026-08-22T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000107', 'devon.patel@demo.shiftshare.app', 'Devon Patel', 'volunteer', 'SS-DE00000107', '2026-08-22T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000108', 'hannah.kim@demo.shiftshare.app', '{"full_name":"Hannah Kim","role":"volunteer"}'::jsonb, '2026-08-23T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000108', 'hannah.kim@demo.shiftshare.app', 'Hannah Kim', 'volunteer', 'SS-DE00000108', '2026-08-23T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000109', 'liam.oconnor@demo.shiftshare.app', '{"full_name":"Liam O''Connor","role":"volunteer"}'::jsonb, '2026-08-24T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000109', 'liam.oconnor@demo.shiftshare.app', 'Liam O''Connor', 'volunteer', 'SS-DE00000109', '2026-08-24T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000110', 'nadia.almansoor@demo.shiftshare.app', '{"full_name":"Nadia Al-Mansoor","role":"volunteer"}'::jsonb, '2026-08-25T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000110', 'nadia.almansoor@demo.shiftshare.app', 'Nadia Al-Mansoor', 'volunteer', 'SS-DE00000110', '2026-08-25T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000111', 'mateo.morales@demo.shiftshare.app', '{"full_name":"Mateo Morales","role":"volunteer"}'::jsonb, '2026-08-26T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000111', 'mateo.morales@demo.shiftshare.app', 'Mateo Morales', 'volunteer', 'SS-DE00000111', '2026-08-26T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000112', 'chloe.bennett@demo.shiftshare.app', '{"full_name":"Chloe Bennett","role":"volunteer"}'::jsonb, '2026-08-27T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000112', 'chloe.bennett@demo.shiftshare.app', 'Chloe Bennett', 'volunteer', 'SS-DE00000112', '2026-08-27T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000113', 'tariq.johnson@demo.shiftshare.app', '{"full_name":"Tariq Johnson","role":"volunteer"}'::jsonb, '2026-08-28T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000113', 'tariq.johnson@demo.shiftshare.app', 'Tariq Johnson', 'volunteer', 'SS-DE00000113', '2026-08-28T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000114', 'grace.cho@demo.shiftshare.app', '{"full_name":"Grace Cho","role":"volunteer"}'::jsonb, '2026-08-29T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000114', 'grace.cho@demo.shiftshare.app', 'Grace Cho', 'volunteer', 'SS-DE00000114', '2026-08-29T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;
insert into auth.users (id, email, raw_user_meta_data, created_at) values ('de000000-0000-4000-8000-000000000115', 'lucas.ferreira@demo.shiftshare.app', '{"full_name":"Lucas Ferreira","role":"volunteer"}'::jsonb, '2026-08-30T16:00:00.000Z') on conflict (id) do update set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data;
insert into public.profiles (id, email, full_name, role, verification_code, created_at) values ('de000000-0000-4000-8000-000000000115', 'lucas.ferreira@demo.shiftshare.app', 'Lucas Ferreira', 'volunteer', 'SS-DE00000115', '2026-08-30T16:00:00.000Z') on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role, verification_code = excluded.verification_code;

-- 2. Events (Fall Carnival + Past Completed Events)
insert into public.events (id, organizer_id, slug, title, description, location, timezone, starts_at, ends_at, published, checkin_token, created_at) values ('e0000000-0000-4000-8000-00000000f001', 'de000000-0000-4000-8000-000000000001', 'fall-carnival', 'Fall Carnival', 'Annual school and neighborhood Fall Carnival at Central Park Pavilion with game booths, apple cider & food stands, prize tables, and family activities.', 'Central Park Pavilion, Fremont, CA', 'America/Los_Angeles', '2026-10-17T15:00:00.000Z', '2026-10-17T23:00:00.000Z', true, 'fc11223344556677889900aabbccddeeff11223344556677889900aabbccddee', '2026-09-25T16:00:00.000Z') on conflict (id) do update set title = excluded.title, description = excluded.description, location = excluded.location, published = excluded.published, checkin_token = excluded.checkin_token;
insert into public.events (id, organizer_id, slug, title, description, location, timezone, starts_at, ends_at, published, checkin_token, created_at) values ('e0000000-0000-4000-8000-00000000f002', 'de000000-0000-4000-8000-000000000001', 'neighborhood-harvest-festival', 'Neighborhood Harvest & Book Festival', 'Community book swap, harvest produce tables, and family reading corners at Fremont Main Library Plaza.', 'Fremont Main Library Plaza, Fremont, CA', 'America/Los_Angeles', '2026-09-26T16:00:00.000Z', '2026-09-26T22:00:00.000Z', true, 'nh11223344556677889900aabbccddeeff11223344556677889900aabbccddee', '2026-09-10T16:00:00.000Z') on conflict (id) do update set title = excluded.title, description = excluded.description, location = excluded.location, published = excluded.published, checkin_token = excluded.checkin_token;
insert into public.events (id, organizer_id, slug, title, description, location, timezone, starts_at, ends_at, published, checkin_token, created_at) values ('e0000000-0000-4000-8000-00000000f003', 'de000000-0000-4000-8000-000000000001', 'fremont-library-book-drive', 'Fremont Library Book Sorting & Drive', 'Cataloging donated children''s books and packing classroom literacy crates for local elementary schools.', 'Fremont Main Library, Fremont, CA', 'America/Los_Angeles', '2026-09-12T15:00:00.000Z', '2026-09-13T03:00:00.000Z', true, 'lb11223344556677889900aabbccddeeff11223344556677889900aabbccddee', '2026-09-01T16:00:00.000Z') on conflict (id) do update set title = excluded.title, description = excluded.description, location = excluded.location, published = excluded.published, checkin_token = excluded.checkin_token;
insert into public.events (id, organizer_id, slug, title, description, location, timezone, starts_at, ends_at, published, checkin_token, created_at) values ('e0000000-0000-4000-8000-00000000f004', 'de000000-0000-4000-8000-000000000001', 'lake-elizabeth-shoreline-cleanup', 'Lake Elizabeth Shoreline Cleanup', 'Morning shoreline restoration, mulch spreading, and native plant care around Lake Elizabeth.', 'Lake Elizabeth Boathouse, Fremont, CA', 'America/Los_Angeles', '2026-09-19T15:00:00.000Z', '2026-09-20T02:00:00.000Z', true, 'pk11223344556677889900aabbccddeeff11223344556677889900aabbccddee', '2026-09-05T16:00:00.000Z') on conflict (id) do update set title = excluded.title, description = excluded.description, location = excluded.location, published = excluded.published, checkin_token = excluded.checkin_token;

-- 3. Roles (6 on Fall Carnival + Past Event Roles)
insert into public.roles (id, event_id, name, description, capacity, position, created_at) values ('d0000000-0000-4000-8000-000000000201', 'e0000000-0000-4000-8000-00000000f001', 'Registration', 'Greet families at the main gate, scan tickets, and hand out carnival wristbands and maps.', 12, 0, '2026-09-25T16:00:00.000Z') on conflict (id) do update set name = excluded.name, description = excluded.description, capacity = excluded.capacity, position = excluded.position;
insert into public.roles (id, event_id, name, description, capacity, position, created_at) values ('d0000000-0000-4000-8000-000000000202', 'e0000000-0000-4000-8000-00000000f001', 'Food Stand', 'Serve warm apple cider, popcorn, and bake-sale treats; keep serving counters restocked.', 12, 1, '2026-09-25T16:00:00.000Z') on conflict (id) do update set name = excluded.name, description = excluded.description, capacity = excluded.capacity, position = excluded.position;
insert into public.roles (id, event_id, name, description, capacity, position, created_at) values ('d0000000-0000-4000-8000-000000000203', 'e0000000-0000-4000-8000-00000000f001', 'Games', 'Run ring toss, pumpkin bowling, and bean-bag booths; reset game props and award stamps.', 12, 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set name = excluded.name, description = excluded.description, capacity = excluded.capacity, position = excluded.position;
insert into public.roles (id, event_id, name, description, capacity, position, created_at) values ('d0000000-0000-4000-8000-000000000204', 'e0000000-0000-4000-8000-00000000f001', 'Setup', 'Unload canopies, arrange tables and directional signs, and set up booth banners before doors open.', 10, 3, '2026-09-25T16:00:00.000Z') on conflict (id) do update set name = excluded.name, description = excluded.description, capacity = excluded.capacity, position = excluded.position;
insert into public.roles (id, event_id, name, description, capacity, position, created_at) values ('d0000000-0000-4000-8000-000000000205', 'e0000000-0000-4000-8000-00000000f001', 'Cleanup', 'Fold tables, pack game crates, sort recycling and compost, and leave the pavilion spotless.', 10, 4, '2026-09-25T16:00:00.000Z') on conflict (id) do update set name = excluded.name, description = excluded.description, capacity = excluded.capacity, position = excluded.position;
insert into public.roles (id, event_id, name, description, capacity, position, created_at) values ('d0000000-0000-4000-8000-000000000206', 'e0000000-0000-4000-8000-00000000f001', 'First Aid Helpers', 'Staff the shade & water station, hand out bandages and ice packs, and assist lost-and-found.', 10, 5, '2026-09-25T16:00:00.000Z') on conflict (id) do update set name = excluded.name, description = excluded.description, capacity = excluded.capacity, position = excluded.position;
insert into public.roles (id, event_id, name, description, capacity, position, created_at) values ('d0000000-0000-4000-8000-000000000301', 'e0000000-0000-4000-8000-00000000f002', 'Welcome & Check-in Desk', 'Check in attendees and distribute book-swap tokens.', 4, 0, '2026-09-10T16:00:00.000Z') on conflict (id) do update set name = excluded.name, description = excluded.description, capacity = excluded.capacity, position = excluded.position;
insert into public.roles (id, event_id, name, description, capacity, position, created_at) values ('d0000000-0000-4000-8000-000000000302', 'e0000000-0000-4000-8000-00000000f002', 'Book Exchange Booth', 'Sort incoming books by grade level and help families browse.', 4, 1, '2026-09-10T16:00:00.000Z') on conflict (id) do update set name = excluded.name, description = excluded.description, capacity = excluded.capacity, position = excluded.position;
insert into public.roles (id, event_id, name, description, capacity, position, created_at) values ('d0000000-0000-4000-8000-000000000303', 'e0000000-0000-4000-8000-00000000f002', 'Cider & Bake Stand', 'Pour hot apple cider and manage the community bake table.', 4, 2, '2026-09-10T16:00:00.000Z') on conflict (id) do update set name = excluded.name, description = excluded.description, capacity = excluded.capacity, position = excluded.position;
insert into public.roles (id, event_id, name, description, capacity, position, created_at) values ('d0000000-0000-4000-8000-000000000304', 'e0000000-0000-4000-8000-00000000f002', 'Teardown & Cleanup Crew', 'Box leftover books for library donation and fold tables.', 4, 3, '2026-09-10T16:00:00.000Z') on conflict (id) do update set name = excluded.name, description = excluded.description, capacity = excluded.capacity, position = excluded.position;
insert into public.roles (id, event_id, name, description, capacity, position, created_at) values ('d0000000-0000-4000-8000-000000000401', 'e0000000-0000-4000-8000-00000000f003', 'Book Sorting Lead', 'Lead volunteer sorting teams and label school literacy boxes.', 4, 0, '2026-09-01T16:00:00.000Z') on conflict (id) do update set name = excluded.name, description = excluded.description, capacity = excluded.capacity, position = excluded.position;
insert into public.roles (id, event_id, name, description, capacity, position, created_at) values ('d0000000-0000-4000-8000-000000000501', 'e0000000-0000-4000-8000-00000000f004', 'Shoreline Stewardship Lead', 'Coordinate trail teams and tool check-out at the boathouse.', 4, 0, '2026-09-05T16:00:00.000Z') on conflict (id) do update set name = excluded.name, description = excluded.description, capacity = excluded.capacity, position = excluded.position;

-- 4. Shifts (43 total; 33 on Fall Carnival)
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000201', '2026-10-17T16:00:00.000Z', '2026-10-17T17:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000201', '2026-10-17T17:00:00.000Z', '2026-10-17T18:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000201', '2026-10-17T18:00:00.000Z', '2026-10-17T19:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000201', '2026-10-17T19:00:00.000Z', '2026-10-17T20:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000201', '2026-10-17T20:00:00.000Z', '2026-10-17T21:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000201', '2026-10-17T21:00:00.000Z', '2026-10-17T22:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000202', '2026-10-17T16:00:00.000Z', '2026-10-17T17:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000202', '2026-10-17T17:00:00.000Z', '2026-10-17T18:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000202', '2026-10-17T18:00:00.000Z', '2026-10-17T19:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000202', '2026-10-17T19:00:00.000Z', '2026-10-17T20:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000202', '2026-10-17T20:00:00.000Z', '2026-10-17T21:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000202', '2026-10-17T21:00:00.000Z', '2026-10-17T22:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000013', 'd0000000-0000-4000-8000-000000000203', '2026-10-17T16:00:00.000Z', '2026-10-17T17:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000014', 'd0000000-0000-4000-8000-000000000203', '2026-10-17T17:00:00.000Z', '2026-10-17T18:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000015', 'd0000000-0000-4000-8000-000000000203', '2026-10-17T18:00:00.000Z', '2026-10-17T19:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000016', 'd0000000-0000-4000-8000-000000000203', '2026-10-17T19:00:00.000Z', '2026-10-17T20:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000017', 'd0000000-0000-4000-8000-000000000203', '2026-10-17T20:00:00.000Z', '2026-10-17T21:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000018', 'd0000000-0000-4000-8000-000000000203', '2026-10-17T21:00:00.000Z', '2026-10-17T22:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000019', 'd0000000-0000-4000-8000-000000000204', '2026-10-17T15:00:00.000Z', '2026-10-17T16:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000204', '2026-10-17T16:00:00.000Z', '2026-10-17T17:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000021', 'd0000000-0000-4000-8000-000000000204', '2026-10-17T17:00:00.000Z', '2026-10-17T18:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000204', '2026-10-17T18:00:00.000Z', '2026-10-17T19:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000023', 'd0000000-0000-4000-8000-000000000204', '2026-10-17T19:00:00.000Z', '2026-10-17T20:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000024', 'd0000000-0000-4000-8000-000000000205', '2026-10-17T18:00:00.000Z', '2026-10-17T19:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000025', 'd0000000-0000-4000-8000-000000000205', '2026-10-17T19:00:00.000Z', '2026-10-17T20:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000026', 'd0000000-0000-4000-8000-000000000205', '2026-10-17T20:00:00.000Z', '2026-10-17T21:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000027', 'd0000000-0000-4000-8000-000000000205', '2026-10-17T21:00:00.000Z', '2026-10-17T22:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000028', 'd0000000-0000-4000-8000-000000000205', '2026-10-17T22:00:00.000Z', '2026-10-17T23:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000029', 'd0000000-0000-4000-8000-000000000206', '2026-10-17T16:00:00.000Z', '2026-10-17T17:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000030', 'd0000000-0000-4000-8000-000000000206', '2026-10-17T17:00:00.000Z', '2026-10-17T18:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000031', 'd0000000-0000-4000-8000-000000000206', '2026-10-17T18:00:00.000Z', '2026-10-17T19:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000032', 'd0000000-0000-4000-8000-000000000206', '2026-10-17T19:00:00.000Z', '2026-10-17T20:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000033', 'd0000000-0000-4000-8000-000000000206', '2026-10-17T20:00:00.000Z', '2026-10-17T21:00:00.000Z', 2, '2026-09-25T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-000000000301', '2026-09-26T16:00:00.000Z', '2026-09-26T19:00:00.000Z', 2, '2026-09-10T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-000000000301', '2026-09-26T19:00:00.000Z', '2026-09-26T22:00:00.000Z', 2, '2026-09-10T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000303', 'd0000000-0000-4000-8000-000000000302', '2026-09-26T16:00:00.000Z', '2026-09-26T19:00:00.000Z', 2, '2026-09-10T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000304', 'd0000000-0000-4000-8000-000000000302', '2026-09-26T19:00:00.000Z', '2026-09-26T22:00:00.000Z', 2, '2026-09-10T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000305', 'd0000000-0000-4000-8000-000000000303', '2026-09-26T16:00:00.000Z', '2026-09-26T19:00:00.000Z', 2, '2026-09-10T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000306', 'd0000000-0000-4000-8000-000000000303', '2026-09-26T19:00:00.000Z', '2026-09-26T22:00:00.000Z', 2, '2026-09-10T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000307', 'd0000000-0000-4000-8000-000000000304', '2026-09-26T19:00:00.000Z', '2026-09-26T22:00:00.000Z', 2, '2026-09-10T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000308', 'd0000000-0000-4000-8000-000000000304', '2026-09-26T20:00:00.000Z', '2026-09-26T22:00:00.000Z', 2, '2026-09-10T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000401', 'd0000000-0000-4000-8000-000000000401', '2026-09-12T15:00:00.000Z', '2026-09-13T03:00:00.000Z', 4, '2026-09-01T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;
insert into public.shifts (id, role_id, starts_at, ends_at, capacity, created_at) values ('f0000000-0000-4000-8000-000000000501', 'd0000000-0000-4000-8000-000000000501', '2026-09-19T15:00:00.000Z', '2026-09-20T02:30:00.000Z', 4, '2026-09-05T16:00:00.000Z') on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, capacity = excluded.capacity;

-- 5. Signups (85 total, including standby/waitlist on full shifts)
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000101', 'confirmed', '2026-10-02T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000102', 'confirmed', '2026-10-03T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000113', 'waitlist', '2026-10-05T18:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000002', 'de000000-0000-4000-8000-000000000105', 'confirmed', '2026-10-05T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000002', 'de000000-0000-4000-8000-000000000106', 'confirmed', '2026-10-06T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000003', 'de000000-0000-4000-8000-000000000107', 'confirmed', '2026-10-01T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000007', 'f0000000-0000-4000-8000-000000000003', 'de000000-0000-4000-8000-000000000108', 'confirmed', '2026-10-02T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000008', 'f0000000-0000-4000-8000-000000000004', 'de000000-0000-4000-8000-000000000109', 'confirmed', '2026-10-03T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000009', 'f0000000-0000-4000-8000-000000000004', 'de000000-0000-4000-8000-000000000110', 'confirmed', '2026-10-04T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000010', 'f0000000-0000-4000-8000-000000000005', 'de000000-0000-4000-8000-000000000111', 'confirmed', '2026-10-05T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000011', 'f0000000-0000-4000-8000-000000000006', 'de000000-0000-4000-8000-000000000113', 'confirmed', '2026-10-06T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000012', 'f0000000-0000-4000-8000-000000000006', 'de000000-0000-4000-8000-000000000114', 'confirmed', '2026-10-01T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000013', 'f0000000-0000-4000-8000-000000000007', 'de000000-0000-4000-8000-000000000115', 'confirmed', '2026-10-02T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000014', 'f0000000-0000-4000-8000-000000000007', 'de000000-0000-4000-8000-000000000103', 'confirmed', '2026-10-03T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000015', 'f0000000-0000-4000-8000-000000000007', 'de000000-0000-4000-8000-000000000104', 'waitlist', '2026-10-05T18:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000016', 'f0000000-0000-4000-8000-000000000008', 'de000000-0000-4000-8000-000000000102', 'confirmed', '2026-10-05T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000017', 'f0000000-0000-4000-8000-000000000008', 'de000000-0000-4000-8000-000000000103', 'confirmed', '2026-10-06T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000018', 'f0000000-0000-4000-8000-000000000009', 'de000000-0000-4000-8000-000000000101', 'confirmed', '2026-10-01T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000019', 'f0000000-0000-4000-8000-000000000009', 'de000000-0000-4000-8000-000000000102', 'confirmed', '2026-10-02T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000020', 'f0000000-0000-4000-8000-000000000010', 'de000000-0000-4000-8000-000000000106', 'confirmed', '2026-10-03T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000021', 'f0000000-0000-4000-8000-000000000011', 'de000000-0000-4000-8000-000000000108', 'confirmed', '2026-10-04T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000022', 'f0000000-0000-4000-8000-000000000011', 'de000000-0000-4000-8000-000000000109', 'confirmed', '2026-10-05T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000023', 'f0000000-0000-4000-8000-000000000012', 'de000000-0000-4000-8000-000000000110', 'confirmed', '2026-10-06T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000024', 'f0000000-0000-4000-8000-000000000012', 'de000000-0000-4000-8000-000000000111', 'confirmed', '2026-10-01T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000025', 'f0000000-0000-4000-8000-000000000013', 'de000000-0000-4000-8000-000000000112', 'confirmed', '2026-10-02T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000026', 'f0000000-0000-4000-8000-000000000013', 'de000000-0000-4000-8000-000000000113', 'confirmed', '2026-10-03T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000027', 'f0000000-0000-4000-8000-000000000013', 'de000000-0000-4000-8000-000000000110', 'waitlist', '2026-10-05T18:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000028', 'f0000000-0000-4000-8000-000000000014', 'de000000-0000-4000-8000-000000000114', 'confirmed', '2026-10-05T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000029', 'f0000000-0000-4000-8000-000000000014', 'de000000-0000-4000-8000-000000000115', 'confirmed', '2026-10-06T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000030', 'f0000000-0000-4000-8000-000000000015', 'de000000-0000-4000-8000-000000000103', 'confirmed', '2026-10-01T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000031', 'f0000000-0000-4000-8000-000000000016', 'de000000-0000-4000-8000-000000000103', 'confirmed', '2026-10-02T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000032', 'f0000000-0000-4000-8000-000000000016', 'de000000-0000-4000-8000-000000000104', 'confirmed', '2026-10-03T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000033', 'f0000000-0000-4000-8000-000000000017', 'de000000-0000-4000-8000-000000000105', 'confirmed', '2026-10-04T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000034', 'f0000000-0000-4000-8000-000000000017', 'de000000-0000-4000-8000-000000000106', 'confirmed', '2026-10-05T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000035', 'f0000000-0000-4000-8000-000000000018', 'de000000-0000-4000-8000-000000000107', 'confirmed', '2026-10-06T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000036', 'f0000000-0000-4000-8000-000000000018', 'de000000-0000-4000-8000-000000000108', 'confirmed', '2026-10-01T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000037', 'f0000000-0000-4000-8000-000000000019', 'de000000-0000-4000-8000-000000000109', 'confirmed', '2026-10-02T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000038', 'f0000000-0000-4000-8000-000000000019', 'de000000-0000-4000-8000-000000000110', 'confirmed', '2026-10-03T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000039', 'f0000000-0000-4000-8000-000000000020', 'de000000-0000-4000-8000-000000000111', 'confirmed', '2026-10-04T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000040', 'f0000000-0000-4000-8000-000000000021', 'de000000-0000-4000-8000-000000000113', 'confirmed', '2026-10-05T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000041', 'f0000000-0000-4000-8000-000000000021', 'de000000-0000-4000-8000-000000000101', 'confirmed', '2026-10-06T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000042', 'f0000000-0000-4000-8000-000000000022', 'de000000-0000-4000-8000-000000000115', 'confirmed', '2026-10-01T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000043', 'f0000000-0000-4000-8000-000000000022', 'de000000-0000-4000-8000-000000000104', 'confirmed', '2026-10-02T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000044', 'f0000000-0000-4000-8000-000000000023', 'de000000-0000-4000-8000-000000000102', 'confirmed', '2026-10-03T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000045', 'f0000000-0000-4000-8000-000000000023', 'de000000-0000-4000-8000-000000000105', 'confirmed', '2026-10-04T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000046', 'f0000000-0000-4000-8000-000000000024', 'de000000-0000-4000-8000-000000000105', 'confirmed', '2026-10-05T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000047', 'f0000000-0000-4000-8000-000000000024', 'de000000-0000-4000-8000-000000000106', 'confirmed', '2026-10-06T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000048', 'f0000000-0000-4000-8000-000000000025', 'de000000-0000-4000-8000-000000000107', 'confirmed', '2026-10-01T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000049', 'f0000000-0000-4000-8000-000000000026', 'de000000-0000-4000-8000-000000000110', 'confirmed', '2026-10-02T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000050', 'f0000000-0000-4000-8000-000000000026', 'de000000-0000-4000-8000-000000000112', 'confirmed', '2026-10-03T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000051', 'f0000000-0000-4000-8000-000000000027', 'de000000-0000-4000-8000-000000000112', 'confirmed', '2026-10-04T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000052', 'f0000000-0000-4000-8000-000000000027', 'de000000-0000-4000-8000-000000000115', 'confirmed', '2026-10-05T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000053', 'f0000000-0000-4000-8000-000000000028', 'de000000-0000-4000-8000-000000000112', 'confirmed', '2026-10-06T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000054', 'f0000000-0000-4000-8000-000000000028', 'de000000-0000-4000-8000-000000000113', 'confirmed', '2026-10-01T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000055', 'f0000000-0000-4000-8000-000000000029', 'de000000-0000-4000-8000-000000000114', 'confirmed', '2026-10-02T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000056', 'f0000000-0000-4000-8000-000000000029', 'de000000-0000-4000-8000-000000000104', 'confirmed', '2026-10-03T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000057', 'f0000000-0000-4000-8000-000000000030', 'de000000-0000-4000-8000-000000000104', 'confirmed', '2026-10-04T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000058', 'f0000000-0000-4000-8000-000000000031', 'de000000-0000-4000-8000-000000000109', 'confirmed', '2026-10-05T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000059', 'f0000000-0000-4000-8000-000000000031', 'de000000-0000-4000-8000-000000000110', 'confirmed', '2026-10-06T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000060', 'f0000000-0000-4000-8000-000000000032', 'de000000-0000-4000-8000-000000000108', 'confirmed', '2026-10-01T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000061', 'f0000000-0000-4000-8000-000000000032', 'de000000-0000-4000-8000-000000000111', 'confirmed', '2026-10-02T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000062', 'f0000000-0000-4000-8000-000000000033', 'de000000-0000-4000-8000-000000000107', 'confirmed', '2026-10-03T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000063', 'f0000000-0000-4000-8000-000000000033', 'de000000-0000-4000-8000-000000000113', 'confirmed', '2026-10-04T14:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000064', 'f0000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000000101', 'confirmed', '2026-09-20T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000065', 'f0000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000000102', 'confirmed', '2026-09-20T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000066', 'f0000000-0000-4000-8000-000000000302', 'de000000-0000-4000-8000-000000000103', 'confirmed', '2026-09-21T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000067', 'f0000000-0000-4000-8000-000000000302', 'de000000-0000-4000-8000-000000000104', 'confirmed', '2026-09-21T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000068', 'f0000000-0000-4000-8000-000000000303', 'de000000-0000-4000-8000-000000000105', 'confirmed', '2026-09-22T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000069', 'f0000000-0000-4000-8000-000000000303', 'de000000-0000-4000-8000-000000000106', 'confirmed', '2026-09-22T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000070', 'f0000000-0000-4000-8000-000000000304', 'de000000-0000-4000-8000-000000000107', 'confirmed', '2026-09-23T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000071', 'f0000000-0000-4000-8000-000000000304', 'de000000-0000-4000-8000-000000000108', 'confirmed', '2026-09-23T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000072', 'f0000000-0000-4000-8000-000000000305', 'de000000-0000-4000-8000-000000000109', 'confirmed', '2026-09-24T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000073', 'f0000000-0000-4000-8000-000000000305', 'de000000-0000-4000-8000-000000000110', 'confirmed', '2026-09-24T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000074', 'f0000000-0000-4000-8000-000000000306', 'de000000-0000-4000-8000-000000000111', 'confirmed', '2026-09-24T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000075', 'f0000000-0000-4000-8000-000000000307', 'de000000-0000-4000-8000-000000000112', 'confirmed', '2026-09-25T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000076', 'f0000000-0000-4000-8000-000000000307', 'de000000-0000-4000-8000-000000000113', 'confirmed', '2026-09-25T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000077', 'f0000000-0000-4000-8000-000000000308', 'de000000-0000-4000-8000-000000000114', 'confirmed', '2026-09-25T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000078', 'f0000000-0000-4000-8000-000000000401', 'de000000-0000-4000-8000-000000000101', 'confirmed', '2026-09-05T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000079', 'f0000000-0000-4000-8000-000000000401', 'de000000-0000-4000-8000-000000000102', 'confirmed', '2026-09-05T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000080', 'f0000000-0000-4000-8000-000000000401', 'de000000-0000-4000-8000-000000000103', 'confirmed', '2026-09-05T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000081', 'f0000000-0000-4000-8000-000000000401', 'de000000-0000-4000-8000-000000000104', 'confirmed', '2026-09-05T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000082', 'f0000000-0000-4000-8000-000000000501', 'de000000-0000-4000-8000-000000000101', 'confirmed', '2026-09-10T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000083', 'f0000000-0000-4000-8000-000000000501', 'de000000-0000-4000-8000-000000000105', 'confirmed', '2026-09-10T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000084', 'f0000000-0000-4000-8000-000000000501', 'de000000-0000-4000-8000-000000000106', 'confirmed', '2026-09-10T15:00:00.000Z') on conflict (id) do update set status = excluded.status;
insert into public.signups (id, shift_id, volunteer_id, status, created_at) values ('a0000000-0000-4000-8000-000000000085', 'f0000000-0000-4000-8000-000000000501', 'de000000-0000-4000-8000-000000000107', 'confirmed', '2026-09-10T15:00:00.000Z') on conflict (id) do update set status = excluded.status;

-- 6. Check-ins & Check-outs (40 total on past completed events)
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000064', 'in', 'qr', true, false, '2026-09-26T16:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000064', 'out', 'qr', true, false, '2026-09-26T19:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000065', 'in', 'qr', true, false, '2026-09-26T16:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000065', 'out', 'organizer_adjusted', true, true, '2026-09-26T19:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000066', 'in', 'qr', true, false, '2026-09-26T19:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000066', 'out', 'qr', true, false, '2026-09-26T22:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000067', 'in', 'qr', true, false, '2026-09-26T19:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000067', 'out', 'qr', true, false, '2026-09-26T22:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000068', 'in', 'qr', true, false, '2026-09-26T16:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000068', 'out', 'qr', true, false, '2026-09-26T19:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000069', 'in', 'qr', true, false, '2026-09-26T16:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000069', 'out', 'qr', true, false, '2026-09-26T19:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000070', 'in', 'qr', true, false, '2026-09-26T19:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000070', 'out', 'qr', true, false, '2026-09-26T22:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000071', 'in', 'qr', true, false, '2026-09-26T19:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000016', 'a0000000-0000-4000-8000-000000000071', 'out', 'qr', true, false, '2026-09-26T22:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000072', 'in', 'qr', true, false, '2026-09-26T16:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000018', 'a0000000-0000-4000-8000-000000000072', 'out', 'qr', true, false, '2026-09-26T19:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000019', 'a0000000-0000-4000-8000-000000000073', 'in', 'qr', true, false, '2026-09-26T16:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000073', 'out', 'qr', true, false, '2026-09-26T19:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000074', 'in', 'qr', true, false, '2026-09-26T19:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000022', 'a0000000-0000-4000-8000-000000000074', 'out', 'qr', true, false, '2026-09-26T22:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000023', 'a0000000-0000-4000-8000-000000000075', 'in', 'qr', true, false, '2026-09-26T19:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000024', 'a0000000-0000-4000-8000-000000000075', 'out', 'qr', true, false, '2026-09-26T22:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000025', 'a0000000-0000-4000-8000-000000000078', 'in', 'qr', true, false, '2026-09-12T15:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000026', 'a0000000-0000-4000-8000-000000000078', 'out', 'qr', true, false, '2026-09-13T03:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000027', 'a0000000-0000-4000-8000-000000000079', 'in', 'qr', true, false, '2026-09-12T15:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000028', 'a0000000-0000-4000-8000-000000000079', 'out', 'qr', true, false, '2026-09-13T03:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000029', 'a0000000-0000-4000-8000-000000000080', 'in', 'qr', true, false, '2026-09-12T15:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000030', 'a0000000-0000-4000-8000-000000000080', 'out', 'qr', true, false, '2026-09-13T03:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000081', 'in', 'qr', true, false, '2026-09-12T15:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000081', 'out', 'qr', true, false, '2026-09-13T03:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000033', 'a0000000-0000-4000-8000-000000000082', 'in', 'qr', true, false, '2026-09-19T15:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000034', 'a0000000-0000-4000-8000-000000000082', 'out', 'qr', true, false, '2026-09-20T02:30:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000035', 'a0000000-0000-4000-8000-000000000083', 'in', 'qr', true, false, '2026-09-19T15:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000036', 'a0000000-0000-4000-8000-000000000083', 'out', 'qr', true, false, '2026-09-20T02:30:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000037', 'a0000000-0000-4000-8000-000000000084', 'in', 'qr', true, false, '2026-09-19T15:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000038', 'a0000000-0000-4000-8000-000000000084', 'out', 'qr', true, false, '2026-09-20T02:30:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000039', 'a0000000-0000-4000-8000-000000000085', 'in', 'qr', true, false, '2026-09-19T15:00:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;
insert into public.checkins (id, signup_id, kind, method, verified, adjusted_by_organizer, at) values ('c0000000-0000-4000-8000-000000000040', 'a0000000-0000-4000-8000-000000000085', 'out', 'qr', true, false, '2026-09-20T02:30:00.000Z') on conflict (id) do update set at = excluded.at, verified = excluded.verified, adjusted_by_organizer = excluded.adjusted_by_organizer;

commit;
