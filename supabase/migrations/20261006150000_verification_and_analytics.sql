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
