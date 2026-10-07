-- ============================================================================
-- Local stand-in for the parts of Supabase the migration depends on.
-- NOT part of the deliverable — this only exists so the migration and its RLS
-- policies can be executed and tested against a real Postgres server.
-- ============================================================================

-- API roles that Supabase creates for every project.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated;

-- auth schema -----------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Mirrors Supabase's auth.uid(): reads the `sub` claim of the request JWT that
-- PostgREST puts in a GUC. In production this is set by the API layer.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
    ),
    ''
  )::uuid;
$$;

-- PostgREST's request context GUCs need to exist so `reset` never errors.
do $$
begin
  perform set_config('request.jwt.claims', '', false);
exception when others then null;
end
$$;

grant usage on schema auth to anon, authenticated;
