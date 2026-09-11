-- The storage manifest is the platform's, and honest about what it cannot see. Rolls back.
begin;

create or replace function t_as(u uuid, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', aal)::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create or replace function t_reset() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', false); end $$;
create or replace function t_check(name text, ok bool) returns void language plpgsql as $$
begin if ok then raise notice 'PASS  %', name; else raise exception 'FAIL  %', name; end if; end $$;
create or replace function t_refused(stmt text, code text) returns bool language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlstate = code; end $$;

create temp table fx (k text primary key, v uuid);
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values (gen_random_uuid(), 'sm-platform@test'), (gen_random_uuid(), 'sm-admin@test');
insert into fx select 'platform', id from auth.users where email = 'sm-platform@test';
insert into fx select 'admin',    id from auth.users where email = 'sm-admin@test';
insert into platform_admins (user_id) values ((select v from fx where k='platform'));
insert into firm_members (firm_id, user_id, role) values ((select v from fx where k='firm'), (select v from fx where k='admin'), 'admin');

-- rows as the Edge Function writes them
insert into storage_manifest (bucket, path, size_bytes, sha256, expected_sha256, status, verified_at) values
  ('documents', 'f/d/v1.pdf', 1200, 'aa', 'aa', 'ok', now()),
  ('documents', 'f/d/v2.pdf', null, null, 'bb', 'missing', now()),
  ('documents', 'f/d/v3.pdf', 900, 'cc', 'dd', 'mismatch', now() - interval '9 days'),
  ('intake-uploads', 'f/c/x.jpg', 40, 'ee', null, 'ok', now());

do $$
declare pa uuid := (select v from fx where k='platform'); ad uuid := (select v from fx where k='admin'); r jsonb; ok bool;
begin
  perform t_as(pa);
  r := storage_integrity();
  perform t_check('the platform reads the integrity summary', r is not null);
  perform t_check('and it says plainly that this database has no storage schema to compare against', (r->>'storage_present')::bool = false);
  perform t_check('counts come from the manifest: ok 2, missing 1, mismatch 1', (r->>'ok')::int = 2 and (r->>'missing')::int = 1 and (r->>'mismatch')::int = 1);
  perform t_check('a row verified over a week ago is stale', (r->>'stale')::int = 1);
  perform t_check('and the last run is known', (r->>'last_run_at') is not null);
  perform t_reset();

  perform t_as(ad);
  ok := t_refused('select storage_integrity()', '42501');
  perform t_check('a firm admin is refused the platform''s storage accounting', ok);
  ok := t_refused('select count(*) from storage_manifest', '42501');
  perform t_check('and cannot read the manifest table itself', ok);
  ok := t_refused($q$insert into storage_manifest (bucket, path, status) values ('documents', 'x', 'ok')$q$, '42501');
  perform t_check('nor write it', ok);
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
