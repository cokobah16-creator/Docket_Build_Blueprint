-- The second copy is the platform's, counts only what is really covered, and tells a firm nothing. Rolls back.
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
insert into auth.users (id, email) values (gen_random_uuid(), 'sr-platform@test'), (gen_random_uuid(), 'sr-admin@test');
insert into fx select 'platform', id from auth.users where email = 'sr-platform@test';
insert into fx select 'admin',    id from auth.users where email = 'sr-admin@test';
insert into platform_admins (user_id) values ((select v from fx where k='platform'));
insert into firm_members (firm_id, user_id, role) values ((select v from fx where k='firm'), (select v from fx where k='admin'), 'admin');

-- The inventory: four objects the manifest has looked at. Only the three 'ok' ones are bytes that
-- exist and therefore bytes that could be lost; 'd' has no source to copy.
insert into storage_manifest (bucket, path, size_bytes, sha256, expected_sha256, status, verified_at) values
  ('documents', 'f/a.pdf', 100, 'aa', 'aa', 'ok', now()),
  ('documents', 'f/b.pdf', 200, 'bb', 'bb', 'ok', now()),
  ('documents', 'f/c.pdf', 300, 'cc', 'cc', 'ok', now()),
  ('documents', 'f/e.pdf', 400, 'ee', 'ee', 'ok', now()),
  ('documents', 'f/d.pdf', null, null, 'dd', 'missing', now());

-- The copies. One good; one good but of bytes the source has since replaced; one that errored, so
-- there is a ROW and no usable copy; one the destination stored without confirming the digest; and
-- one for an object the manifest never saw.
insert into storage_replicas (bucket, path, sha256, size_bytes, replica_etag, status, replicated_at) values
  ('documents', 'f/a.pdf', 'aa',  100, 'etag-a', 'ok',          now()),
  ('documents', 'f/b.pdf', 'old', 200, 'etag-b', 'ok',          now() - interval '2 days'),
  ('documents', 'f/c.pdf', null,  null, null,    'error',       now()),
  ('documents', 'f/e.pdf', 'ee',  400, 'etag-e', 'unconfirmed', now()),
  ('intake-uploads', 'f/z.jpg', 'zz', 10, 'etag-z', 'ok',       now());

do $$
declare pa uuid := (select v from fx where k='platform'); ad uuid := (select v from fx where k='admin'); r jsonb; ok bool;
begin
  perform t_as(pa);
  r := storage_replication_health();
  perform t_check('the platform reads the replication summary', r is not null);
  perform t_check('and it says plainly that this database has no storage schema to compare against', (r->>'storage_present')::bool = false);
  perform t_check('three copies are recorded good, one errored, one unconfirmed',
                  (r->>'ok')::int = 3 and (r->>'error')::int = 1 and (r->>'unconfirmed')::int = 1);
  perform t_check('five replica rows in all', (r->>'replica_rows')::int = 5);

  -- The numbers this table exists for. Both of the uncovered cases are things that LOOK like
  -- coverage from a distance: a row exists, and the request came back 2xx.
  perform t_check('an object whose copy ERRORED counts as unreplicated, because a row is not a copy',
                  (r->>'unreplicated')::int = 2);
  perform t_check('and so does one the destination stored without confirming the digest — a 2xx is not a proof',
                  (r->>'unreplicated')::int = 2);
  perform t_check('a copy taken before the source changed is stale, not safe',
                  (r->>'stale')::int = 1);
  perform t_check('an object the manifest never saw is not counted as covered',
                  (r->>'unreplicated')::int = 2);   -- f/z.jpg has a copy and no manifest row; it changes nothing
  perform t_check('and the last run is known', (r->>'last_run_at') is not null);
  perform t_reset();

  -- Same rule as the manifest: this is the platform's accounting and no firm's business.
  perform t_as(ad);
  ok := t_refused('select storage_replication_health()', '42501');
  perform t_check('a firm admin is refused the platform''s replication accounting', ok);
  ok := t_refused('select count(*) from storage_replicas', '42501');
  perform t_check('and cannot read the replica table itself', ok);
  ok := t_refused($q$insert into storage_replicas (bucket, path, status) values ('documents', 'x', 'ok')$q$, '42501');
  perform t_check('nor write it', ok);
  perform t_reset();

  -- A platform admin without a second factor is not a platform admin for this.
  perform t_as(pa, 'aal1');
  ok := t_refused('select storage_replication_health()', '42501');
  perform t_check('nor a platform admin at aal1', ok);
  perform t_reset();
end $$;

-- The status column is a closed set: a typo becomes an error, not a silently uncounted row.
do $$
declare ok bool;
begin
  ok := t_refused($q$insert into storage_replicas (bucket, path, status) values ('documents', 'q', 'copied')$q$, '23514');
  perform t_check('an unknown replica status is refused by the check constraint', ok);
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
