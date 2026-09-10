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
  (gen_random_uuid(), 'lawyer_a@stest'), (gen_random_uuid(), 'admin_a@stest'), (gen_random_uuid(), 'lawyer_b@stest'),
  (gen_random_uuid(), 'staff_b@stest'), (gen_random_uuid(), 'lawyer_c@stest'), (gen_random_uuid(), 'client_a@stest');
insert into fx select split_part(email, '@', 1), id from auth.users where email like '%@stest';
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm_a'), (select v from fx where k='lawyer_a'), 'lawyer'),
  ((select v from fx where k='firm_a'), (select v from fx where k='admin_a'),  'admin'),
  ((select v from fx where k='firm_b'), (select v from fx where k='lawyer_b'), 'admin'),
  ((select v from fx where k='firm_b'), (select v from fx where k='staff_b'),  'staff'),
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
insert into document_versions (document_id, storage_path, mime, checksum, uploaded_by)
select id, 'documents/' || firm_id || '/' || id || '/v1.pdf', 'application/pdf', 'sha256:v1', uploaded_by from documents where name = 'Originating Summons.pdf';
update documents d set current_version_id = v.id from document_versions v where v.document_id = d.id;
insert into fx select 'ver1', id from document_versions;

-- ---------------------------------------------------------------- 1. record counsel; the rules of service are enforced
do $$
declare la uuid := (select v from fx where k='lawyer_a'); fa uuid := (select v from fx where k='firm_a'); fb uuid := (select v from fx where k='firm_b');
        m uuid := (select v from fx where k='matter'); ds uuid := (select v from fx where k='doc_summons');
        c_b uuid; c_off uuid; s1 uuid; s2 uuid; s3 uuid; ok bool;
begin
  perform t_as(la, 'aal2');
  insert into matter_counsel (firm_id, matter_id, side, party_name, party_side, counsel_firm_id, created_by)
  values (fa, m, 'opposing', 'Eze', 'defendant', fb, la) returning id into c_b;
  insert into matter_counsel (firm_id, matter_id, side, party_name, party_side, counsel_name, counsel_firm_name, email, address_for_service, created_by)
  values (fa, m, 'co_counsel', 'Okonkwo', 'claimant', 'K. Bello, Esq.', 'Bello & Co', 'k.bello@example.com', '12 Broad Street, Lagos', la) returning id into c_off;
  perform t_check('counsel recorded on the matter',                        (select count(*) from matter_counsel where matter_id = m) = 2);
  ok := false;
  begin
    insert into matter_counsel (firm_id, matter_id, side, counsel_firm_id, created_by) values (fa, m, 'opposing', fb, la);
  exception when unique_violation then ok := true;
  end;
  perform t_check('a firm is recorded once per matter',                    ok);

  ok := false;
  begin
    s1 := serve_process(m, c_b, ds, 'Motion on Notice', 'platform');
  exception when others then ok := sqlerrm like '%has not undertaken to accept service through Docket%';
  end;
  perform t_check('platform service needs the other firm''s opt-in',       ok);
  perform t_reset();
  update firms set accepts_platform_service = true where id = fb;
  perform t_as(la, 'aal2');

  s1 := serve_process(m, c_b, ds, 'Motion on Notice', 'platform', now() - interval '10 days');
  perform t_check('served on Docket counsel',                              (select method from process_service where id = s1) = 'platform');
  perform t_check('platform service is timestamped by the platform',      (select served_at from process_service where id = s1) > now() - interval '1 minute');
  perform t_check('service is pinned to the document version and checksum', (select document_version_id from process_service where id = s1) = (select v from fx where k='ver1')
                                                                            and (select checksum from process_service where id = s1) = 'sha256:v1');
  perform t_check('service snapshots what is on the face of the process',  (select suit_number || '|' || case_title from process_service where id = s1) = 'FHC/L/CS/77/2026|Okonkwo v Eze');
  perform t_check('client-visible timeline entry posted',                  (select count(*) from updates where matter_id = m and visibility = 'client' and title = 'Motion on Notice served on Firm B for Eze') = 1);

  ok := false;
  begin
    s2 := serve_process(m, c_b, ds, 'Originating Summons', 'platform', now(), null, true);
  exception when others then ok := sqlerrm like '%originating process%';
  end;
  perform t_check('an originating process is not served on counsel without an undertaking', ok);
  update matter_counsel set accepts_service = true where id = c_b;
  s2 := serve_process(m, c_b, ds, 'Originating Summons', 'platform', now(), null, true);
  perform t_check('with counsel''s undertaking the originating process may be served', (select is_originating from process_service where id = s2));

  s3 := serve_process(m, c_off, ds, 'Originating Summons', 'bailiff', now() - interval '2 days', 'bailiff copy filed', true, false, null,
                      'K. Bello, Esq.', 'counsel', '12 Broad Street, Lagos', 'Bailiff J. Musa');
  perform t_check('off-platform service records who was served and by whom', (select served_on_name || '|' || server_name from process_service where id = s3) = 'K. Bello, Esq.|Bailiff J. Musa');
  ok := false;
  begin
    perform serve_process(m, c_off, ds, 'Motion on Notice', 'platform');
  exception when others then ok := sqlerrm like '%not on Docket%';
  end;
  perform t_check('cannot serve off-platform counsel through the platform', ok);
  ok := false;
  begin
    perform serve_process(m, c_off, ds, 'Motion on Notice', 'email', now() + interval '1 day');
  exception when others then ok := sqlerrm like '%cannot be in the future%';
  end;
  perform t_check('service cannot be dated in the future',                 ok);
  ok := false;
  begin
    perform serve_process(m, c_off, ds, 'Motion on Notice', 'pasting', now(), null, false, true, null);
  exception when others then ok := sqlerrm like '%court''s order%';
  end;
  perform t_check('substituted service needs the court''s order attached',   ok);
  ok := false;
  begin
    perform serve_process(m, c_b, gen_random_uuid(), 'Motion on Notice', 'platform');
  exception when others then ok := sqlerrm like '%document is not on this matter%';
  end;
  perform t_check('cannot serve a document that is not on the matter',    ok);
  ok := false;
  begin
    update matter_counsel set counsel_firm_id = (select v from fx where k='firm_c') where id = c_b;
  exception when others then ok := sqlerrm like '%served through Docket%';
  end;
  perform t_check('counsel served through Docket cannot be re-pointed at another firm', ok);
  -- recording an off-platform service against Docket counsel is bookkeeping only: it grants nothing
  perform serve_process(m, c_b, ds, 'Written Address', 'email', now(), 'sent to chambers email');
  perform t_reset();

  perform t_as((select v from fx where k='lawyer_c'), 'aal2');
  ok := false;
  begin
    insert into matter_counsel (firm_id, matter_id, side, counsel_firm_name, created_by) values ((select v from fx where k='firm_c'), m, 'opposing', 'Intruder & Co', (select v from fx where k='lawyer_c'));
  exception when others then ok := sqlerrm like '%belong to the firm%' or sqlstate = '42501';
  end;
  perform t_check('another firm cannot add counsel to a matter it does not own', ok);
  perform t_reset();
  insert into fx values ('counsel_b', c_b), ('counsel_off', c_off), ('svc_b', s1), ('svc_b2', s2), ('svc_off', s3);
end $$;

-- ---------------------------------------------------------------- 2. what the served firm sees — and does not
do $$
declare lb uuid := (select v from fx where k='lawyer_b'); lc uuid := (select v from fx where k='lawyer_c'); s1 uuid := (select v from fx where k='svc_b');
        fb uuid := (select v from fx where k='firm_b'); ds uuid := (select v from fx where k='doc_summons'); dm uuid := (select v from fx where k='doc_memo');
        m uuid := (select v from fx where k='matter'); v1 uuid := (select v from fx where k='ver1'); v2 uuid; own uuid; ok bool;
begin
  perform t_as(lb, 'aal2');
  perform t_check('served firm''s lawyer was notified',                    (select count(*) from notifications where event = 'process_served' and (payload ->> 'process_service_id')::uuid = s1) >= 1);
  perform t_check('served firm never reads the serving firm''s record',    (select count(*) from process_service) = 0);
  perform t_check('served firm sees it in its inbox, with the checksum',   (select count(*) from service_inbox where id = s1 and serving_firm_id = (select v from fx where k='firm_a') and checksum = 'sha256:v1') = 1);
  perform t_check('the inbox names who served, with SCN',                  (select served_by_name from service_inbox where id = s1) is not null);
  perform t_check('the inbox never carries the serving firm''s notes',     not exists (select 1 from information_schema.columns where table_name = 'service_inbox' and column_name in ('note','proof_document_id','acknowledgement_note','revoke_reason')));
  perform t_check('off-platform service on Docket counsel grants nothing', (select count(*) from service_inbox where process_title = 'Written Address') = 0);
  perform t_check('served firm can open the served document version',     (select count(*) from documents where id = ds) = 1 and (select count(*) from document_versions where id = v1) = 1);
  perform t_check('served firm can never upload into the serving firm''s document', can_access_document(ds) and not can_upload_document(ds));
  perform t_reset();

  perform t_as((select v from fx where k='staff_b'), 'aal2');
  ok := false;
  begin
    perform acknowledge_service(s1);
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('a staff-role member cannot acknowledge service',        ok);
  perform t_reset();

  perform t_as(lb, 'aal2');
  perform t_check('served firm cannot see the matter',                    (select count(*) from matters where id = m) = 0);
  perform t_check('served firm cannot see other documents on the matter', (select count(*) from documents where id = dm) = 0);
  perform t_check('served firm cannot see the counsel roster',            (select count(*) from matter_counsel) = 0);
  perform t_check('served firm cannot see the matter timeline',           (select count(*) from updates where matter_id = m) = 0);
  perform t_reset();

  -- the serving firm files an amended version later: the other side keeps only what was served
  insert into document_versions (document_id, storage_path, mime, checksum, uploaded_by)
  values (ds, 'documents/x/' || ds || '/v2.pdf', 'application/pdf', 'sha256:v2', (select v from fx where k='lawyer_a')) returning id into v2;
  update documents set current_version_id = v2 where id = ds;

  perform t_as(lb, 'aal2');
  perform t_check('served firm sees only the version that was served',    (select count(*) from document_versions where document_id = ds) = 1
                                                                          and (select id from document_versions where document_id = ds) = v1);
  perform acknowledge_service(s1, 'Received at chambers');
  perform t_check('served firm acknowledges service, by name',            (select acknowledged_at from service_inbox where id = s1) is not null and (select acknowledged_by_name from service_inbox where id = s1) like '%Firm B');
  ok := false;
  begin
    perform acknowledge_service(s1);
  exception when others then ok := sqlerrm like '%already%';
  end;
  perform t_check('acknowledgement is once only',                         ok);

  insert into matters (firm_id, reference, title, type) values (fb, 'SB-M-2026-000001', 'Eze ads. Okonkwo', 'litigation') returning id into own;
  perform link_service_to_matter(s1, own, current_date + 14, 'File counter-affidavit');
  perform t_check('served firm files the process against its own matter', (select recipient_matter_id from service_inbox where id = s1) = own
                                                                          and (select count(*) from updates where matter_id = own and visibility = 'internal' and title like 'Motion on Notice received from Firm A') = 1);
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

-- ---------------------------------------------------------------- 3. the serving firm, its client, and withdrawal
do $$
declare la uuid := (select v from fx where k='lawyer_a'); aa uuid := (select v from fx where k='admin_a'); ca uuid := (select v from fx where k='client_a');
        lb uuid := (select v from fx where k='lawyer_b'); s1 uuid := (select v from fx where k='svc_b'); s2 uuid := (select v from fx where k='svc_b2');
        m uuid := (select v from fx where k='matter'); ds uuid := (select v from fx where k='doc_summons'); ok bool;
begin
  perform t_as(la, 'aal2');
  perform t_check('serving firm sees the acknowledgement',                (select acknowledgement_note from process_service where id = s1) = 'Received at chambers');
  perform t_check('serving firm has an internal note of it',              (select count(*) from updates where matter_id = m and visibility = 'internal' and title like 'Service of Motion on Notice acknowledged by Firm B') = 1);
  perform t_check('serving lawyer was told',                              (select count(*) from notifications where user_id = la and event = 'service_acknowledged') >= 1);
  update process_service set note = 'bailiff copy filed' where id = s1;
  perform t_check('serving firm keeps its own bookkeeping',               (select note from process_service where id = s1) = 'bailiff copy filed');
  ok := false;
  begin
    perform revoke_service(s2, 'served on the wrong chambers');
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('a lawyer cannot withdraw service — an admin can',       ok);
  perform t_reset();

  perform t_as(aa, 'aal2');
  perform revoke_service(s2, 'served on the wrong chambers');
  perform t_check('admin withdraws a wrongly served process',             (select revoked_at from process_service where id = s2) is not null);
  perform t_reset();

  perform t_as(lb, 'aal2');
  perform t_check('withdrawn service leaves the served firm''s inbox',     (select count(*) from service_inbox where id = s2) = 0 and (select count(*) from service_inbox where id = s1) = 1);
  ok := false;
  begin
    perform acknowledge_service(s2);
  exception when others then ok := sqlerrm like '%withdrawn%';
  end;
  perform t_check('withdrawn service cannot be acknowledged',             ok);
  perform t_reset();

  -- suspension: the serving firm's staff stop writing, its client keeps reading
  update firms set status = 'suspended' where id = (select v from fx where k='firm_a');
  perform t_as(la, 'aal2');
  ok := false;
  begin
    insert into updates (matter_id, firm_id, kind, title, posted_by) values (m, (select v from fx where k='firm_a'), 'note', 'while suspended', la);
  exception when insufficient_privilege or check_violation then ok := true;
  end;
  perform t_check('a suspended firm''s lawyer cannot write',               ok);
  ok := false;
  begin
    perform serve_process(m, (select v from fx where k='counsel_b'), ds, 'Hearing Notice', 'platform');
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('a suspended firm cannot serve',                         ok);
  perform t_reset();
  perform t_as(ca, 'aal1');
  perform t_check('the client keeps reading during suspension',            (select count(*) from updates where matter_id = m) > 0);
  perform t_reset();
  update firms set status = 'active' where id = (select v from fx where k='firm_a');

  perform t_as(ca, 'aal1');
  perform t_check('client sees the case moving',                          (select count(*) from updates where matter_id = m and title like '% served on %') = 4);
  perform t_check('client does not see internal notes',                   (select count(*) from updates where visibility = 'internal') = 0);
  perform t_check('client sees no service records or counsel details',    (select count(*) from process_service) + (select count(*) from matter_counsel) = 0);
  ok := false;
  begin
    perform serve_process(m, (select v from fx where k='counsel_b'), ds, 'Hearing Notice', 'platform');
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('clients cannot serve processes',                       ok);
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
