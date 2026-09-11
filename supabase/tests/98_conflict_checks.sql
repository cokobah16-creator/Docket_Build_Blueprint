-- Conflict checks search this firm's own register and record what a lawyer decides. Never another
-- firm's clients; never the decision itself. Opt-in: with the switch on, no client joins a matter
-- until the latest decided check on it is clear or waived. Run alone or with the others. Rolls back.
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
create or replace function t_fails(stmt text, fragment text) returns bool language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlerrm like '%' || fragment || '%'; end $$;

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into firms (slug, name, reference_prefix) values ('cc-other', 'Other Chambers', 'OC');
insert into fx select 'other', id from firms where slug = 'cc-other';
insert into auth.users (id, email) values
  (gen_random_uuid(),'cc-a@test'), (gen_random_uuid(),'cc-b@test'), (gen_random_uuid(),'cc-admin@test'),
  (gen_random_uuid(),'cc-client@test'), (gen_random_uuid(),'cc-client2@test'), (gen_random_uuid(),'cc-other-lawyer@test'), (gen_random_uuid(),'cc-other-client@test');
insert into fx select 'a',        id from auth.users where email='cc-a@test';
insert into fx select 'b',        id from auth.users where email='cc-b@test';
insert into fx select 'admin',    id from auth.users where email='cc-admin@test';
insert into fx select 'client',   id from auth.users where email='cc-client@test';
insert into fx select 'client2',  id from auth.users where email='cc-client2@test';
insert into fx select 'olawyer',  id from auth.users where email='cc-other-lawyer@test';
insert into fx select 'oclient',  id from auth.users where email='cc-other-client@test';
update profiles set full_name = 'Chukwuemeka Okonkwo' where id = (select v from fx where k='client');
update profiles set full_name = 'Amina Bello', company_name = 'Bello Holdings Ltd', client_type = 'business' where id = (select v from fx where k='client2');
update profiles set full_name = 'Ngozi Adichie' where id = (select v from fx where k='oclient');
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'),  (select v from fx where k='a'),       'lawyer'),
  ((select v from fx where k='firm'),  (select v from fx where k='b'),       'lawyer'),
  ((select v from fx where k='firm'),  (select v from fx where k='admin'),   'admin'),
  ((select v from fx where k='other'), (select v from fx where k='olawyer'), 'owner');
-- M1: Okonkwo v Eze, at Klinique, with an adverse party register
insert into matters (firm_id, reference, title, cause_title, type, handling_lawyer_id, opposing_party)
  values ((select v from fx where k='firm'), 'CC-M-2026-000001', 'Okonkwo land dispute', 'Okonkwo v Eze & 2 Ors', 'litigation', (select v from fx where k='a'), 'Emeka Eze');
insert into fx select 'm1', id from matters where reference = 'CC-M-2026-000001';
insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values ((select v from fx where k='m1'), (select v from fx where k='firm'), (select v from fx where k='a'), true);
insert into matter_parties (matter_id, firm_id, user_id, role)
  values ((select v from fx where k='m1'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');
-- M2: a second Klinique matter with no client yet
insert into matters (firm_id, reference, title, type, handling_lawyer_id)
  values ((select v from fx where k='firm'), 'CC-M-2026-000002', 'Bello contract', 'advisory', (select v from fx where k='b'));
insert into fx select 'm2', id from matters where reference = 'CC-M-2026-000002';
insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values ((select v from fx where k='m2'), (select v from fx where k='firm'), (select v from fx where k='b'), true);
-- The other firm acts for Ngozi Adichie against Chukwuemeka Okonkwo
insert into matters (firm_id, reference, title, type, handling_lawyer_id, opposing_party)
  values ((select v from fx where k='other'), 'OC-M-2026-000001', 'Adichie v Okonkwo', 'litigation', (select v from fx where k='olawyer'), 'Chukwuemeka Okonkwo');
insert into fx select 'om', id from matters where reference = 'OC-M-2026-000001';
insert into matter_parties (matter_id, firm_id, user_id, role)
  values ((select v from fx where k='om'), (select v from fx where k='other'), (select v from fx where k='oclient'), 'client');

-- ---------------------------------------------------------------- 1. the adverse-party register is firm work product
do $$
declare a uuid := (select v from fx where k='a'); cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm'); m1 uuid := (select v from fx where k='m1'); ok bool;
begin
  perform t_as(a);
  insert into matter_adverse_parties (firm_id, matter_id, name, aliases, kind, created_by)
    values (f, m1, 'Emeka Eze', array['E. Eze', 'Chief Eze'], 'person', a);
  insert into matter_adverse_parties (firm_id, matter_id, name, kind, relation, created_by)
    values (f, m1, 'Eze & Sons Nigeria Limited', 'organisation', 'related', a);
  perform t_check('staff record the other side on the matter, with aliases', (select count(*) = 2 from matter_adverse_parties where matter_id = m1));
  perform t_reset(); perform t_as(cl, 'aal1');
  perform t_check('the client on the matter sees none of it', not exists (select 1 from matter_adverse_parties where matter_id = m1));
  ok := t_refused(format('insert into matter_adverse_parties (firm_id, matter_id, name) values (%L, %L, ''Somebody'')', f, m1), '42501');
  perform t_check('and cannot add to it', ok);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. a search finds what this firm knows, and only this firm
do $$
declare a uuid := (select v from fx where k='a'); f uuid := (select v from fx where k='firm'); m1 uuid := (select v from fx where k='m1'); r jsonb; kinds text[];
begin
  perform t_as(a);
  r := run_conflict_check(f, null, array['Emeka Eze']);
  perform t_check('an adverse party is found by name, exactly',
    exists (select 1 from jsonb_array_elements(r -> 'matches') e where e ->> 'kind' = 'adverse' and e ->> 'strength' = 'exact' and (e ->> 'matter_id')::uuid = m1 and e ->> 'matter_reference' = 'CC-M-2026-000001'));
  perform t_check('the free-text opposing party is searched too',
    exists (select 1 from jsonb_array_elements(r -> 'matches') e where e ->> 'kind' = 'opposing_party' and e ->> 'strength' = 'exact'));
  r := run_conflict_check(f, null, array['Chief Eze']);
  perform t_check('an alias is found', (r ->> 'match_count')::int >= 1 and exists (select 1 from jsonb_array_elements(r -> 'matches') e where e ->> 'name' = 'Chief Eze'));
  r := run_conflict_check(f, null, array['Chukwuemeka Okonkwo']);
  perform t_check('a client of the firm is found', exists (select 1 from jsonb_array_elements(r -> 'matches') e where e ->> 'kind' = 'client' and e ->> 'strength' = 'exact'));
  r := run_conflict_check(f, null, array['Chukwuemeka Okonkow']);
  perform t_check('a misspelling is found as similar', exists (select 1 from jsonb_array_elements(r -> 'matches') e where e ->> 'kind' = 'client' and e ->> 'strength' = 'similar'));
  r := run_conflict_check(f, null, array['Okonkwo']);
  perform t_check('a surname alone is found inside the full name', exists (select 1 from jsonb_array_elements(r -> 'matches') e where e ->> 'kind' = 'client' and e ->> 'strength' = 'contains'));
  perform t_check('and inside a cause title', exists (select 1 from jsonb_array_elements(r -> 'matches') e where e ->> 'kind' = 'cause_title' and e ->> 'strength' = 'contains'));
  r := run_conflict_check(f, null, array['Ngozi Adichie']);
  perform t_check('another firm''s client is never found — the register is this firm''s own', (r ->> 'match_count')::int = 0);
  r := run_conflict_check(f, null, array['Ltd']);
  perform t_check('a three-letter fragment lights nothing up', (r ->> 'match_count')::int = 0);
  perform t_check('nothing to check is refused', t_fails(format('select run_conflict_check(%L, null, array['''']::text[])', f), 'nothing to check'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. a check on a matter searches everyone the matter names, except itself
do $$
declare b uuid := (select v from fx where k='b'); f uuid := (select v from fx where k='firm'); m1 uuid := (select v from fx where k='m1'); m2 uuid := (select v from fx where k='m2'); r jsonb;
begin
  perform t_as(b);
  insert into matter_adverse_parties (firm_id, matter_id, name, created_by) values (f, m2, 'Chukwuemeka Okonkwo', b);
  r := run_conflict_check(f, m2, null);
  perform t_check('checking M2 finds its own adverse party as M1''s client',
    exists (select 1 from jsonb_array_elements(r -> 'matches') e where e ->> 'kind' = 'client' and (e ->> 'matter_id')::uuid = m1));
  perform t_check('and never reports M2 against itself', not exists (select 1 from jsonb_array_elements(r -> 'matches') e where (e ->> 'matter_id')::uuid = m2));
  perform t_check('the check is recorded on the matter, undecided', exists (select 1 from conflict_checks where id = (r ->> 'check_id')::uuid and matter_id = m2 and outcome is null and created_by = b));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. the record is readable by staff, written by nobody
do $$
declare a uuid := (select v from fx where k='a'); cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm'); m2 uuid := (select v from fx where k='m2'); ol uuid := (select v from fx where k='olawyer'); ok bool; c uuid;
begin
  c := (select id from conflict_checks where matter_id = m2 limit 1);
  perform t_as(a);
  perform t_check('a colleague reads the check', exists (select 1 from conflict_checks where id = c));
  ok := t_refused(format('insert into conflict_checks (firm_id, matter_id) values (%L, %L)', f, m2), '42501');
  perform t_check('a check cannot be written directly', ok);
  ok := t_refused(format('update conflict_checks set outcome = ''clear'', reviewed_at = now() where id = %L', c), '42501');
  perform t_check('nor decided directly', ok);
  ok := t_refused(format('delete from conflict_checks where id = %L', c), '42501');
  perform t_check('nor deleted', ok);
  perform t_reset(); perform t_as(cl, 'aal1');
  perform t_check('the client sees no check', not exists (select 1 from conflict_checks));
  ok := t_refused(format('select run_conflict_check(%L, null, array[''anyone''])', f), '42501');
  perform t_check('and cannot run one', ok);
  perform t_reset(); perform t_as(ol);
  ok := t_refused(format('select run_conflict_check(%L, null, array[''Chukwuemeka Okonkwo''])', f), '42501');
  perform t_check('another firm''s lawyer cannot search this firm''s register', ok);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 5. the lawyer decides, once
do $$
declare b uuid := (select v from fx where k='b'); m2 uuid := (select v from fx where k='m2'); c uuid;
begin
  c := (select id from conflict_checks where matter_id = m2 limit 1);
  perform t_as(b);
  perform t_check('a waiver without a note is refused', t_fails(format('select decide_conflict_check(%L, ''waived'', null)', c), 'a waiver records why'));
  perform t_check('an unknown outcome is refused', t_fails(format('select decide_conflict_check(%L, ''fine'', null)', c), 'the outcome is'));
  perform decide_conflict_check(c, 'clear', 'Same name, different person — the client confirmed');
  perform t_check('the decision is recorded with who and when', (select outcome = 'clear' and reviewed_by = b and reviewed_at is not null from conflict_checks where id = c));
  perform t_check('a check is decided once', t_fails(format('select decide_conflict_check(%L, ''conflict'', null)', c), 'already been decided'));
  perform t_reset();
  perform t_check('both steps are in the audit log', (select count(*) = 2 from audit_log where entity = 'conflict_check' and entity_id = c and action in ('conflict_check.run', 'conflict_check.decided')));
end $$;

-- ---------------------------------------------------------------- 6. off by default: nothing is refused
do $$
declare a uuid := (select v from fx where k='a'); f uuid := (select v from fx where k='firm'); c2 uuid := (select v from fx where k='client2'); r jsonb;
begin
  perform t_check('the switch is off for the seeded firm', (select not conflict_checks_required from firms where id = f));
  perform t_as(a);
  r := open_matter(f, 'No check needed', 'advisory', c2);
  perform t_check('with the switch off a matter opens on a client with no check at all', exists (select 1 from matter_parties where matter_id = (r ->> 'matter_id')::uuid and user_id = c2));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 7. the switch on: no client without clearance, through any door
do $$
declare a uuid := (select v from fx where k='a'); ad uuid := (select v from fx where k='admin'); f uuid := (select v from fx where k='firm');
        m2 uuid := (select v from fx where k='m2'); c2 uuid := (select v from fx where k='client2'); r jsonb; c uuid; mnew uuid; ok bool;
begin
  perform t_as(ad);
  update firms set conflict_checks_required = true where id = f;
  perform t_check('an admin switches the requirement on', (select conflict_checks_required from firms where id = f));
  perform t_reset(); perform t_as(a);
  -- M2 was cleared in section 5, so it is joinable; a fresh matter is not
  insert into matters (firm_id, reference, title, type, handling_lawyer_id) values (f, 'CC-M-2026-000009', 'Unchecked', 'advisory', a);
  select id into mnew from matters where reference = 'CC-M-2026-000009';
  perform t_check('a direct client link on an unchecked matter is refused',
    t_fails(format('insert into matter_parties (matter_id, firm_id, user_id, role) values (%L, %L, %L, ''client'')', mnew, f, c2), 'cleared conflict check'));
  perform t_check('so is an invitation as client', t_fails(format('select invite_matter_party(%L, ''+2348030000001'', null, ''client'')', mnew), 'cleared conflict check'));
  r := invite_matter_party(mnew, '+2348030000002', null, 'contact');
  perform t_check('a contact may still be invited — the rule is about the client', r ? 'token');
  perform t_check('open_matter with a client and no check is refused',
    t_fails(format('select open_matter(%L, ''Blocked'', ''advisory'', %L)', f, c2), 'cleared conflict check'));
  -- a check run before the matter exists, decided conflict, does not open it
  r := run_conflict_check(f, null, array['Amina Bello', 'Bello Holdings Ltd']);
  c := (r ->> 'check_id')::uuid;
  perform t_check('open_matter refuses an undecided check', t_fails(format('select open_matter(%L, ''Blocked'', ''advisory'', %L, null, null, null, null, null, null, null, ''new_inquiry'', null, %L)', f, c2, c), 'decide the conflict check'));
  perform decide_conflict_check(c, 'conflict', 'We act against Bello Holdings in CC-M-2026-000001');
  perform t_check('a check that found a conflict does not clear the matter', t_fails(format('select open_matter(%L, ''Blocked'', ''advisory'', %L, null, null, null, null, null, null, null, ''new_inquiry'', null, %L)', f, c2, c), 'cleared conflict check'));
  -- a second check, waived with a note, opens it and is attached
  r := run_conflict_check(f, null, array['Amina Bello', 'Bello Holdings Ltd', 'Kola Adeyemi']);
  c := (r ->> 'check_id')::uuid;
  perform decide_conflict_check(c, 'waived', 'Both clients gave informed consent in writing, 10 Sep 2026');
  r := open_matter(f, 'Bello advisory', 'advisory', c2, null, null, null, null, null, null, null, 'new_inquiry', null, c,
                   '[{"name": "Kola Adeyemi", "kind": "person", "aliases": ["K. Adeyemi"]}, {"name": "X"}]'::jsonb);
  perform t_check('a waived check opens the matter on the client', exists (select 1 from matter_parties where matter_id = (r ->> 'matter_id')::uuid and user_id = c2 and role = 'client'));
  perform t_check('and is attached to it', (select matter_id = (r ->> 'matter_id')::uuid from conflict_checks where id = c));
  perform t_check('the other side given at opening is on the register, the one-letter name dropped',
    (select count(*) = 1 and bool_and(aliases = array['K. Adeyemi']) from matter_adverse_parties where matter_id = (r ->> 'matter_id')::uuid));
  perform t_check('a check already attached cannot open a second matter', t_fails(format('select open_matter(%L, ''Again'', ''advisory'', %L, null, null, null, null, null, null, null, ''new_inquiry'', null, %L)', f, c2, c), 'belongs to another matter'));
  -- M2 is cleared: the client joins by invitation
  r := invite_matter_party(m2, '+2348030000003', null, 'client');
  perform t_check('a cleared matter takes a client invitation', r ? 'token');
  -- the review round (migration 33)
  perform t_check('a client row cannot be moved onto an unchecked matter',
    t_fails(format('update matter_parties set matter_id = %L where matter_id = %L and user_id = %L', mnew, (select matter_id from conflict_checks where id = c), c2), 'cleared conflict check'));
  r := run_conflict_check(f, null, array['Somebody Else']);
  c := (r ->> 'check_id')::uuid;
  perform decide_conflict_check(c, 'clear', null);
  perform t_check('a check that searched other names does not admit this client',
    t_fails(format('select open_matter(%L, ''Wrong check'', ''advisory'', %L, null, null, null, null, null, null, null, ''new_inquiry'', null, %L)', f, c2, c), 'did not search for'));
  perform t_check('nor the other side it did not search',
    t_fails(format('select open_matter(%L, ''Wrong check'', ''advisory'', null, null, null, null, null, null, null, null, ''new_inquiry'', null, %L, ''[{"name": "Unsearched Person"}]''::jsonb)', f, c), 'unsearched person'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 8. behind the wall a match is reported without the matter
do $$
declare a uuid := (select v from fx where k='a'); b uuid := (select v from fx where k='b'); ad uuid := (select v from fx where k='admin'); f uuid := (select v from fx where k='firm'); m1 uuid := (select v from fx where k='m1'); r jsonb; e jsonb;
begin
  perform t_as(ad); update firms set matter_walls = true where id = f; perform t_reset();
  perform t_as(a); update matters set access = 'team' where id = m1; perform t_reset();
  perform t_as(b);
  r := run_conflict_check(f, null, array['Emeka Eze']);
  select x into e from jsonb_array_elements(r -> 'matches') x where x ->> 'kind' = 'adverse' and x ->> 'strength' = 'exact' limit 1;
  perform t_check('a colleague outside the wall is told a match exists', e is not null);
  perform t_check('but not which matter', (e ->> 'restricted')::bool and e -> 'matter_id' = 'null'::jsonb and e -> 'matter_reference' = 'null'::jsonb);
  perform t_check('and who leads it, so they can ask', (e ->> 'lead_lawyer_id')::uuid = a);
  perform t_check('a check on a walled matter cannot be run from outside', t_refused(format('select run_conflict_check(%L, %L, null)', f, m1), '42501'));
  perform t_reset(); perform t_as(a);
  r := run_conflict_check(f, null, array['Emeka Eze']);
  perform t_check('inside the wall the same match names the matter', exists (select 1 from jsonb_array_elements(r -> 'matches') x where x ->> 'kind' = 'adverse' and (x ->> 'matter_id')::uuid = m1 and not (x ->> 'restricted')::bool));
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
