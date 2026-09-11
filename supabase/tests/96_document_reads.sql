-- Opening a document leaves a record; the record is the only way to the bytes; who may see the
-- record is who may see the document, and never the client. Run alone or with the others. Rolls back.
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
insert into auth.users (id, email) values (gen_random_uuid(),'dr-a@test'), (gen_random_uuid(),'dr-b@test'), (gen_random_uuid(),'dr-client@test'), (gen_random_uuid(),'dr-stranger@test');
insert into fx select 'a', id from auth.users where email='dr-a@test';
insert into fx select 'b', id from auth.users where email='dr-b@test';
insert into fx select 'client', id from auth.users where email='dr-client@test';
insert into fx select 'stranger', id from auth.users where email='dr-stranger@test';
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'), (select v from fx where k='a'), 'lawyer'),
  ((select v from fx where k='firm'), (select v from fx where k='b'), 'lawyer');
insert into matters (firm_id, reference, title, type, handling_lawyer_id)
  values ((select v from fx where k='firm'), 'DR-M-2026-000001', 'Reads v Records', 'litigation', (select v from fx where k='a'));
insert into fx select 'matter', id from matters where reference = 'DR-M-2026-000001';
insert into matter_parties (matter_id, firm_id, user_id, role) values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');
insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by)
  values (gen_random_uuid(), (select v from fx where k='firm'), (select v from fx where k='matter'), 'affidavit.pdf', 'pleading', true, (select v from fx where k='a'));
insert into fx select 'doc', id from documents where name = 'affidavit.pdf';
insert into document_versions (id, document_id, storage_path, mime, uploaded_by)
  values (gen_random_uuid(), (select v from fx where k='doc'), 'f/d/v.pdf', 'application/pdf', (select v from fx where k='a'));
insert into fx select 'ver', id from document_versions where storage_path = 'f/d/v.pdf';
update documents set current_version_id = (select v from fx where k='ver') where id = (select v from fx where k='doc');

do $$
declare a uuid := (select v from fx where k='a'); ver uuid := (select v from fx where k='ver'); d uuid := (select v from fx where k='doc'); f uuid := (select v from fx where k='firm'); r jsonb;
begin
  perform t_as(a);
  perform t_check('before opening, the bytes are gated shut for the lawyer too', not recorded_read(ver));
  r := open_document_version(ver);
  perform t_check('opening returns what storage needs', r ->> 'storage_path' = 'f/d/v.pdf');
  perform t_check('and leaves a record', exists (select 1 from document_reads where version_id = ver and user_id = a));
  perform t_check('which opens the gate for the next few minutes', recorded_read(ver));
  perform t_reset();
  perform t_check('and a line in the firm''s audit log', exists (select 1 from audit_log where action = 'document.opened' and entity_id = ver and actor_id = a and firm_id = f));
end $$;

do $$
declare cl uuid := (select v from fx where k='client'); a uuid := (select v from fx where k='a'); ver uuid := (select v from fx where k='ver'); ok bool;
begin
  perform t_as(cl, 'aal1');
  perform open_document_version(ver);
  perform t_check('but sees no record — not even their own', not exists (select 1 from document_reads where version_id = ver));
  perform t_reset();
  perform t_check('the client opened their client-visible document', exists (select 1 from document_reads where version_id = ver and user_id = cl));
  perform t_reset(); perform t_as(a);
  perform t_check('the lawyer sees both reads', (select count(*) from document_reads where version_id = ver) = 2);
  ok := t_refused(format('insert into document_reads (version_id, document_id, firm_id, user_id) values (%L, %L, %L, %L)', ver, (select document_id from document_reads limit 1), (select firm_id from document_reads limit 1), a), '42501');
  perform t_check('a record cannot be written directly', ok);
  perform t_reset();
end $$;

do $$
declare st uuid := (select v from fx where k='stranger'); ver uuid := (select v from fx where k='ver'); ok bool;
begin
  perform t_as(st, 'aal1');
  ok := t_refused(format('select open_document_version(%L)', ver), '42501');
  perform t_check('a stranger cannot open it', ok);
  perform t_check('and the gate stays shut for them', not recorded_read(ver));
  perform t_reset();
end $$;

-- the wall reaches the record: B, outside a restricted matter's team, can neither open nor see who did
do $$
declare a uuid := (select v from fx where k='a'); b uuid := (select v from fx where k='b'); f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter'); ver uuid := (select v from fx where k='ver'); ok bool;
begin
  update firms set matter_walls = true where id = f;
  insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values (m, f, a, true);
  perform t_as(a); update matters set access = 'team' where id = m; perform t_reset();
  perform t_as(b);
  ok := t_refused(format('select open_document_version(%L)', ver), '42501');
  perform t_check('a colleague outside the wall cannot open the document', ok);
  perform t_check('nor see who did', not exists (select 1 from document_reads where version_id = ver));
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
