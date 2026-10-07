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
