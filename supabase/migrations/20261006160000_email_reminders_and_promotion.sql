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
