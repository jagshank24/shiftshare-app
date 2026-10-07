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
