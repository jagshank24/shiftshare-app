-- ============================================================================
-- RLS test suite
-- ============================================================================
-- Runs the migration's policies as the real API roles (anon / authenticated)
-- with a stubbed `auth.uid()`, and asserts what each person can and cannot do.
--
--   sudo -u postgres psql -d shiftshare_test -v ON_ERROR_STOP=1 -f tests/01_rls_test.sql
--
-- Everything runs in one transaction and ends with ROLLBACK, so the suite can
-- be re-run against the same database.
-- ============================================================================

begin;

-- A regular table rather than a temp table: the API roles need to be able to
-- write to it, and temp schemas aren't reachable from a switched role. The
-- whole script ends in ROLLBACK, so this never persists.
create table public._rls_results (
  section text,
  label   text,
  ok      boolean,
  detail  text
);

grant insert, select on public._rls_results to anon, authenticated;

-- Seed ----------------------------------------------------------------------
-- Done as the table owner, which bypasses RLS. The auth.users inserts fire the
-- handle_new_user trigger, which is itself under test.

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1ace000-0000-4000-8000-000000000001', 'alice@example.com',
   '{"role":"organizer","full_name":"Alice Ortiz"}'),
  ('b0b00000-0000-4000-8000-000000000002', 'bob@example.com',
   '{"role":"organizer","full_name":"Bob Nguyen"}'),
  ('ca401000-0000-4000-8000-000000000003', 'carol@example.com',
   '{"role":"volunteer","full_name":"Carol Diaz"}'),
  ('da7e0000-0000-4000-8000-000000000004', 'dave@example.com',
   '{"role":"volunteer","full_name":"Dave Patel"}'),
  -- Google-style signup: no role in the metadata.
  ('9000e000-0000-4000-8000-000000000005', 'erin@gmail.com',
   '{"full_name":"Erin Kim"}');

insert into public.events (id, organizer_id, title, slug, starts_at, published) values
  ('e0000000-0000-4000-8000-00000000000a', 'a1ace000-0000-4000-8000-000000000001',
   'Alice published', 'alice-published', now() + interval '10 days', true),
  ('e0000000-0000-4000-8000-00000000000d', 'a1ace000-0000-4000-8000-000000000001',
   'Alice draft', 'alice-draft', now() + interval '20 days', false),
  ('e0000000-0000-4000-8000-00000000000b', 'b0b00000-0000-4000-8000-000000000002',
   'Bob published', 'bob-published', now() + interval '30 days', true);

insert into public.roles (id, event_id, name, capacity) values
  ('40000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-00000000000a', 'Check-in table', 3),
  ('40000000-0000-4000-8000-00000000000d', 'e0000000-0000-4000-8000-00000000000d', 'Draft role', 2),
  ('40000000-0000-4000-8000-00000000000b', 'e0000000-0000-4000-8000-00000000000b', 'Bob role', 2);

insert into public.shifts (id, role_id, starts_at, ends_at, capacity) values
  ('50000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-00000000000a',
   now() + interval '10 days', now() + interval '10 days 4 hours', 3),
  ('50000000-0000-4000-8000-00000000000d', '40000000-0000-4000-8000-00000000000d',
   now() + interval '20 days', now() + interval '20 days 4 hours', 2),
  ('50000000-0000-4000-8000-00000000000b', '40000000-0000-4000-8000-00000000000b',
   now() + interval '30 days', now() + interval '30 days 4 hours', 2);

-- Carol signs up for a shift on Alice's published event.
insert into public.signups (id, shift_id, volunteer_id) values
  ('50000004-0000-4000-8000-00000000000c', '50000000-0000-4000-8000-00000000000a',
   'ca401000-0000-4000-8000-000000000003');


-- ============================================================================
-- 1. anon — what a signed-out visitor sees
-- ============================================================================
do $$
declare
  n int;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';

  execute 'select count(*) from public.events' into n;
  insert into public._rls_results values ('anon', 'sees published events', n = 2, format('saw %s of 2', n));

  execute $q$select count(*) from public.events where slug = 'alice-draft'$q$ into n;
  insert into public._rls_results values ('anon', 'cannot see unpublished drafts', n = 0, format('saw %s', n));

  execute $q$select count(*) from public.roles$q$ into n;
  insert into public._rls_results values ('anon', 'sees roles only for published events', n = 2, format('saw %s of 2', n));

  execute $q$select count(*) from public.shifts$q$ into n;
  insert into public._rls_results values ('anon', 'sees shifts only for published events', n = 2, format('saw %s of 2', n));

  -- Signed-out visitors get nothing from these tables. Depending on grants
  -- they're stopped either by the table privilege (bare Postgres + the
  -- migration's grants) or by RLS returning zero rows (Supabase's default
  -- grants, which are broader). Both are correct, so accept either.
  begin
    execute 'select count(*) from public.signups' into n;
    insert into public._rls_results values (
      'anon', 'cannot read signups', n = 0,
      case when n = 0 then 'RLS returned 0 rows' else format('LEAK: saw %s', n) end);
  exception when insufficient_privilege then
    insert into public._rls_results values ('anon', 'cannot read signups', true, 'table privilege denied');
  end;

  begin
    execute 'select count(*) from public.profiles' into n;
    insert into public._rls_results values (
      'anon', 'cannot read profiles', n = 0,
      case when n = 0 then 'RLS returned 0 rows' else format('LEAK: saw %s', n) end);
  exception when insufficient_privilege then
    insert into public._rls_results values ('anon', 'cannot read profiles', true, 'table privilege denied');
  end;

  begin
    execute $q$insert into public.events (organizer_id, title, slug, starts_at)
              values ('a1ace000-0000-4000-8000-000000000001', 'Sneaky', 'sneaky', now())$q$;
    insert into public._rls_results values ('anon', 'cannot create events', false, 'insert succeeded');
  exception when insufficient_privilege then
    insert into public._rls_results values ('anon', 'cannot create events', true, 'blocked by RLS');
  end;

  execute 'reset role';
end
$$;


-- ============================================================================
-- 2. Organizer — "edit only their own"
-- ============================================================================
do $$
declare
  n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"a1ace000-0000-4000-8000-000000000001"}', true);
  perform set_config('request.jwt.claim.sub', 'a1ace000-0000-4000-8000-000000000001', true);
  execute 'set local role authenticated';

  -- Alice sees her own draft plus every published event.
  execute 'select count(*) from public.events' into n;
  insert into public._rls_results values ('organizer', 'sees own drafts + published events', n = 3, format('saw %s of 3', n));

  execute $q$update public.events set title = 'Alice published v2' where slug = 'alice-published'$q$;
  get diagnostics n = row_count;
  insert into public._rls_results values ('organizer', 'can update own event', n = 1, format('%s rows', n));

  execute $q$update public.events set title = 'Hijacked' where slug = 'bob-published'$q$;
  get diagnostics n = row_count;
  insert into public._rls_results values ('organizer', 'cannot update another organizer''s event', n = 0, format('%s rows', n));

  execute $q$delete from public.events where slug = 'bob-published'$q$;
  get diagnostics n = row_count;
  insert into public._rls_results values ('organizer', 'cannot delete another organizer''s event', n = 0, format('%s rows', n));

  -- Reassigning an event to another organizer is caught by the policy's
  -- WITH CHECK, so it raises rather than quietly updating zero rows.
  begin
    execute $q$update public.events set organizer_id = 'b0b00000-0000-4000-8000-000000000002'
              where slug = 'alice-draft'$q$;
    get diagnostics n = row_count;
    insert into public._rls_results values (
      'organizer', 'cannot hand event to someone else', n = 0,
      case when n = 0 then '0 rows updated' else format('LEAK: %s rows', n) end);
  exception when insufficient_privilege then
    insert into public._rls_results values ('organizer', 'cannot hand event to someone else', true, 'blocked by WITH CHECK');
  end;

  begin
    execute $q$insert into public.events (organizer_id, title, slug, starts_at)
              values ('b0b00000-0000-4000-8000-000000000002', 'For Bob', 'for-bob', now())$q$;
    insert into public._rls_results values ('organizer', 'cannot create an event for someone else', false, 'insert succeeded');
  exception when insufficient_privilege then
    insert into public._rls_results values ('organizer', 'cannot create an event for someone else', true, 'blocked by RLS');
  end;

  -- Roles and shifts on Bob's event are off limits too.
  execute $q$update public.roles set name = 'Hijacked' where id = '40000000-0000-4000-8000-00000000000b'$q$;
  get diagnostics n = row_count;
  insert into public._rls_results values ('organizer', 'cannot edit another organizer''s roles', n = 0, format('%s rows', n));

  execute $q$update public.shifts set capacity = 99 where id = '50000000-0000-4000-8000-00000000000b'$q$;
  get diagnostics n = row_count;
  insert into public._rls_results values ('organizer', 'cannot edit another organizer''s shifts', n = 0, format('%s rows', n));

  -- But Alice can edit her own.
  execute $q$update public.shifts set capacity = 5 where id = '50000000-0000-4000-8000-00000000000a'$q$;
  get diagnostics n = row_count;
  insert into public._rls_results values ('organizer', 'can edit own shifts', n = 1, format('%s rows', n));

  execute $q$insert into public.roles (event_id, name, capacity)
            values ('e0000000-0000-4000-8000-00000000000a', 'Cleanup', 4)$q$;
  get diagnostics n = row_count;
  insert into public._rls_results values ('organizer', 'can add roles to own event', n = 1, format('%s rows', n));

  -- Alice can see the volunteer who signed up for her event.
  execute $q$select count(*) from public.profiles where email = 'carol@example.com'$q$ into n;
  insert into public._rls_results values ('organizer', 'can read volunteers on own event', n = 1, format('%s rows', n));

  -- …but not Dave, who has never signed up for anything of hers.
  execute $q$select count(*) from public.profiles where email = 'dave@example.com'$q$ into n;
  insert into public._rls_results values ('organizer', 'cannot read unrelated profiles', n = 0, format('%s rows', n));

  execute 'select count(*) from public.signups' into n;
  insert into public._rls_results values ('organizer', 'can read signups on own event', n = 1, format('%s rows', n));

  execute 'reset role';
end
$$;


-- ============================================================================
-- 3. Volunteer — "manage only their own signups"
-- ============================================================================
do $$
declare
  n int;
  v_carol constant uuid := 'ca401000-0000-4000-8000-000000000003';
  v_dave  constant uuid := 'da7e0000-0000-4000-8000-000000000004';
  v_shift constant uuid := '50000000-0000-4000-8000-00000000000a';
begin
  perform set_config('request.jwt.claims', '{"sub":"ca401000-0000-4000-8000-000000000003"}', true);
  perform set_config('request.jwt.claim.sub', 'ca401000-0000-4000-8000-000000000003', true);
  execute 'set local role authenticated';

  execute 'select count(*) from public.signups' into n;
  insert into public._rls_results values ('volunteer', 'sees own signups', n = 1, format('saw %s', n));

  -- Carol signs herself up for Bob's published event.
  execute format(
    'insert into public.signups (shift_id, volunteer_id) values (%L, %L)',
    '50000000-0000-4000-8000-00000000000b', v_carol);
  execute $q$select count(*) from public.signups$q$ into n;
  insert into public._rls_results values ('volunteer', 'can sign self up for a published shift', n = 2, format('saw %s', n));

  -- Signing someone else up is not allowed.
  begin
    execute format(
      'insert into public.signups (shift_id, volunteer_id) values (%L, %L)',
      '50000000-0000-4000-8000-00000000000b', v_dave);
    insert into public._rls_results values ('volunteer', 'cannot sign up another volunteer', false, 'insert succeeded');
  exception when insufficient_privilege then
    insert into public._rls_results values ('volunteer', 'cannot sign up another volunteer', true, 'blocked by RLS');
  end;

  -- Nor for an unpublished event.
  begin
    execute format(
      'insert into public.signups (shift_id, volunteer_id) values (%L, %L)',
      '50000000-0000-4000-8000-00000000000d', v_carol);
    insert into public._rls_results values ('volunteer', 'cannot sign up for an unpublished event', false, 'insert succeeded');
  exception when insufficient_privilege then
    insert into public._rls_results values ('volunteer', 'cannot sign up for an unpublished event', true, 'blocked by RLS');
  end;

  -- Duplicate signups are stopped by the unique constraint.
  begin
    execute format(
      'insert into public.signups (shift_id, volunteer_id) values (%L, %L)', v_shift, v_carol);
    insert into public._rls_results values ('volunteer', 'cannot sign up twice for one shift', false, 'insert succeeded');
  exception when unique_violation then
    insert into public._rls_results values ('volunteer', 'cannot sign up twice for one shift', true, 'unique constraint');
  end;

  -- Carol can cancel her own signup.
  execute format('update public.signups set status = %L where volunteer_id = %L', 'cancelled', v_carol);
  get diagnostics n = row_count;
  insert into public._rls_results values ('volunteer', 'can cancel own signup', n = 2, format('%s rows', n));

  -- Dave sees nothing of Carol's.
  perform set_config('request.jwt.claims', '{"sub":"da7e0000-0000-4000-8000-000000000004"}', true);
  perform set_config('request.jwt.claim.sub', 'da7e0000-0000-4000-8000-000000000004', true);
  execute 'select count(*) from public.signups' into n;
  insert into public._rls_results values ('volunteer', 'other volunteers see no signups', n = 0, format('saw %s', n));

  execute $q$update public.signups set status = 'confirmed'$q$;
  get diagnostics n = row_count;
  insert into public._rls_results values ('volunteer', 'cannot touch another volunteer''s signup', n = 0, format('%s rows', n));

  execute $q$select count(*) from public.profiles where email = 'carol@example.com'$q$ into n;
  insert into public._rls_results values ('volunteer', 'cannot read another profile', n = 0, format('saw %s', n));

  -- Dave can read his own profile and update it.
  execute $q$select count(*) from public.profiles where email = 'dave@example.com'$q$ into n;
  insert into public._rls_results values ('volunteer', 'can read own profile', n = 1, format('saw %s', n));

  execute $q$update public.profiles set full_name = 'Dave P.' where id = 'da7e0000-0000-4000-8000-000000000004'$q$;
  get diagnostics n = row_count;
  insert into public._rls_results values ('volunteer', 'can update own profile', n = 1, format('%s rows', n));

  execute $q$update public.profiles set role = 'organizer' where email = 'carol@example.com'$q$;
  get diagnostics n = row_count;
  insert into public._rls_results values ('volunteer', 'cannot edit another profile', n = 0, format('%s rows', n));

  execute 'reset role';
end
$$;


-- ============================================================================
-- 4. Check-ins — volunteers tap, organizers verify
-- ============================================================================
do $$
declare
  n int;
  v_signup constant uuid := '50000004-0000-4000-8000-00000000000c';
  v_checkin uuid;
  v_verified boolean;
  v_verified_by uuid;
begin
  -- Carol taps in.
  perform set_config('request.jwt.claims', '{"sub":"ca401000-0000-4000-8000-000000000003"}', true);
  perform set_config('request.jwt.claim.sub', 'ca401000-0000-4000-8000-000000000003', true);
  execute 'set local role authenticated';

  execute format('insert into public.checkins (signup_id, kind) values (%L, %L) returning id', v_signup, 'in')
    into v_checkin;
  insert into public._rls_results values ('checkin', 'volunteer can check in to own shift', v_checkin is not null, 'row created');

  -- Creating a pre-verified checkin is refused by the trigger.
  begin
    execute format(
      'insert into public.checkins (signup_id, kind, verified, verified_by, verified_at) '
      'values (%L, %L, true, %L, now())',
      v_signup, 'out', 'ca401000-0000-4000-8000-000000000003');
    insert into public._rls_results values ('checkin', 'cannot insert a verified checkin', false, 'insert succeeded');
  exception when check_violation then
    insert into public._rls_results values ('checkin', 'cannot insert a verified checkin', true, 'blocked by trigger');
  end;

  -- …and so is flipping the flag afterwards.
  begin
    execute format('update public.checkins set verified = true where id = %L', v_checkin);
    insert into public._rls_results values ('checkin', 'volunteer cannot self-verify', false, 'update succeeded');
  exception when insufficient_privilege then
    insert into public._rls_results values ('checkin', 'volunteer cannot self-verify', true, 'blocked by trigger');
  end;

  -- Carol can still fix an honest mistake.
  execute format('update public.checkins set at = now() - interval ''1 hour'' where id = %L', v_checkin);
  get diagnostics n = row_count;
  insert into public._rls_results values ('checkin', 'volunteer can correct own tap time', n = 1, format('%s rows', n));

  -- Dave cannot see Carol's checkins.
  perform set_config('request.jwt.claims', '{"sub":"da7e0000-0000-4000-8000-000000000004"}', true);
  perform set_config('request.jwt.claim.sub', 'da7e0000-0000-4000-8000-000000000004', true);
  execute 'select count(*) from public.checkins' into n;
  insert into public._rls_results values ('checkin', 'other volunteers cannot see checkins', n = 0, format('saw %s', n));

  -- Alice (organizer of the event) verifies the hours.
  perform set_config('request.jwt.claims', '{"sub":"a1ace000-0000-4000-8000-000000000001"}', true);
  perform set_config('request.jwt.claim.sub', 'a1ace000-0000-4000-8000-000000000001', true);

  execute format('update public.checkins set verified = true where id = %L', v_checkin);
  get diagnostics n = row_count;
  execute format('select verified, verified_by from public.checkins where id = %L', v_checkin)
    into v_verified, v_verified_by;

  insert into public._rls_results values ('checkin', 'organizer can verify hours', n = 1, format('%s rows', n));
  insert into public._rls_results values (
    'checkin', 'verification stamps organizer and time',
    v_verified and v_verified_by = 'a1ace000-0000-4000-8000-000000000001',
    format('verified=%s by=%s', v_verified, v_verified_by));

  -- Bob organizes a different event and must not be able to verify these hours.
  perform set_config('request.jwt.claims', '{"sub":"b0b00000-0000-4000-8000-000000000002"}', true);
  perform set_config('request.jwt.claim.sub', 'b0b00000-0000-4000-8000-000000000002', true);

  execute 'select count(*) from public.checkins' into n;
  insert into public._rls_results values ('checkin', 'unrelated organizer cannot see checkins', n = 0, format('saw %s', n));

  execute 'reset role';
end
$$;


-- ============================================================================
-- 5. Signup trigger — profiles
-- ============================================================================
do $$
declare
  v_role public.user_role;
  v_name text;
begin
  select role, full_name into v_role, v_name
  from public.profiles where id = 'a1ace000-0000-4000-8000-000000000001';
  insert into public._rls_results values ('trigger', 'email signup saves chosen role', v_role = 'organizer', format('role=%s', v_role));

  select role, full_name into v_role, v_name
  from public.profiles where id = 'ca401000-0000-4000-8000-000000000003';
  insert into public._rls_results values ('trigger', 'volunteer role saved', v_role = 'volunteer', format('role=%s', v_role));

  select role, full_name into v_role, v_name
  from public.profiles where id = '9000e000-0000-4000-8000-000000000005';
  insert into public._rls_results values (
    'trigger', 'google signup gets name but no role',
    v_role is null and v_name = 'Erin Kim',
    format('role=%s name=%s', v_role, v_name));
end
$$;


-- ============================================================================
-- 6. Signup RPCs — capacity, standby and schedule clashes
-- ============================================================================
-- The public event page doesn't insert into `signups` directly; it calls
-- `sign_up_for_shift`, which owns the rules. These checks are about those
-- rules holding under the real API roles.
--
-- The fixtures are created here rather than in the seed on purpose: the counts
-- asserted in the sections above must not move.
do $$
declare
  n       int;
  v_stand int;
  result  jsonb;
  v_event uuid := 'e0000000-0000-4000-8000-0000000000e2';
  v_role  uuid := 'a0000000-0000-4000-8000-0000000000b2';
  -- Fills with one signup.
  s_first uuid := '50000000-0000-4000-8000-0000000000b1';
  -- Runs straight after s_first — back-to-back, so allowed.
  s_next  uuid := '50000000-0000-4000-8000-0000000000b2';
  -- Overlaps both of the above.
  s_clash uuid := '50000000-0000-4000-8000-0000000000b3';
  -- Already over.
  s_past  uuid := '50000000-0000-4000-8000-0000000000b4';
  -- On Alice's draft event.
  s_draft uuid := '50000000-0000-4000-8000-00000000000d';
  v_carol text := 'ca401000-0000-4000-8000-000000000003';
  v_dave  text := 'da7e0000-0000-4000-8000-000000000004';
begin
  execute 'reset role';

  insert into public.events (id, organizer_id, title, slug, location, starts_at, ends_at,
                             published, timezone)
  values (v_event, 'b0b00000-0000-4000-8000-000000000002', 'RPC event', 'rpc-event',
          'Fremont Library',
          (current_date + 10)::timestamptz + interval '9 hours',
          (current_date + 10)::timestamptz + interval '12 hours',
          true, 'America/Los_Angeles');

  insert into public.roles (id, event_id, name, description, capacity)
  values (v_role, v_event, 'Check-in table', 'Greet people.', 5);

  insert into public.shifts (id, role_id, starts_at, ends_at, capacity) values
    (s_first, v_role, (current_date + 10)::timestamptz + interval '9 hours',
                       (current_date + 10)::timestamptz + interval '10 hours 30 minutes', 1),
    (s_next,  v_role, (current_date + 10)::timestamptz + interval '10 hours 30 minutes',
                       (current_date + 10)::timestamptz + interval '12 hours', 2),
    (s_clash, v_role, (current_date + 10)::timestamptz + interval '9 hours 30 minutes',
                       (current_date + 10)::timestamptz + interval '11 hours', 2),
    (s_past,  v_role, now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 1);

  -- ---- a signed-out visitor ------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';

  -- Counting spots is public: that's the point of a shareable link.
  execute format($q$select count(*) from public.shift_signup_counts(%L)$q$, v_event) into n;
  insert into public._rls_results values ('rpc', 'anon may read spot counts', n = 4, format('%s shifts', n));

  -- Claiming one is not.
  begin
    execute format('select public.sign_up_for_shift(%L)', s_first) into result;
    insert into public._rls_results values ('rpc', 'anon cannot claim a spot', false, 'allowed!');
  exception when insufficient_privilege then
    insert into public._rls_results values ('rpc', 'anon cannot claim a spot', true, 'permission denied');
  end;

  -- A draft's counts stay private.
  execute format($q$select count(*) from public.shift_signup_counts(%L)$q$,
                 'e0000000-0000-4000-8000-00000000000d') into n;
  insert into public._rls_results values ('rpc', 'anon cannot read a draft''s counts', n = 0, format('%s rows', n));

  execute 'reset role';

  -- ---- Carol claims a spot -------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_carol, true);
  execute 'set local role authenticated';

  execute format('select public.sign_up_for_shift(%L)', s_first) into result;
  insert into public._rls_results values ('rpc', 'claims an open spot',
    result->>'code' = 'confirmed', result->>'code');

  -- The row belongs to the caller — there is no parameter for anyone else.
  select count(*) into n from public.signups where shift_id = s_first;
  insert into public._rls_results values ('rpc', 'signs up only the caller', n = 1, format('%s rows', n));

  execute format('select public.sign_up_for_shift(%L)', s_first) into result;
  insert into public._rls_results values ('rpc', 'a second tap is not a second spot',
    result->>'code' = 'already', result->>'code');

  -- Back-to-back is not a clash.
  execute format('select public.sign_up_for_shift(%L)', s_next) into result;
  insert into public._rls_results values ('rpc', 'allows the shift straight after',
    result->>'code' = 'confirmed', result->>'code');

  -- Overlapping is.
  execute format('select public.sign_up_for_shift(%L)', s_clash) into result;
  insert into public._rls_results values ('rpc', 'refuses a clashing shift',
    result->>'code' = 'overlap', result->>'code');
  insert into public._rls_results values ('rpc', 'names the shift it clashes with',
    result->'conflict'->>'role' is not null, coalesce(result->'conflict'->>'role', 'none'));
  insert into public._rls_results values ('rpc', 'reports the clashing event''s timezone',
    result->'conflict'->>'timezone' is not null, coalesce(result->'conflict'->>'timezone', 'none'));

  execute format('select public.cancel_signup(%L)', s_next) into result;
  insert into public._rls_results values ('rpc', 'cancels a claimed spot',
    result->>'code' = 'cancelled', result->>'code');

  select count(*) into n from public.signups
   where shift_id = s_next and status = 'confirmed';
  insert into public._rls_results values ('rpc', 'a canceled spot is free again', n = 0, format('%s claimed', n));

  -- Changing their mind puts them back on the same row.
  execute format('select public.sign_up_for_shift(%L)', s_next) into result;
  insert into public._rls_results values ('rpc', 're-signing up after canceling works',
    result->>'code' = 'confirmed', result->>'code');

  execute format('select public.cancel_signup(%L)', s_clash) into result;
  insert into public._rls_results values ('rpc', 'canceling nothing says so',
    result->>'code' = 'not_signed_up', result->>'code');

  -- A finished shift is not a shift you can volunteer for.
  execute format('select public.sign_up_for_shift(%L)', s_past) into result;
  insert into public._rls_results values ('rpc', 'refuses a shift that is over',
    result->>'code' = 'past', result->>'code');

  execute format('select public.sign_up_for_shift(%L)', s_draft) into result;
  insert into public._rls_results values ('rpc', 'refuses a draft event''s shift',
    result->>'code' = 'not_published', result->>'code');

  execute format('select public.sign_up_for_shift(%L)', '50000000-0000-4000-8000-00000000dead') into result;
  insert into public._rls_results values ('rpc', 'says when a shift is gone',
    result->>'code' = 'not_found', result->>'code');

  -- ---- Dave, on a shift that is already full ------------------------------
  perform set_config('request.jwt.claim.sub', v_dave, true);

  execute format('select public.sign_up_for_shift(%L)', s_first) into result;
  insert into public._rls_results values ('rpc', 'joins standby when the shift is full',
    result->>'code' = 'waitlist', result->>'code');

  execute format('select public.sign_up_for_shift(%L)', s_first) into result;
  insert into public._rls_results values ('rpc', 'does not queue twice',
    result->>'code' = 'already_waitlist', result->>'code');

  -- Standby is not a place; it doesn't eat the spot. Read through the public
  -- counts on purpose: Dave cannot see Carol's signup row, and shouldn't be
  -- able to — that's the policy working, not a gap.
  select taken, standing_by into n, v_stand
    from public.shift_signup_counts(v_event) where shift_id = s_first;
  insert into public._rls_results values ('rpc', 'standby does not take a spot', n = 1, format('%s taken', n));

  -- ---- counts agree with all of that --------------------------------------
  perform set_config('request.jwt.claim.sub', v_carol, true);

  select taken, standing_by into n, v_stand
    from public.shift_signup_counts(v_event) where shift_id = s_first;
  insert into public._rls_results values ('rpc', 'counts the claimed spots', n = 1, format('%s taken', n));
  insert into public._rls_results values ('rpc', 'counts standby separately', v_stand = 1, format('%s waiting', v_stand));

  -- ---- standby is not a commitment ---------------------------------------
  -- Dave is waiting for a place on s_first (fills with one signup, which Carol
  -- holds). Waiting there must not stop him volunteering for something that
  -- overlaps it — and if he does, his standby place has to go, or the
  -- organizer promoting him later would double-book him.
  perform set_config('request.jwt.claim.sub', v_dave, true);

  execute format('select public.sign_up_for_shift(%L)', s_clash) into result;
  insert into public._rls_results values ('rpc', 'a standby place does not block a signup',
    result->>'code' = 'confirmed', result->>'code');

  insert into public._rls_results values ('rpc', 'confirming reports the standby place it took back',
    (result->>'released_standby')::int = 1, coalesce(result->>'released_standby', 'absent'));

  select count(*) into n from public.signups
   where shift_id = s_first and volunteer_id = v_dave::uuid and status = 'waitlist';
  insert into public._rls_results values ('rpc', 'the overlapping standby place is released',
    n = 0, format('%s left waiting', n));

  -- Standby on a shift that does not overlap is left alone.
  perform set_config('request.jwt.claim.sub', v_carol, true);
  execute format('select public.sign_up_for_shift(%L)', s_clash) into result;

  perform set_config('request.jwt.claim.sub', v_dave, true);
  execute format('select public.cancel_signup(%L)', s_clash) into result;

  -- Dave cancels: Carol's row must be untouched.
  perform set_config('request.jwt.claim.sub', v_dave, true);
  execute format('select public.cancel_signup(%L)', s_first) into result;

  perform set_config('request.jwt.claim.sub', v_carol, true);
  select count(*) into n from public.signups
   where shift_id = s_first and status = 'confirmed';
  insert into public._rls_results values ('rpc', 'canceling touches only your own row',
    n = 1, format('%s still claimed', n));

  execute 'reset role';
end
$$;


-- ============================================================================
-- 8. QR Check-in & Check-out RPCs (qr_scan_checkin, refresh_checkin_token,
--    validate_checkin_token, organizer_set_checkout)
-- ============================================================================
do $$
declare
  v_alice text := 'a1ace000-0000-4000-8000-000000000001';
  v_carol text := 'ca401000-0000-4000-8000-000000000003';
  v_dave  text := 'da7e0000-0000-4000-8000-000000000004';

  e_qr      uuid := 'e0000000-0000-4000-8000-0000000000c1';
  r_qr      uuid := '30000000-0000-4000-8000-0000000000c1';
  s_now     uuid := '40000000-0000-4000-8000-0000000000c1';
  s_future  uuid := '40000000-0000-4000-8000-0000000000c2';

  v_token     text;
  v_new_token text;
  v_signup    uuid;
  res         jsonb;
  n           int;
begin
  execute 'reset role';

  -- Seed a published event with one shift starting 10m ago (within [-30m,+30m])
  -- and one shift starting 3 hours from now (outside window).
  insert into public.events (id, organizer_id, title, slug, starts_at, ends_at, published, checkin_token)
  values (
    e_qr, v_alice::uuid, 'QR Checkin Carnival', 'qr-checkin-carnival',
    now() - interval '1 hour', now() + interval '5 hours', true,
    'initial-secret-token-123'
  );

  insert into public.roles (id, event_id, name, capacity, position)
  values (r_qr, e_qr, 'Welcome Booth', 4, 0);

  insert into public.shifts (id, role_id, starts_at, ends_at, capacity) values
    (s_now,    r_qr, now() - interval '10 minutes', now() + interval '80 minutes', 2),
    (s_future, r_qr, now() + interval '3 hours',    now() + interval '4 hours',    2);

  v_token := 'initial-secret-token-123';

  -- 1. Anon / logged-out token validation works
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';

  res := public.validate_checkin_token(e_qr, v_token);
  insert into public._rls_results values ('qr', 'validate_checkin_token accepts valid token',
    (res->>'valid')::boolean = true, res::text);

  res := public.validate_checkin_token(e_qr, 'wrong-token');
  insert into public._rls_results values ('qr', 'validate_checkin_token rejects invalid token',
    (res->>'valid')::boolean = false and res->>'code' = 'invalid_token', res::text);

  execute 'reset role';

  -- 2. Non-organizer cannot rotate token; organizer can rotate token
  perform set_config('request.jwt.claim.sub', v_carol, true);
  execute 'set local role authenticated';

  res := public.refresh_checkin_token(e_qr);
  insert into public._rls_results values ('qr', 'volunteer cannot refresh QR token',
    res->>'code' = 'forbidden', res::text);

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_alice, true);
  execute 'set local role authenticated';

  res := public.refresh_checkin_token(e_qr);
  v_new_token := res->>'token';
  insert into public._rls_results values ('qr', 'organizer refreshes QR token and invalidates old token',
    res->>'code' = 'refreshed' and v_new_token is not null and v_new_token <> v_token, res::text);

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_carol, true);
  execute 'set local role authenticated';

  res := public.qr_scan_checkin(e_qr, v_token);
  insert into public._rls_results values ('qr', 'old token is rejected after refresh',
    res->>'code' = 'invalid_token', res::text);

  -- 3. Volunteer not signed up gets not_signed_up
  res := public.qr_scan_checkin(e_qr, v_new_token);
  insert into public._rls_results values ('qr', 'unsigned-up volunteer gets not_signed_up',
    res->>'code' = 'not_signed_up', res::text);

  -- 4. Volunteer signed up only for future shift (> 30m away) gets outside_window
  perform public.sign_up_for_shift(s_future);
  res := public.qr_scan_checkin(e_qr, v_new_token);
  insert into public._rls_results values ('qr', 'shift outside [-30m, +30m] returns outside_window + organizer contact',
    res->>'code' = 'outside_window' and res->>'organizer_email' = 'alice@example.com', res::text);

  -- 5. Volunteer has confirmed signup for shift within [-30m, +30m] window -> qr_scan_checkin checks them IN
  execute 'reset role';
  insert into public.signups (id, shift_id, volunteer_id, status)
  values ('50000004-0000-4000-8000-0000000000c1', s_now, v_carol::uuid, 'confirmed')
  returning id into v_signup;

  perform set_config('request.jwt.claim.sub', v_carol, true);
  execute 'set local role authenticated';

  res := public.qr_scan_checkin(e_qr, v_new_token);
  insert into public._rls_results values ('qr', 'shift within [-30m, +30m] checks volunteer IN',
    res->>'code' = 'checked_in' and res->>'role_name' = 'Welcome Booth', res::text);

  -- Move check-in time back 90 minutes (1.50 hours) so check-out computes non-zero server hours
  execute 'reset role';
  update public.checkins
     set at = now() - interval '90 minutes'
   where signup_id = v_signup and kind = 'in';

  -- 6. Second scan when already checked in checks volunteer OUT and computes hours to 2 decimals
  perform set_config('request.jwt.claim.sub', v_carol, true);
  execute 'set local role authenticated';

  res := public.qr_scan_checkin(e_qr, v_new_token);
  insert into public._rls_results values ('qr', 'second scan checks volunteer OUT with 1.50 shift hours',
    res->>'code' = 'checked_out' and (res->>'shift_hours')::numeric = 1.50, res::text);

  -- 7. Duplicate check-in / check-out prevention (idempotency + unique constraint)
  perform public.cancel_signup(s_future);
  res := public.qr_scan_checkin(e_qr, v_new_token);
  insert into public._rls_results values ('qr', 'third scan is idempotent (already_checked_out, no duplicate rows)',
    res->>'code' = 'already_checked_out' and (res->>'shift_hours')::numeric = 1.50, res::text);

  select count(*) into n from public.checkins where signup_id = v_signup;
  insert into public._rls_results values ('qr', 'exactly 1 in and 1 out checkin exist for the signup',
    n = 2, format('%s rows', n));

  -- 8. Organizer manual check-out sets time and flags adjusted_by_organizer = true
  execute 'reset role';
  insert into public.signups (id, shift_id, volunteer_id, status)
  values ('50000004-0000-4000-8000-0000000000c2', s_now, v_dave::uuid, 'confirmed')
  returning id into v_signup;

  perform set_config('request.jwt.claim.sub', v_dave, true);
  execute 'set local role authenticated';
  perform public.qr_scan_checkin(e_qr, v_new_token);

  -- Set Dave's check-in to 2 hours ago
  execute 'reset role';
  update public.checkins
     set at = now() - interval '2 hours'
   where signup_id = v_signup and kind = 'in';

  -- Non-organizer cannot call organizer_set_checkout
  perform set_config('request.jwt.claim.sub', v_carol, true);
  execute 'set local role authenticated';
  res := public.organizer_set_checkout(v_signup, now());
  insert into public._rls_results values ('qr', 'volunteer cannot call organizer_set_checkout',
    res->>'code' = 'forbidden', res::text);

  -- Organizer sets Dave's check-out to 30 minutes ago (1.50 hours worked)
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_alice, true);
  execute 'set local role authenticated';
  res := public.organizer_set_checkout(v_signup, now() - interval '30 minutes');
  insert into public._rls_results values ('qr', 'organizer manually sets checkout and flags adjusted_by_organizer',
    res->>'code' = 'adjusted'
    and (res->>'adjusted_by_organizer')::boolean = true
    and (res->>'shift_hours')::numeric = 1.50,
    res::text);

  -- 9. Public certificate verification (/verify/[code]) as anon (no login required)
  execute 'reset role';
  update public.profiles
     set verification_code = 'SS-CAROL2026X'
   where id = v_carol::uuid;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';

  res := public.verify_volunteer_certificate('SS-CAROL2026X');
  insert into public._rls_results values ('verify', 'anon can verify valid certificate code and read hours',
    (res->>'valid')::boolean = true
    and res->>'volunteer_name' = 'Carol Diaz'
    and (res->>'total_hours')::numeric = 1.50,
    res::text);

  res := public.verify_volunteer_certificate('SS-CAROL2026X--' || e_qr::text);
  insert into public._rls_results values ('verify', 'anon can verify single-event certificate code',
    (res->>'valid')::boolean = true
    and jsonb_array_length(res->'events') = 1
    and (res->>'total_hours')::numeric = 1.50,
    res::text);

  res := public.verify_volunteer_certificate('SS-BAD-CODE-999');
  insert into public._rls_results values ('verify', 'invalid certificate code returns invalid_code',
    (res->>'valid')::boolean = false and res->>'code' = 'invalid_code',
    res::text);

  execute 'reset role';
end
$$;


-- ============================================================================
-- 7. Cascade deletes
-- ============================================================================
do $$
declare
  n int;
begin
  delete from public.events where slug = 'alice-published';

  select count(*) into n from public.roles where event_id = 'e0000000-0000-4000-8000-00000000000a';
  insert into public._rls_results values ('cascade', 'deleting an event removes its roles', n = 0, format('%s left', n));

  select count(*) into n from public.shifts where role_id = '40000000-0000-4000-8000-00000000000a';
  insert into public._rls_results values ('cascade', 'removes its shifts', n = 0, format('%s left', n));

  select count(*) into n from public.signups where id = '50000004-0000-4000-8000-00000000000c';
  insert into public._rls_results values ('cascade', 'removes its signups', n = 0, format('%s left', n));

  select count(*) into n from public.checkins where signup_id = '50000004-0000-4000-8000-00000000000c';
  insert into public._rls_results values ('cascade', 'removes its checkins', n = 0, format('%s left', n));

  select count(*) into n from public.profiles where id = 'ca401000-0000-4000-8000-000000000003';
  insert into public._rls_results values ('cascade', 'keeps the volunteer''s profile', n = 1, format('%s left', n));
end
$$;


-- ============================================================================
-- Report
-- ============================================================================
select
  case when ok then 'PASS' else 'FAIL' end as result,
  section,
  label,
  detail
from public._rls_results
order by section, label;

select
  format('%s passed, %s failed, %s total',
         count(*) filter (where ok),
         count(*) filter (where not ok),
         count(*)) as summary
from public._rls_results;

do $$
declare v_failed int;
begin
  select count(*) into v_failed from public._rls_results where not ok;
  if v_failed > 0 then
    raise exception '% checks failed', v_failed;
  end if;
end
$$;

rollback;
