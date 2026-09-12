-- Who may act for a client: bound only by redeeming a token, scoped, dated, endable by either
-- side, and never able to sign.
--
-- The assertions that carry this suite are the negative ones. A person the firm named by email and
-- phone has no access at all until they redeem the token — a shared phone number confers nothing.
-- A representative without the documents right cannot reach a document row, its version or its
-- bytes. One without the money right cannot see an invoice. None of them can sign anything, ever.
-- An expired authority stops granting at the moment it expires, with no job having run. And the
-- table itself has no write door beside its three functions.
--
-- It also pins the two switches matter_parties has carried since migration 1 and nothing ever
-- asked: can_view_docs now decides, and can_pay is not pretended into meaning something it never
-- had for a party.
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
create or replace function t_fails(stmt text, fragment text) returns bool language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlerrm like '%' || fragment || '%'; end $$;

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
grant select, insert on fx to anon, authenticated;
create temp table tk (k text primary key, v text);
grant select, insert on tk to anon, authenticated;

insert into firms (slug, name, reference_prefix, status, paystack_subaccount)
  values ('rep-firm', 'Delegation Chambers', 'DC', 'active', 'ACCT_dc');
insert into fx select 'firm', id from firms where slug = 'rep-firm';
insert into auth.users (id, email) values
  (gen_random_uuid(),'rp-lawyer@test'), (gen_random_uuid(),'rp-client@test'),
  (gen_random_uuid(),'rp-agent@test'), (gen_random_uuid(),'rp-impostor@test'), (gen_random_uuid(),'rp-contact@test');
insert into fx select 'lawyer',   id from auth.users where email='rp-lawyer@test';
insert into fx select 'client',   id from auth.users where email='rp-client@test';
insert into fx select 'agent',    id from auth.users where email='rp-agent@test';
insert into fx select 'impostor', id from auth.users where email='rp-impostor@test';
insert into fx select 'contact',  id from auth.users where email='rp-contact@test';
update profiles set full_name = 'Acme Holdings Ltd', client_type = 'business', company_name = 'Acme Holdings Ltd',
                    email = 'rp-client@test', phone = '+2348030000101' where id = (select v from fx where k='client');
update profiles set full_name = 'Chidi Eze',   email = 'rp-agent@test',    phone = '+2348030000102' where id = (select v from fx where k='agent');
update profiles set full_name = 'Not Chidi',   email = 'rp-impostor@test', phone = '+2348030000103' where id = (select v from fx where k='impostor');
update profiles set full_name = 'Ada Contact', email = 'rp-contact@test',  phone = '+2348030000104' where id = (select v from fx where k='contact');
insert into auth.users (id, email) values (gen_random_uuid(), 'rp-owner@test');
insert into fx select 'owner', id from auth.users where email='rp-owner@test';
update profiles set full_name = 'Ify Owner', email = 'rp-owner@test', phone = '+2348030000100' where id = (select v from fx where k='owner');
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'), (select v from fx where k='lawyer'), 'lawyer'),
  -- An owner, because a contact-details change is told to the people who would act on it.
  ((select v from fx where k='firm'), (select v from fx where k='owner'), 'owner');

insert into matters (firm_id, reference, title, type, handling_lawyer_id)
  values ((select v from fx where k='firm'), 'DC-M-2026-000001', 'Acme v Registrar', 'corporate', (select v from fx where k='lawyer'));
insert into fx select 'matter', id from matters where reference = 'DC-M-2026-000001';
insert into matters (firm_id, reference, title, type)
  values ((select v from fx where k='firm'), 'DC-M-2026-000002', 'Acme lease renewal', 'property');
insert into fx select 'matter2', id from matters where reference = 'DC-M-2026-000002';
insert into matter_parties (matter_id, firm_id, user_id, role) values
  ((select v from fx where k='matter'),  (select v from fx where k='firm'), (select v from fx where k='client'), 'client'),
  ((select v from fx where k='matter2'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');
-- A plain contact whose documents switch is off: the thing the console has been claiming for months.
insert into matter_parties (matter_id, firm_id, user_id, role, can_view_docs)
  values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='contact'), 'contact', false);

insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by)
  values (gen_random_uuid(), (select v from fx where k='firm'), (select v from fx where k='matter'),
          'share-register.pdf', 'correspondence', true, (select v from fx where k='lawyer'));
insert into fx select 'doc', id from documents where name = 'share-register.pdf';
insert into document_versions (id, document_id, storage_path, mime, size_bytes, checksum, uploaded_by)
  values (gen_random_uuid(), (select v from fx where k='doc'),
          (select v from fx where k='firm') || '/' || (select v from fx where k='doc') || '/v1.pdf',
          'application/pdf', 2048, repeat('a', 64), (select v from fx where k='lawyer'));
insert into fx select 'ver', id from document_versions where document_id = (select v from fx where k='doc');
insert into updates (matter_id, firm_id, kind, visibility, title, body, posted_by)
  values ((select v from fx where k='matter'), (select v from fx where k='firm'), 'note', 'client',
          'Filed at the registry', 'The annual return was filed.', (select v from fx where k='lawyer'));
insert into invoices (firm_id, matter_id, client_id, number, currency, subtotal_minor, vat_minor, total_minor, status, issued_at)
  values ((select v from fx where k='firm'), (select v from fx where k='matter'), (select v from fx where k='client'),
          'DC-INV-2026-000001', 'NGN', 50000000, 0, 50000000, 'issued', now());

-- ---------------------------------------------------------------- 1. the switch the database never asked
do $$
declare co uuid := (select v from fx where k='contact'); cl uuid := (select v from fx where k='client');
        doc_id uuid := (select v from fx where k='doc'); ver_id uuid := (select v from fx where k='ver');
begin
  perform t_as(co, 'aal1');
  perform t_check('a party whose can_view_docs is off cannot reach the document row',
    not exists (select 1 from documents where id = doc_id));
  perform t_check('...nor its version',           not exists (select 1 from document_versions where id = ver_id));
  perform t_check('...nor open it for reading',   t_refused(format('select open_document_version(%L)', ver_id), '42501'));
  perform t_check('...but the matter itself is still theirs to see, which is what a contact is for',
    exists (select 1 from matters where id = (select v from fx where k='matter')));
  perform t_reset();
  perform t_as(cl, 'aal1');
  perform t_check('the client, whose switch is on, reads it as before',
    exists (select 1 from documents where id = doc_id) and exists (select 1 from document_versions where id = ver_id));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. what a grant refuses
do $$
declare l uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm');
        cl uuid := (select v from fx where k='client'); ag uuid := (select v from fx where k='agent');
        m uuid := (select v from fx where k='matter'); other uuid;
begin
  perform t_as(ag, 'aal1');
  perform t_check('a client cannot grant an authority over anybody',
    t_refused(format('select grant_representation(%L, %L, ''family'', ''in_person'', null, null, false, false, null, null, null, ''met them'')', f, cl), '42501'));
  perform t_reset(); perform t_as(l, 'aal1');
  perform t_check('nor a lawyer without a second factor',
    t_refused(format('select grant_representation(%L, %L, ''family'', ''in_person'', null, null, false, false, null, null, null, ''met them'')', f, cl), '42501'));
  perform t_reset(); perform t_as(l);
  perform t_check('a stranger to the firm cannot be made a principal',
    t_fails(format('select grant_representation(%L, %L, ''family'', ''in_person'', null, null, false, false, null, null, null, ''met them'')', f, ag),
            'not a client of this firm'));
  perform t_check('nor a member of the firm itself',
    t_fails(format('select grant_representation(%L, %L, ''employee'', ''in_person'', null, null, false, false, null, null, null, ''met them'')', f, l),
            'not a client of this firm'));
  perform t_check('an authority that expired yesterday is refused rather than stored',
    t_fails(format('select grant_representation(%L, %L, ''family'', ''in_person'', null, null, false, false, %L, null, null, ''met them'')',
                   f, cl, current_date - 1), 'already expired'));
  perform t_check('and the firm must record what it saw',
    t_fails(format('select grant_representation(%L, %L, ''company_officer'', ''board_resolution'', null, ''Acme Holdings Ltd'', false, false, null, null, null, null)', f, cl),
            'representations_authority_chk'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. a shared phone number confers nothing
do $$
declare l uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm');
        cl uuid := (select v from fx where k='client'); imp uuid := (select v from fx where k='impostor');
        m uuid := (select v from fx where k='matter'); r jsonb;
begin
  perform t_as(l);
  -- The firm records the company secretary's own email and phone, because that is where the
  -- invitation goes. Nothing is matched on them.
  r := grant_representation(f, cl, 'company_officer', 'board_resolution', m, 'Acme Holdings Ltd',
                            false, false, null, 'Board resolution of 3 September 2026', null,
                            'Seen in the minute book', 'rp-agent@test', '+2348030000102');
  insert into fx select 'rep', (r ->> 'representation_id')::uuid;
  insert into tk select 'token', r ->> 'token';
  perform t_reset();

  -- profiles.email and profiles.phone are unique, so two accounts cannot literally share them.
  -- What CAN happen is somebody else getting hold of the invitation link, and that is the case
  -- worth pinning: the token alone is not the binding when the firm named a person.
  perform t_as(imp, 'aal1');
  perform t_check('the invitation link in the wrong hands binds nobody',
    t_refused(format('select accept_representation(%L)', (select v from tk where k='token')), '42501'));
  perform t_check('...and that person has no access of any kind',
    not exists (select 1 from matters where id = m) and not acts_for_matter(m, 'base'));
  perform t_reset();

  perform t_as((select v from fx where k='agent'), 'aal1');
  perform t_check('nor has the person the firm did name, before redeeming: being the right person is not itself access',
    not exists (select 1 from matters where id = m) and not acts_for_matter(m, 'base'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. redeeming the token is the whole binding
do $$
declare ag uuid := (select v from fx where k='agent'); l uuid := (select v from fx where k='lawyer');
        cl uuid := (select v from fx where k='client'); m uuid := (select v from fx where k='matter');
        doc_id uuid := (select v from fx where k='doc'); ver_id uuid := (select v from fx where k='ver');
        tok text := (select v from tk where k='token');
begin
  perform t_as(cl, 'aal1');
  perform t_check('the principal cannot redeem their own authority', t_fails(format('select accept_representation(%L)', tok), 'act for yourself'));
  perform t_reset(); perform t_as(l);
  perform t_check('nor can a member of the firm', t_refused(format('select accept_representation(%L)', tok), '42501'));
  perform t_reset();

  perform t_as(ag, 'aal1');
  perform accept_representation(tok);
  perform t_check('once redeemed, the representative reads the matter',        exists (select 1 from matters where id = m));
  perform t_check('...and the timeline written for the client',                exists (select 1 from updates where matter_id = m));
  insert into messages (firm_id, matter_id, sender_id, body)
    values ((select v from fx where k='firm'), m, auth.uid(), 'Acting for Acme: any news?');
  perform t_check('...and may write a message on it, which is most of what acting for somebody is',
    exists (select 1 from messages where matter_id = m and sender_id = ag));
  perform t_check('but NOT a document, because the firm did not give that right',
    not exists (select 1 from documents where id = doc_id) and not exists (select 1 from document_versions where id = ver_id));
  perform t_check('...nor open its bytes',  t_refused(format('select open_document_version(%L)', ver_id), '42501'));
  perform t_check('...nor an invoice, because the firm did not give that either',
    not exists (select 1 from invoices where matter_id = m));
  perform t_check('and the other matter of the same client is NOT covered: this authority named one',
    not exists (select 1 from matters where id = (select v from fx where k='matter2')));
  perform t_check('the same token cannot be redeemed twice', t_fails(format('select accept_representation(%L)', tok), 'not valid'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 5. the rights, given one at a time
do $$
declare ag uuid := (select v from fx where k='agent'); rep uuid := (select v from fx where k='rep');
        m uuid := (select v from fx where k='matter'); doc_id uuid := (select v from fx where k='doc'); ver_id uuid := (select v from fx where k='ver');
begin
  perform t_reset();
  update representations set can_view_docs = true where id = rep;
  perform t_as(ag, 'aal1');
  perform t_check('with the documents right, the document and its version are readable',
    exists (select 1 from documents where id = doc_id) and exists (select 1 from document_versions where id = ver_id));
  perform t_check('...and the bytes open, through the same read record the client needs',
    (select open_document_version(ver_id)) is not null);
  perform t_check('...but an invoice still is not',  not exists (select 1 from invoices where matter_id = m));
  perform t_reset();

  update representations set can_pay = true where id = rep;
  perform t_as(ag, 'aal1');
  perform t_check('with the money right, what the principal owes is readable',
    exists (select 1 from invoices where matter_id = m and number = 'DC-INV-2026-000001'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 6. signing is never delegated
do $$
declare ag uuid := (select v from fx where k='agent'); l uuid := (select v from fx where k='lawyer');
        doc_id uuid := (select v from fx where k='doc'); ver_id uuid := (select v from fx where k='ver');
begin
  perform t_as(l);
  perform request_signature(doc_id);
  perform t_reset();
  perform t_as(ag, 'aal1');
  perform open_document_version(ver_id);
  -- record_signature() asks for the matter's own client. A representative may act; they may not execute.
  perform t_check('a representative cannot sign for the client, however wide their authority',
    t_refused(format('select record_signature(%L, ''Chidi Eze'')', ver_id), '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 7. expiry needs no job to run
do $$
declare ag uuid := (select v from fx where k='agent'); rep uuid := (select v from fx where k='rep'); m uuid := (select v from fx where k='matter');
begin
  perform t_reset();
  -- Backdate the start too: the table refuses an authority that ends before it begins, which is
  -- the constraint doing its job rather than the test being awkward.
  update representations set starts_on = (now() at time zone 'Africa/Lagos')::date - 5,
                             expires_on = (now() at time zone 'Africa/Lagos')::date - 1 where id = rep;
  perform t_as(ag, 'aal1');
  perform t_check('an expired authority grants nothing, the moment it expires',
    not exists (select 1 from matters where id = m) and not acts_for_matter(m, 'base'));
  perform t_reset();
  update representations set expires_on = (now() at time zone 'Africa/Lagos')::date + 30 where id = rep;
  perform t_as(ag, 'aal1');
  perform t_check('and it is live again for a day still to come', exists (select 1 from matters where id = m));
  perform t_reset();
  -- Starting tomorrow is not starting today.
  update representations set starts_on = (now() at time zone 'Africa/Lagos')::date + 1 where id = rep;
  perform t_as(ag, 'aal1');
  perform t_check('an authority that starts tomorrow grants nothing today', not exists (select 1 from matters where id = m));
  perform t_reset();
  update representations set starts_on = (now() at time zone 'Africa/Lagos')::date where id = rep;
end $$;

-- ---------------------------------------------------------------- 8. either side may end it
do $$
declare ag uuid := (select v from fx where k='agent'); cl uuid := (select v from fx where k='client');
        rep uuid := (select v from fx where k='rep'); m uuid := (select v from fx where k='matter'); imp uuid := (select v from fx where k='impostor');
begin
  perform t_as(imp, 'aal1');
  perform t_check('a stranger cannot end somebody else''s authority', t_refused(format('select revoke_representation(%L)', rep), '42501'));
  perform t_reset();

  perform t_as(cl, 'aal1');
  perform t_check('the client can see the authority granted over their own files',
    exists (select 1 from representations where id = rep));
  perform revoke_representation(rep, 'He has left the company.');
  perform t_reset();
  perform t_check('the principal ending it is recorded as theirs, with the reason',
    (select revoked_by = cl and revoke_reason = 'He has left the company.' from representations where id = rep));

  perform t_as(ag, 'aal1');
  perform t_check('and from that moment the representative reads nothing',
    not exists (select 1 from matters where id = m)
    and not exists (select 1 from documents where id = (select v from fx where k='doc'))
    and not exists (select 1 from invoices where matter_id = m));
  perform t_reset();
  perform t_check('the record of what happened is kept, not deleted',
    (select accepted_at is not null and revoked_at is not null from representations where id = rep));
end $$;

-- ---------------------------------------------------------------- 9. firm-wide scope, and the door
do $$
declare l uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm');
        cl uuid := (select v from fx where k='client'); ag2 uuid := (select v from fx where k='impostor');
        m2 uuid := (select v from fx where k='matter2'); r jsonb; m3 uuid;
begin
  perform t_as(l);
  r := grant_representation(f, cl, 'attorney', 'power_of_attorney', null, null, false, false, null, 'POA/2026/17');
  perform t_reset();
  perform t_as(ag2, 'aal1');
  perform accept_representation(r ->> 'token');
  perform t_check('a firm-wide authority reaches every matter the principal is a party to',
    exists (select 1 from matters where id = m2) and exists (select 1 from matters where id = (select v from fx where k='matter')));
  perform t_reset();

  -- A matter opened after the authority was granted is covered without anything being written.
  insert into matters (firm_id, reference, title, type) values (f, 'DC-M-2026-000003', 'Acme trademark', 'corporate') returning id into m3;
  insert into matter_parties (matter_id, firm_id, user_id, role) values (m3, f, cl, 'client');
  perform t_as(ag2, 'aal1');
  perform t_check('...including one opened after it was granted', exists (select 1 from matters where id = m3));
  perform t_reset();

  -- And a matter of the same firm the principal is NOT on is still out of reach.
  insert into matters (firm_id, reference, title, type) values (f, 'DC-M-2026-000004', 'Someone else entirely', 'litigation') returning id into m3;
  perform t_as(ag2, 'aal1');
  perform t_check('...and never a matter the principal is not on', not exists (select 1 from matters where id = m3));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 10. the door beside the door
do $$
declare ag uuid := (select v from fx where k='agent'); l uuid := (select v from fx where k='lawyer');
        cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm');
begin
  perform t_as(l);
  perform t_check('no member may write a representation by hand, however much MFA they hold',
    t_refused(format('insert into representations (firm_id, principal_id, capacity, authority_kind, authority_ref, verified_by) values (%L, %L, ''other'', ''other'', ''x'', %L)', f, cl, l), '42501'));
  perform t_check('nor edit one', t_refused(format('update representations set can_pay = true where firm_id = %L', f), '42501'));
  perform t_check('nor delete one', t_refused(format('delete from representations where firm_id = %L', f), '42501'));
  perform t_reset();
  perform t_as(ag, 'aal1');
  perform t_check('and a representative cannot widen their own authority',
    t_refused(format('update representations set can_view_docs = true, can_pay = true where representative_id = %L', ag), '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 11. a changed phone number is written down
do $$
declare cl uuid := (select v from fx where k='client'); l uuid := (select v from fx where k='lawyer'); n int;
begin
  perform t_as(cl, 'aal1');
  update profiles set phone = '+2349999999999' where id = auth.uid();
  perform t_reset();
  perform t_check('the change is recorded, with the number it used to be',
    exists (select 1 from identity_events where user_id = cl and field = 'phone'
              and old_value = '+2348030000101' and new_value = '+2349999999999'));
  perform t_check('the firm is told, because a human should ring the old number',
    exists (select 1 from notifications where event = 'client_contact_changed' and (payload ->> 'client_id')::uuid = cl));

  perform t_as(cl, 'aal1');
  perform t_check('the client can read their own identity record',
    exists (select 1 from identity_events where user_id = cl));
  perform t_check('...and cannot tidy it away', t_refused(format('delete from identity_events where user_id = %L', cl), '42501'));
  perform t_check('...nor rewrite it',          t_refused(format('update identity_events set old_value = null where user_id = %L', cl), '42501'));
  perform t_reset();
  perform t_as(l);
  perform t_check('the firm reads it too', exists (select 1 from identity_events where user_id = cl));
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
