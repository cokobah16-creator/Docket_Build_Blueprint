-- The words inside a file are walled exactly like the file.
--
-- Migration 48 lets search reach inside a document. That is the single most dangerous thing built
-- in Wave 4, because a firm's most sensitive sentences are inside its files rather than in its
-- fields, and a search box is the classic way an access model leaks. So the assertions that matter
-- here are the negative ones: a colleague outside a walled matter's team cannot find a phrase in
-- that matter's document by searching for it; a client cannot find a word inside a document their
-- firm never shared with them; nothing crosses a firm; and the two functions that write the text
-- are the service role's alone, with the table beside them shut.
--
-- The positive half is asserted too, because a wall that holds by breaking the feature is not the
-- feature holding.
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

create or replace function t_found(q text, f uuid, k text) returns int language sql stable as $$
  select count(*)::int from search_docket(q, f, case when k is null then null else array[k] end, 100)
$$;

-- ---------------------------------------------------------------- fixture
-- Two firms. At the first: a walled matter with a document whose TEXT carries a rare word that
-- appears nowhere in its name, and an unwalled matter as the control.
create temp table fx (k text primary key, v uuid);
grant select, insert on fx to anon, authenticated;

insert into firms (slug, name, reference_prefix, status) values ('dtx-one', 'Text Chambers', 'TC', 'active');
insert into firms (slug, name, reference_prefix, status) values ('dtx-two', 'Other Chambers', 'OC2', 'active');
insert into fx select 'firm',  id from firms where slug = 'dtx-one';
insert into fx select 'other', id from firms where slug = 'dtx-two';

insert into auth.users (id, email) values
  (gen_random_uuid(), 'dtx-a@test'), (gen_random_uuid(), 'dtx-b@test'),
  (gen_random_uuid(), 'dtx-client@test'), (gen_random_uuid(), 'dtx-outsider@test');
insert into fx select 'a',        id from auth.users where email = 'dtx-a@test';
insert into fx select 'b',        id from auth.users where email = 'dtx-b@test';
insert into fx select 'client',   id from auth.users where email = 'dtx-client@test';
insert into fx select 'outsider', id from auth.users where email = 'dtx-outsider@test';
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'),  (select v from fx where k='a'), 'lawyer'),
  ((select v from fx where k='firm'),  (select v from fx where k='b'), 'lawyer'),
  ((select v from fx where k='other'), (select v from fx where k='outsider'), 'lawyer');

-- The walled matter. A is on its team; B is not.
insert into matters (firm_id, reference, title, type, handling_lawyer_id)
  values ((select v from fx where k='firm'), 'TC-M-2026-000001', 'Ikeja tenancy', 'property', (select v from fx where k='a'));
insert into fx select 'matter', id from matters where reference = 'TC-M-2026-000001';
insert into matter_lawyers (matter_id, firm_id, user_id, is_lead)
  values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='a'), true);
insert into matter_parties (matter_id, firm_id, user_id, role, can_view_docs)
  values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client', true);

-- The unwalled control matter at the same firm.
insert into matters (firm_id, reference, title, type)
  values ((select v from fx where k='firm'), 'TC-M-2026-000002', 'Yaba conveyance', 'property');
insert into fx select 'open_matter', id from matters where reference = 'TC-M-2026-000002';

-- A document on the walled matter, shared with the client. Its NAME says nothing; the rare word
-- 'quicksilver' is only in the text, so a hit can only have come from inside the file.
insert into documents (firm_id, matter_id, name, category, client_visible, uploaded_by)
  values ((select v from fx where k='firm'), (select v from fx where k='matter'), 'lease.pdf', 'agreement', true,
          (select v from fx where k='a'));
insert into fx select 'doc', id from documents where name = 'lease.pdf';
insert into document_versions (document_id, storage_path, mime, size_bytes, checksum, uploaded_by)
  values ((select v from fx where k='doc'), 'documents/dtx/lease-v1.pdf', 'application/pdf', 4096, 'aa', (select v from fx where k='a'));
insert into fx select 'ver', id from document_versions where storage_path = 'documents/dtx/lease-v1.pdf';
update documents set current_version_id = (select v from fx where k='ver') where id = (select v from fx where k='doc');

-- A document on the walled matter that the firm has NOT shared with the client. Same rare word.
insert into documents (firm_id, matter_id, name, category, client_visible, uploaded_by)
  values ((select v from fx where k='firm'), (select v from fx where k='matter'), 'advice.pdf', 'internal', false,
          (select v from fx where k='a'));
insert into fx select 'internal_doc', id from documents where name = 'advice.pdf';
insert into document_versions (document_id, storage_path, mime, size_bytes, checksum, uploaded_by)
  values ((select v from fx where k='internal_doc'), 'documents/dtx/advice-v1.pdf', 'application/pdf', 2048, 'bb', (select v from fx where k='a'));
insert into fx select 'internal_ver', id from document_versions where storage_path = 'documents/dtx/advice-v1.pdf';
update documents set current_version_id = (select v from fx where k='internal_ver') where id = (select v from fx where k='internal_doc');

-- A document at the OTHER firm, with the same rare word. A hit on it would be unmistakable.
insert into matters (firm_id, reference, title, type)
  values ((select v from fx where k='other'), 'OC2-M-2026-000001', 'Nothing to do with us', 'litigation');
insert into documents (firm_id, matter_id, name, client_visible, uploaded_by)
  values ((select v from fx where k='other'), (select id from matters where reference = 'OC2-M-2026-000001'),
          'theirs.pdf', false, (select v from fx where k='outsider'));
insert into fx select 'other_doc', id from documents where name = 'theirs.pdf';
insert into document_versions (document_id, storage_path, mime, size_bytes, checksum, uploaded_by)
  values ((select v from fx where k='other_doc'), 'documents/oc2/theirs.pdf', 'application/pdf', 1024, 'cc', (select v from fx where k='outsider'));
insert into fx select 'other_ver', id from document_versions where storage_path = 'documents/oc2/theirs.pdf';
update documents set current_version_id = (select v from fx where k='other_ver') where id = (select v from fx where k='other_doc');

-- ---------------------------------------------------------------- 1. a fresh version is waiting, and nothing is claimed about it
do $$
begin
  perform t_check('a new version starts pending',
    (select text_status from document_versions where id = (select v from fx where k='ver')) = 'pending');
  perform t_check('and carries no text, no count and no time',
    (select text_content is null and text_chars is null and text_extracted_at is null
       from document_versions where id = (select v from fx where k='ver')));
  perform t_check('and is not marked truncated before anything has been read',
    (select not text_truncated from document_versions where id = (select v from fx where k='ver')));
end $$;

-- ---------------------------------------------------------------- 2. the two doors are the service role's alone
do $$
declare a uuid := (select v from fx where k='a'); ver uuid := (select v from fx where k='ver');
begin
  -- Not merely guarded: not executable. A guard inside a function a client can call is one bug from
  -- being no guard at all.
  perform t_check('claim_document_text is executable by neither anon nor authenticated',
    not has_function_privilege('anon', 'public.claim_document_text(int)', 'execute')
    and not has_function_privilege('authenticated', 'public.claim_document_text(int)', 'execute'));
  perform t_check('record_document_text is executable by neither anon nor authenticated',
    not has_function_privilege('anon', 'public.record_document_text(uuid,text,text,text,boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public.record_document_text(uuid,text,text,text,boolean)', 'execute'));

  -- And the guard inside them holds independently, for a caller who reaches them another way.
  perform t_as(a);
  perform t_check('a signed-in lawyer is refused by the claim function''s own guard',
    t_refused('select * from claim_document_text(1)', '42501'));
  perform t_check('...and by the recording function''s',
    t_refused(format('select record_document_text(%L, %L, %L)', ver, 'extracted', 'anything'), '42501'));

  -- THE DOOR BESIDE THE DOOR. A guarded function is only the rule when it is the only way in.
  perform t_check('a lawyer cannot write the text straight onto the row',
    t_refused(format('update document_versions set text_content = %L where id = %L', 'planted', ver), '42501'));
  perform t_check('...and cannot clear it either',
    t_refused(format('update document_versions set text_status = %L where id = %L', 'extracted', ver), '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. what the extractor records
do $$
declare ver uuid := (select v from fx where k='ver'); iver uuid := (select v from fx where k='internal_ver');
        oid_ uuid := (select v from fx where k='other_ver');
begin
  perform t_reset();
  perform record_document_text(ver, 'extracted',
    'IN THE HIGH COURT OF LAGOS STATE. The lessee shall not assign the quicksilver premises without consent.',
    null, false);
  perform t_check('the text is stored',
    (select text_content like '%quicksilver%' from document_versions where id = ver));
  perform t_check('and its length with it',
    (select text_chars = length(text_content) from document_versions where id = ver));
  perform t_check('and the row says it has been read',
    (select text_status = 'extracted' and text_extracted_at is not null and text_claimed_at is null
       from document_versions where id = ver));

  perform record_document_text(iver, 'extracted', 'Our quicksilver argument is weak and we should settle.', null, false);
  perform record_document_text(oid_, 'extracted', 'A quicksilver matter of another firm entirely.', null, false);

  -- An outcome that is not "extracted" stores the reason and NO text. A row that half-says
  -- something is how a firm comes to believe a file was searched.
  perform record_document_text(oid_, 'no_text_layer', 'this should not be kept', 'it is a scan.', true);
  perform t_check('a scan keeps no text',
    (select text_content is null and text_chars is null from document_versions where id = oid_));
  perform t_check('...but does keep the reason, in words',
    (select text_detail = 'it is a scan.' from document_versions where id = oid_));
  perform t_check('...and is not left marked truncated',
    (select not text_truncated from document_versions where id = oid_));
  perform record_document_text(oid_, 'extracted', 'A quicksilver matter of another firm entirely.', null, true);
  perform t_check('a document that was cut says so', (select text_truncated from document_versions where id = oid_));

  perform t_check('an outcome nobody has defined is refused, not written',
    t_refused(format('select record_document_text(%L, %L, %L)', ver, 'probably_fine', 'x'), '22023'));
  perform t_check('a version that does not exist is refused',
    t_refused(format('select record_document_text(%L, %L)', gen_random_uuid(), 'failed'), 'P0002'));
end $$;

-- ---------------------------------------------------------------- 4. the lawyer on the matter finds the words inside the file
do $$
declare a uuid := (select v from fx where k='a'); f uuid := (select v from fx where k='firm'); d uuid := (select v from fx where k='doc');
begin
  perform t_as(a);
  perform t_check('a word that is only inside the file finds the document',
    t_found('quicksilver', f, 'document') = 2);
  perform t_check('and the hit is the document, not the version',
    (select count(*) from search_docket('quicksilver', f, array['document'], 10) s where s.id = d) = 1);
  perform t_check('the snippet is the passage it was found in',
    (select bool_or(snippet like '%<<quicksilver>>%') from search_docket('quicksilver', f, array['document'], 10)));
  perform t_check('a phrase from the file is found as a phrase',
    t_found('"assign the quicksilver premises"', f, 'document') = 1);
  perform t_check('a word in no file finds nothing', t_found('marmalade', f, 'document') = 0);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 5. THE WALL
-- B is a lawyer at the firm and is not on the walled matter's team. Everything about this section
-- is the negative: the words inside that matter's files must be as invisible to B as the files are.
do $$
declare a uuid := (select v from fx where k='a'); b uuid := (select v from fx where k='b'); f uuid := (select v from fx where k='firm');
begin
  -- FIRST, with no wall up, B finds it. Without this the section below would be equally true of a
  -- search that had simply stopped working for B, and the wall would be proving nothing.
  perform t_as(b);
  perform t_check('before any wall, a colleague DOES find the phrase inside the file',
    t_found('quicksilver', f, 'document') = 2);
  perform t_reset();

  update firms set matter_walls = true where id = f;
  update matters set access = 'team' where id = (select v from fx where k='matter');

  perform t_as(b);
  perform t_check('a colleague off the team cannot find the phrase inside the walled file',
    t_found('quicksilver', f, 'document') = 0);
  perform t_check('...nor by a phrase from it',
    t_found('"assign the quicksilver premises"', f, 'document') = 0);
  perform t_check('...nor with no kind filter at all, which is the search a person actually types',
    t_found('quicksilver', f, null) = 0);
  perform t_check('...and cannot read the text off the row either',
    (select count(*) from document_versions dv where dv.id = (select v from fx where k='ver')) = 0);

  -- The control. If B could find nothing at all, the assertions above would be true of a search
  -- that was simply broken.
  perform t_reset();
  insert into documents (firm_id, matter_id, name, client_visible, uploaded_by)
    values (f, (select v from fx where k='open_matter'), 'open.pdf', false, a);
  insert into fx select 'open_doc', id from documents where name = 'open.pdf';
  insert into document_versions (document_id, storage_path, mime, size_bytes, uploaded_by)
    values ((select v from fx where k='open_doc'), 'documents/dtx/open-v1.pdf', 'application/pdf', 512, a);
  update documents set current_version_id = (select id from document_versions where storage_path = 'documents/dtx/open-v1.pdf')
   where id = (select v from fx where k='open_doc');
  perform record_document_text((select id from document_versions where storage_path = 'documents/dtx/open-v1.pdf'),
                               'extracted', 'A marmalade clause in the unwalled deed.', null, false);

  perform t_as(b);
  perform t_check('the same colleague DOES find the words in a file that is not walled',
    t_found('marmalade', f, 'document') = 1);
  perform t_reset();

  -- And A, who is on the team, still finds it.
  perform t_as(a);
  perform t_check('the lawyer on the team still finds the walled file by its words',
    t_found('quicksilver', f, 'document') = 2);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 6. the client
do $$
declare c uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm');
        d uuid := (select v from fx where k='doc');
begin
  perform t_as(c, 'aal1');   -- a client never holds a second factor
  perform t_check('the client finds the words in the document their firm shared with them',
    (select count(*) from search_docket('quicksilver', null, array['document'], 50) s where s.id = d) = 1);
  perform t_check('and finds NOTHING else with that word — not the internal advice, not another firm''s',
    t_found('quicksilver', null, 'document') = 1);
  perform t_check('...which is decided by the row, not by the search: the internal version is not readable',
    (select count(*) from document_versions dv where dv.id = (select v from fx where k='internal_ver')) = 0);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 7. nothing crosses a firm
do $$
declare o uuid := (select v from fx where k='outsider'); f uuid := (select v from fx where k='firm');
        og uuid := (select v from fx where k='other');
begin
  perform t_as(o);
  perform t_check('a lawyer at another firm finds none of the first firm''s file text',
    t_found('quicksilver', f, 'document') = 0);
  perform t_check('...not even without naming a firm',
    (select count(*) from search_docket('quicksilver', null, array['document'], 50)) = 1);  -- their own only
  perform t_check('...and cannot read the row',
    (select count(*) from document_versions dv where dv.id = (select v from fx where k='ver')) = 0);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 8. only the current version is searched
do $$
declare a uuid := (select v from fx where k='a'); f uuid := (select v from fx where k='firm'); d uuid := (select v from fx where k='doc');
begin
  perform t_reset();
  -- A second version supersedes the first. The old version keeps its own text — that text is true
  -- of that version — but a search must return what the document says NOW.
  insert into document_versions (document_id, storage_path, mime, size_bytes, uploaded_by)
    values (d, 'documents/dtx/lease-v2.pdf', 'application/pdf', 5000, a);
  insert into fx select 'ver2', id from document_versions where storage_path = 'documents/dtx/lease-v2.pdf';
  update documents set current_version_id = (select v from fx where k='ver2') where id = d;
  perform record_document_text((select v from fx where k='ver2'), 'extracted',
    'The lessee shall not assign the tangerine premises without consent.', null, false);

  perform t_as(a);
  perform t_check('the new version''s words are found',      t_found('tangerine', f, 'document') = 1);
  perform t_check('the superseded version''s are not',       t_found('quicksilver', f, 'document') = 1);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 9. the queue
do $$
declare n int; first uuid; claimed int;
begin
  perform t_reset();
  -- Everything so far has been recorded, so nothing but the newest version is waiting. Put one
  -- back and claim it.
  update document_versions set text_status = 'pending', text_content = null, text_chars = null,
         text_extracted_at = null, text_attempts = 0, text_claimed_at = null
   where id = (select v from fx where k='ver2');

  select count(*) into claimed from claim_document_text(10);
  perform t_check('the waiting version is claimed', claimed = 1);
  perform t_check('and the claim is recorded on the row, with an attempt counted',
    (select text_claimed_at is not null and text_attempts = 1 from document_versions where id = (select v from fx where k='ver2')));

  select count(*) into n from claim_document_text(10);
  perform t_check('a second run does not claim it again — two workers never take the same file', n = 0);

  -- A claim nobody finished goes back after fifteen minutes. It may have been half-read; the row
  -- says only that it was claimed and never answered for.
  update document_versions set text_claimed_at = now() - interval '20 minutes' where id = (select v from fx where k='ver2');
  select count(*) into n from claim_document_text(10);
  perform t_check('a claim nobody finished comes back', n = 1);

  -- A file that keeps killing the extractor is not retried for ever.
  perform record_document_text((select v from fx where k='ver2'), 'failed', null, 'it broke.');
  update document_versions set text_attempts = 3, text_extracted_at = now() - interval '2 hours'
   where id = (select v from fx where k='ver2');
  select count(*) into n from claim_document_text(10);
  perform t_check('a file that has failed three times stops being retried', n = 0);

  -- A superseded version is never claimed at all: only what a search would return is read.
  update document_versions set text_status = 'pending', text_content = null, text_attempts = 0,
         text_claimed_at = null, text_extracted_at = null
   where id = (select v from fx where k='ver');
  select count(*) into n from claim_document_text(10);
  perform t_check('a superseded version is never claimed', n = 0);

  -- A deleted document's file is not read either.
  update documents set deleted_at = now() where id = (select v from fx where k='internal_doc');
  update document_versions set text_status = 'pending', text_content = null, text_attempts = 0,
         text_claimed_at = null, text_extracted_at = null
   where id = (select v from fx where k='internal_ver');
  select count(*) into n from claim_document_text(10);
  perform t_check('a deleted document''s file is not read', n = 0);
  update documents set deleted_at = null where id = (select v from fx where k='internal_doc');
end $$;

-- ---------------------------------------------------------------- 10. what the firm is told about it
do $$
declare a uuid := (select v from fx where k='a'); o uuid := (select v from fx where k='outsider');
        f uuid := (select v from fx where k='firm'); r record;
begin
  perform t_reset();
  update document_versions set text_status = 'no_text_layer', text_content = null,
         text_detail = 'it is a scan.', text_extracted_at = now()
   where id = (select v from fx where k='internal_ver');

  perform t_as(a);
  select * into r from document_text_health(f);
  perform t_check('the firm is told how many of its files could not be read', r.no_text_layer = 1);
  perform t_check('and how many were', r.extracted >= 1);
  perform t_check('and when the last one was read', r.last_extracted_at is not null);
  perform t_reset();

  -- Another firm's numbers are not a firm's business, even in the aggregate.
  perform t_as(o);
  select * into r from document_text_health(f);
  perform t_check('a lawyer at another firm is told nothing about this firm''s files',
    coalesce(r.extracted, 0) = 0 and coalesce(r.no_text_layer, 0) = 0 and r.last_extracted_at is null);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 11. the search function is still the caller's
do $$
begin
  -- Migration 43 turns on this one word, and so does everything above. If search_docket ever became
  -- SECURITY DEFINER, every negative assertion in this file would quietly become false.
  perform t_check('search_docket is NOT security definer',
    (select not prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'search_docket'));
  perform t_check('...and the two writing functions ARE, which is why they refuse a signed-in caller',
    (select bool_and(prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('claim_document_text', 'record_document_text')));
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
