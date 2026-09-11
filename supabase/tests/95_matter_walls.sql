-- A restricted matter is invisible to a colleague through every door: the rows, the bytes, the
-- writes, the definer functions, the views. The client on it is unaffected. Default off, so every
-- other suite is unchanged. Run alone or with the others. Rolls back.
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

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values
  (gen_random_uuid(),'walls-a@test'), (gen_random_uuid(),'walls-b@test'), (gen_random_uuid(),'walls-admin@test'), (gen_random_uuid(),'walls-client@test');
insert into fx select 'a',      id from auth.users where email='walls-a@test';
insert into fx select 'b',      id from auth.users where email='walls-b@test';
insert into fx select 'admin',  id from auth.users where email='walls-admin@test';
insert into fx select 'client', id from auth.users where email='walls-client@test';
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'), (select v from fx where k='a'), 'lawyer'),
  ((select v from fx where k='firm'), (select v from fx where k='b'), 'lawyer'),
  ((select v from fx where k='firm'), (select v from fx where k='admin'), 'admin');
insert into matters (firm_id, reference, title, type, handling_lawyer_id)
  values ((select v from fx where k='firm'), 'WL-M-2026-000001', 'Walled v Open', 'litigation', (select v from fx where k='a'));
insert into fx select 'matter', id from matters where reference = 'WL-M-2026-000001';
insert into matter_parties (matter_id, firm_id, user_id, role)
  values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');
insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by)
  values (gen_random_uuid(), (select v from fx where k='firm'), (select v from fx where k='matter'), 'privileged.pdf', 'pleading', true, (select v from fx where k='a'));
insert into fx select 'doc', id from documents where name = 'privileged.pdf';
insert into updates (matter_id, firm_id, kind, visibility, title, body, posted_by)
  values ((select v from fx where k='matter'), (select v from fx where k='firm'), 'note', 'client', 'Filed', 'Filed today', (select v from fx where k='a'));
insert into messages (firm_id, matter_id, sender_id, body)
  values ((select v from fx where k='firm'), (select v from fx where k='matter'), (select v from fx where k='client'), 'any news?');
insert into tasks (firm_id, matter_id, title, status) values ((select v from fx where k='firm'), (select v from fx where k='matter'), 'Draft reply', 'open');

-- ---------------------------------------------------------------- 1. walls are off by default, and a matter cannot be restricted until they are on
do $$
declare a uuid := (select v from fx where k='a'); m uuid := (select v from fx where k='matter'); ok bool;
begin
  perform t_check('walls are off for the seeded firm', (select not matter_walls from firms where slug = 'attorneys-klinique'));
  perform t_check('every existing matter is firm-wide', (select access = 'firm' from matters where id = m));
  perform t_as(a);
  ok := t_refused(format('update matters set access = ''team'' where id = %L', m), '42501');
  perform t_check('a lawyer cannot restrict a matter while the firm''s walls are off', ok);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. the admin switches walls on; A restricts; A is inside the wall
do $$
declare a uuid := (select v from fx where k='a'); ad uuid := (select v from fx where k='admin'); f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter'); ok bool;
begin
  perform t_as(ad);
  update firms set matter_walls = true where id = f;
  perform t_check('an admin switches walls on', (select matter_walls from firms where id = f));
  perform t_reset(); perform t_as(a);
  ok := t_refused(format('update matters set access = ''team'' where id = %L', m), '42501');
  perform t_check('A cannot restrict a matter they are not on the team of — they would lock themselves out', ok);
  insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values (m, f, a, true);
  update matters set access = 'team' where id = m;
  perform t_check('on the team, A restricts the matter', (select access = 'team' from matters where id = m));
  perform t_check('A still sees the matter', exists (select 1 from matters where id = m));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. B, a member not on the team, sees nothing through any door
do $$
declare b uuid := (select v from fx where k='b'); m uuid := (select v from fx where k='matter'); f uuid := (select v from fx where k='firm'); d uuid := (select v from fx where k='doc'); cl uuid := (select v from fx where k='client'); ok bool;
begin
  perform t_as(b);
  perform t_check('B cannot select the matter', not exists (select 1 from matters where id = m));
  perform t_check('nor its documents', not exists (select 1 from documents where matter_id = m));
  perform t_check('can_access_document says no — which is what the storage policy asks', not can_access_document(d));
  perform t_check('nor its updates', not exists (select 1 from updates where matter_id = m));
  perform t_check('nor its messages', not exists (select 1 from messages where matter_id = m));
  perform t_check('nor its tasks', not exists (select 1 from tasks where matter_id = m));
  perform t_check('nor its parties', not exists (select 1 from matter_parties where matter_id = m));
  perform t_check('nor its team', not exists (select 1 from matter_lawyers where matter_id = m));
  perform t_check('nor its thread', not exists (select 1 from firm_threads where matter_id = m));
  perform t_check('and Today does not count it for B', (select open_matters from firm_overview where firm_id = f) = (select count(*) from matters where firm_id = f and deleted_at is null and closed_at is null));
  ok := t_refused(format('insert into updates (matter_id, firm_id, kind, visibility, title, body, posted_by) values (%L, %L, ''note'', ''internal'', ''x'', ''x'', %L)', m, f, b), '42501');
  perform t_check('B cannot post an update to it', ok);
  ok := t_refused(format('insert into messages (firm_id, matter_id, sender_id, body) values (%L, %L, %L, ''hello'')', f, m, b), '42501');
  perform t_check('nor send a message on it', ok);
  ok := t_refused(format('insert into tasks (firm_id, matter_id, title, status) values (%L, %L, ''x'', ''open'')', f, m), '42501');
  perform t_check('nor add a task', ok);
  ok := t_refused(format('select post_court_update(%L, ''hearing_held'')', m), '42501');
  perform t_check('nor post a court update through the definer function', ok);
  ok := t_refused(format('select create_invoice(%L, %L, ''[{"description":"x","quantity":1,"unit_minor":100}]''::jsonb, %L, ''NGN'', current_date, false, null)', f, cl, m), '42501');
  perform t_check('nor raise an invoice on it', ok);
  ok := t_refused(format('select mark_thread_read(%L, null)', m), '42501');
  perform t_check('nor mark its thread read', ok);
  ok := t_refused(format('update matters set title = ''renamed'' where id = %L', m), '42501');
  perform t_check('an update matches nothing (RLS) or is refused', ok or (select title = 'Walled v Open' from matters where id = m) is null);
  perform t_reset();
  perform t_check('the matter is untouched', (select title = 'Walled v Open' from matters where id = m));
end $$;

-- ---------------------------------------------------------------- 4. an admin not on the team is walled too; the client is not
do $$
declare ad uuid := (select v from fx where k='admin'); cl uuid := (select v from fx where k='client'); m uuid := (select v from fx where k='matter'); d uuid := (select v from fx where k='doc');
begin
  perform t_as(ad);
  perform t_check('an admin outside the team cannot see the matter — a wall partners can walk through is not a wall', not exists (select 1 from matters where id = m));
  perform t_reset(); perform t_as(cl, 'aal1');
  perform t_check('the client still sees their matter', exists (select 1 from matters where id = m));
  perform t_check('and its client-visible update', exists (select 1 from updates where matter_id = m and visibility = 'client'));
  perform t_check('and their document', can_access_document(d));
  perform t_check('and the thread', exists (select 1 from firm_threads where matter_id = m));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 5. the team can grow and shrink, but never to nobody
do $$
declare a uuid := (select v from fx where k='a'); b uuid := (select v from fx where k='b'); f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter'); ok bool;
begin
  perform t_as(a);
  insert into matter_lawyers (matter_id, firm_id, user_id) values (m, f, b);
  perform t_reset(); perform t_as(b);
  perform t_check('added to the team, B sees the matter', exists (select 1 from matters where id = m));
  perform t_check('and its documents', exists (select 1 from documents where matter_id = m));
  delete from matter_lawyers where matter_id = m and user_id = a;
  perform t_check('B removes A', not exists (select 1 from matter_lawyers where matter_id = m and user_id = a));
  ok := t_refused(format('delete from matter_lawyers where matter_id = %L and user_id = %L', m, b), '42501');
  perform t_check('but cannot remove the last member of a restricted team', ok);
  perform t_reset(); perform t_as(a);
  perform t_check('A, removed, no longer sees it', not exists (select 1 from matters where id = m));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 6. walls cannot be switched off over a restricted matter
do $$
declare ad uuid := (select v from fx where k='admin'); b uuid := (select v from fx where k='b'); f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter'); ok bool;
begin
  perform t_as(ad);
  ok := t_refused(format('update firms set matter_walls = false where id = %L', f), '42501');
  perform t_check('walls cannot be switched off while a matter is restricted', ok);
  perform t_reset(); perform t_as(b);
  update matters set access = 'firm' where id = m;
  perform t_check('the team opens the matter', (select access = 'firm' from matters where id = m));
  perform t_reset(); perform t_as(ad);
  perform t_check('and the admin sees it again', exists (select 1 from matters where id = m));
  update firms set matter_walls = false where id = f;
  perform t_check('now walls switch off', (select not matter_walls from firms where id = f));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 7. the review round (migration 33): invitations, acceptance, the last member
do $$
declare a uuid := (select v from fx where k='a'); b uuid := (select v from fx where k='b'); ad uuid := (select v from fx where k='admin'); f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter'); m2 uuid; r jsonb; tok text; ok bool;
begin
  -- walls back on; B alone on the team; the matter restricted again
  perform t_as(ad); update firms set matter_walls = true where id = f; perform t_reset();
  perform t_as(b); update matters set access = 'team' where id = m;
  r := invite_matter_party(m, '+2348030000077', null, 'client');
  tok := r ->> 'token';
  perform t_check('B, on the team, invites a client', tok is not null);
  perform t_reset(); perform t_as(a);
  perform t_check('A, outside the wall, cannot read the invitation — nor its token', not exists (select 1 from invites where matter_id = m));
  perform t_check('and cannot accept it as a member of the firm', t_refused(format('select accept_invite(%L)', tok), '42501'));
  perform t_check('A is not on the matter', not exists (select 1 from matter_parties where matter_id = m and user_id = a));
  perform t_reset();
  insert into matters (firm_id, reference, title, type, handling_lawyer_id) values (f, 'WL-M-2026-000002', 'Elsewhere', 'advisory', b);
  select id into m2 from matters where reference = 'WL-M-2026-000002';
  perform t_as(b);
  ok := t_refused(format('update matter_lawyers set matter_id = %L where matter_id = %L and user_id = %L', m2, m, b), '42501');
  perform t_check('the last member cannot move off a restricted matter by update either', ok);
  perform t_check('the team still stands', exists (select 1 from matter_lawyers where matter_id = m and user_id = b));
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
