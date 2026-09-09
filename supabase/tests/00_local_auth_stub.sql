-- LOCAL TESTS ONLY. A minimal stand-in for the parts of Supabase the
-- migrations depend on: the anon/authenticated/service_role roles, the
-- auth schema, and auth.uid()/auth.jwt() reading request.jwt.claims —
-- exactly how PostgREST populates them in production.
--
-- NEVER run this against a Supabase project (scripts/db-test-local.sh
-- refuses to). On Supabase all of this already exists, managed by the
-- platform.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique,
  phone       text unique,
  created_at  timestamptz not null default now()
);
grant select on auth.users to authenticated, service_role;

-- Supabase's auth.uid(): the sub claim of the request JWT.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ), ''
  )::uuid
$$;

-- Supabase's auth.jwt(): the full claims object (carries "aal" for MFA).
create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'anon'
  )
$$;
