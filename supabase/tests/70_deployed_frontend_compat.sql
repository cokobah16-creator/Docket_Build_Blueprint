-- The deployed front end's contract with the database, pinned.
--
-- WHY THIS SUITE EXISTS. Migrations are applied to the live project from a branch, and the front
-- end that is actually serving comes from main — so for a while the live schema is AHEAD of the
-- code reading it. That is fine only if every read the deployed code makes still works. Nothing
-- used to check. This suite asserts, as the exact role and assurance level the deployed code runs
-- at, that each relation and column it reads is still there and still readable, and that the two
-- writes a client makes without MFA still go through.
--
-- WHAT IT PINS, AND WHERE THE LIST CAME FROM. `git grep` over origin/main for .from("…"),
-- .rpc("…"), and the two raw PostgREST fetches in src/lib/tenant.ts and src/lib/services.ts.
-- When the deployed front end starts reading something new, add it here; when a column here is
-- renamed, this suite fails before the live site does.
--
-- THE SHARP CHECKS ARE THE ONES AT aal1. A client never holds MFA, so anything the portal reads or
-- writes must work at aal1 — and the console layout on main reads firm_members BEFORE it checks
-- assurance, so that read must work at aal1 too, or every staff member lands on "no membership"
-- instead of the enrolment page.
--
-- Run alone or with the others: scripts/db-test-local.sh. Rolls back.

begin;

create or replace function t_as(u uuid, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', aal)::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create or replace function t_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  perform set_config('role', 'anon', false);
end $$;
create or replace function t_reset() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;
create or replace function t_check(name text, ok bool) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', name; else raise exception 'FAIL  %', name; end if;
end $$;

-- ---------------------------------------------------------------- fixture
-- The seeded tenant is active with published policies. A client, a staff member and a platform
-- admin are seated directly — the suite is about reads, not onboarding.
create temp table fx (k text primary key, v uuid);
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values
  (gen_random_uuid(), 'client@compat.test'), (gen_random_uuid(), 'staff@compat.test'), (gen_random_uuid(), 'platform@compat.test');
insert into fx select 'client',   id from auth.users where email = 'client@compat.test';
insert into fx select 'staff',    id from auth.users where email = 'staff@compat.test';
insert into fx select 'platform', id from auth.users where email = 'platform@compat.test';
insert into firm_members (firm_id, user_id, role) values ((select v from fx where k='firm'), (select v from fx where k='staff'), 'lawyer');
insert into platform_admins (user_id) values ((select v from fx where k='platform'));

-- ---------------------------------------------------------------- 1. every relation main reads still exists
do $$
declare r text; missing text := '';
begin
  foreach r in array array[
    'profiles','invoices','matters','appointments','documents','document_versions','updates','matter_parties',
    'firms','services','messages','matter_lawyers','matter_counsel','availability_rules','lawyer_public',
    'availability_exceptions','tasks','firm_members','consent_records','payments','notifications','matter_statuses',
    'invoice_items','firm_overview','notification_preferences','firm_service_directory','firm_cause_list','courts',
    'court_events','consultation_notes','service_inbox','push_subscriptions','public_holidays','platform_admins',
    'partner_attribution','lawyer_profiles','invites','intake_responses','firm_sittings_due','firm_admin',
    'court_vacations','consultation_sessions','consultation_internal_notes','firm_public'] loop
    if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = r) then
      missing := missing || ' ' || r;
    end if;
  end loop;
  perform t_check('every table and view the deployed front end reads exists' || case when missing <> '' then ' — MISSING:' || missing else '' end, missing = '');
end $$;

-- ---------------------------------------------------------------- 2. every RPC main calls still exists
do $$
declare r text; missing text := '';
begin
  foreach r in array array[
    'available_slots','invoice_settlement','create_firm','vacate_court_event','set_firm_status','serve_process',
    'save_consultation_notes','revoke_service','revoke_matter_invite','reschedule_appointment','post_court_update',
    'open_matter','mark_no_show','link_service_to_matter','issue_invoice','is_non_sitting_day','invite_matter_party',
    'create_invoice','cancel_invoice','cancel_appointment','book_appointment','acknowledge_service',
    'accept_staff_invite','accept_invite'] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = r) then
      missing := missing || ' ' || r;
    end if;
  end loop;
  perform t_check('every RPC the deployed front end calls exists' || case when missing <> '' then ' — MISSING:' || missing else '' end, missing = '');
end $$;

-- ---------------------------------------------------------------- 3. the two raw PostgREST reads, as anon, column for column
-- src/lib/tenant.ts and src/lib/services.ts fetch these with fetch(), not the client library, and
-- name every column in the URL. A dropped column is a 400 from PostgREST and a blank tenant site.
do $$
declare f uuid := (select v from fx where k='firm'); n int;
begin
  perform t_anon();
  select count(*) into n from (
    select id, slug, name, legal_name, brand, policies, custom_domain, timezone, default_currency, verified
    from firm_public where slug = 'attorneys-klinique') x;
  perform t_check('anon reads firm_public with every column the tenant resolver names', n = 1);
  select count(*) into n from (
    select id, slug, name, description, price_minor, currency, duration_min, virtual_available, is_active, sort, firm_id
    from services where firm_id = f and is_active) x;
  perform t_check('anon reads services with every column the public site names', n >= 1);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. a firm that is not active is not public — asserted, not discovered
-- firm_public is `where status = 'active'` (migrations 12/13). The deployed front end therefore
-- 404s a suspended or pending firm's public site. That is the intended behaviour; it is pinned so
-- that a change to it is a deliberate one.
do $$
declare f uuid := (select v from fx where k='firm'); pa uuid := (select v from fx where k='platform'); n int;
begin
  perform t_as(pa, 'aal2');
  perform set_firm_status(f, 'suspended', 'compat suite');
  perform t_reset();
  perform t_anon();
  select count(*) into n from firm_public where slug = 'attorneys-klinique';
  perform t_check('a firm that is not active has no public row — its site 404s by design', n = 0);
  perform t_reset();
  perform t_as(pa, 'aal2');
  perform set_firm_status(f, 'active', 'compat suite');
  perform t_reset();
  perform t_anon();
  select count(*) into n from firm_public where slug = 'attorneys-klinique';
  perform t_check('and is public again once active', n = 1);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 5. the client, at aal1 — what the portal reads and writes without MFA
do $$
declare cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm'); n int; ok bool;
begin
  perform t_as(cl, 'aal1');
  select count(*) into n from (
    select full_name, phone, email, timezone, preferred_channel, quiet_hours_start, quiet_hours_end
    from profiles where id = cl) x;
  perform t_check('a client at aal1 reads their own profile with every column the portal names', n = 1);

  -- The one write a client makes on their first visit: accepting a firm's terms and privacy
  -- notice. Migration 21 rewrote both consent_records policies; a client never holds MFA.
  ok := true;
  begin
    insert into consent_records (user_id, firm_id, kind, version) values (cl, f, 'terms', 'compat-1');
    insert into consent_records (user_id, firm_id, kind, version) values (cl, f, 'privacy', 'compat-1');
  exception when others then ok := false; raise notice 'consent insert failed: %', sqlerrm; end;
  perform t_check('a client at aal1 can record consent', ok);
  select count(*) into n from (select kind, version from consent_records where user_id = cl) x;
  perform t_check('and read it back with the columns the consent gate names', n = 2);
  select count(*) into n from (select id, firm_id, kind, version, accepted_at from consent_records where user_id = cl) x;
  perform t_check('and with the columns the profile page names', n = 2);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 6. staff, at aal1 — the read the console makes BEFORE it checks MFA
-- app/firm/(console)/layout.tsx on main reads memberships first and redirects to enrolment only
-- afterwards. If this read ever became MFA-gated, a staff member without a factor would see "no
-- firm membership" instead of the page that lets them add one — a dead end for every new hire.
do $$
declare st uuid := (select v from fx where k='staff'); n int;
begin
  perform t_as(st, 'aal1');
  select count(*) into n from (select firm_id, role from firm_members where user_id = st) x;
  perform t_check('a staff member at aal1 reads their memberships (the console reads before it checks MFA)', n = 1);
  select count(*) into n from (select firm_id, user_id, role from firm_members) x;
  perform t_check('with every column the console names', n >= 1);
  perform t_reset();
  perform t_as(st, 'aal2');
  select count(*) into n from (select user_id, role from firm_members where user_id = st) x;
  perform t_check('and still at aal2', n = 1);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 7. the console's client record, column for column
-- app/firm/(console)/clients/page.tsx names the widest profile projection anywhere in the code.
do $$
declare st uuid := (select v from fx where k='staff'); n int;
begin
  perform t_as(st, 'aal2');
  select count(*) into n from (
    select id, full_name, phone, email, country, state, address, client_type, company_name, timezone, preferred_channel, created_at
    from profiles where id = st) x;
  perform t_check('every profile column the console client list names exists', n = 1);
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
