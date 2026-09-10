-- Docket — slice 4: the staff console's own RPCs (migration 18).
-- Manual invoicing, matter invitations and the firm-wide reads, from every side.
begin;

create function t_as(u uuid, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', aal)::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create function t_reset() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;
create function t_check(name text, ok bool) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', name; else raise exception 'FAIL  %', name; end if;
end $$;

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
grant select, insert on fx to anon, authenticated;  -- suites record ids while acting as a user

insert into firms (slug, name, reference_prefix, vat_rate, status, paystack_subaccount)
values ('console-firm', 'Console Firm', 'CF', 7.5, 'active', 'ACCT_console');
insert into fx select 'firm', id from firms where slug = 'console-firm';
insert into firms (slug, name, reference_prefix, status) values ('other-firm', 'Other Firm', 'OF', 'active');
insert into fx select 'other', id from firms where slug = 'other-firm';

insert into auth.users (id, email) values
  (gen_random_uuid(), 'lawyer@console.test'), (gen_random_uuid(), 'admin@console.test'),
  (gen_random_uuid(), 'client@console.test'), (gen_random_uuid(), 'stranger@console.test');
insert into fx select 'lawyer',   id from auth.users where email = 'lawyer@console.test';
insert into fx select 'admin',    id from auth.users where email = 'admin@console.test';
insert into fx select 'client',   id from auth.users where email = 'client@console.test';
insert into fx select 'stranger', id from auth.users where email = 'stranger@console.test';
update profiles set phone = '+2348030000001', full_name = 'Ada Client' where id = (select v from fx where k='client');

insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'), (select v from fx where k='lawyer'), 'lawyer'),
  ((select v from fx where k='firm'), (select v from fx where k='admin'),  'admin'),
  ((select v from fx where k='other'), (select v from fx where k='stranger'), 'lawyer');
insert into matter_statuses (firm_id, key, label) values ((select v from fx where k='firm'), 'new_inquiry', 'New Inquiry');

do $$
declare la uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm'); r jsonb;
begin
  perform t_as(la, 'aal2');
  r := open_matter(f, 'Okonkwo v Eze', 'litigation', null, 'Okonkwo v Eze & 3 Ors', 'Land at Asaba');
  insert into fx values ('matter', (r ->> 'matter_id')::uuid);
  -- A second file for the invoicing tests, so the first can stay clear of parties
  -- for the invitation flow below.
  r := open_matter(f, 'Adeyemi v Bello', 'litigation', null, 'Adeyemi v Bello', 'Fees on account');
  insert into fx values ('billed_matter', (r ->> 'matter_id')::uuid);
  perform t_reset();
end $$;

-- The client is a party to the billed matter (migration 19: an invoice filed against a
-- matter has to name someone on it, or the matter's own parties would read it).
insert into matter_parties (matter_id, firm_id, user_id, role)
values ((select v from fx where k='billed_matter'), (select v from fx where k='firm'),
        (select v from fx where k='client'), 'client');

-- ---------------------------------------------------------------- 1. manual invoices
do $$
declare la uuid := (select v from fx where k='lawyer'); ad uuid := (select v from fx where k='admin');
        cl uuid := (select v from fx where k='client'); st uuid := (select v from fx where k='stranger');
        f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='billed_matter');
        unrelated uuid := (select v from fx where k='matter');
        r jsonb; inv uuid; ok bool;
begin
  perform t_as(la, 'aal2');
  r := create_invoice(f, cl,
        jsonb_build_array(jsonb_build_object('description','Professional fees','quantity',1,'unit_minor',20000000),
                          jsonb_build_object('description','Filing fees','quantity',2,'unit_minor',500000)),
        m, 'NGN', (current_date + 14), true, 'Fees to date');
  inv := (r ->> 'invoice_id')::uuid;
  insert into fx values ('invoice', inv);
  perform t_check('manual invoice numbers itself from the firm counter', (r ->> 'number') like 'CF-INV-%');
  perform t_check('manual invoice sums its items',                       (r ->> 'subtotal_minor')::bigint = 21000000);
  perform t_check('manual invoice applies the firm VAT rate',            (r ->> 'vat_minor')::bigint = 1575000
                                                                          and (r ->> 'total_minor')::bigint = 22575000);
  perform t_check('issuing writes both invoice items',                   (select count(*) from invoice_items where invoice_id = inv) = 2);
  perform t_check('the matter timeline shows the fee',                   (select count(*) from updates where matter_id = m and kind = 'fee' and visibility = 'client') = 1);

  -- The client is not on the other matter, and an issued invoice would file a
  -- client-visible fee entry there for its parties to read.
  ok := false;
  begin
    perform create_invoice(f, cl, jsonb_build_array(jsonb_build_object('description','Fees','quantity',1,'unit_minor',100000)),
                           unrelated, 'NGN', null, true, null);
  exception when others then ok := sqlerrm like '%must be a party to that matter%'; end;
  perform t_check('an invoice cannot name a client who is not on the matter', ok);
  perform t_check('and no entry was filed on that matter',
                  (select count(*) from updates where matter_id = unrelated and kind = 'fee') = 0);

  ok := false;
  begin perform create_invoice(f, cl, '[]'::jsonb); exception when others then ok := sqlerrm like '%at least one item%'; end;
  perform t_check('an invoice with no items is refused',                 ok);
  ok := false;
  begin
    perform create_invoice(f, cl, jsonb_build_array(jsonb_build_object('description','Bad','quantity',1,'unit_minor',-1)));
  exception when others then ok := sqlerrm like '%zero or more%'; end;
  perform t_check('a negative item amount is refused',                   ok);
  -- draft → issue
  r := create_invoice(f, cl, jsonb_build_array(jsonb_build_object('description','Drafting','quantity',1,'unit_minor',1000000)),
                      null, 'NGN', null, false, null);
  perform t_check('a draft invoice is created unissued',                 (r ->> 'status') = 'draft');
  insert into fx values ('draft_invoice', (r ->> 'invoice_id')::uuid);
  perform t_reset();

  -- the client sees the issued invoice but never the draft
  perform t_as(cl, 'aal1');
  perform t_check('the client sees the issued invoice',                  (select count(*) from invoices where id = inv) = 1);
  perform t_check('the client never sees a draft invoice',               (select count(*) from invoices where id = (select v from fx where k='draft_invoice')) = 0);
  perform t_check('the client reads the invoice items',                  (select count(*) from invoice_items where invoice_id = inv) = 2);
  perform t_check('the client is told the invoice was issued',           (select count(*) from notifications where event = 'invoice_issued' and channel = 'in_app') = 1);
  perform t_reset();

  -- another firm's lawyer sees nothing and cannot invoice into this firm
  perform t_as(st, 'aal2');
  perform t_check('another firm sees none of these invoices',            (select count(*) from invoices) = 0);
  ok := false;
  begin perform create_invoice(f, cl, jsonb_build_array(jsonb_build_object('description','Hijack','quantity',1,'unit_minor',100)));
  exception when insufficient_privilege then ok := true; end;
  perform t_check('another firm cannot invoice through this firm',       ok);
  perform t_reset();

  -- issue_invoice and cancellation rules
  perform t_as(la, 'aal2');
  perform issue_invoice((select v from fx where k='draft_invoice'), current_date + 7);
  perform t_check('a draft can be issued',                               (select status from invoices where id = (select v from fx where k='draft_invoice')) = 'issued');
  ok := false;
  begin perform issue_invoice((select v from fx where k='draft_invoice')); exception when others then ok := sqlerrm like '%already%'; end;
  perform t_check('an issued invoice is not issued twice',               ok);
  ok := false;
  begin perform cancel_invoice(inv, 'oops'); exception when insufficient_privilege then ok := true; end;
  perform t_check('a lawyer cannot cancel an invoice (admin only)',      ok);
  perform t_reset();

  perform t_as(ad, 'aal2');
  perform cancel_invoice(inv, 'raised in error');
  perform t_check('an admin cancels an unpaid invoice',                  (select status from invoices where id = inv) = 'cancelled');
  perform t_reset();
end $$;

-- a paid invoice can never be cancelled
do $$
declare ad uuid := (select v from fx where k='admin'); di uuid := (select v from fx where k='draft_invoice'); ok bool;
begin
  update invoices set paid_minor = 500000, status = 'partially_paid' where id = di;
  perform t_as(ad, 'aal2');
  ok := false;
  begin perform cancel_invoice(di, 'no'); exception when others then ok := sqlerrm like '%credit note%'; end;
  perform t_check('a part-paid invoice cannot be cancelled',             ok);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. inviting a client onto a matter
do $$
declare la uuid := (select v from fx where k='lawyer'); cl uuid := (select v from fx where k='client');
        st uuid := (select v from fx where k='stranger'); m uuid := (select v from fx where k='matter');
        r jsonb; tok text; ok bool;
begin
  perform t_as(la, 'aal2');
  r := invite_matter_party(m, '+2348030000001', null, 'client');
  tok := r ->> 'token';
  perform t_check('an invitation returns a token for the WhatsApp link', length(tok) >= 32);
  perform t_check('the invitation carries the matter reference',         (r ->> 'matter_reference') like 'CF-M-%');
  ok := false;
  begin perform invite_matter_party(m, null, null, 'client'); exception when others then ok := sqlerrm like '%phone number or an email%'; end;
  perform t_check('an invitation needs a phone or an email',             ok);
  ok := false;
  begin perform invite_matter_party(m, '+2348030000009', null, 'lawyer'); exception when others then ok := true; end;
  perform t_check('a lawyer cannot be invited as a matter party',        ok);
  perform t_reset();

  -- another firm cannot invite onto this matter
  perform t_as(st, 'aal2');
  ok := false;
  begin perform invite_matter_party(m, '+2348030000002', null, 'client');
  exception when others then ok := sqlerrm like '%not found%' or sqlerrm like '%not permitted%'; end;
  perform t_check('another firm cannot invite onto this matter',         ok);
  perform t_reset();

  -- the client accepts and becomes a party
  perform t_as(cl, 'aal1');
  perform t_check('the client cannot read the invitations table',        (select count(*) from invites) = 0);
  perform accept_invite(tok);
  perform t_check('accepting the invitation adds the client as a party', (select count(*) from matter_parties where matter_id = m and user_id = cl) = 1);
  perform t_check('the client now sees the matter',                      (select count(*) from matters where id = m) = 1);
  perform t_reset();

  -- a second invitation for someone already on the matter is refused
  perform t_as(la, 'aal2');
  ok := false;
  begin perform invite_matter_party(m, '+2348030000001', null, 'client'); exception when others then ok := sqlerrm like '%already on this matter%'; end;
  perform t_check('a party already on the matter is not re-invited',     ok);

  -- revoking an unaccepted invitation kills it
  r := invite_matter_party(m, null, 'someone@example.test', 'contact');
  perform revoke_matter_invite((r ->> 'invite_id')::uuid);
  perform t_check('a revoked invitation is expired',                     (select expires_at from invites where id = (r ->> 'invite_id')::uuid) < now());
  perform t_reset();
  perform t_as(cl, 'aal1');
  ok := false;
  begin perform accept_invite(r ->> 'token'); exception when others then ok := sqlerrm like '%invalid or expired%'; end;
  perform t_check('a revoked invitation cannot be accepted',             ok);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. Today and Overview reads
do $$
declare la uuid := (select v from fx where k='lawyer'); st uuid := (select v from fx where k='stranger');
        f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter'); u uuid;
begin
  -- a sitting whose day has passed with no update posted
  insert into court_events (matter_id, firm_id, scheduled_at, court_name, purpose)
  values (m, f, now() - interval '2 days', 'High Court of Delta State', 'mention');
  -- and a file the client sent in, which counts until somebody looks at it
  insert into documents (firm_id, matter_id, name, category, client_visible, uploaded_by)
  values (f, m, 'Land certificate.pdf', 'client_upload', true, (select v from fx where k='client'));

  perform t_as(la, 'aal2');
  perform t_check('a past sitting with no update is due',                (select count(*) from firm_sittings_due where matter_id = m) = 1);
  perform t_check('the overview counts it',                              (select sittings_due from firm_overview where firm_id = f) = 1);
  perform t_check('the overview counts the open matters',                (select open_matters from firm_overview where firm_id = f) = 2);
  -- The only live naira invoice is the draft that was issued (1,075,000) and then
  -- part-paid by 500,000 in the cancellation test above.
  perform t_check('the overview totals what is outstanding in naira',
                  ((select outstanding_by_currency from firm_overview where firm_id = f) ->> 'NGN')::bigint = 575000);
  perform t_check('a firm sees exactly one overview row — its own',      (select count(*) from firm_overview) = 1);
  perform t_check('a client upload lands on the review counter',         (select client_uploads from firm_overview where firm_id = f) = 1);
  update documents set reviewed_at = now(), reviewed_by = la where firm_id = f and category = 'client_upload';
  perform t_check('marking it reviewed takes it off the counter',        (select client_uploads from firm_overview where firm_id = f) = 0);

  -- Money in two currencies is two figures, never one sum: kobo added to cents is
  -- a number that means nothing.
  perform create_invoice(f, (select v from fx where k='client'),
                         jsonb_build_array(jsonb_build_object('description','Opinion for a foreign client','quantity',1,'unit_minor',50000)),
                         null, 'USD', null, true, null);
  perform t_check('a second currency is kept apart, not added in',
                  ((select outstanding_by_currency from firm_overview where firm_id = f) ->> 'USD')::bigint = 53750
                    and ((select outstanding_by_currency from firm_overview where firm_id = f) ->> 'NGN')::bigint = 575000);

  -- posting the update clears the chase list
  u := post_court_update(m, 'mention', now() - interval '2 days', null, null, null, null, 'Matter came up for mention.', null);
  perform t_check('posting the update clears the sitting from the list', (select count(*) from firm_sittings_due where matter_id = m) = 0);
  perform t_check('and from the overview count',                         (select sittings_due from firm_overview where firm_id = f) = 0);
  perform t_reset();

  perform t_reset();

  perform t_as(st, 'aal2');
  perform t_check('another firm sees none of these sittings',            (select count(*) from firm_sittings_due) = 0);
  perform t_check('another firm sees only its own overview row',         (select count(*) from firm_overview) = 1
                                                                          and (select firm_id from firm_overview) = (select v from fx where k='other'));
  perform t_reset();
end $$;

-- the views are read-only for API roles
do $$
declare la uuid := (select v from fx where k='lawyer'); ok bool;
begin
  perform t_as(la, 'aal2');
  ok := false;
  begin execute 'update firm_overview set open_matters = 999'; exception when others then ok := true; end;
  perform t_check('firm_overview is read-only',                          ok);
  ok := false;
  begin execute 'delete from firm_sittings_due'; exception when others then ok := true; end;
  perform t_check('firm_sittings_due is read-only',                      ok);
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
