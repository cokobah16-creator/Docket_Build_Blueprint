-- Docket v0.2 — RLS isolation and flow tests. Runs inside one transaction and rolls back.
-- psql -v ON_ERROR_STOP=1 -f tests/00_local_auth_stub.sql -f migrations/*.sql -f seed.sql -f tests/10_rls_isolation.sql
begin;

create function t_as(u uuid, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', aal)::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create function t_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  perform set_config('role', 'anon', false);
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

-- ---------------------------------------------------------------- fixture (as postgres)
create temp table fx (k text primary key, v uuid);
grant select on fx to anon, authenticated;
insert into firms (slug, name, reference_prefix) values ('firm-a', 'Firm A', 'FA'), ('firm-b', 'Firm B', 'FB');
insert into fx select 'firm_a', id from firms where slug = 'firm-a';
insert into fx select 'firm_b', id from firms where slug = 'firm-b';

insert into auth.users (id, email) values
  (gen_random_uuid(), 'lawyer_a@test'), (gen_random_uuid(), 'admin_a@test'), (gen_random_uuid(), 'client_a1@test'),
  (gen_random_uuid(), 'client_a2@test'), (gen_random_uuid(), 'lawyer_b@test'), (gen_random_uuid(), 'client_b1@test');
insert into fx select split_part(email, '@', 1), id from auth.users where email like '%@test';

insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm_a'), (select v from fx where k='lawyer_a'), 'lawyer'),
  ((select v from fx where k='firm_a'), (select v from fx where k='admin_a'),  'admin'),
  ((select v from fx where k='firm_b'), (select v from fx where k='lawyer_b'), 'lawyer');

insert into matter_statuses (firm_id, key, label) values ((select v from fx where k='firm_a'), 'open', 'Open');

insert into services (firm_id, slug, name, price_minor, currency, duration_min) values
  ((select v from fx where k='firm_a'), 'consult', 'Consultation', 5000000, 'NGN', 45),
  ((select v from fx where k='firm_b'), 'consult', 'Consultation', 4000000, 'NGN', 45);
insert into fx select 'svc_a', id from services where firm_id = (select v from fx where k='firm_a');

-- lawyer A works 09:00–17:00 with a lunch break on the test date's weekday
insert into availability_rules (firm_id, lawyer_id, weekday, start_time, end_time, break_start, break_end, slot_min, max_per_day)
values ((select v from fx where k='firm_a'), (select v from fx where k='lawyer_a'),
        extract(dow from current_date + 7)::int, '09:00', '17:00', '13:00', '14:00', 45, 6);

insert into matters (id, firm_id, reference, title, type, court_name)
values (gen_random_uuid(), (select v from fx where k='firm_a'), 'FA-M-2026-000001', 'A v B', 'litigation', 'High Court of the FCT, Maitama');
insert into fx select 'matter_a', id from matters where reference = 'FA-M-2026-000001';
insert into matters (id, firm_id, reference, title, type)
values (gen_random_uuid(), (select v from fx where k='firm_b'), 'FB-M-2026-000001', 'C v D', 'property');
insert into fx select 'matter_b', id from matters where reference = 'FB-M-2026-000001';

insert into matter_parties (matter_id, firm_id, user_id, role) values
  ((select v from fx where k='matter_a'), (select v from fx where k='firm_a'), (select v from fx where k='client_a1'), 'client'),
  ((select v from fx where k='matter_b'), (select v from fx where k='firm_b'), (select v from fx where k='client_b1'), 'client');
insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values
  ((select v from fx where k='matter_a'), (select v from fx where k='firm_a'), (select v from fx where k='lawyer_a'), true);

insert into updates (matter_id, firm_id, kind, visibility, title, posted_by) values
  ((select v from fx where k='matter_a'), (select v from fx where k='firm_a'), 'note', 'client',   'Client-visible note', (select v from fx where k='lawyer_a')),
  ((select v from fx where k='matter_a'), (select v from fx where k='firm_a'), 'note', 'internal', 'Internal note',       (select v from fx where k='lawyer_a'));

insert into documents (firm_id, matter_id, name, client_visible, uploaded_by) values
  ((select v from fx where k='firm_a'), (select v from fx where k='matter_a'), 'Statement of claim.pdf', true,  (select v from fx where k='lawyer_a')),
  ((select v from fx where k='firm_a'), (select v from fx where k='matter_a'), 'Strategy memo.docx',     false, (select v from fx where k='lawyer_a'));

insert into invoices (firm_id, number, client_id, matter_id, currency, subtotal_minor, total_minor, status, issued_at)
values ((select v from fx where k='firm_a'), next_reference((select v from fx where k='firm_a'), 'invoice'), (select v from fx where k='client_a1'),
        (select v from fx where k='matter_a'), 'NGN', 10000000, 10000000, 'issued', now());

-- ---------------------------------------------------------------- 1. client isolation
do $$
declare a1 uuid := (select v from fx where k='client_a1'); a2 uuid := (select v from fx where k='client_a2'); b1 uuid := (select v from fx where k='client_b1');
begin
  perform t_as(a1, 'aal1');
  perform t_check('client A1 sees exactly her matter',            (select count(*) from matters) = 1);
  perform t_check('client A1 sees only client-visible updates',   (select count(*) from updates) = 1 and (select visibility from updates limit 1) = 'client');
  perform t_check('client A1 sees only client-visible documents', (select count(*) from documents) = 1);
  perform t_check('client A1 sees her invoice',                   (select count(*) from invoices) = 1);
  perform t_check('client A1 sees active services of every firm', (select count(*) from services) >= 2 and not exists (select 1 from services where not is_active));
  perform t_check('client A1 cannot read the firms table',        (select count(*) from firms) = 0);
  perform t_reset();

  perform t_as(a2, 'aal1');
  perform t_check('client A2 (no matter) sees nothing',           (select count(*) from matters) + (select count(*) from updates)
                                                                  + (select count(*) from documents) + (select count(*) from invoices) = 0);
  perform t_reset();

  perform t_as(b1, 'aal1');
  perform t_check('client B1 sees only firm B matter',            (select count(*) from matters) = 1 and (select reference from matters) = 'FB-M-2026-000001');
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. staff isolation and MFA gating
do $$
declare la uuid := (select v from fx where k='lawyer_a'); lb uuid := (select v from fx where k='lawyer_b'); ma uuid := (select v from fx where k='matter_a');
        fa uuid := (select v from fx where k='firm_a'); ok bool;
begin
  perform t_as(lb);
  perform t_check('lawyer B sees only firm B matters',            (select count(*) from matters) = 1 and (select reference from matters) = 'FB-M-2026-000001');
  perform t_check('lawyer B sees no firm A updates',              (select count(*) from updates) = 0);
  ok := false;
  begin
    insert into updates (matter_id, firm_id, kind, title, posted_by) values (ma, fa, 'note', 'cross-tenant write', lb);
  exception when insufficient_privilege or check_violation then ok := true;
  end;
  perform t_check('lawyer B cannot write into firm A',            ok);
  perform t_reset();

  perform t_as(la, 'aal1');
  perform t_check('lawyer A (no MFA) can read firm A',            (select count(*) from matters) = 1 and (select count(*) from updates) = 2);
  ok := false;
  begin
    insert into updates (matter_id, firm_id, kind, title, posted_by) values (ma, fa, 'note', 'write without MFA', la);
  exception when insufficient_privilege or check_violation then ok := true;
  end;
  perform t_check('lawyer A without MFA cannot write',            ok);
  perform t_reset();

  perform t_as(la, 'aal2');
  insert into updates (matter_id, firm_id, kind, title, posted_by) values (ma, fa, 'note', 'write with MFA', la);
  perform t_check('lawyer A with MFA can write',                  (select count(*) from updates where title = 'write with MFA') = 1);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. anonymous surface
do $$
declare fa uuid := (select v from fx where k='firm_a'); la uuid := (select v from fx where k='lawyer_a'); sa uuid := (select v from fx where k='svc_a');
begin
  perform t_anon();
  perform t_check('anon reads the public firm projection',        (select count(*) from firm_public) >= 2);
  perform t_check('anon reads active services',                   (select count(*) from services) >= 2);
  perform t_check('anon sees no matters or appointments',         (select count(*) from matters) + (select count(*) from appointments) = 0);
  perform t_check('anon can compute booking slots',               (select count(*) from available_slots(fa, la, sa, current_date + 7)) > 0);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. booking, double-booking, payment cascade
do $$
declare fa uuid := (select v from fx where k='firm_a'); la uuid := (select v from fx where k='lawyer_a'); sa uuid := (select v from fx where k='svc_a');
        a1 uuid := (select v from fx where k='client_a1'); a2 uuid := (select v from fx where k='client_a2');
        slot timestamptz; res jsonb; res2 jsonb; ok bool; n_slots int;
begin
  perform t_as(a1, 'aal1');
  select count(*) into n_slots from available_slots(fa, la, sa, current_date + 7);
  perform t_check('slots exclude the lunch break (8 hours, 45-min slots, 1-hour break)', n_slots between 8 and 10);
  select s.starts_at into slot from available_slots(fa, la, sa, current_date + 7) s order by 1 limit 1;
  res := book_appointment(fa, sa, la, slot, 'virtual', 'America/New_York', '{"issue_summary":"land dispute"}'::jsonb, null);
  perform t_check('booking creates a held appointment awaiting payment', res ->> 'status' = 'awaiting_payment' and res ->> 'invoice_number' like 'FA-INV-%');
  perform t_check('booking reference follows the firm prefix',           res ->> 'reference' like 'FA-2026-%' or res ->> 'reference' like 'FA-20%');
  perform t_check('held slot disappears from availability',              not exists (select 1 from available_slots(fa, la, sa, current_date + 7) s where s.starts_at = slot));
  perform t_check('client sees her own appointment',                     (select count(*) from appointments) = 1);
  perform t_check('intake answers were stored',                          (select count(*) from intake_responses) = 1);
  perform t_reset();

  perform t_as(a2, 'aal1');
  ok := false;
  begin
    res2 := book_appointment(fa, sa, la, slot);
  exception when others then ok := sqlerrm like '%slot unavailable%';
  end;
  perform t_check('second client cannot take the same slot',             ok);
  perform t_check('other client sees no appointments',                   (select count(*) from appointments) = 0);
  ok := false;
  begin
    perform cancel_appointment((res ->> 'appointment_id')::uuid, 'nope');
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('other client cannot cancel someone else''s appointment', ok);
  perform t_reset();

  -- webhook path (service role / postgres)
  res2 := record_payment('paystack', 'PSK-REF-1', res ->> 'invoice_number', (res ->> 'amount_minor')::bigint, 'NGN', 'succeeded', '{"channel":"card"}'::jsonb);
  perform t_check('payment marks the invoice paid',                      res2 ->> 'invoice_status' = 'paid');
  perform t_check('payment confirms the appointment',                    (select status from appointments where id = (res ->> 'appointment_id')::uuid) = 'confirmed');
  res2 := record_payment('paystack', 'PSK-REF-1', res ->> 'invoice_number', (res ->> 'amount_minor')::bigint, 'NGN', 'succeeded', '{}'::jsonb);
  perform t_check('duplicate webhook is ignored',                        (res2 ->> 'duplicate')::bool and (select paid_minor from invoices where number = res ->> 'invoice_number') = (res ->> 'amount_minor')::bigint);
  perform t_check('client was told: confirmed + payment',                (select count(*) from notifications where user_id = a1 and event in ('appointment_confirmed','payment_confirmed') and channel = 'in_app') = 2);

  perform t_as(a1, 'aal1');
  perform t_check('client reads her payment through the invoice',        (select count(*) from payments) = 1);
  perform t_reset();
  perform t_as((select v from fx where k='lawyer_b'));
  perform t_check('lawyer B sees no firm A payments or appointments',    (select count(*) from payments) + (select count(*) from appointments) = 0);
  perform t_reset();

  insert into fx values ('appt_a1', (res ->> 'appointment_id')::uuid);
end $$;

-- ---------------------------------------------------------------- 5. court update, consultation notes, audit
do $$
declare la uuid := (select v from fx where k='lawyer_a'); ma uuid := (select v from fx where k='matter_a'); a1 uuid := (select v from fx where k='client_a1');
        ad uuid := (select v from fx where k='admin_a'); ap uuid := (select v from fx where k='appt_a1'); upd uuid; ok bool;
begin
  perform t_as(la, 'aal2');
  upd := post_court_update(ma, 'adjourned', now(), null, 'the defendant', now() + interval '21 days', 'hearing',
                           'Court adjourned at the defendant''s request. Nothing needed from you.', 'Opposing counsel absent again — consider costs.');
  perform t_check('court update posted with composed title',             (select title from updates where id = upd) like 'Adjourned at the instance of the defendant to % for hearing');
  perform t_check('next court event created',                            (select count(*) from court_events where matter_id = ma and outcome_update_id is null) = 1);
  perform t_check('matter next date updated',                            (select next_event_at from matters where id = ma) is not null);
  perform t_check('lawyer sees the internal note',                       (select count(*) from updates where matter_id = ma and visibility = 'internal') = 2);
  -- reschedule (slice 2): re-validated through the booking engine, reminders reset, client notified
  declare slot2 timestamptz; r jsonb;
  begin
    select s.starts_at into slot2 from available_slots((select v from fx where k='firm_a'), la, (select service_id from appointments where id = ap), current_date + 14, ap) s order by 1 limit 1;
    update appointments set reminders_sent = '{24h}' where id = ap;
    r := reschedule_appointment(ap, slot2, 'court clash');
    perform t_check('appointment rescheduled to a valid slot',              (select status from appointments where id = ap) = 'rescheduled' and (select starts_at from appointments where id = ap) = slot2);
    perform t_check('reschedule resets reminders',                          (select reminders_sent from appointments where id = ap) = '{}');
    ok := false;
    begin
      perform reschedule_appointment(ap, slot2 + interval '7 minutes');
    exception when others then ok := sqlerrm like '%not available%';
    end;
    perform t_check('reschedule refuses a time the engine would not offer', ok);
  end;
  perform save_consultation_notes(ap, 'We discussed your land dispute.', 'Obtain a certified true copy of the survey plan.', 'Send documents within 7 days.', 'Client seems to have a weak chain of title.');
  perform t_check('lawyer reads internal consultation notes',            (select count(*) from consultation_internal_notes) = 1);
  perform t_reset();

  perform t_as(a1, 'aal1');
  perform t_check('client sees the court update',                        (select count(*) from updates where id = upd) = 1);
  perform t_check('client never sees internal notes',                    (select count(*) from updates where visibility = 'internal') = 0);
  perform t_check('client sees her next court date',                     (select count(*) from court_events) = 1);
  perform t_check('client was notified of the update',                   (select count(*) from notifications where event = 'matter_update' and channel = 'in_app' and (payload ->> 'update_id')::uuid = upd) = 1);
  perform t_check('client was told about the reschedule',                (select count(*) from notifications where event = 'appointment_rescheduled' and channel = 'in_app') = 1);
  perform t_check('client reads the consultation summary',               (select count(*) from consultation_notes) = 1);
  perform t_check('client cannot read internal consultation notes',      (select count(*) from consultation_internal_notes) = 0);
  perform t_check('appointment marked completed after notes',            (select status from appointments where id = ap) = 'completed');
  perform t_check('client cannot read the audit log',                    (select count(*) from audit_log) = 0);
  ok := false;
  begin
    update audit_log set action = 'tampered';
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('audit log is append-only for users',                  ok);
  perform t_reset();

  perform t_as(la, 'aal2');
  perform t_check('a plain lawyer cannot read the audit log',            (select count(*) from audit_log) = 0);
  perform t_reset();
  perform t_as(ad, 'aal2');
  perform t_check('reschedule is audited',                                (select count(*) from audit_log where action = 'appointment.rescheduled' and entity_id = ap) = 1);
  perform t_check('firm admin reads firm A audit trail',                 (select count(*) from audit_log) > 5 and (select count(*) from audit_log where firm_id <> (select v from fx where k='firm_a')) = 0);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 6. jobs
do $$
declare n int;
begin
  update appointments set status = 'awaiting_payment', hold_expires_at = now() - interval '1 minute' where reference like 'FA-%' and status = 'completed';
  n := release_expired_holds();
  perform t_check('expired holds are released by the job',               n = 1 and (select count(*) from appointments where cancellation_reason = 'payment_timeout') = 1);
  n := enqueue_court_reminders();
  perform t_check('court reminder job runs (nothing due yet)',           n = 0);
end $$;

-- ---------------------------------------------------------------- 7. client portal (slice 3)
insert into matter_parties (matter_id, firm_id, user_id, role) values
  ((select v from fx where k='matter_a'), (select v from fx where k='firm_a'), (select v from fx where k='client_a2'), 'contact'),
  ((select v from fx where k='matter_b'), (select v from fx where k='firm_b'), (select v from fx where k='client_a2'), 'client');
do $$
declare a2 uuid := (select v from fx where k='client_a2'); la uuid := (select v from fx where k='lawyer_a');
        ma uuid := (select v from fx where k='matter_a'); fa uuid := (select v from fx where k='firm_a');
        d uuid; v uuid := gen_random_uuid(); ok bool; msg uuid; qs time; qe time;
begin
  perform t_as(a2, 'aal1');
  perform t_check('two-firm client sees both matters in one feed',        (select count(*) from matters) = 2 and (select count(distinct firm_id) from matters) = 2);
  perform t_check('two-firm client sees only client-visible updates',     (select count(*) from updates) = (select count(*) from updates where visibility = 'client'));
  perform t_check('two-firm client sees both firms'' status labels',      (select count(distinct firm_id) from matter_statuses) >= 1);
  perform t_check('two-firm client sees the court date',                  (select count(*) from court_events) = 1);
  perform t_check('two-firm client cannot see internal documents',        (select count(*) from documents where not client_visible) = 0);

  -- client upload: documents row, then a version; the trigger points current_version_id at it
  -- no RETURNING: the select policy's stable helper cannot see a row inserted by the same statement,
  -- so the app generates the id first and inserts with return=minimal (same here)
  d := gen_random_uuid();
  insert into documents (id, firm_id, matter_id, name, client_visible, uploaded_by, category)
  values (d, fa, ma, 'Survey plan.pdf', true, a2, 'client_upload');
  insert into document_versions (id, document_id, storage_path, mime, size_bytes, uploaded_by)
  values (v, d, 'documents/' || fa || '/' || d || '/' || v || '.pdf', 'application/pdf', 2048000, a2);
  perform t_check('client upload becomes the current version',            (select current_version_id from documents where id = d) = v);
  ok := false;
  begin
    insert into documents (firm_id, matter_id, name, client_visible, uploaded_by) values (fa, ma, 'Sneaky.pdf', false, a2);
  exception when insufficient_privilege or check_violation then ok := true;
  end;
  perform t_check('client cannot create a hidden document',               ok);

  -- message from the client; read receipt by the client on the lawyer's reply
  insert into messages (firm_id, matter_id, sender_id, body) values (fa, ma, a2, 'When is the next hearing?') returning id into msg;
  perform t_reset();
  perform t_as(la, 'aal2');
  perform t_check('lawyer was notified of the client message',            (select count(*) from notifications where event = 'new_message' and channel = 'in_app' and (payload ->> 'message_id')::uuid = msg) = 1);
  insert into messages (firm_id, matter_id, sender_id, body) values (fa, ma, la, 'Next week Tuesday.');
  perform t_reset();
  perform t_as(a2, 'aal1');
  update messages set read_at = now() where matter_id = ma and sender_id <> a2 and read_at is null;
  perform t_check('client marks the reply read',                          (select count(*) from messages where matter_id = ma and sender_id = la and read_at is not null) = 1);
  perform t_check('client cannot mark her own message read for others',   (select count(*) from messages where id = msg and read_at is null) = 1);

  -- quiet hours: a client-visible update during quiet hours defers push/email but not in-app
  qs := ((now() at time zone 'Africa/Lagos')::time - interval '1 hour');
  qe := ((now() at time zone 'Africa/Lagos')::time + interval '1 hour');
  update profiles set quiet_hours_start = qs, quiet_hours_end = qe, email = 'a2@example.com' where id = a2;
  perform t_reset();
  perform t_as(la, 'aal2');
  insert into updates (matter_id, firm_id, kind, visibility, title, posted_by) values (ma, fa, 'note', 'client', 'Quiet-hours note', la);
  perform t_reset();
  perform t_as(a2, 'aal1');
  perform t_check('quiet hours defer push until they end',                (select min(send_after) from notifications where user_id = a2 and event = 'matter_update' and channel = 'push' and (payload ->> 'title') = 'Quiet-hours note') > now() + interval '30 minutes');
  perform t_check('quiet hours never delay in-app',                       (select count(*) from notifications where user_id = a2 and event = 'matter_update' and channel = 'in_app' and (payload ->> 'title') = 'Quiet-hours note' and status = 'sent') = 1);
  update notifications set read_at = now() where user_id = a2 and channel = 'in_app' and read_at is null;
  perform t_check('client marks her in-app notifications read',           (select count(*) from notifications where user_id = a2 and channel = 'in_app' and read_at is null) = 0);
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
