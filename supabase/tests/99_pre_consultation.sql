-- Before a consultation: what is still missing is computed from real rows, the client answers only
-- that, and — with the firm's switch on — the booking is held until the firm confirms it, which the
-- database refuses until everything required is in. Off, nothing changes. Rolls back.
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
grant select on fx to anon, authenticated;
insert into firms (slug, name, reference_prefix, status, paystack_subaccount) values ('ck-firm', 'Check-in Chambers', 'CK', 'active', 'ACCT_ck');
insert into fx select 'firm', id from firms where slug = 'ck-firm';
update firms set policies = jsonb_build_object('terms', jsonb_build_object('version', '2026-09', 'text', 'Terms.'),
                                               'privacy', jsonb_build_object('version', '2026-09', 'text', 'Privacy.'))
 where slug = 'ck-firm';
insert into auth.users (id, email) values
  (gen_random_uuid(), 'ck-lawyer@test'), (gen_random_uuid(), 'ck-admin@test'), (gen_random_uuid(), 'ck-client@test'), (gen_random_uuid(), 'ck-stranger@test');
insert into fx select 'lawyer',   id from auth.users where email = 'ck-lawyer@test';
insert into fx select 'admin',    id from auth.users where email = 'ck-admin@test';
insert into fx select 'client',   id from auth.users where email = 'ck-client@test';
insert into fx select 'stranger', id from auth.users where email = 'ck-stranger@test';
update profiles set full_name = 'Adaeze Nwosu' where id = (select v from fx where k='client');
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'), (select v from fx where k='lawyer'), 'lawyer'),
  ((select v from fx where k='firm'), (select v from fx where k='admin'),  'admin');
insert into services (firm_id, slug, name, price_minor, currency, duration_min, requires_prepayment, is_active) values
  ((select v from fx where k='firm'), 'free',  'Free first consultation', 0,       'NGN', 30, false, true),
  ((select v from fx where k='firm'), 'paid',  'Paid consultation',       5000000, 'NGN', 45, true,  true);
insert into fx select 'svc_free', id from services where firm_id = (select v from fx where k='firm') and slug = 'free';
insert into fx select 'svc_paid', id from services where firm_id = (select v from fx where k='firm') and slug = 'paid';
insert into availability_rules (firm_id, lawyer_id, weekday, start_time, end_time, slot_min, max_per_day)
values ((select v from fx where k='firm'), (select v from fx where k='lawyer'), extract(dow from current_date + 7)::int, '09:00', '17:00', 30, 12);
-- One firm-wide form: two required text questions, a required file (never counted), a required
-- question shown on a condition (never counted), and an optional one.
insert into intake_forms (firm_id, service_id, name, is_active, schema) values
  ((select v from fx where k='firm'), null, 'Before we meet', true, jsonb_build_object('questions', jsonb_build_array(
     jsonb_build_object('key', 'issue_summary', 'type', 'longtext', 'label', 'What is the matter about?', 'required', true),
     jsonb_build_object('key', 'urgency', 'type', 'choice', 'label', 'How urgent is it?', 'options', jsonb_build_array('This week', 'This month'), 'required', true),
     jsonb_build_object('key', 'papers', 'type', 'file', 'label', 'Any papers', 'required', true),
     jsonb_build_object('key', 'company_name', 'type', 'text', 'label', 'Company', 'required', true, 'show_if', jsonb_build_object('question', 'client_type', 'equals', 'Business')),
     jsonb_build_object('key', 'other_lawyer', 'type', 'text', 'label', 'Another lawyer?', 'required', false))));
insert into fx select 'form', id from intake_forms where firm_id = (select v from fx where k='firm');

-- ---------------------------------------------------------------- 1. the switch is off: a booking is confirmed as before, and readiness is readable
do $$
declare cl uuid := (select v from fx where k='client'); st uuid := (select v from fx where k='stranger'); f uuid := (select v from fx where k='firm');
        l uuid := (select v from fx where k='lawyer'); s uuid := (select v from fx where k='svc_free'); slot timestamptz; res jsonb; r jsonb;
begin
  perform t_check('the switch is off by default', (select not checkin_before_confirm from firms where id = f));
  perform t_as(cl, 'aal1');
  select x.starts_at into slot from available_slots(f, l, s, current_date + 7) x order by 1 limit 1;
  res := book_appointment(f, s, l, slot, 'virtual', 'Africa/Lagos', jsonb_build_object('issue_summary', 'A tenancy'), (select v from fx where k='form'));
  perform t_check('with the switch off a free booking is confirmed at once', res ->> 'status' = 'confirmed');
  r := appointment_readiness((res ->> 'appointment_id')::uuid);
  perform t_check('the client reads their own readiness: not held, one question still to answer, terms not accepted',
    not (r ->> 'held')::bool and not (r ->> 'checkin_required')::bool
    and exists (select 1 from jsonb_array_elements(r -> 'items') i where i ->> 'kind' = 'intake' and not (i ->> 'satisfied')::bool and i -> 'missing' @> '[{"key": "urgency"}]'::jsonb and not (i -> 'missing' @> '[{"key": "papers"}]'::jsonb) and not (i -> 'missing' @> '[{"key": "company_name"}]'::jsonb))
    and exists (select 1 from jsonb_array_elements(r -> 'items') i where i ->> 'kind' = 'consent' and not (i ->> 'satisfied')::bool)
    and not exists (select 1 from jsonb_array_elements(r -> 'items') i where i ->> 'kind' = 'conflict'));
  perform t_reset(); perform t_as(st, 'aal1');
  perform t_check('a stranger cannot read it', t_refused(format('select appointment_readiness(%L)', res ->> 'appointment_id'), '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. the switch on: a booking is held, and nothing confirms it until it is ready
do $$
declare cl uuid := (select v from fx where k='client'); ad uuid := (select v from fx where k='admin'); l uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm');
        s uuid := (select v from fx where k='svc_free'); slot timestamptz; res jsonb; r jsonb; a uuid; rq uuid; d uuid; d2 uuid; a2 uuid; c uuid;
begin
  perform t_as(ad);
  update firms set checkin_before_confirm = true where id = f;
  perform t_reset(); perform t_as(cl, 'aal1');
  select x.starts_at into slot from available_slots(f, l, s, current_date + 7) x order by 1 offset 1 limit 1;
  res := book_appointment(f, s, l, slot, 'virtual', 'Africa/Lagos', jsonb_build_object('issue_summary', 'A tenancy'), (select v from fx where k='form'));
  a := (res ->> 'appointment_id')::uuid;
  perform t_check('with the switch on a free booking is held', res ->> 'status' = 'pending' and (select status = 'pending' from appointments where id = a));
  perform t_reset();
  perform t_check('and the client is told it is held, not confirmed', exists (select 1 from notifications where user_id = cl and event = 'appointment_held' and (payload ->> 'appointment_id')::uuid = a)
                                                                    and not exists (select 1 from notifications where user_id = cl and event = 'appointment_confirmed' and (payload ->> 'appointment_id')::uuid = a));
  perform t_check('a held booking holds the slot', not exists (select 1 from available_slots(f, l, s, current_date + 7) x where x.starts_at = slot));
  insert into fx values ('held', a);

  perform t_as(l);
  perform t_check('staff cannot confirm it by hand', t_fails(format('update appointments set status = ''confirmed'' where id = %L', a), 'once what it asked for is in'));
  perform t_check('nor through the door', t_fails(format('select confirm_appointment(%L)', a), 'not ready'));
  -- the firm asks for a document on the consultation
  insert into document_requests (firm_id, appointment_id, title, why, requested_by) values (f, a, 'Your tenancy agreement', 'So we read it before we meet', l) returning id into rq;
  perform t_reset();
  perform t_check('the client is told what the firm asked for, on the consultation', exists (select 1 from notifications where user_id = cl and event = 'document_requested' and (payload ->> 'appointment_id')::uuid = a));
  perform t_as(cl, 'aal1');
  r := appointment_readiness(a);
  perform t_check('the client sees the open request among what is missing', exists (select 1 from jsonb_array_elements(r -> 'items') i where i ->> 'kind' = 'documents' and not (i ->> 'satisfied')::bool and (i -> 'open' -> 0 ->> 'title') = 'Your tenancy agreement'));
  -- the client answers the missing question; answers stay insert-once
  r := amend_intake_response(a, jsonb_build_object('urgency', 'This week'));
  perform t_check('the client answers only what was missing, and the latest row carries everything', (select answers ->> 'issue_summary' = 'A tenancy' and answers ->> 'urgency' = 'This week' from intake_responses where appointment_id = a order by created_at desc limit 1)
                                                                                                  and (select count(*) = 2 from intake_responses where appointment_id = a));
  perform t_check('and the intake item is now satisfied', exists (select 1 from jsonb_array_elements(r -> 'readiness' -> 'items') i where i ->> 'kind' = 'intake' and (i ->> 'satisfied')::bool));
  perform t_check('answers cannot be edited in place', t_refused(format('update intake_responses set answers = ''{}'' where appointment_id = %L', a), '42501'));
  -- the client uploads against the consultation and answers the request
  d := gen_random_uuid();
  insert into documents (id, firm_id, appointment_id, name, category, client_visible, uploaded_by) values (d, f, a, 'tenancy.pdf', 'correspondence', true, cl);
  perform fulfil_document_request(rq, d);
  r := appointment_readiness(a);
  perform t_check('the upload answers the request and the documents item is satisfied', (select fulfilled_document_id = d from document_requests where id = rq) and exists (select 1 from jsonb_array_elements(r -> 'items') i where i ->> 'kind' = 'documents' and (i ->> 'satisfied')::bool));
  -- consent, at the current versions
  insert into consent_records (user_id, firm_id, kind, version) values (cl, f, 'terms', '2026-09'), (cl, f, 'privacy', '2026-09');
  r := appointment_readiness(a);
  perform t_check('accepting the current terms and privacy notice satisfies consent', exists (select 1 from jsonb_array_elements(r -> 'items') i where i ->> 'kind' = 'consent' and (i ->> 'satisfied')::bool));
  perform t_check('everything the client can do is done; the booking is ready', (r ->> 'ready')::bool);
  perform t_reset();

  -- a document on another consultation cannot answer a request here
  perform t_as(cl, 'aal1');
  select x.starts_at into slot from available_slots(f, l, s, current_date + 7) x order by 1 offset 2 limit 1;
  res := book_appointment(f, s, l, slot, 'virtual', 'Africa/Lagos', null, null);
  a2 := (res ->> 'appointment_id')::uuid;
  d2 := gen_random_uuid();
  insert into documents (id, firm_id, appointment_id, name, category, client_visible, uploaded_by) values (d2, f, a2, 'other.pdf', 'correspondence', true, cl);
  perform t_reset(); perform t_as(l);
  insert into document_requests (firm_id, appointment_id, title, requested_by) values (f, a, 'Something else', l) returning id into rq;
  perform t_reset(); perform t_as(cl, 'aal1');
  perform t_check('a document on another consultation cannot answer it', t_fails(format('select fulfil_document_request(%L, %L)', rq, d2), 'not on this consultation'));
  perform t_reset(); perform t_as(l);
  update document_requests set cancelled_at = now() where id = rq;
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. the firm's own check is an item only where the firm requires clearance, and the client never sees its substance
do $$
declare cl uuid := (select v from fx where k='client'); ad uuid := (select v from fx where k='admin'); l uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm');
        a uuid := (select v from fx where k='held'); r jsonb; c uuid; i jsonb;
begin
  perform t_as(ad); update firms set conflict_checks_required = true where id = f; perform t_reset();
  perform t_as(cl, 'aal1');
  r := appointment_readiness(a);
  select x into i from jsonb_array_elements(r -> 'items') x where x ->> 'kind' = 'conflict';
  perform t_check('the client sees that the firm has checks to finish, and nothing else', i is not null and not (i ->> 'satisfied')::bool and i ->> 'detail' like 'The firm is finishing its own checks%' and not (i ? 'matches'));
  perform t_check('and the booking is no longer ready', not (r ->> 'ready')::bool);
  perform t_check('the client cannot run the firm''s check', t_refused(format('select run_conflict_check(%L, null, null, %L)', f, a), '42501'));
  perform t_reset(); perform t_as(l);
  perform t_check('the firm cannot confirm until it has cleared its check', t_fails(format('select confirm_appointment(%L)', a), 'not ready'));
  r := run_conflict_check(f, null, null, a);
  c := (r ->> 'check_id')::uuid;
  perform t_check('the check on a consultation searches for the person who booked it', r -> 'keys' @> '["adaeze nwosu"]'::jsonb and (select appointment_id = a from conflict_checks where id = c));
  perform decide_conflict_check(c, 'clear', 'Nobody by that name on our books');
  r := appointment_readiness(a);
  perform t_check('cleared, the firm sees the item satisfied with its detail', exists (select 1 from jsonb_array_elements(r -> 'items') x where x ->> 'kind' = 'conflict' and (x ->> 'satisfied')::bool and x ->> 'detail' = 'Cleared.'));
  r := confirm_appointment(a);
  perform t_check('ready, the firm confirms', r ->> 'status' = 'confirmed' and (select status = 'confirmed' from appointments where id = a));
  perform t_check('confirming again is refused', t_fails(format('select confirm_appointment(%L)', a), 'not held'));
  perform t_reset();
  perform t_check('the confirmation is audited and the client told', exists (select 1 from audit_log where action = 'appointment.confirmed' and entity_id = a)
                                                                  and exists (select 1 from notifications where user_id = cl and event = 'appointment_confirmed' and (payload ->> 'appointment_id')::uuid = a));
  update firms set conflict_checks_required = false where id = f;
end $$;

-- ---------------------------------------------------------------- 4. a paid booking is held after payment with the switch on, confirmed with it off
do $$
declare cl uuid := (select v from fx where k='client'); l uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm'); s uuid := (select v from fx where k='svc_paid');
        slot timestamptz; res jsonb; r2 jsonb; a uuid;
begin
  perform t_as(cl, 'aal1');
  select x.starts_at into slot from available_slots(f, l, s, current_date + 7) x order by 1 desc limit 1;
  res := book_appointment(f, s, l, slot);
  a := (res ->> 'appointment_id')::uuid;
  perform t_check('a paid booking still waits for payment first', res ->> 'status' = 'awaiting_payment');
  perform t_reset();
  r2 := record_payment('paystack', 'CK-REF-1', res ->> 'invoice_number', (res ->> 'amount_minor')::bigint, 'NGN', 'succeeded', '{}'::jsonb, 'ACCT_ck');
  perform t_check('paid, it is held for the firm rather than confirmed', (select status = 'pending' and hold_expires_at is null from appointments where id = a)
                                                                     and exists (select 1 from notifications where user_id = cl and event = 'appointment_held' and (payload ->> 'appointment_id')::uuid = a)
                                                                     and exists (select 1 from notifications where user_id = cl and event = 'payment_confirmed' and payload ->> 'invoice_number' = res ->> 'invoice_number'));
  perform t_check('and the payment item is satisfied', exists (select 1 from jsonb_array_elements(appointment_checkin(a) -> 'items') i where i ->> 'kind' = 'payment' and (i ->> 'satisfied')::bool));
  update firms set checkin_before_confirm = false where id = f;
  perform t_as(cl, 'aal1');
  select x.starts_at into slot from available_slots(f, l, s, current_date + 7) x order by 1 desc limit 1;
  res := book_appointment(f, s, l, slot);
  perform t_reset();
  r2 := record_payment('paystack', 'CK-REF-2', res ->> 'invoice_number', (res ->> 'amount_minor')::bigint, 'NGN', 'succeeded', '{}'::jsonb, 'ACCT_ck');
  perform t_check('with the switch off, paid means confirmed, as before', (select status = 'confirmed' from appointments where id = (res ->> 'appointment_id')::uuid));
  update firms set checkin_before_confirm = true where id = f;
end $$;

-- ---------------------------------------------------------------- 5. a held booking is nudged, and released when its time comes
do $$
declare cl uuid := (select v from fx where k='client'); l uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm'); a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); inv uuid; n int;
begin
  insert into appointments (id, firm_id, reference, client_id, lawyer_id, service_id, mode, status, starts_at, ends_at, client_timezone, fee_minor, currency)
  values (a, f, 'CK-2026-900001', cl, l, (select v from fx where k='svc_free'), 'virtual', 'pending', now() + interval '30 hours', now() + interval '30 hours 30 minutes', 'Africa/Lagos', 0, 'NGN');
  n := enqueue_appointment_reminders();
  perform t_check('two days out the client is told what is outstanding; the lawyer not yet',
    exists (select 1 from notifications where user_id = cl and event = 'appointment_checkin_due' and (payload ->> 'appointment_id')::uuid = a)
    and not exists (select 1 from notifications where user_id = l and event = 'appointment_awaiting_confirmation' and (payload ->> 'appointment_id')::uuid = a));
  update appointments set starts_at = now() + interval '20 hours', ends_at = now() + interval '20 hours 30 minutes' where id = a;
  n := enqueue_appointment_reminders();
  perform t_check('a day out the lawyer is told it is theirs to confirm', exists (select 1 from notifications where user_id = l and event = 'appointment_awaiting_confirmation' and (payload ->> 'appointment_id')::uuid = a));
  n := enqueue_appointment_reminders();
  -- one row per channel is the dispatcher's shape; "once" means once per channel and the key recorded once
  perform t_check('and each only once', (select count(*) = count(distinct channel) from notifications where event = 'appointment_checkin_due' and (payload ->> 'appointment_id')::uuid = a)
                                     and (select count(*) = count(distinct channel) from notifications where event = 'appointment_awaiting_confirmation' and (payload ->> 'appointment_id')::uuid = a)
                                     and (select reminders_sent @> array['checkin', 'unconfirmed'] and array_length(reminders_sent, 1) = 2 from appointments where id = a));
  insert into appointments (id, firm_id, reference, client_id, lawyer_id, service_id, mode, status, starts_at, ends_at, client_timezone, fee_minor, currency)
  values (b, f, 'CK-2026-900002', cl, l, (select v from fx where k='svc_free'), 'virtual', 'pending', now() - interval '1 hour', now() - interval '30 minutes', 'Africa/Lagos', 100000, 'NGN');
  insert into invoices (id, firm_id, number, client_id, appointment_id, currency, subtotal_minor, vat_minor, total_minor, status, issued_at, due_at)
  values (gen_random_uuid(), f, 'CK-INV-2026-900001', cl, b, 'NGN', 100000, 0, 100000, 'issued', now(), current_date) returning id into inv;
  update appointments set invoice_id = inv where id = b;
  n := release_expired_holds();
  perform t_check('a held booking nobody confirmed is released when its time comes, its unpaid invoice voided',
    (select status = 'cancelled' and cancellation_reason = 'not_confirmed' from appointments where id = b) and (select status = 'cancelled' from invoices where id = inv));
  perform t_check('a held booking still in the future is untouched', (select status = 'pending' from appointments where id = a));
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
