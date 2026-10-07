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
