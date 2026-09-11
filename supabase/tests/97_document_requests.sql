-- A request for a document is a row the client sees, fulfils once by uploading, and staff may
-- withdraw but never delete. The wall reaches it. Run alone or with the others. Rolls back.
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
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values (gen_random_uuid(),'dq-a@test'), (gen_random_uuid(),'dq-b@test'), (gen_random_uuid(),'dq-client@test'), (gen_random_uuid(),'dq-stranger@test');
insert into fx select 'a', id from auth.users where email='dq-a@test';
insert into fx select 'b', id from auth.users where email='dq-b@test';
insert into fx select 'client', id from auth.users where email='dq-client@test';
insert into fx select 'stranger', id from auth.users where email='dq-stranger@test';
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'), (select v from fx where k='a'), 'lawyer'),
  ((select v from fx where k='firm'), (select v from fx where k='b'), 'lawyer');
update profiles set preferred_channel = 'sms', phone = '+2348000000301' where id = (select v from fx where k='client');
insert into matters (firm_id, reference, title, type, handling_lawyer_id)
  values ((select v from fx where k='firm'), 'DQ-M-2026-000001', 'Requests v Silence', 'litigation', (select v from fx where k='a'));
insert into fx select 'matter', id from matters where reference = 'DQ-M-2026-000001';
insert into matter_parties (matter_id, firm_id, user_id, role) values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');

do $$
declare a uuid := (select v from fx where k='a'); cl uuid := (select v from fx where k='client'); st uuid := (select v from fx where k='stranger');
        f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter'); rq uuid; ok bool;
begin
  perform t_as(a);
  insert into document_requests (firm_id, matter_id, title, why, due_on, requested_by)
    values (f, m, 'Certificate of occupancy', 'The court will ask for the original', current_date + 7, a) returning id into rq;
  perform t_check('staff ask for a document, by a day', (select due_on = current_date + 7 from document_requests where id = rq));
  perform t_reset();
  perform t_check('the client is told', exists (select 1 from notifications where user_id = cl and event = 'document_requested' and payload ->> 'request_id' = rq::text));
  perform t_as(cl, 'aal1');
  perform t_check('the client sees the request', exists (select 1 from document_requests where id = rq));
  ok := t_refused(format('update document_requests set cancelled_at = now() where id = %L', rq), '42501');
  perform t_check('but cannot withdraw it — an update matches nothing or is refused', ok or (select cancelled_at is null from document_requests where id = rq));
  perform t_reset(); perform t_as(st, 'aal1');
  perform t_check('a stranger sees nothing', not exists (select 1 from document_requests where id = rq));
  perform t_reset();
end $$;

do $$
declare a uuid := (select v from fx where k='a'); cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter');
        rq uuid := (select id from document_requests where title = 'Certificate of occupancy'); d uuid := gen_random_uuid(); other uuid := gen_random_uuid(); ok bool;
begin
  -- the client uploads (the documents policy lets a party insert a client-visible document on their matter)
  perform t_as(cl, 'aal1');
  insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by) values (d, f, m, 'c-of-o.pdf', 'client_upload', true, cl);
  perform fulfil_document_request(rq, d);
  perform t_check('the client answers the request with their upload', (select fulfilled_document_id = d and fulfilled_at is not null from document_requests where id = rq));
  ok := t_refused(format('select fulfil_document_request(%L, %L)', rq, d), 'P0001');
  perform t_check('a request is answered once', ok);
  perform t_reset();
  perform t_check('the lawyer who asked is told the document arrived', exists (select 1 from notifications where user_id = a and event = 'document_received' and payload ->> 'request_id' = rq::text));
  -- a document on another matter cannot answer it
  perform t_as(a);
  insert into document_requests (firm_id, matter_id, title, requested_by) values (f, m, 'Deed of assignment', a) returning id into rq;
  perform t_reset();
  insert into matters (id, firm_id, reference, title, type) values (other, f, 'DQ-M-2026-000002', 'Other', 'litigation');
  insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by) values (gen_random_uuid(), f, other, 'elsewhere.pdf', 'pleading', true, a);
  perform t_as(a);
  ok := t_refused(format('select fulfil_document_request(%L, %L)', rq, (select id from documents where name = 'elsewhere.pdf')), 'P0001');
  perform t_check('a document on another matter cannot answer it', ok);
  update document_requests set cancelled_at = now() where id = rq;
  perform t_check('staff withdraw a request', (select cancelled_at is not null from document_requests where id = rq));
  perform t_check('and cannot un-withdraw it', t_fails(format('update document_requests set cancelled_at = null where id = %L', rq), 'stays withdrawn'));
  perform t_check('nor answer a request by hand', t_refused(format('update document_requests set fulfilled_at = now() where id = %L', rq), '42501'));
  perform t_check('nor rewrite who asked', t_refused(format('update document_requests set requested_by = %L where id = %L', a, rq), '42501'));
  ok := t_refused(format('delete from document_requests where id = %L', rq), '42501');
  perform t_check('and can never delete one', ok);
  perform t_reset();
end $$;

-- the wall reaches requests
do $$
declare a uuid := (select v from fx where k='a'); b uuid := (select v from fx where k='b'); f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter');
begin
  update firms set matter_walls = true where id = f;
  insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values (m, f, a, true);
  perform t_as(a); update matters set access = 'team' where id = m; perform t_reset();
  perform t_as(b);
  perform t_check('a colleague outside the wall sees no request on the matter', not exists (select 1 from document_requests where matter_id = m));
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
