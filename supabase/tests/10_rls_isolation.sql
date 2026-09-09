-- Docket RLS isolation suite: two firms, six users, 52 checks. Proves that
-- tenant isolation, MFA gating, the booking engine, the payment cascade and
-- the audit trail behave as blueprint §6 demands. Everything rolls back.
--
-- Run via scripts/db-test-local.sh (needs tests/00_local_auth_stub.sql first).
-- Expected tail: 52 "PASS" notices, then "ALL CHECKS PASSED".

begin;

create temp table _results (n serial, name text, pass boolean);

-- security definer so the results table is writable regardless of the role
-- being impersonated when a check lands.
create function pg_temp.chk(p_name text, p_pass boolean) returns void
language plpgsql security definer as $fn$
begin
  insert into _results (name, pass) values (p_name, coalesce(p_pass, false));
  if coalesce(p_pass, false) then
    raise notice 'PASS: %', p_name;
  else
    raise warning 'FAIL: %', p_name;
  end if;
end $fn$;

-- Impersonation: exactly what PostgREST does — set request.jwt.claims and
-- switch to the matching database role.
create function pg_temp.as_user(p_user uuid, p_aal text default 'aal1') returns void
language plpgsql as $fn$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  set local role authenticated;
end $fn$;

create function pg_temp.as_anon() returns void
language plpgsql as $fn$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
end $fn$;

create function pg_temp.as_service() returns void
language plpgsql as $fn$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role service_role;
end $fn$;

create function pg_temp.as_super() returns void
language plpgsql as $fn$
begin
  reset role;
end $fn$;

do $test$
declare
  -- users
  u_alice uuid := gen_random_uuid();     -- client of firm A
  u_bob uuid := gen_random_uuid();       -- client of firm B (later invited to A)
  u_carol uuid := gen_random_uuid();     -- client at BOTH firms
  u_lawyer_a uuid := gen_random_uuid();  -- lawyer, firm A
  u_admin_a uuid := gen_random_uuid();   -- owner, firm A
  u_lawyer_b uuid := gen_random_uuid();  -- lawyer, firm B
  -- tenants and fixtures
  firm_a uuid;
  firm_b uuid := gen_random_uuid();
  svc uuid;
  form uuid;
  lp_a uuid := gen_random_uuid();
  lp_b uuid := gen_random_uuid();
  st_filed uuid;
  m_a1 uuid := gen_random_uuid();  -- alice's matter at A
  m_a2 uuid := gen_random_uuid();  -- carol's matter at A
  m_b1 uuid := gen_random_uuid();  -- bob's matter at B
  m_ab uuid := gen_random_uuid();  -- carol's matter at B
  upd_client uuid := gen_random_uuid();
  upd_internal uuid := gen_random_uuid();
  doc_visible uuid := gen_random_uuid();
  doc_hidden uuid := gen_random_uuid();
  inv_b uuid := gen_random_uuid();
  ce1 uuid := gen_random_uuid();
  -- the test day: a week out, so lead time never interferes
  v_day date := current_date + 7;
  v_slot1 timestamptz;
  v_slot2 timestamptz;
  -- scratch
  ok boolean;
  n integer;
  n2 integer;
  js jsonb;
  b1 uuid;          -- alice's first (paid) appointment
  b1_invoice text;  -- its invoice number
  b1_total numeric;
  b2 uuid;          -- alice's second (expired-hold) appointment
  v_update uuid;
begin
  -- =========================================================================
  -- Fixtures (as superuser; the migration owner bypasses RLS)
  -- =========================================================================
  perform pg_temp.as_super();

  insert into auth.users (id, email) values
    (u_alice, 'alice@example.test'),
    (u_bob, 'bob@example.test'),
    (u_carol, 'carol@example.test'),
    (u_lawyer_a, 'lawyer.a@example.test'),
    (u_admin_a, 'admin.a@example.test'),
    (u_lawyer_b, 'lawyer.b@example.test');
  insert into public.profiles (id, full_name) values
    (u_alice, 'Alice Client'), (u_bob, 'Bob Client'), (u_carol, 'Carol Client'),
    (u_lawyer_a, 'Firm A Lawyer'), (u_admin_a, 'Firm A Owner'), (u_lawyer_b, 'Firm B Lawyer');

  select id into firm_a from public.firms where slug = 'klinique';
  if firm_a is null then raise exception 'seed missing: run supabase/seed.sql first'; end if;
  update public.firms set vat_rate = 7.5 where id = firm_a; -- exercise the VAT math

  insert into public.firms (id, slug, name, reference_prefix)
  values (firm_b, 'okafor-partners', 'Okafor & Partners', 'OK');

  insert into public.firm_members (firm_id, user_id, role) values
    (firm_a, u_lawyer_a, 'lawyer'),
    (firm_a, u_admin_a, 'owner'),
    (firm_b, u_lawyer_b, 'lawyer');

  insert into public.lawyer_profiles (id, firm_id, user_id, slug, title, timezone, is_public, is_bookable)
  values
    (lp_a, firm_a, u_lawyer_a, 'firm-a-lawyer', 'Senior Associate', 'Africa/Lagos', true, true),
    (lp_b, firm_b, u_lawyer_b, 'firm-b-lawyer', 'Partner', 'Africa/Lagos', false, true);

  -- Weekly rule for the test day: 09:00–17:00, lunch 13:00–14:00, 30-minute
  -- slots, at most 2 appointments a day. Second rule + closed exception for
  -- the day after.
  insert into public.availability_rules
    (firm_id, lawyer_id, weekday, start_time, end_time, breaks, slot_minutes, daily_cap)
  values
    (firm_a, lp_a, extract(dow from v_day)::int, '09:00', '17:00',
     '[{"start":"13:00","end":"14:00"}]', 30, 2),
    (firm_a, lp_a, extract(dow from v_day + 1)::int, '09:00', '17:00', '[]', 30, null);
  insert into public.availability_exceptions (firm_id, lawyer_id, on_date, is_closed, reason)
  values (firm_a, lp_a, v_day + 1, true, 'court holiday');

  select id into svc from public.services where firm_id = firm_a and slug = 'legal-consultation';
  select id into form from public.intake_forms where firm_id = firm_a and service_id = svc;
  select id into st_filed from public.matter_statuses where firm_id = firm_a and key = 'filed';

  insert into public.matters (id, firm_id, reference, title, status_id, court) values
    (m_a1, firm_a, 'AK/2026/0001', 'Alice v Landlord', st_filed, 'High Court of Lagos'),
    (m_a2, firm_a, 'AK/2026/0002', 'Carol — contract dispute', st_filed, null),
    (m_b1, firm_b, 'OK/2026/0001', 'Bob — debt recovery', null, null),
    (m_ab, firm_b, 'OK/2026/0002', 'Carol — property purchase', null, null);
  insert into public.matter_parties (firm_id, matter_id, user_id, role) values
    (firm_a, m_a1, u_alice, 'client'),
    (firm_a, m_a2, u_carol, 'client'),
    (firm_b, m_b1, u_bob, 'client'),
    (firm_b, m_ab, u_carol, 'client');
  insert into public.matter_lawyers (firm_id, matter_id, user_id, is_lead)
  values (firm_a, m_a1, u_lawyer_a, true);

  insert into public.updates (id, firm_id, matter_id, author_id, visibility, kind, title, body) values
    (upd_client, firm_a, m_a1, u_lawyer_a, 'client', 'note',
     'We have filed your originating summons', 'Filed today at the registry.'),
    (upd_internal, firm_a, m_a1, u_lawyer_a, 'internal', 'note',
     'Internal strategy', 'Client should not see this.');

  insert into public.documents (id, firm_id, matter_id, owner_id, title, is_client_visible) values
    (doc_visible, firm_a, m_a1, u_lawyer_a, 'Originating summons', true),
    (doc_hidden, firm_a, m_a1, u_lawyer_a, 'Draft strategy memo', false);
  insert into public.document_versions (firm_id, document_id, version, storage_path, uploaded_by) values
    (firm_a, doc_visible, 1, 'documents/' || firm_a || '/' || doc_visible || '/v1.pdf', u_lawyer_a),
    (firm_a, doc_hidden, 1, 'documents/' || firm_a || '/' || doc_hidden || '/v1.pdf', u_lawyer_a);

  insert into public.invoices (id, firm_id, number, client_id, matter_id, status, currency,
                               subtotal, total, issued_at)
  values (inv_b, firm_b, 'INV-OK-000001', u_bob, m_b1, 'issued', 'NGN', 100000, 100000, now());

  -- a sitting today, not yet reported on
  insert into public.court_events (id, firm_id, matter_id, scheduled_at, court, purpose)
  values (ce1, firm_a, m_a1,
          (current_date::timestamp + time '09:00') at time zone 'Africa/Lagos',
          'High Court of Lagos', 'Mention');

  -- an invite for bob into alice's matter (redeemed at the end)
  insert into public.invites (firm_id, matter_id, role, email, token, invited_by)
  values (firm_a, m_a1, 'client', 'bob@example.test', 'test-invite-token-bob', u_admin_a);

  v_slot1 := (v_day::timestamp + time '10:00') at time zone 'Africa/Lagos';
  v_slot2 := (v_day::timestamp + time '11:00') at time zone 'Africa/Lagos';

  -- =========================================================================
  -- The anonymous surface
  -- =========================================================================
  perform pg_temp.as_anon();

  select count(*) into n from public.firm_public where slug = 'klinique';
  perform pg_temp.chk('anon resolves the tenant through firm_public', n = 1);

  select count(*) into n from public.services where firm_id = firm_a;
  perform pg_temp.chk('anon sees only active services', n = 1);

  select count(*) into n from public.lawyer_profiles;
  perform pg_temp.chk('anon sees only public lawyer profiles', n = 1);

  ok := false;
  begin
    perform 1 from public.firms limit 1;
  exception when insufficient_privilege then ok := true;
  end;
  perform pg_temp.chk('anon cannot read the firms table directly', ok);

  ok := false;
  begin
    perform 1 from public.appointments limit 1;
  exception when insufficient_privilege then ok := true;
  end;
  perform pg_temp.chk('anon cannot read appointments', ok);

  ok := false;
  begin
    perform public.book_appointment(firm_a, svc, lp_a, v_slot1);
  exception when insufficient_privilege then ok := true;
  end;
  perform pg_temp.chk('anon cannot call book_appointment', ok);

  -- =========================================================================
  -- Slot computation (rules, breaks, exceptions)
  -- =========================================================================
  select count(*) into n from public.available_slots(firm_a, lp_a, svc, v_day);
  perform pg_temp.chk('slot grid: 09:00-17:00 minus lunch yields 14 slots', n = 14);

  select count(*) into n from public.available_slots(firm_a, lp_a, svc, v_day) s
  where (s.slot_starts_at at time zone 'Africa/Lagos')::time >= '13:00'
    and (s.slot_starts_at at time zone 'Africa/Lagos')::time < '14:00';
  perform pg_temp.chk('no slots are offered during the break', n = 0);

  select count(*) into n from public.available_slots(firm_a, lp_a, svc, v_day + 1);
  perform pg_temp.chk('a closed exception day offers no slots', n = 0);

  -- =========================================================================
  -- Booking
  -- =========================================================================
  perform pg_temp.as_user(u_alice);

  ok := false;
  begin
    insert into public.appointments
      (firm_id, client_id, lawyer_id, service_id, starts_at, ends_at, price, currency)
    values (firm_a, u_alice, lp_a, svc, v_slot1, v_slot1 + interval '30 minutes', 0, 'NGN');
  exception when insufficient_privilege then ok := true;
  end;
  perform pg_temp.chk('clients cannot insert appointments directly', ok);

  js := public.book_appointment(
    firm_a, svc, lp_a, v_slot1, 'virtual', 'Africa/Lagos',
    '{"topic": "Property or land", "summary": "Landlord dispute", "urgency": "Within the month", "in_court": "No"}'::jsonb,
    form);
  b1 := (js ->> 'appointment_id')::uuid;
  b1_invoice := js ->> 'invoice_number';
  b1_total := (js ->> 'amount_due')::numeric;

  select count(*) into n from public.appointments
  where id = b1 and status = 'held'
    and hold_expires_at between now() + interval '13 minutes' and now() + interval '16 minutes';
  perform pg_temp.chk('book_appointment creates a 15-minute hold', n = 1);

  select count(*) into n from public.invoices
  where number = b1_invoice and status = 'issued'
    and vat_amount = 3750.00 and total = 53750.00;
  perform pg_temp.chk('the invoice is issued with VAT from firms.vat_rate', n = 1 and b1_total = 53750.00);

  select count(*) into n from public.intake_responses
  where appointment_id = b1 and client_id = u_alice
    and answers ->> 'summary' = 'Landlord dispute';
  perform pg_temp.chk('intake answers are stored with the appointment', n = 1);

  select count(*) into n from public.available_slots(firm_a, lp_a, svc, v_day) s
  where s.slot_starts_at = v_slot1;
  perform pg_temp.chk('a held slot disappears from available_slots', n = 0);

  perform pg_temp.as_user(u_bob);
  ok := false;
  begin
    js := public.book_appointment(firm_a, svc, lp_a, v_slot1);
  exception when others then ok := true;
  end;
  perform pg_temp.chk('a second client cannot take the same slot', ok);

  -- =========================================================================
  -- Payment cascade
  -- =========================================================================
  perform pg_temp.as_user(u_alice);
  ok := false;
  begin
    perform public.record_payment('paystack', 'FAKE', b1_invoice, 1, 'NGN', 'success');
  exception when insufficient_privilege then ok := true;
  end;
  perform pg_temp.chk('authenticated users cannot call record_payment', ok);

  perform pg_temp.as_service();
  js := public.record_payment('paystack', 'PSK_TEST_REF_1', b1_invoice,
                              53750.00, 'NGN', 'success', '{"source": "test"}'::jsonb);

  perform pg_temp.as_super();
  select count(*) into n from public.invoices
  where number = b1_invoice and status = 'paid' and amount_paid = 53750.00;
  perform pg_temp.chk('record_payment settles the invoice', n = 1);

  select count(*) into n from public.appointments
  where id = b1 and status = 'confirmed' and hold_expires_at is null;
  perform pg_temp.chk('a paid invoice confirms the held appointment', n = 1);

  perform pg_temp.as_service();
  js := public.record_payment('paystack', 'PSK_TEST_REF_1', b1_invoice,
                              53750.00, 'NGN', 'success');
  perform pg_temp.as_super();
  select amount_paid into b1_total from public.invoices where number = b1_invoice;
  perform pg_temp.chk('a duplicate webhook is idempotent',
    (js ->> 'duplicate')::boolean and b1_total = 53750.00);

  -- =========================================================================
  -- The 15-minute hold and the daily cap
  -- =========================================================================
  perform pg_temp.as_user(u_alice);
  js := public.book_appointment(firm_a, svc, lp_a, v_slot2);
  b2 := (js ->> 'appointment_id')::uuid;

  perform pg_temp.as_anon();
  select count(*) into n from public.available_slots(firm_a, lp_a, svc, v_day);
  perform pg_temp.chk('the daily cap stops further bookings', n = 0);

  perform pg_temp.as_super();
  update public.appointments set hold_expires_at = now() - interval '1 minute' where id = b2;
  perform pg_temp.as_service();
  select public.release_expired_holds() into n;
  perform pg_temp.as_super();
  select count(*) into n2 from public.appointments
  where id = b2 and status = 'cancelled' and cancel_reason = 'hold_expired';
  perform pg_temp.chk('release_expired_holds cancels the expired hold', n >= 1 and n2 = 1);

  select count(*) into n from public.invoices
  where appointment_id = b2 and status = 'void';
  perform pg_temp.chk('an expired hold voids its unpaid invoice', n = 1);

  perform pg_temp.as_anon();
  select count(*) into n from public.available_slots(firm_a, lp_a, svc, v_day);
  perform pg_temp.chk('released holds free the capacity again', n > 0);

  -- =========================================================================
  -- Client isolation
  -- =========================================================================
  perform pg_temp.as_user(u_alice);

  select count(*) into n from public.matters;
  select count(*) into n2 from public.matters where id = m_a1;
  perform pg_temp.chk('a client sees exactly their own matters', n = 1 and n2 = 1);

  select count(*) into n from public.updates where matter_id = m_a1;
  perform pg_temp.chk('a client sees the client-visible timeline', n >= 1);

  select count(*) into n from public.updates where visibility = 'internal';
  perform pg_temp.chk('internal timeline entries never reach clients', n = 0);

  select count(*) into n from public.documents where id = doc_visible;
  select count(*) into n2 from public.documents where id = doc_hidden;
  perform pg_temp.chk('clients see visible documents, never hidden ones', n = 1 and n2 = 0);

  select count(*) into n from public.invoices where id = inv_b;
  select count(*) into n2 from public.invoices where client_id = u_alice;
  perform pg_temp.chk('clients see only their own invoices', n = 0 and n2 = 2);

  select count(*) into n from public.payments;
  perform pg_temp.chk('clients see only payments on their own invoices', n = 1);

  select count(*) into n from public.matters where firm_id = firm_b;
  select count(*) into n2 from public.updates where firm_id = firm_b;
  perform pg_temp.chk('a firm-A client sees nothing of firm B', n = 0 and n2 = 0);

  perform pg_temp.as_user(u_carol);
  select count(*) into n from public.matters;
  select count(*) into n2 from public.matters where id in (m_a2, m_ab);
  perform pg_temp.chk('a client at two firms gets one merged feed of exactly their matters',
    n = 2 and n2 = 2);

  -- =========================================================================
  -- Staff isolation and MFA gating
  -- =========================================================================
  perform pg_temp.as_user(u_lawyer_a, 'aal1'); -- staff can READ without MFA

  select count(*) into n from public.matters where firm_id = firm_a;
  perform pg_temp.chk('staff see all their firm''s matters', n = 2);

  select count(*) into n from public.matters where firm_id = firm_b;
  perform pg_temp.chk('staff see nothing of other firms', n = 0);

  select count(*) into n from public.updates where id = upd_internal;
  perform pg_temp.chk('staff read internal timeline entries', n = 1);

  ok := false;
  begin
    insert into public.updates (firm_id, matter_id, author_id, visibility, kind, title)
    values (firm_a, m_a1, u_lawyer_a, 'client', 'note', 'written without MFA');
  exception when insufficient_privilege then ok := true;
  end;
  perform pg_temp.chk('staff writes are rejected without an MFA session', ok);

  perform pg_temp.as_user(u_lawyer_a, 'aal2');
  insert into public.updates (firm_id, matter_id, author_id, visibility, kind, title)
  values (firm_a, m_a1, u_lawyer_a, 'client', 'note', 'written with MFA');
  perform pg_temp.chk('staff writes succeed at aal2', true);

  ok := false;
  begin
    insert into public.updates (firm_id, matter_id, author_id, visibility, kind, title)
    values (firm_b, m_b1, u_lawyer_a, 'client', 'note', 'cross-tenant write');
  exception when insufficient_privilege then ok := true;
  end;
  perform pg_temp.chk('staff cannot write into another firm, even with MFA', ok);

  select count(*) into n from public.profiles where id = u_alice;
  select count(*) into n2 from public.profiles where id = u_bob;
  perform pg_temp.chk('staff see their own clients'' profiles, not other firms''',
    n = 1 and n2 = 0);

  -- =========================================================================
  -- The court-update form (blueprint §5.11)
  -- =========================================================================
  perform pg_temp.as_user(u_lawyer_a, 'aal1');
  ok := false;
  begin
    perform public.post_court_update(m_a1, 'adjourned', current_date,
      'High Court of Lagos', 'defendant');
  exception when insufficient_privilege then ok := true;
  end;
  perform pg_temp.chk('post_court_update refuses a non-MFA session', ok);

  perform pg_temp.as_user(u_lawyer_a, 'aal2');
  v_update := public.post_court_update(
    m_a1, 'adjourned', current_date, 'High Court of Lagos', 'defendant',
    (current_date + 14)::timestamp at time zone 'Africa/Lagos' + interval '9 hours',
    'Hearing of pending motion',
    'The court adjourned at the defendant''s instance. Nothing is required from you.',
    'Opposing counsel sought adjournment; costs reserved.');

  select count(*) into n from public.updates
  where matter_id = m_a1 and kind = 'court_update' and visibility = 'client';
  select count(*) into n2 from public.updates
  where matter_id = m_a1 and kind = 'court_update' and visibility = 'internal';
  perform pg_temp.chk('post_court_update posts client and internal entries', n = 1 and n2 = 1);

  select count(*) into n from public.court_events
  where id = ce1 and outcome = 'adjourned' and outcome_update_id = v_update;
  perform pg_temp.chk('today''s sitting is closed by the update', n = 1);

  select count(*) into n from public.court_events
  where matter_id = m_a1 and outcome_update_id is null
    and purpose = 'Hearing of pending motion';
  perform pg_temp.chk('the next court date is diarised', n = 1);

  perform pg_temp.as_super();
  select count(*) into n from public.notifications
  where user_id = u_alice and event = 'court_update' and channel = 'in_app';
  perform pg_temp.chk('the client party is notified of the court update', n >= 1);

  -- =========================================================================
  -- Consultation notes
  -- =========================================================================
  perform pg_temp.as_user(u_lawyer_a, 'aal2');
  perform public.save_consultation_notes(
    b1, 'We discussed your tenancy dispute and your options.',
    'Serve a formal notice before filing.', 'Send the tenancy agreement this week.',
    'Client seems ready to litigate; quote conservatively.', true);
  perform pg_temp.as_super();
  select count(*) into n from public.appointments where id = b1 and status = 'completed';
  select count(*) into n2 from public.consultation_notes where appointment_id = b1;
  perform pg_temp.chk('save_consultation_notes writes notes and completes the appointment',
    n = 1 and n2 = 1);

  perform pg_temp.as_user(u_alice);
  select count(*) into n from public.consultation_notes
  where appointment_id = b1 and summary is not null;
  perform pg_temp.chk('the client sees their consultation summary', n = 1);

  select count(*) into n from public.consultation_internal_notes;
  perform pg_temp.chk('internal consultation notes never reach clients', n = 0);

  -- =========================================================================
  -- Invites
  -- =========================================================================
  perform pg_temp.as_user(u_bob);
  select count(*) into n from public.invites;
  perform pg_temp.chk('invite tokens are invisible to clients', n = 0);

  js := public.accept_invite('test-invite-token-bob');
  select count(*) into n from public.matters where id = m_a1;
  perform pg_temp.chk('accept_invite makes the client a party to the matter',
    (js ->> 'matter_id')::uuid = m_a1 and n = 1);

  -- =========================================================================
  -- Audit log: owner/admin read, append-only for everyone
  -- =========================================================================
  perform pg_temp.as_user(u_admin_a);
  select count(*) into n from public.audit_log where firm_id = firm_a;
  perform pg_temp.chk('the firm owner reads the firm''s audit log', n > 0);

  perform pg_temp.as_user(u_lawyer_a, 'aal2');
  select count(*) into n from public.audit_log;
  perform pg_temp.chk('non-admin staff cannot read the audit log', n = 0);

  perform pg_temp.as_service();
  ok := false;
  begin
    update public.audit_log set action = 'tampered' where firm_id = firm_a;
  exception when others then ok := true;
  end;
  perform pg_temp.chk('audit_log rejects updates even from the service role', ok);

  ok := false;
  begin
    delete from public.audit_log where firm_id = firm_a;
  exception when others then ok := true;
  end;
  perform pg_temp.chk('audit_log rejects deletes even from the service role', ok);

  -- =========================================================================
  -- Verdict
  -- =========================================================================
  perform pg_temp.as_super();
  select count(*) filter (where pass), count(*) filter (where not pass)
  into n, n2 from _results;
  if n2 > 0 then
    raise exception '% of % checks FAILED', n2, n + n2;
  end if;
  if n <> 52 then
    raise exception 'expected 52 checks, ran %', n;
  end if;
  raise notice 'ALL CHECKS PASSED';
end $test$;

rollback;
