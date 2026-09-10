-- Docket — counsel and service-of-process tests: a served firm sees the service record and the served
-- document, and nothing else; off-platform counsel is served the old way; clients see progress.
-- Runs in one transaction and rolls back.
begin;

create or replace function t_as(u uuid, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', aal)::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create or replace function t_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
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

-- ---------------------------------------------------------------- fixture: three firms, one matter at firm A
create temp table fx (k text primary key, v uuid);
grant select on fx to anon, authenticated;
insert into firms (slug, name, reference_prefix) values ('serve-a', 'Firm A', 'SA'), ('serve-b', 'Firm B', 'SB'), ('serve-c', 'Firm C', 'SC');
insert into fx select 'firm_' || right(slug, 1), id from firms where slug like 'serve-%';
insert into auth.users (id, email) values
  (gen_random_uuid(), 'lawyer_a@stest'), (gen_random_uuid(), 'lawyer_b@stest'), (gen_random_uuid(), 'lawyer_c@stest'), (gen_random_uuid(), 'client_a@stest');
insert into fx select split_part(email, '@', 1), id from auth.users where email like '%@stest';
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm_a'), (select v from fx where k='lawyer_a'), 'lawyer'),
  ((select v from fx where k='firm_b'), (select v from fx where k='lawyer_b'), 'lawyer'),
  ((select v from fx where k='firm_c'), (select v from fx where k='lawyer_c'), 'lawyer');
insert into matters (firm_id, reference, title, type, suit_number, court_name)
values ((select v from fx where k='firm_a'), 'SA-M-2026-000001', 'Okonkwo v Eze', 'litigation', 'FHC/L/CS/77/2026', 'Federal High Court, Lagos');
insert into fx select 'matter', id from matters where reference = 'SA-M-2026-000001';
insert into matter_parties (matter_id, firm_id, user_id, role) values
  ((select v from fx where k='matter'), (select v from fx where k='firm_a'), (select v from fx where k='client_a'), 'client');
insert into documents (firm_id, matter_id, name, category, client_visible, uploaded_by) values
  ((select v from fx where k='firm_a'), (select v from fx where k='matter'), 'Originating Summons.pdf', 'court', false, (select v from fx where k='lawyer_a')),
  ((select v from fx where k='firm_a'), (select v from fx where k='matter'), 'Strategy memo.docx',      'internal', false, (select v from fx where k='lawyer_a'));
insert into fx select 'doc_summons', id from documents where name = 'Originating Summons.pdf';
insert into fx select 'doc_memo',    id from documents where name = 'Strategy memo.docx';
insert into document_versions (document_id, storage_path, mime, uploaded_by)
select id, 'documents/' || firm_id || '/' || id || '/v1.pdf', 'application/pdf', uploaded_by from documents where name = 'Originating Summons.pdf';

-- ---------------------------------------------------------------- 1. record counsel, serve on Docket and off it
do $$
declare la uuid := (select v from fx where k='lawyer_a'); fa uuid := (select v from fx where k='firm_a'); fb uuid := (select v from fx where k='firm_b');
        m uuid := (select v from fx where k='matter'); ds uuid := (select v from fx where k='doc_summons'); dm uuid := (select v from fx where k='doc_memo');
        c_b uuid; c_off uuid; s1 uuid; s2 uuid; ok bool;
begin
  perform t_as(la, 'aal2');
  insert into matter_counsel (firm_id, matter_id, side, party_name, counsel_firm_id, created_by)
  values (fa, m, 'opposing', 'Eze', fb, la) returning id into c_b;
  insert into matter_counsel (firm_id, matter_id, side, party_name, counsel_name, counsel_firm_name, email, address_for_service, created_by)
  values (fa, m, 'co_counsel', 'Okonkwo', 'K. Bello, Esq.', 'Bello & Co', 'k.bello@example.com', '12 Broad Street, Lagos', la) returning id into c_off;
  perform t_check('counsel recorded on the matter',                        (select count(*) from matter_counsel where matter_id = m) = 2);

  s1 := serve_process(m, c_b, ds, 'Originating Summons', 'platform');
  perform t_check('served on Docket counsel',                              (select method from process_service where id = s1) = 'platform');
  perform t_check('service snapshots what is on the face of the process',  (select suit_number || '|' || case_title from process_service where id = s1) = 'FHC/L/CS/77/2026|Okonkwo v Eze');
  perform t_check('client-visible timeline entry posted',                  (select count(*) from updates where matter_id = m and visibility = 'client' and title = 'Originating Summons served on Firm B') = 1);

  s2 := serve_process(m, c_off, ds, 'Originating Summons', 'email', now(), 'sent to k.bello@example.com');
  perform t_check('served off-platform counsel by email',                 (select method from process_service where id = s2) = 'email');
  ok := false;
  begin
    perform serve_process(m, c_off, ds, 'Motion on Notice', 'platform');
  exception when others then ok := sqlerrm like '%not on Docket%';
  end;
  perform t_check('cannot serve off-platform counsel through the platform', ok);
  ok := false;
  begin
    perform serve_process(m, c_b, gen_random_uuid(), 'Motion on Notice', 'platform');
  exception when others then ok := sqlerrm like '%document is not on this matter%';
  end;
  perform t_check('cannot serve a document that is not on the matter',    ok);
  perform t_reset();
  insert into fx values ('counsel_b', c_b), ('counsel_off', c_off), ('svc_b', s1), ('svc_off', s2);
end $$;

-- ---------------------------------------------------------------- 2. what the served firm sees — and does not
do $$
declare lb uuid := (select v from fx where k='lawyer_b'); lc uuid := (select v from fx where k='lawyer_c'); s1 uuid := (select v from fx where k='svc_b');
        ds uuid := (select v from fx where k='doc_summons'); dm uuid := (select v from fx where k='doc_memo'); m uuid := (select v from fx where k='matter'); ok bool;
begin
  perform t_as(lb, 'aal2');
  perform t_check('served firm sees the service record',                   (select count(*) from process_service where id = s1) = 1);
  perform t_check('served firm''s lawyer was notified',                    (select count(*) from notifications where event = 'process_served' and (payload ->> 'process_service_id')::uuid = s1) >= 1);
  perform t_check('served firm sees it in its inbox',                     (select count(*) from service_inbox where id = s1 and serving_firm_id = (select v from fx where k='firm_a')) = 1);
  perform t_check('served firm can open the served document',             (select count(*) from documents where id = ds) = 1 and (select count(*) from document_versions where document_id = ds) = 1);
  perform t_check('served firm cannot see the matter',                    (select count(*) from matters where id = m) = 0);
  perform t_check('served firm cannot see other documents on the matter', (select count(*) from documents where id = dm) = 0);
  perform t_check('served firm cannot see the counsel roster',            (select count(*) from matter_counsel) = 0);
  perform t_check('served firm cannot see the matter timeline',           (select count(*) from updates where matter_id = m) = 0);
  ok := false;
  begin
    update process_service set note = 'tampered' where id = s1;
    ok := (select coalesce(note, '') from process_service where id = s1) <> 'tampered';
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('served firm cannot edit the record',                   ok);
  perform acknowledge_service(s1, 'Received at chambers');
  perform t_check('served firm acknowledges service',                     (select acknowledged_by from process_service where id = s1) = lb);
  ok := false;
  begin
    perform acknowledge_service(s1);
  exception when others then ok := sqlerrm like '%already%';
  end;
  perform t_check('acknowledgement is once only',                         ok);
  perform t_reset();

  perform t_as(lc, 'aal2');
  perform t_check('an unrelated firm sees nothing',                       (select count(*) from process_service) + (select count(*) from documents) + (select count(*) from service_inbox) = 0);
  ok := false;
  begin
    perform acknowledge_service((select v from fx where k='svc_off'));
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('an unrelated firm cannot acknowledge',                 ok);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. the serving firm and its client
do $$
declare la uuid := (select v from fx where k='lawyer_a'); ca uuid := (select v from fx where k='client_a'); s1 uuid := (select v from fx where k='svc_b');
        m uuid := (select v from fx where k='matter'); ok bool;
begin
  perform t_as(la, 'aal2');
  perform t_check('serving firm sees the acknowledgement',                (select acknowledgement_note from process_service where id = s1) = 'Received at chambers');
  perform t_check('serving firm has an internal note of it',              (select count(*) from updates where matter_id = m and visibility = 'internal' and title like 'Service of Originating Summons acknowledged by Firm B') = 1);
  perform t_check('serving lawyer was told',                              (select count(*) from notifications where user_id = la and event = 'service_acknowledged') >= 1);
  update process_service set note = 'bailiff copy filed' where id = s1;
  perform t_check('serving firm keeps its own bookkeeping',               (select note from process_service where id = s1) = 'bailiff copy filed');
  perform t_reset();

  perform t_as(ca, 'aal1');
  perform t_check('client sees the case moving',                          (select count(*) from updates where matter_id = m and title like '% served on %') = 2);
  perform t_check('client does not see the acknowledgement note',         (select count(*) from updates where visibility = 'internal') = 0);
  perform t_check('client sees no service records or counsel details',    (select count(*) from process_service) + (select count(*) from matter_counsel) = 0);
  ok := false;
  begin
    perform serve_process(m, (select v from fx where k='counsel_b'), (select v from fx where k='doc_summons'), 'Hearing Notice', 'platform');
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('clients cannot serve processes',                       ok);
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
