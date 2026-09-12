-- A retry makes nothing twice: the same client reference on the same matter returns the update
-- already posted; a message carries a client-minted id. An upload that stopped leaves a row with no
-- file that answers nothing and can be retired; the platform counts such rows. Rolls back.
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

create temp table fx (k text primary key, v uuid);
grant select on fx to anon, authenticated;
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values (gen_random_uuid(), 'rt-lawyer@test'), (gen_random_uuid(), 'rt-client@test'), (gen_random_uuid(), 'rt-admin@test');
insert into fx select 'lawyer', id from auth.users where email = 'rt-lawyer@test';
insert into fx select 'client', id from auth.users where email = 'rt-client@test';
insert into fx select 'padmin', id from auth.users where email = 'rt-admin@test';
insert into firm_members (firm_id, user_id, role) values ((select v from fx where k='firm'), (select v from fx where k='lawyer'), 'lawyer');
insert into platform_admins (user_id, note) values ((select v from fx where k='padmin'), 'retries suite');
insert into matters (firm_id, reference, title, type, handling_lawyer_id)
  values ((select v from fx where k='firm'), 'RT-M-2026-000001', 'Retry v Twice', 'litigation', (select v from fx where k='lawyer'));
insert into fx select 'matter', id from matters where reference = 'RT-M-2026-000001';
insert into matter_parties (matter_id, firm_id, user_id, role) values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');

-- ---------------------------------------------------------------- 1. the same posting twice is one posting
do $$
declare l uuid := (select v from fx where k='lawyer'); m uuid := (select v from fx where k='matter'); ref uuid := gen_random_uuid(); u1 uuid; u2 uuid; u3 uuid;
begin
  perform t_as(l);
  u1 := post_court_update(m, 'hearing_held', now(), null, null, null, null, 'We were heard', null, null, null, false, null, null, null, null, null, null, null, null, ref);
  u2 := post_court_update(m, 'hearing_held', now(), null, null, null, null, 'We were heard', null, null, null, false, null, null, null, null, null, null, null, null, ref);
  perform t_check('a retry with the same reference returns the same update', u1 = u2 and (select count(*) = 1 from updates where matter_id = m and kind = 'court_sitting'));
  u3 := post_court_update(m, 'hearing_held', now(), null, null, null, null, 'Again, deliberately', null, null, null, false, null, null, null, null, null, null, null, null, null);
  perform t_check('without a reference a second posting is a second posting, as before', u3 <> u1 and (select count(*) = 2 from updates where matter_id = m and kind = 'court_sitting'));
  perform t_check('the reference is unique per matter', t_refused(format('insert into updates (matter_id, firm_id, kind, visibility, title, posted_by, client_ref) values (%L, %L, ''note'', ''internal'', ''x'', %L, %L)', m, (select v from fx where k='firm'), l, ref), '23505'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. a message with a client-minted id lands once
do $$
declare cl uuid := (select v from fx where k='client'); m uuid := (select v from fx where k='matter'); f uuid := (select v from fx where k='firm'); mid uuid := gen_random_uuid();
begin
  perform t_as(cl, 'aal1');
  insert into messages (id, firm_id, matter_id, sender_id, body) values (mid, f, m, cl, 'hello');
  perform t_check('the second send of the same message is refused by the key, so the app treats it as sent', t_refused(format('insert into messages (id, firm_id, matter_id, sender_id, body) values (%L, %L, %L, %L, ''hello'')', mid, f, m, cl), '23505'));
  perform t_check('and only one landed', (select count(*) = 1 from messages where id = mid));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. an upload that stopped answers nothing and can be retired
do $$
declare cl uuid := (select v from fx where k='client'); l uuid := (select v from fx where k='lawyer'); m uuid := (select v from fx where k='matter'); f uuid := (select v from fx where k='firm');
        d uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); rq uuid; pa uuid := (select v from fx where k='padmin'); r jsonb;
begin
  perform t_as(l);
  insert into document_requests (firm_id, matter_id, title, requested_by) values (f, m, 'The lease', l) returning id into rq;
  perform t_reset(); perform t_as(cl, 'aal1');
  insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by) values (d, f, m, 'lease.pdf', 'client_upload', true, cl);
  perform t_check('a row with no file cannot answer a request', t_fails(format('select fulfil_document_request(%L, %L)', rq, d), 'no file yet'));
  perform t_reset(); perform t_as(pa);
  perform t_check('the platform counts it', (storage_integrity() ->> 'documents_without_version')::int >= 1);
  perform t_reset(); perform t_as(cl, 'aal1');
  perform retire_empty_document(d);
  perform t_check('and can no longer see it', not exists (select 1 from documents where id = d));
  perform t_reset();
  perform t_check('the client who made it retires it', (select deleted_at is not null from documents where id = d));
  insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by) values (d2, f, m, 'signed.pdf', 'client_upload', true, cl);
  insert into document_versions (document_id, storage_path, mime, size_bytes, uploaded_by) values (d2, f || '/' || d2 || '/v.pdf', 'application/pdf', 10, cl);
  perform t_as(cl, 'aal1');
  perform t_check('a document with a file stays', t_fails(format('select retire_empty_document(%L)', d2), 'has a file and stays'));
  perform t_reset();
  perform t_check('retiring is audited', exists (select 1 from audit_log where action = 'document.retired' and entity_id = d));
end $$;

-- ---------------------------------------------------------------- 4. a request sent twice is one request
do $$
declare l uuid := (select v from fx where k='lawyer'); cl uuid := (select v from fx where k='client'); m uuid := (select v from fx where k='matter'); f uuid := (select v from fx where k='firm');
        ref uuid := gen_random_uuid(); n int;
begin
  perform t_reset(); perform t_as(l);
  insert into document_requests (firm_id, matter_id, title, requested_by, client_ref) values (f, m, 'The certificate of occupancy', l, ref);
  perform t_check('the same reference twice is refused, so the retry lands once',
    t_refused(format('insert into document_requests (firm_id, matter_id, title, requested_by, client_ref) values (%L, %L, ''The certificate of occupancy'', %L, %L)', f, m, l, ref), '23505'));
  perform t_check('one request, and the client told once',
    (select count(*) = 1 from document_requests where client_ref = ref)
    and (select count(*) = count(distinct channel) from notifications n2 where n2.user_id = cl and n2.event = 'document_requested' and n2.payload ->> 'title' = 'The certificate of occupancy'));
  perform t_check('a different reference is a different request',
    not t_refused(format('insert into document_requests (firm_id, matter_id, title, requested_by, client_ref) values (%L, %L, ''The survey plan'', %L, %L)', f, m, l, gen_random_uuid()), '23505'));
  perform t_check('and one without a reference is not blocked by another without one',
    not t_refused(format('insert into document_requests (firm_id, matter_id, title, requested_by) values (%L, %L, ''No reference at all'', %L)', f, m, l), '23505')
    and not t_refused(format('insert into document_requests (firm_id, matter_id, title, requested_by) values (%L, %L, ''No reference either'', %L)', f, m, l), '23505'));
  perform t_check('what fulfilment writes is not the API''s to write',
    t_refused(format('insert into document_requests (firm_id, matter_id, title, requested_by, fulfilled_at) values (%L, %L, ''Already answered?'', %L, now())', f, m, l), '42501'));
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
