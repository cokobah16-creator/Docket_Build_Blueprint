-- The baseline: every figure comes from a row this fixture writes, an inference says it is one,
-- and the record cannot be edited once it is taken. Run alone or with the others. Rolls back.
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
-- One firm, one month. Everything below is dated inside it, so every figure is checked against
-- a number this file wrote rather than against whatever the seed happens to contain.
create temp table fx (k text primary key, v uuid);
grant select on fx to anon, authenticated;
create temp table win (wfrom timestamptz, wto timestamptz);
grant select on win to anon, authenticated;
insert into win values (now() - interval '30 days', now());

insert into firms (slug, name, reference_prefix, status, timezone) values ('bl-firm', 'Baseline Chambers', 'BL', 'active', 'Africa/Lagos');
insert into fx select 'firm', id from firms where slug = 'bl-firm';
insert into firms (slug, name, reference_prefix, status) values ('bl-other', 'Other Chambers', 'BO', 'active');
insert into fx select 'other', id from firms where slug = 'bl-other';
insert into auth.users (id, email) values
  (gen_random_uuid(), 'bl-owner@test'), (gen_random_uuid(), 'bl-lawyer@test'), (gen_random_uuid(), 'bl-client@test'),
  (gen_random_uuid(), 'bl-client2@test'), (gen_random_uuid(), 'bl-stranger@test');
insert into fx select 'owner',    id from auth.users where email = 'bl-owner@test';
insert into fx select 'lawyer',   id from auth.users where email = 'bl-lawyer@test';
insert into fx select 'client',   id from auth.users where email = 'bl-client@test';
insert into fx select 'client2',  id from auth.users where email = 'bl-client2@test';
insert into fx select 'stranger', id from auth.users where email = 'bl-stranger@test';
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'), (select v from fx where k='owner'),  'owner'),
  ((select v from fx where k='firm'), (select v from fx where k='lawyer'), 'lawyer');
insert into services (firm_id, slug, name, price_minor, currency, duration_min, requires_prepayment, is_active)
values ((select v from fx where k='firm'), 'first', 'First consultation', 5000000, 'NGN', 45, true, true);
insert into fx select 'svc', id from services where firm_id = (select v from fx where k='firm');

-- Two consultations whose time has passed: one written up, one never written up. And one missed.
insert into appointments (id, firm_id, reference, client_id, lawyer_id, service_id, mode, status, starts_at, ends_at, client_timezone, fee_minor, currency, created_at)
values (gen_random_uuid(), (select v from fx where k='firm'), 'BL-2026-000001', (select v from fx where k='client'), (select v from fx where k='lawyer'), (select v from fx where k='svc'),
        'virtual', 'completed', now() - interval '20 days', now() - interval '20 days' + interval '45 minutes', 'Africa/Lagos', 5000000, 'NGN', now() - interval '25 days');
insert into fx select 'appt_done', id from appointments where reference = 'BL-2026-000001';
insert into appointments (id, firm_id, reference, client_id, lawyer_id, service_id, mode, status, starts_at, ends_at, client_timezone, fee_minor, currency, created_at)
values (gen_random_uuid(), (select v from fx where k='firm'), 'BL-2026-000002', (select v from fx where k='client2'), (select v from fx where k='lawyer'), (select v from fx where k='svc'),
        'in_person', 'confirmed', now() - interval '10 days', now() - interval '10 days' + interval '45 minutes', 'Africa/Lagos', 5000000, 'NGN', now() - interval '12 days');
insert into fx select 'appt_unwritten', id from appointments where reference = 'BL-2026-000002';
insert into appointments (id, firm_id, reference, client_id, lawyer_id, service_id, mode, status, starts_at, ends_at, client_timezone, fee_minor, currency, created_at)
values (gen_random_uuid(), (select v from fx where k='firm'), 'BL-2026-000003', (select v from fx where k='client2'), (select v from fx where k='lawyer'), (select v from fx where k='svc'),
        'virtual', 'no_show', now() - interval '5 days', now() - interval '5 days' + interval '45 minutes', 'Africa/Lagos', 5000000, 'NGN', now() - interval '7 days');

-- The first one was invoiced and paid a day after it was booked.
insert into invoices (id, firm_id, number, client_id, appointment_id, currency, subtotal_minor, vat_minor, total_minor, paid_minor, status, issued_at, due_at)
values (gen_random_uuid(), (select v from fx where k='firm'), 'BL-INV-2026-000001', (select v from fx where k='client'), (select v from fx where k='appt_done'),
        'NGN', 5000000, 0, 5000000, 5000000, 'paid', now() - interval '25 days', (now() - interval '18 days')::date);
insert into fx select 'inv', id from invoices where number = 'BL-INV-2026-000001';
update appointments set invoice_id = (select v from fx where k='inv') where id = (select v from fx where k='appt_done');
insert into payments (invoice_id, provider, provider_ref, status, amount_minor, currency, paid_at)
values ((select v from fx where k='inv'), 'paystack', 'bl-ref-1', 'succeeded', 5000000, 'NGN', now() - interval '24 days');

-- The client of the written-up consultation became a matter three days later.
insert into matters (id, firm_id, reference, title, type, created_at, opened_at)
values (gen_random_uuid(), (select v from fx where k='firm'), 'BL-M-2026-000001', 'Okonkwo v Bello', 'litigation',
        now() - interval '17 days', (now() - interval '17 days')::date);
insert into fx select 'matter', id from matters where reference = 'BL-M-2026-000001';
insert into matter_parties (matter_id, firm_id, user_id, role) values
  ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');

-- Two sittings: one updated within the day, one never updated.
insert into updates (id, matter_id, firm_id, kind, visibility, title, posted_by, occurred_at, created_at)
values (gen_random_uuid(), (select v from fx where k='matter'), (select v from fx where k='firm'), 'court_sitting', 'client', 'Adjourned to a date to be fixed',
        (select v from fx where k='lawyer'), now() - interval '14 days', now() - interval '14 days' + interval '3 hours');
insert into fx select 'update', id from updates where title = 'Adjourned to a date to be fixed';
insert into court_events (matter_id, firm_id, scheduled_at, court_name, purpose, outcome_update_id)
values ((select v from fx where k='matter'), (select v from fx where k='firm'), now() - interval '14 days', 'High Court of Lagos State', 'Hearing', (select v from fx where k='update'));
insert into court_events (matter_id, firm_id, scheduled_at, court_name, purpose)
values ((select v from fx where k='matter'), (select v from fx where k='firm'), now() - interval '4 days', 'High Court of Lagos State', 'Mention');

-- One client message answered after two hours, one still waiting.
insert into messages (id, firm_id, matter_id, sender_id, body, created_at)
values (gen_random_uuid(), (select v from fx where k='firm'), (select v from fx where k='matter'), (select v from fx where k='client'), 'Any news?', now() - interval '9 days');
insert into messages (id, firm_id, matter_id, sender_id, body, created_at)
values (gen_random_uuid(), (select v from fx where k='firm'), (select v from fx where k='matter'), (select v from fx where k='lawyer'), 'The matter was adjourned.', now() - interval '9 days' + interval '2 hours');
insert into messages (id, firm_id, matter_id, sender_id, body, created_at)
values (gen_random_uuid(), (select v from fx where k='firm'), (select v from fx where k='matter'), (select v from fx where k='client'), 'And the next date?', now() - interval '2 days');

-- One document asked for and sent, one still outstanding.
insert into document_requests (firm_id, matter_id, title, requested_by, requested_at, fulfilled_at)
values ((select v from fx where k='firm'), (select v from fx where k='matter'), 'The tenancy agreement', (select v from fx where k='lawyer'), now() - interval '8 days', now() - interval '8 days' + interval '30 hours');
insert into document_requests (firm_id, matter_id, title, requested_by, requested_at)
values ((select v from fx where k='firm'), (select v from fx where k='matter'), 'Your identification', (select v from fx where k='lawyer'), now() - interval '3 days');

-- ---------------------------------------------------------------- 1. every figure is a row this file wrote
do $$
declare l uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm');
        wf timestamptz := (select wfrom from win); wt timestamptz := (select wto from win); m jsonb;
begin
  perform t_as(l);
  m := firm_metrics(f, wf, wt);
  perform t_check('three bookings were made in the window, one of them paid, a day after booking',
    (m -> 'bookings' ->> 'made')::int = 3 and (m -> 'bookings' ->> 'paid')::int = 1
    and (m -> 'bookings' ->> 'median_hours_to_pay')::numeric between 23 and 25);
  perform t_check('attendance separates attended, missed and never written up',
    (m -> 'attendance' ->> 'past')::int = 3 and (m -> 'attendance' ->> 'attended')::int = 1
    and (m -> 'attendance' ->> 'missed')::int = 1 and (m -> 'attendance' ->> 'unrecorded')::int = 1);
  perform t_check('and says so in words, rather than folding it into either',
    exists (select 1 from jsonb_array_elements_text(m -> 'caveats') c where c like '%neither marked completed nor a no-show%'));
  perform t_check('a consultation followed by a matter is counted, and named an inference',
    (m -> 'consultation_to_matter' ->> 'consultations')::int = 1
    and (m -> 'consultation_to_matter' ->> 'followed_by_a_matter')::int = 1
    and (m -> 'consultation_to_matter' ->> 'median_days')::numeric between 2.5 and 3.5
    and exists (select 1 from jsonb_array_elements_text(m -> 'caveats') c where c like '%It is an inference, not a record.%'));
  perform t_check('two sittings, one updated, and that one within the day',
    (m -> 'sittings' ->> 'sat')::int = 2 and (m -> 'sittings' ->> 'with_an_update')::int = 1
    and (m -> 'sittings' ->> 'updated_within_24h')::int = 1
    and (m -> 'sittings' ->> 'median_hours_to_update')::numeric between 2.5 and 3.5);
  perform t_check('two messages from the client, one answered in two hours, one still waiting',
    (m -> 'replies' ->> 'messages_from_clients')::int = 2 and (m -> 'replies' ->> 'answered')::int = 1
    and (m -> 'replies' ->> 'median_hours_to_first_reply')::numeric between 1.5 and 2.5
    and (m -> 'replies' ->> 'still_unanswered')::int = 1
    and (m -> 'replies' ->> 'oldest_unanswered_hours')::numeric between 46 and 50);
  perform t_check('two documents asked for, one sent, after thirty hours',
    (m -> 'document_requests' ->> 'asked')::int = 2 and (m -> 'document_requests' ->> 'answered')::int = 1
    and (m -> 'document_requests' ->> 'median_hours_to_answer')::numeric between 29 and 31);
  perform t_check('money is per currency and never one total',
    (m -> 'money' -> 'invoiced' ->> 'NGN')::bigint = 5000000 and (m -> 'money' -> 'collected' ->> 'NGN')::bigint = 5000000
    and jsonb_typeof(m -> 'money' -> 'invoiced') = 'object'
    and (m -> 'money' ->> 'median_days_to_collect')::numeric between 0.5 and 1.5);
  perform t_check('the work as it stands, and what the client was told in the window',
    (m -> 'work' ->> 'open_matters')::int = 1 and (m -> 'work' ->> 'matters_opened_in_window')::int = 1
    and (m -> 'work' ->> 'client_updates_posted')::int = 1);
  perform t_check('a client who sent a message is active; the firm''s own people are not counted',
    (m -> 'clients' ->> 'active_in_window')::int = 1);
  perform t_check('the funnel is disclaimed rather than relied on',
    exists (select 1 from jsonb_array_elements_text(m -> 'caveats') c where c like '%PostHog funnel is not part of it%'));
  perform t_check('the window it answered for is part of the answer',
    (m ->> 'window_from')::timestamptz = wf and (m ->> 'window_to')::timestamptz = wt);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 1b. an invoice paid in two parts is one paid booking
do $$
declare l uuid := (select v from fx where k='lawyer'); cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm');
        a uuid := gen_random_uuid(); inv uuid := gen_random_uuid();
        wf timestamptz := (select wfrom from win); wt timestamptz := (select wto from win); m jsonb;
begin
  perform t_reset();
  insert into appointments (id, firm_id, reference, client_id, lawyer_id, service_id, mode, status, starts_at, ends_at, client_timezone, fee_minor, currency, created_at)
  values (a, f, 'BL-2026-000004', cl, l, (select v from fx where k='svc'), 'in_person', 'completed',
          now() - interval '6 days', now() - interval '6 days' + interval '45 minutes', 'Africa/Lagos', 5000000, 'NGN', now() - interval '8 days');
  insert into invoices (id, firm_id, number, client_id, appointment_id, currency, subtotal_minor, vat_minor, total_minor, paid_minor, status, issued_at, due_at)
  values (inv, f, 'BL-INV-2026-000004', cl, a, 'NGN', 5000000, 0, 5000000, 5000000, 'paid', now() - interval '8 days', (now() - interval '1 day')::date);
  update appointments set invoice_id = inv where id = a;
  -- Half on the day it was booked, the rest four days later. The fee was paid when the second
  -- part landed, not the first.
  insert into payments (invoice_id, provider, provider_ref, status, amount_minor, currency, paid_at) values
    (inv, 'paystack', 'bl-ref-part-1', 'succeeded', 2500000, 'NGN', now() - interval '8 days'),
    (inv, 'paystack', 'bl-ref-part-2', 'succeeded', 2500000, 'NGN', now() - interval '4 days');
  perform t_as(l);
  m := firm_metrics(f, wf, wt);
  perform t_check('two successful payments on one invoice are one paid booking, not two',
    (m -> 'bookings' ->> 'made')::int = 4 and (m -> 'bookings' ->> 'paid')::int = 2);
  perform t_check('and the clock stops at the payment that settled it, not the first part',
    (m -> 'bookings' ->> 'median_hours_to_pay')::numeric between 60 and 60 + 25);
  perform t_reset();
  delete from payments where invoice_id = inv;
  delete from invoices where id = inv;
  delete from appointments where id = a;
end $$;

-- ---------------------------------------------------------------- 2. one firm's numbers, and nobody else's
do $$
declare l uuid := (select v from fx where k='lawyer'); cl uuid := (select v from fx where k='client'); st uuid := (select v from fx where k='stranger');
        f uuid := (select v from fx where k='firm'); o uuid := (select v from fx where k='other');
        wf timestamptz := (select wfrom from win); wt timestamptz := (select wto from win);
begin
  perform t_as(st, 'aal1');
  perform t_check('a stranger computes nothing', t_refused(format('select firm_metrics(%L, %L, %L)', f, wf, wt), '42501'));
  perform t_reset(); perform t_as(cl, 'aal1');
  perform t_check('nor does a client of the firm', t_refused(format('select firm_metrics(%L, %L, %L)', f, wf, wt), '42501'));
  perform t_reset(); perform t_as(l);
  perform t_check('nor a member, for another firm', t_refused(format('select firm_metrics(%L, %L, %L)', o, wf, wt), '42501'));
  perform t_check('a window must be a window', t_fails(format('select firm_metrics(%L, %L, %L)', f, wt, wf), 'give a window'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. the record is a record
do $$
declare ow uuid := (select v from fx where k='owner'); l uuid := (select v from fx where k='lawyer'); cl uuid := (select v from fx where k='client');
        f uuid := (select v from fx where k='firm'); wf timestamptz := (select wfrom from win); wt timestamptz := (select wto from win); b uuid;
begin
  perform t_reset(); perform t_as(l);
  perform t_check('a lawyer does not take the baseline', t_refused(format('select record_firm_baseline(%L, %L, %L)', f, wf, wt), '42501'));
  perform t_reset(); perform t_as(ow, 'aal1');
  perform t_check('nor an owner without a second factor', t_refused(format('select record_firm_baseline(%L, %L, %L)', f, wf, wt), '42501'));
  perform t_reset(); perform t_as(ow);
  perform t_check('a figure the firm states is short text, not a number Docket computed',
    t_fails(format('select record_firm_baseline(%L, %L, %L, null, ''{"calls_a_day": 12}'')', f, wf, wt), 'text of at most 500'));
  b := record_firm_baseline(f, wf, wt, 'Before the pilot.', '{"chasing_court_dates": "About four hours a week, the partners estimate."}'::jsonb);
  perform t_check('the record holds the window, the metrics as computed, and who took it',
    (select window_from = wf and window_to = wt and taken_by = ow and note = 'Before the pilot.'
        and (metrics -> 'bookings' ->> 'made')::int = 3 from firm_baselines where id = b));
  perform t_check('what the firm says is kept apart from what Docket computed',
    (select stated ->> 'chasing_court_dates' like 'About four hours%' and not (metrics ? 'chasing_court_dates') from firm_baselines where id = b));
  perform t_check('taking it is audited', (t_audit('baseline.recorded', f) -> 'meta' ->> 'baseline_id')::uuid = b);
  perform t_check('every member reads it, and the API cannot write one by hand',
    t_refused(format('insert into firm_baselines (firm_id, window_from, window_to, metrics) values (%L, %L, %L, ''{}'')', f, wf, wt), '42501'));
  perform t_check('nor edit or delete the one that is there',
    t_refused(format('update firm_baselines set note = ''better'' where id = %L', b), '42501')
    and t_refused(format('delete from firm_baselines where id = %L', b), '42501'));
  perform t_reset(); perform t_as(l);
  perform t_check('a lawyer of the firm reads it', exists (select 1 from firm_baselines where id = b));
  perform t_reset(); perform t_as(cl, 'aal1');
  perform t_check('a client sees no baseline at all', not exists (select 1 from firm_baselines where id = b));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. the same window twice is the same answer
do $$
declare l uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm');
        wf timestamptz := (select wfrom from win); wt timestamptz := (select wto from win); a jsonb; b jsonb;
begin
  perform t_as(l);
  a := firm_metrics(f, wf, wt); b := firm_metrics(f, wf, wt);
  perform t_check('a fixed window recomputes identically, but for the moment it was asked',
    (a - 'computed_at') = (b - 'computed_at'));
  perform t_check('an empty firm answers zeroes rather than nothing',
    (firm_metrics((select v from fx where k='firm'), now() - interval '400 days', now() - interval '370 days') -> 'bookings' ->> 'made')::int = 0);
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
