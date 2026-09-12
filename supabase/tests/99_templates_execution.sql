-- A document drawn from the matter's facts refuses to guess; a signature is what the database
-- saw and locks the document; an instrument executed on paper is recorded, not signed here.
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
create or replace function t_fails(stmt text, fragment text) returns bool language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlerrm like '%' || fragment || '%'; end $$;
create or replace function t_audit(p_action text, p_entity uuid) returns jsonb language sql security definer as $$
  select jsonb_build_object('firm_id', firm_id, 'actor_id', actor_id, 'meta', meta) from audit_log where action = p_action and entity_id = p_entity order by at desc limit 1 $$;

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
grant select on fx to anon, authenticated;
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values (gen_random_uuid(), 'te-owner@test'), (gen_random_uuid(), 'te-lawyer@test'), (gen_random_uuid(), 'te-client@test'), (gen_random_uuid(), 'te-stranger@test');
insert into fx select 'owner', id from auth.users where email = 'te-owner@test';
insert into fx select 'lawyer', id from auth.users where email = 'te-lawyer@test';
insert into fx select 'client', id from auth.users where email = 'te-client@test';
insert into fx select 'stranger', id from auth.users where email = 'te-stranger@test';
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'), (select v from fx where k='owner'), 'owner'),
  ((select v from fx where k='firm'), (select v from fx where k='lawyer'), 'lawyer');
update profiles set full_name = 'Ngozi Adeyemi' where id = (select v from fx where k='lawyer');
insert into lawyer_profiles (firm_id, user_id, slug, title, scn) values ((select v from fx where k='firm'), (select v from fx where k='lawyer'), 'ngozi-adeyemi', 'Partner', 'SCN/12345');
update profiles set full_name = 'Adaeze  Okafor', address = '12 Broad Street, Lagos', email = 'te-client@test', phone = '+2348030000009' where id = (select v from fx where k='client');
update profiles set full_name = 'Nobody Here' where id = (select v from fx where k='stranger');
update firms set brand = coalesce(brand, '{}'::jsonb) || jsonb_build_object('contact', jsonb_build_object('address', '5 Marina, Lagos', 'email', 'chambers@example.test')) where id = (select v from fx where k='firm');
insert into matters (firm_id, reference, title, type, handling_lawyer_id, cause_title)
  values ((select v from fx where k='firm'), 'TE-M-2026-000001', 'Okafor v Eze', 'litigation', (select v from fx where k='lawyer'), 'Okafor v Eze & Anor');
insert into fx select 'matter', id from matters where reference = 'TE-M-2026-000001';
insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='lawyer'), true);
insert into matter_parties (matter_id, firm_id, user_id, role) values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');

-- ---------------------------------------------------------------- 1. a template names facts, and only facts
do $$
declare ow uuid := (select v from fx where k='owner'); l uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm'); t uuid := gen_random_uuid(); tp uuid := gen_random_uuid();
begin
  perform t_as(l);
  perform t_check('a lawyer does not write templates', t_refused(format('insert into document_templates (id, firm_id, name, body) values (%L, %L, ''x'', ''hello'')', t, f), '42501'));
  perform t_reset(); perform t_as(ow);
  perform t_check('a placeholder naming nothing on the list is refused', t_fails(format('insert into document_templates (id, firm_id, name, body) values (%L, %L, ''x'', ''Dear {client.name}, see {matter.internal_note}'')', t, f), 'names nothing a template may draw on'));
  insert into document_templates (id, firm_id, name, body, execution) values
    (t, f, 'Letter of engagement', 'Dear {client.name},' || E'\n\n' || 'We act for you in {matter.cause_title} ({matter.suit_number}) before the {matter.court}. Our fee is {extra.fee}.' || E'\n\n' || '{lawyer.name} ({lawyer.scn}), {firm.legal_name}, {firm.address}. {today}', 'electronic');
  insert into document_templates (id, firm_id, name, body, execution, matter_types) values
    (tp, f, 'Deed of assignment', 'THIS DEED is made between {client.name} of {client.address} and the assignee.', 'paper', array['property']::matter_type[]);
  perform t_check('templates are the firm''s, versioned from 1', (select count(*) = 2 and bool_and(version = 1) from document_templates where firm_id = f));
  update document_templates set body = body || E'\nYours faithfully,' where id = t;
  perform t_check('a change of the body is a new version', (select version = 2 from document_templates where id = t));
  update document_templates set note = 'no change to the words' where id = t;
  perform t_check('a change of anything else is not', (select version = 2 from document_templates where id = t));
  perform t_check('the write is audited', (t_audit('document_templates.insert', t) ->> 'firm_id')::uuid = f);
  perform t_reset();
  insert into fx values ('tpl', t), ('tpl_paper', tp);
end $$;

-- ---------------------------------------------------------------- 2. generation refuses to guess
do $$
declare l uuid := (select v from fx where k='lawyer'); cl uuid := (select v from fx where k='client'); m uuid := (select v from fx where k='matter'); t uuid := (select v from fx where k='tpl'); tp uuid := (select v from fx where k='tpl_paper'); r jsonb; d uuid; v uuid; path text;
begin
  perform t_as(cl, 'aal1');
  perform t_check('a client generates nothing', t_refused(format('select prepare_generated_document(%L, %L)', m, t), '42501'));
  perform t_reset(); perform t_as(l);
  perform t_check('a fact the matter does not have stops the generation and is named',
    t_fails(format('select prepare_generated_document(%L, %L, null, null, ''{"fee": "NGN 500,000"}'')', m, t), 'no value for matter.court, matter.suit_number'));
  perform t_check('a value typed at generation must be text', t_fails(format('select prepare_generated_document(%L, %L, null, null, ''{"fee": 5}'')', m, t), 'extra.fee is text'));
  perform t_check('a template for other matter types is refused', t_fails(format('select prepare_generated_document(%L, %L)', m, tp), 'is for property matters'));
  perform t_reset();
  update matters set suit_number = 'LD/123/2026', court_name = 'High Court of Lagos State' where id = m;
  perform t_as(l);
  r := prepare_generated_document(m, t, 'Engagement letter — Okafor', null, '{"fee": "NGN 500,000"}'::jsonb);
  d := (r ->> 'document_id')::uuid; v := (r ->> 'version_id')::uuid; path := r ->> 'storage_path';
  perform t_check('the text is the template filled from the matter, the client, the lawyer and the firm',
    (r ->> 'text') like 'Dear Adaeze  Okafor,%' and (r ->> 'text') like '%Okafor v Eze & Anor (LD/123/2026) before the High Court of Lagos State. Our fee is NGN 500,000.%'
    and (r ->> 'text') like '%Ngozi Adeyemi (SCN/12345), Attorneys Klinique%' and (r ->> 'text') like '%5 Marina, Lagos%' and (r ->> 'text') not like '%{%');
  perform t_check('every value rendered is frozen with the column it came from',
    r -> 'facts' -> 'matter.suit_number' ->> 'source' = 'matters.suit_number' and r -> 'facts' -> 'matter.court' ->> 'source' = 'matters.court_name'
    and r -> 'facts' -> 'extra.fee' ->> 'source' = 'typed at generation' and r -> 'facts' -> 'lawyer.scn' ->> 'value' = 'SCN/12345');
  perform t_check('the document is opened, staff-only, without a file yet', (select category = 'generated' and not client_visible and current_version_id is null and uploaded_by = l from documents where id = d));
  perform t_check('a version cannot be marked generated by hand', t_refused(format('insert into document_versions (id, document_id, storage_path, mime, checksum, uploaded_by, kind) values (%L, %L, %L, ''application/pdf'', repeat(''a'', 64), %L, ''generated'')', v, d, path, l), '42501'));
  perform t_check('a version without a checksum is not finalised', t_fails(format('select finalize_generated_version(%L, %L, %L, 1234, null, %L, ''{}'')', d, v, path, t), 'carries the sha256'));
  perform t_check('nor at a path that is not its own', t_fails(format('select finalize_generated_version(%L, %L, ''elsewhere.pdf'', 1234, repeat(''a'', 64), %L, ''{}'')', d, v, t), 'not this version'));
  perform finalize_generated_version(d, v, path, 1234, repeat('a', 64), t, r -> 'facts');
  perform t_check('finalised: a generated version with its checksum, its template and version, and the facts',
    (select kind = 'generated' and checksum = repeat('a', 64) and source_template_id = t and template_version = 2 and facts -> 'extra.fee' ->> 'value' = 'NGN 500,000' from document_versions where id = v)
    and (select current_version_id = v from documents where id = d) and (t_audit('document.generated', d) -> 'meta' ->> 'template') = 'Letter of engagement');
  perform t_check('and only once', t_fails(format('select finalize_generated_version(%L, %L, %L, 1234, repeat(''a'', 64), %L, ''{}'')', d, v, path, t), 'already has its version'));
  perform t_reset();
  insert into fx values ('doc', d), ('ver', v);
end $$;

-- ---------------------------------------------------------------- 3. asking for a signature, and signing
do $$
declare l uuid := (select v from fx where k='lawyer'); cl uuid := (select v from fx where k='client'); st uuid := (select v from fx where k='stranger'); f uuid := (select v from fx where k='firm');
        m uuid := (select v from fx where k='matter'); d uuid := (select v from fx where k='doc'); v uuid := (select v from fx where k='ver'); sig uuid; sig2 uuid; v2 uuid := gen_random_uuid();
begin
  perform t_as(cl, 'aal1');
  perform t_check('the client cannot see the document before it is shared', not exists (select 1 from documents where id = d));
  perform t_reset(); perform t_as(l);
  perform request_signature(d);
  perform t_reset();
  perform t_check('asking for a signature shares the document and tells the client',
    (select client_visible and signature_requested_at is not null and signature_requested_by = l from documents where id = d)
    and exists (select 1 from notifications where user_id = cl and event = 'document_ready_to_sign' and channel = 'in_app' and (payload ->> 'document_id')::uuid = d));
  perform t_reset(); perform t_as(cl, 'aal1');
  perform t_check('a signature over bytes the signer has not opened is refused', t_fails(format('select record_signature(%L, ''Adaeze Okafor'')', v), 'open the document first'));
  perform open_document_version(v);
  perform t_check('a name that is not the signer''s is refused', t_fails(format('select record_signature(%L, ''A. Okafor'')', v), 'type your name exactly'));
  sig := record_signature(v, ' adaeze okafor ');
  perform t_check('signed: who, the name typed, the version and its checksum, that it was opened, when, and the terms in force',
    (select signer_id = cl and signer_role = 'client' and signer_name = 'adaeze okafor' and checksum = repeat('a', 64) and read_at is not null and signed_at is not null from document_signatures where id = sig));
  perform t_check('the document is locked on that version', (select locked_version_id = v and locked_at is not null from documents where id = d));
  perform t_check('the client reads the signature record', exists (select 1 from document_signatures where id = sig));
  perform t_check('and signs once', t_refused(format('select record_signature(%L, ''Adaeze Okafor'')', v), '23505'));
  perform t_reset();
  perform t_check('the signature is audited, the lawyers are told, and the client''s timeline says so',
    (t_audit('document.signed', d) -> 'meta' ->> 'signer_role') = 'client'
    and exists (select 1 from notifications where user_id = l and event = 'document_signed' and channel = 'in_app' and payload ->> 'audience' = 'firm')
    and exists (select 1 from updates where matter_id = m and kind = 'document' and visibility = 'client' and title = 'Signed: Engagement letter — Okafor'));
  perform t_as(l);
  perform t_check('no further version can be added, by staff', t_fails(format('insert into document_versions (id, document_id, storage_path, mime, checksum, uploaded_by) values (%L, %L, %L, ''application/pdf'', repeat(''b'', 64), %L)', v2, d, f || '/' || d || '/' || v2 || '.pdf', l), 'locked on its executed version'));
  perform t_check('the pointer and the lock are not the API''s to move', t_refused(format('update documents set current_version_id = null where id = %L', d), '42501') and t_refused(format('update documents set locked_version_id = null where id = %L', d), '42501'));
  perform t_check('nor is the row deleted', t_refused(format('update documents set deleted_at = now() where id = %L', d), '42501') and t_fails(format('select retire_empty_document(%L)', d), 'has a file'));
  perform open_document_version(v);
  sig2 := record_signature(v, 'Ngozi Adeyemi');
  perform t_check('the firm countersigns the same bytes, with the practitioner''s enrolment number', (select signer_role = 'staff' and signer_scn = 'SCN/12345' and version_id = v from document_signatures where id = sig2));
  perform t_reset();
  perform t_check('and the client is told, on a row addressed to the client rather than to the firm',
    exists (select 1 from notifications where user_id = cl and event = 'document_signed' and channel = 'in_app' and payload ->> 'audience' = 'client'));
  perform t_reset();
  perform t_as(cl, 'aal1');
  perform t_check('no further version can be added, by the client either', t_refused(format('insert into document_versions (id, document_id, storage_path, mime, checksum, uploaded_by) values (%L, %L, %L, ''application/pdf'', repeat(''c'', 64), %L)', gen_random_uuid(), d, f || '/' || d || '/x.pdf', cl), '42501')
    or t_fails(format('insert into document_versions (id, document_id, storage_path, mime, checksum, uploaded_by) values (%L, %L, %L, ''application/pdf'', repeat(''c'', 64), %L)', gen_random_uuid(), d, f || '/' || d || '/x.pdf', cl), 'locked'));
  perform t_reset(); perform t_as(st, 'aal1');
  perform t_check('a stranger signs nothing and sees no signature', t_refused(format('select record_signature(%L, ''Nobody Here'')', v), '42501') and (select count(*) = 0 from document_signatures where document_id = d));
  -- A contact on the matter is a party, but not the person whose signature was asked for.
  perform t_reset();
  insert into matter_parties (matter_id, firm_id, user_id, role) values (m, f, st, 'contact');
  update profiles set full_name = 'Nobody Here' where id = st;
  perform t_as(st, 'aal1');
  perform open_document_version(v);
  perform t_check('a contact on the matter is not a client, and signs nothing',
    t_refused(format('select record_signature(%L, ''Nobody Here'')', v), '42501'));
  perform t_reset();
  delete from matter_parties where matter_id = m and user_id = st;
end $$;

-- ---------------------------------------------------------------- 3b. a second client still signs the version the first locked
do $$
declare l uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter');
        d uuid := (select v from fx where k='doc'); v uuid := (select v from fx where k='ver'); c2 uuid; sig uuid;
begin
  perform t_reset();
  insert into auth.users (id, email) values (gen_random_uuid(), 'te-client2@test') returning id into c2;
  update profiles set full_name = 'Chidi Okafor' where id = c2;
  insert into matter_parties (matter_id, firm_id, user_id, role) values (m, f, c2, 'client');
  perform t_as(c2, 'aal1');
  perform t_check('the second client sees the document the firm shared', exists (select 1 from documents where id = d));
  perform open_document_version(v);
  sig := record_signature(v, 'Chidi Okafor');
  perform t_check('and signs the very version the first client locked',
    (select version_id = v and signer_role = 'client' from document_signatures where id = sig));
  perform t_reset();
  perform t_check('the lock did not move', (select locked_version_id = v from documents where id = d));
  -- Put the matter back to one client: the sections below generate documents addressed to "the
  -- client", and a second one changes which facts that resolves to.
  delete from matter_parties where matter_id = m and user_id = c2;
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. paper: recorded, not signed here
do $$
declare l uuid := (select v from fx where k='lawyer'); ow uuid := (select v from fx where k='owner'); f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter'); tp uuid := (select v from fx where k='tpl_paper');
        d uuid := gen_random_uuid(); v uuid := gen_random_uuid(); dp uuid; vp uuid; r jsonb;
begin
  perform t_reset();
  update matters set type = 'property' where id = m;   -- for the deed
  perform t_as(l);
  r := prepare_generated_document(m, tp, 'Deed — Plot 12');
  dp := (r ->> 'document_id')::uuid; vp := (r ->> 'version_id')::uuid;
  perform finalize_generated_version(dp, vp, r ->> 'storage_path', 999, repeat('d', 64), tp, r -> 'facts');
  perform t_check('a paper instrument cannot be sent for signature here', t_fails(format('select request_signature(%L)', dp), 'executed on paper'));
  -- The scanned, executed copy arrives as an upload on its own document.
  insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by) values (d, f, m, 'deed-signed.pdf', 'firm_upload', true, l);
  insert into document_versions (id, document_id, storage_path, mime, size_bytes, checksum, uploaded_by) values (v, d, f || '/' || d || '/' || v || '.pdf', 'application/pdf', 2048, repeat('e', 64), l);
  perform t_check('a day in the future is refused', t_fails(format('select record_paper_execution(%L, %L, %L)', d, v, (now() at time zone 'Africa/Lagos')::date + 1), 'not in the future'));
  perform record_paper_execution(d, v, '2026-03-02', 'Chukwu Obi', 'Commissioner for Oaths, Lagos', 'SD/2026/0412', null);
  perform t_check('recorded: the day as written, the witness, who attested, the stamp; locked on that version',
    (select kind = 'executed_paper' and executed_on = '2026-03-02' and witness_name = 'Chukwu Obi' and attested_by like 'Commissioner%' and stamp_ref = 'SD/2026/0412' and executed_recorded_by = l from document_versions where id = v)
    and (select locked_version_id = v and current_version_id = v from documents where id = d)
    and (t_audit('document.executed_on_paper', d) -> 'meta' ->> 'executed_on') = '2026-03-02'
    and exists (select 1 from updates where matter_id = m and kind = 'document' and title = 'Executed: deed-signed.pdf' and body like '%2 March 2026%'));
  perform t_check('and not recorded twice', t_fails(format('select record_paper_execution(%L, %L, ''2026-03-03'')', d, v), 'already executed'));
  perform open_document_version(v);
  perform t_check('an instrument executed on paper is not signed here as well',
    t_fails(format('select record_signature(%L, ''Ngozi Adeyemi'')', v), 'executed on paper, not signed here'));
  perform t_reset();
  update matters set type = 'litigation' where id = m;
end $$;

-- ---------------------------------------------------------------- 4b. execution withdraws an outstanding request
-- A request to sign that is left standing after the instrument is executed can never be met:
-- record_signature() refuses the version. The client's screen was reading "your firm has asked
-- you to sign this" beside "executed on paper · this version is final", with a button whose only
-- outcome was a refusal, and nothing anywhere could clear it. The execution withdraws it, and
-- says in the audit entry that there was one to withdraw.
do $$
declare l uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter');
        cl uuid := (select v from fx where k='client'); d uuid := gen_random_uuid(); v uuid := gen_random_uuid();
begin
  perform t_reset(); perform t_as(l);
  insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by) values (d, f, m, 'undertaking.pdf', 'firm_upload', true, l);
  insert into document_versions (id, document_id, storage_path, mime, size_bytes, checksum, uploaded_by) values (v, d, f || '/' || d || '/' || v || '.pdf', 'application/pdf', 1024, repeat('f', 64), l);
  perform request_signature(d);
  perform t_check('the request stands while the document is open', (select signature_requested_at is not null and signature_requested_by = l from documents where id = d));
  perform record_paper_execution(d, v, '2026-03-04');
  perform t_check('executing it on paper withdraws the request rather than leaving it unanswerable',
    (select signature_requested_at is null and signature_requested_by is null and locked_version_id = v from documents where id = d));
  perform t_check('and the audit entry records that there was a request to withdraw',
    (t_audit('document.executed_on_paper', d) -> 'meta' ->> 'signature_request_withdrawn') = 'true');
  perform t_reset(); perform t_as(cl, 'aal1');
  perform open_document_version(v);
  -- The withdrawal is the first thing the client meets, not the last: with no request standing,
  -- record_signature() refuses before it ever reaches the executed-on-paper test.
  perform t_check('the client asking to sign it anyway is told no signature was asked for',
    t_fails(format('select record_signature(%L, ''Adaeze Okafor'')', v), 'has not asked for a signature'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 5. what the API may still write
-- Migration 40 narrows two grants that were blanket before it. This section is the proof the
-- runbook's "safe either side" rests on: the columns the deployed front end writes still go
-- through, and the ones it never writes are now refused rather than merely unused.
do $$
declare l uuid := (select v from fx where k='lawyer'); cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter');
        d uuid := gen_random_uuid(); v uuid := gen_random_uuid();
begin
  perform t_reset(); perform t_as(l);
  insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by) values (d, f, m, 'affidavit.pdf', 'firm_upload', false, l);
  insert into document_versions (id, document_id, storage_path, mime, size_bytes, checksum, uploaded_by)
    values (v, d, f || '/' || d || '/' || v || '.pdf', 'application/pdf', 4096, repeat('f', 64), l);
  perform t_check('the ordinary upload still writes its row and its version', (select current_version_id = v from documents where id = d));
  update documents set client_visible = true where id = d;
  update documents set reviewed_at = now(), reviewed_by = l where id = d;
  update documents set name = 'affidavit-of-service.pdf', category = 'firm_upload' where id = d;
  perform t_check('sharing, marking reviewed and renaming still go through',
    (select client_visible and reviewed_at is not null and reviewed_by = l and name = 'affidavit-of-service.pdf' from documents where id = d));
  perform t_check('and nothing outside that list does',
    t_refused(format('update documents set matter_id = null where id = %L', d), '42501')
    and t_refused(format('update documents set uploaded_by = %L where id = %L', cl, d), '42501')
    and t_refused(format('update documents set signature_requested_at = now() where id = %L', d), '42501'));
  perform t_check('nor may a version claim a template, facts or an execution it did not have',
    t_refused(format('insert into document_versions (id, document_id, storage_path, mime, checksum, uploaded_by, template_version) values (%L, %L, %L, ''application/pdf'', repeat(''g'', 64), %L, 3)', gen_random_uuid(), d, f || '/' || d || '/g.pdf', l), '42501')
    and t_refused(format('insert into document_versions (id, document_id, storage_path, mime, checksum, uploaded_by, executed_on) values (%L, %L, %L, ''application/pdf'', repeat(''h'', 64), %L, ''2026-01-01'')', gen_random_uuid(), d, f || '/' || d || '/h.pdf', l), '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 5. the client cannot ask the firm to sign
-- Reproduced before the fix: narrowing UPDATE on documents while leaving INSERT table-wide let a
-- client insert a row with signature_requested_at and signature_requested_by already set — naming
-- a partner — then add a version and sign it. record_signature() reads exactly that column to
-- decide whether the firm asked, so the refusal was the client's to switch off, and what came out
-- was a signature record against a document nobody asked to be signed, permanently locked.
do $$
declare cl uuid := (select v from fx where k='client'); l uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm');
        m uuid := (select v from fx where k='matter'); d uuid := gen_random_uuid(); v uuid := gen_random_uuid();
begin
  perform t_reset(); perform t_as(cl, 'aal1');
  perform t_check('a client cannot stamp the firm''s signature request onto a document',
    t_refused(format('insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by, signature_requested_at, signature_requested_by) values (%L, %L, %L, ''Deed of release.pdf'', ''client_upload'', true, %L, now(), %L)',
                     d, f, m, cl, l), '42501'));
  perform t_check('nor name a lawyer as having reviewed it',
    t_refused(format('insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by, reviewed_at, reviewed_by) values (%L, %L, %L, ''x.pdf'', ''client_upload'', true, %L, now(), %L)', d, f, m, cl, l), '42501'));
  perform t_check('nor open one already locked, or pointing at a version',
    t_refused(format('insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by, locked_version_id) values (%L, %L, %L, ''x.pdf'', ''client_upload'', true, %L, %L)', d, f, m, cl, v), '42501')
    and t_refused(format('insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by, current_version_id) values (%L, %L, %L, ''x.pdf'', ''client_upload'', true, %L, %L)', d, f, m, cl, v), '42501'));
  -- The ordinary upload, which is what the columns granted are for, still goes through.
  insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by) values (d, f, m, 'my-lease.pdf', 'client_upload', true, cl);
  insert into document_versions (id, document_id, storage_path, mime, size_bytes, checksum, uploaded_by)
    values (v, d, f || '/' || d || '/' || v || '.pdf', 'application/pdf', 2048, repeat('9', 64), cl);
  perform t_check('the client''s own upload is unaffected', (select current_version_id = v from documents where id = d));
  perform open_document_version(v);
  perform t_check('and it cannot be signed, because the firm never asked',
    t_fails(format('select record_signature(%L, ''Adaeze Okafor'')', v), 'has not asked for a signature'));
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
