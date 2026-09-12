-- Search finds what the caller may already read, and not one row more.
--
-- The point of this suite is the second half of that sentence. A search box is the classic way a
-- carefully built access model leaks, so the assertions that matter here are the negative ones: a
-- colleague outside a walled matter's team cannot find it by any word in it; a client cannot find
-- an internal update, a consultation's internal note, a staff task or the firm's adverse-party
-- register; and nobody at one firm can find anything at another. Each is asserted through the
-- search function itself, not through the tables it reads, because a wall that holds everywhere
-- except in the search box is not a wall.
--
-- Run alone or with the others. Rolls back.
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

-- How many results of a kind a search returns, for the caller in force.
create or replace function t_found(q text, f uuid, k text) returns int language sql stable as $$
  select count(*)::int from search_docket(q, f, case when k is null then null else array[k] end, 100)
$$;

-- ---------------------------------------------------------------- fixture
-- Two firms, so "no result crosses a firm" is a real question. One firm has walls on, a matter
-- restricted to lawyer A's team, and a client on that matter.
create temp table fx (k text primary key, v uuid);
grant select on fx to anon, authenticated;
insert into firms (slug, name, reference_prefix, status) values ('search-one', 'Search Chambers', 'SC', 'active');
insert into firms (slug, name, reference_prefix, status) values ('search-two', 'Other Chambers', 'OC', 'active');
insert into fx select 'firm',  id from firms where slug = 'search-one';
insert into fx select 'other', id from firms where slug = 'search-two';
insert into auth.users (id, email) values
  (gen_random_uuid(),'sx-a@test'), (gen_random_uuid(),'sx-b@test'), (gen_random_uuid(),'sx-client@test'), (gen_random_uuid(),'sx-outsider@test');
insert into fx select 'a',        id from auth.users where email='sx-a@test';
insert into fx select 'b',        id from auth.users where email='sx-b@test';
insert into fx select 'client',   id from auth.users where email='sx-client@test';
insert into fx select 'outsider', id from auth.users where email='sx-outsider@test';
update profiles set full_name = 'Ngozi Adeyemi' where id = (select v from fx where k='client');
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'),  (select v from fx where k='a'), 'lawyer'),
  ((select v from fx where k='firm'),  (select v from fx where k='b'), 'lawyer'),
  ((select v from fx where k='other'), (select v from fx where k='outsider'), 'lawyer');

-- The walled matter: every searchable surface carries the same rare word, so one query tests them all.
insert into matters (firm_id, reference, title, type, description, suit_number, handling_lawyer_id)
  values ((select v from fx where k='firm'), 'SC-M-2026-000001', 'Ikeja tenancy dispute', 'property',
          'A quicksilver covenant in the lease.', 'LD/4521/2026', (select v from fx where k='a'));
insert into fx select 'matter', id from matters where reference = 'SC-M-2026-000001';
insert into matter_lawyers (matter_id, firm_id, user_id, is_lead)
  values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='a'), true);
insert into matter_parties (matter_id, firm_id, user_id, role)
  values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');
insert into updates (matter_id, firm_id, kind, visibility, title, body, posted_by) values
  ((select v from fx where k='matter'), (select v from fx where k='firm'), 'note', 'client',   'Quicksilver filed',   'The quicksilver application was filed.',   (select v from fx where k='a')),
  ((select v from fx where k='matter'), (select v from fx where k='firm'), 'note', 'internal', 'Quicksilver strategy', 'Our quicksilver argument is weak.',       (select v from fx where k='a'));
insert into messages (firm_id, matter_id, sender_id, body)
  values ((select v from fx where k='firm'), (select v from fx where k='matter'), (select v from fx where k='client'), 'Any news on the quicksilver point?');
insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by)
  values (gen_random_uuid(), (select v from fx where k='firm'), (select v from fx where k='matter'), 'quicksilver-lease.pdf', 'pleading', true, (select v from fx where k='a'));
insert into tasks (firm_id, matter_id, title, status)
  values ((select v from fx where k='firm'), (select v from fx where k='matter'), 'Draft the quicksilver reply', 'open');
insert into matter_adverse_parties (firm_id, matter_id, name, aliases, created_by)
  values ((select v from fx where k='firm'), (select v from fx where k='matter'), 'Quicksilver Holdings Ltd',
          array['QSH', 'Quicksilver Nigeria'], (select v from fx where k='a'));

-- A second matter at the SAME firm, never walled. It is the control: without it, "B finds nothing"
-- would be equally true of a search that was simply broken for B.
insert into matters (firm_id, reference, title, type, description)
  values ((select v from fx where k='firm'), 'SC-M-2026-000002', 'Yaba conveyance', 'property', 'A marmalade clause in the deed.');

-- The other firm uses the same rare word, so a hit there would be unmistakable.
insert into matters (firm_id, reference, title, type, description)
  values ((select v from fx where k='other'), 'OC-M-2026-000001', 'Quicksilver v Nobody', 'litigation', 'Nothing to do with the first firm.');

-- ---------------------------------------------------------------- 1. the lawyer inside the matter finds it, on every surface
do $$
declare a uuid := (select v from fx where k='a'); f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter');
begin
  perform t_as(a);
  perform t_check('a word in the matter''s own prose finds the matter',        t_found('quicksilver', f, 'matter') = 1);
  perform t_check('...and the update',                                          t_found('quicksilver', f, 'update') = 2);
  perform t_check('...and the message',                                         t_found('quicksilver', f, 'message') = 1);
  perform t_check('...and the document, by its name',                           t_found('quicksilver', f, 'document') = 1);
  perform t_check('...and the task',                                            t_found('quicksilver', f, 'task') = 1);
  perform t_check('...and the adverse party, and its alias',                    t_found('quicksilver', f, 'adverse_party') = 1 and t_found('QSH', f, 'adverse_party') = 1);
  perform t_check('a result carries the matter it belongs to',
    (select matter_id from search_docket('quicksilver', f, array['matter'], 10)) = m);
  perform t_check('the snippet says why it matched',
    (select snippet from search_docket('quicksilver', f, array['message'], 10)) like '%<<quicksilver>>%');
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. a reference is found as typed, not stemmed
do $$
declare a uuid := (select v from fx where k='a'); f uuid := (select v from fx where k='firm');
begin
  perform t_as(a);
  perform t_check('the Docket reference finds the matter',      t_found('SC-M-2026-000001', f, 'matter') = 1);
  perform t_check('so does the suit number',                    t_found('LD/4521/2026', f, 'matter') = 1);
  perform t_check('and the suit number however it is spaced',   t_found('LD/4521 /2026', f, 'matter') = 1);
  perform t_check('a client is found by name',                  t_found('Ngozi', f, 'person') >= 1);
  perform t_check('...and that result names no matter, because which matters a client has is the wall''s to decide',
    (select bool_and(matter_id is null) from search_docket('Ngozi', f, array['person'], 10)));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. THE WALL. B is in the firm and outside the matter's team
do $$
declare ad uuid := (select v from fx where k='a'); b uuid := (select v from fx where k='b'); f uuid := (select v from fx where k='firm');
begin
  perform t_reset();
  update firms set matter_walls = true where id = f;
  perform t_as(ad);
  update matters set access = 'team' where id = (select v from fx where k='matter');
  perform t_reset();
  -- Said out loud, because every assertion below is a count of zero: if this update had been
  -- refused and the matter were still firm-wide, B would find it and those zeroes would be the
  -- test failing, not the wall holding.
  perform t_check('the matter really is walled now', (select access = 'team' from matters where id = (select v from fx where k='matter')));

  perform t_as(b);
  perform t_check('B''s search works: they find the firm''s other, unwalled matter',
    t_found('marmalade', f, 'matter') = 1);
  perform t_check('a colleague outside the team finds no matter',        t_found('quicksilver', f, 'matter') = 0);
  perform t_check('...nor any update on it',                             t_found('quicksilver', f, 'update') = 0);
  perform t_check('...nor a message',                                    t_found('quicksilver', f, 'message') = 0);
  perform t_check('...nor a document, not even its name',                t_found('quicksilver', f, 'document') = 0);
  perform t_check('...nor a task',                                       t_found('quicksilver', f, 'task') = 0);
  perform t_check('...nor the adverse party recorded against it',        t_found('quicksilver', f, 'adverse_party') = 0);
  perform t_check('...nor by the suit number, which is the obvious way round a word search',
    t_found('LD/4521/2026', f, 'matter') = 0 and t_found('SC-M-2026-000001', f, 'matter') = 0);
  perform t_check('the whole search returns nothing about it',           t_found('quicksilver', f, null) = 0);
  perform t_reset();

  -- ...and the lawyer inside it still does, so the wall is what changed and not the search.
  perform t_as(ad);
  perform t_check('the lawyer on the team still finds it',               t_found('quicksilver', f, 'matter') = 1);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. the client searches their own matter, and no further
do $$
declare cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm');
begin
  perform t_as(cl, 'aal1');
  perform t_check('a client finds their own matter',                     t_found('quicksilver', f, 'matter') = 1);
  perform t_check('...and the update written for them',                  t_found('quicksilver', f, 'update') = 1);
  perform t_check('...and never the internal one',
    not exists (select 1 from search_docket('quicksilver', f, array['update'], 50) s
                 join updates u on u.id = s.id where u.visibility = 'internal'));
  perform t_check('...nor the firm''s task list',                        t_found('quicksilver', f, 'task') = 0);
  perform t_check('...nor the adverse-party register, which is the firm''s work product',
    t_found('quicksilver', f, 'adverse_party') = 0);
  perform t_check('...nor an internal consultation note',                t_found('quicksilver', f, 'internal_note') = 0);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 5. nothing crosses a firm
do $$
declare out_u uuid := (select v from fx where k='outsider'); f uuid := (select v from fx where k='firm'); o uuid := (select v from fx where k='other');
begin
  perform t_as(out_u);
  perform t_check('a lawyer at another firm finds nothing here, even naming this firm''s id',
    t_found('quicksilver', f, null) = 0);
  perform t_check('...and nothing when they name no firm at all, beyond their own',
    (select count(*) from search_docket('quicksilver', null, null, 100) s where s.firm_id = f) = 0);
  perform t_check('their own firm''s matter is still theirs to find',    t_found('quicksilver', o, 'matter') = 1);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 6. what a search refuses to be
do $$
declare a uuid := (select v from fx where k='a'); f uuid := (select v from fx where k='firm'); anon_ok bool;
begin
  perform t_as(a);
  perform t_check('one character is not a search', t_found('q', f, null) = 0);
  perform t_check('nor is an empty string, or whitespace', t_found('', f, null) = 0 and t_found('   ', f, null) = 0);
  perform t_check('a wildcard is a character, not a wildcard: % matches nothing on its own',
    t_found('%', f, null) = 0 and t_found('%%', f, null) = 0);
  perform t_check('an underscore is a character too', t_found('__', f, null) = 0);
  perform t_check('the result set is bounded however large the caseload', (select count(*) from search_docket('a e i', f, null, 1000)) <= 100);
  perform t_reset();
  -- The function is SECURITY INVOKER, and the suite says so rather than trusting the comment.
  perform t_check('search_docket is not security definer',
    (select not prosecdef from pg_proc where proname = 'search_docket'));
  perform t_check('and it is not the anonymous public''s to call',
    not has_function_privilege('anon', 'public.search_docket(text, uuid, text[], int)', 'execute'));
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
