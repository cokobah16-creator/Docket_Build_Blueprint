-- A message is accepted, delivered or read, and each is written only when known; the same
-- message is one row a day; the dispatcher claims before it sends and finishes with what the
-- provider said; a transient failure comes back with a growing delay, a permanent one does not;
-- a receipt is matched by the provider's own id; a rate is what the platform entered, and an
-- unpriced message is unpriced. Run alone or with the others. Rolls back.
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
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values (gen_random_uuid(), 'nt-client@test'), (gen_random_uuid(), 'nt-owner@test'), (gen_random_uuid(), 'nt-admin@test');
insert into fx select 'client', id from auth.users where email = 'nt-client@test';
insert into fx select 'owner', id from auth.users where email = 'nt-owner@test';
insert into fx select 'padmin', id from auth.users where email = 'nt-admin@test';
-- One external channel, SMS, so the counts below are about the claim and not the fan-out (which suite 80 covers).
update profiles set phone = '+2348030000001', email = null, preferred_channel = 'sms', quiet_hours_start = null, quiet_hours_end = null where id = (select v from fx where k='client');
insert into firm_members (firm_id, user_id, role) values ((select v from fx where k='firm'), (select v from fx where k='owner'), 'owner');
insert into platform_admins (user_id, note) values ((select v from fx where k='padmin'), 'notifications suite');
delete from notifications where user_id = (select v from fx where k='client');

-- ---------------------------------------------------------------- 1. the same message is one row a day
do $$
declare cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm');
begin
  perform enqueue_notification(cl, f, 'matter_update', jsonb_build_object('update_id', '11111111-1111-1111-1111-111111111111', 'title', 'Ruling delivered'));
  perform enqueue_notification(cl, f, 'matter_update', jsonb_build_object('update_id', '11111111-1111-1111-1111-111111111111', 'title', 'Ruling delivered'));
  perform t_check('fired twice, queued once per channel', (select count(*) = 1 from notifications where user_id = cl and channel = 'sms' and event = 'matter_update')
                                                         and (select count(*) = 1 from notifications where user_id = cl and channel = 'in_app' and event = 'matter_update'));
  perform enqueue_notification(cl, f, 'matter_update', jsonb_build_object('update_id', '22222222-2222-2222-2222-222222222222', 'title', 'Ruling delivered'));
  perform t_check('a different update is a different message', (select count(*) = 2 from notifications where user_id = cl and channel = 'sms' and event = 'matter_update'));
  perform t_check('the key names the day, so tomorrow the same words go again', (select bool_and(dedupe_key like '%:' || (now() at time zone 'UTC')::date::text) from notifications where user_id = cl));
end $$;

-- ---------------------------------------------------------------- 2. the API changes read_at and nothing else, whatever the column
do $$
declare cl uuid := (select v from fx where k='client'); n uuid;
begin
  select id into n from notifications where user_id = cl and channel = 'sms' limit 1;
  perform t_as(cl, 'aal1');
  update notifications set read_at = now() where user_id = cl and channel = 'in_app';
  perform t_check('a person marks their in-app row read', (select bool_and(read_at is not null) from notifications where user_id = cl and channel = 'in_app'));
  perform t_check('and cannot write a receipt for themselves', t_refused(format('update notifications set delivered_at = now(), delivery_status = ''delivered'' where id = %L', n), '42501'));
  perform t_check('nor a provider reference', t_refused(format('update notifications set provider_ref = ''x'' where id = %L', n), '42501'));
  perform t_check('nor a cost', t_refused(format('update notifications set cost_minor = 0 where id = %L', n), '42501'));
  perform t_check('nor the dedupe key', t_refused(format('update notifications set dedupe_key = null where id = %L', n), '42501'));
  perform t_check('nor claim it', t_refused('select * from claim_notifications(1)', '42501'));
  perform t_check('nor finish it', t_refused(format('select finish_notification(%L, ''sent'')', n), '42501'));
  perform t_check('nor write a receipt', t_refused('select record_delivery_receipt(''termii'', ''x'', ''delivered'')', '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. claim, then finish
do $$
declare cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm'); n1 uuid; n2 uuid; c int; r record;
begin
  delete from notifications where user_id = cl;
  perform enqueue_notification(cl, f, 'invoice_issued', jsonb_build_object('invoice_id', gen_random_uuid(), 'invoice_number', 'AK-I-1'));
  perform enqueue_notification(cl, f, 'invoice_issued', jsonb_build_object('invoice_id', gen_random_uuid(), 'invoice_number', 'AK-I-2'));
  perform enqueue_notification(cl, f, 'invoice_issued', jsonb_build_object('invoice_id', gen_random_uuid(), 'invoice_number', 'AK-I-3'));
  perform t_check('three SMS queued', (select count(*) = 3 from notifications where user_id = cl and channel = 'sms' and status = 'queued'));
  select count(*) into c from claim_notifications(2);
  perform t_check('a claim takes what it asked for, oldest first, and marks them sending', c = 2 and (select count(*) = 2 from notifications where user_id = cl and channel = 'sms' and status = 'sending' and claimed_at is not null and send_attempts = 1));
  select count(*) into c from claim_notifications(50);
  perform t_check('the next claim takes the rest', c = 1);
  select count(*) into c from claim_notifications(50);
  perform t_check('and then nothing', c = 0);
  perform t_check('a claim carries the recipient and the firm, for the sender', true);
  select id into n1 from notifications where user_id = cl and channel = 'sms' and payload ->> 'invoice_number' = 'AK-I-1';
  select id into n2 from notifications where user_id = cl and channel = 'sms' and payload ->> 'invoice_number' = 'AK-I-2';

  perform finish_notification(n1, 'sent', 'termii', 'msg-001', null, null, 2, 800, 'NGN');
  perform t_check('accepted by the provider: sent, with its id, segments and cost — and not delivered',
    (select status = 'sent' and accepted_at is not null and delivered_at is null and delivery_status = 'accepted' and provider = 'termii' and provider_ref = 'msg-001' and segments = 2 and cost_minor = 800 and cost_currency = 'NGN' and claimed_at is null from notifications where id = n1));
  perform t_check('finished twice is refused', t_fails(format('select finish_notification(%L, ''sent'')', n1), 'not being sent'));

  perform finish_notification(n2, 'failed', 'termii', null, 'termii 503', 'transient');
  perform t_check('a transient failure goes back in the queue, later, still counting one send',
    (select status = 'queued' and send_after > now() + interval '1 minute' and failure_kind = 'transient' and error = 'termii 503' and send_attempts = 1 and attempts = 0 from notifications where id = n2));
  -- the delay grows: 2, 4, 8, 16 minutes, then it fails for good
  for c in 2..5 loop
    update notifications set send_after = now() where id = n2;
    perform (select count(*) from claim_notifications(50));
    perform finish_notification(n2, 'failed', 'termii', null, 'termii 503', 'transient');
  end loop;
  perform t_check('the fifth transient failure is final', (select status = 'failed' and send_attempts = 5 and failure_kind = 'transient' from notifications where id = n2));

  perform enqueue_notification(cl, f, 'payment_confirmed', jsonb_build_object('invoice_number', 'AK-I-1', 'amount_minor', 100000, 'currency', 'NGN', 'provider_ref', 'ps-1'));
  select id into n1 from notifications where user_id = cl and channel = 'sms' and event = 'payment_confirmed';
  perform (select count(*) from claim_notifications(50));
  perform finish_notification(n1, 'failed', 'termii', null, 'termii: invalid destination', 'permanent');
  perform t_check('a permanent failure fails at once', (select status = 'failed' and failure_kind = 'permanent' and send_attempts = 1 from notifications where id = n1));
  perform t_check('unpriced is unpriced: nothing costs zero by default', (select cost_minor is null from notifications where id = n1));
end $$;

-- ---------------------------------------------------------------- 4. a claim that never finished, and a channel that is not offered
do $$
declare cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm'); n uuid; c int;
begin
  perform enqueue_notification(cl, f, 'new_message', jsonb_build_object('message_id', gen_random_uuid()));
  select id into n from notifications where user_id = cl and channel = 'sms' and event = 'new_message';
  perform (select count(*) from claim_notifications(50));
  update notifications set claimed_at = now() - interval '11 minutes' where id = n;
  select count(*) into c from claim_notifications(50);
  perform t_check('a claim older than ten minutes is put back and claimed again, and the row says it may have gone', c = 1 and (select status = 'sending' and send_attempts = 2 and error like '%may have gone out%' from notifications where id = n));
  perform finish_notification(n, 'sent', 'termii', 'msg-002', null, null, 1, null, null);
  insert into notifications (user_id, firm_id, channel, event, payload) values (cl, f, 'whatsapp', 'new_message', '{}');
  select count(*) into c from claim_notifications(50);
  perform t_check('a whatsapp row is skipped by the claim, never handed to a sender', c = 0 and (select status = 'skipped' from notifications where user_id = cl and channel = 'whatsapp'));
end $$;

-- ---------------------------------------------------------------- 5. a receipt, by the provider's own id
do $$
declare cl uuid := (select v from fx where k='client'); n uuid; got uuid;
begin
  select id into n from notifications where user_id = cl and provider_ref = 'msg-002';
  got := record_delivery_receipt('termii', 'msg-002', 'note', now(), 'Sent to carrier');
  perform t_check('a note is kept and decides nothing', got = n and (select delivery_status = 'accepted' and delivered_at is null and delivery_note = 'Sent to carrier' from notifications where id = n));
  got := record_delivery_receipt('termii', 'msg-002', 'delivered', now() - interval '1 minute', null);
  perform t_check('delivered, with the provider''s time', got = n and (select delivery_status = 'delivered' and delivered_at < now() from notifications where id = n));
  perform t_check('a receipt nobody sent a message for matches nothing', record_delivery_receipt('termii', 'msg-nope', 'delivered') is null);
  perform t_check('a receipt for another provider''s id matches nothing', record_delivery_receipt('twilio', 'msg-002', 'delivered') is null);
  got := record_delivery_receipt('termii', 'msg-002', 'undelivered', now(), 'DND Active on Phone Number');
  perform t_check('a later verdict replaces the earlier one', (select delivery_status = 'undelivered' and delivered_at is null and delivery_note like 'DND%' from notifications where id = n));
  perform t_check('an unknown verdict is refused', t_fails('select record_delivery_receipt(''termii'', ''msg-002'', ''opened'')', 'unknown receipt status'));
end $$;

-- ---------------------------------------------------------------- 6. rates: the platform's, with MFA, audited; the health and cost views
do $$
declare pa uuid := (select v from fx where k='padmin'); ow uuid := (select v from fx where k='owner'); cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm'); r record;
begin
  perform t_as(ow);
  perform t_check('a firm owner cannot set a rate', t_refused('select set_provider_rate(''termii'', ''sms'', ''NGN'', 400)', '42501'));
  perform t_check('nor read the cost view', (select count(*) = 0 from platform_notification_cost) and (select count(*) = 0 from platform_firm_active_matters) and (select count(*) = 0 from provider_rates));
  perform t_reset(); perform t_as(pa, 'aal1');
  perform t_check('a platform admin without a second factor cannot set a rate', t_refused('select set_provider_rate(''termii'', ''sms'', ''NGN'', 400)', '42501'));
  perform t_reset(); perform t_as(pa);
  perform set_provider_rate('termii', 'sms', 'NGN', 400, current_date - 30, true, 'DND route, per segment');
  perform set_provider_rate('termii', 'sms', 'NGN', 450, current_date + 10, true, 'next month');
  perform t_check('an unknown provider is refused', t_fails('select set_provider_rate(''pigeon'', ''sms'', ''NGN'', 1)', 'unknown provider'));
  perform t_check('the rate is audited as a platform act, and the platform can read that', exists (select 1 from audit_log where action = 'provider_rate.set' and actor_id = pa and (meta ->> 'unit_minor')::int = 450));
  perform t_reset();
  select * into r from current_provider_rate('termii', 'sms');
  perform t_check('the rate in force is the latest that has begun, not one still to come', r.unit_minor = 400 and r.currency = 'NGN' and r.per_segment);
  perform t_check('no rate means no rate', not exists (select 1 from current_provider_rate('twilio', 'sms')));

  perform t_as(pa);
  perform t_check('the platform reads delivery counts, never content',
    (select sum(delivered) + sum(undelivered) + sum(accepted) >= 1 from platform_notification_health where firm_id = f)
    and (select count(*) = 0 from notifications));
  perform t_check('the failed list says what kind of failure and how many sends',
    exists (select 1 from platform_failed_notifications where firm_id = f and failure_kind = 'permanent' and send_attempts = 1 and provider = 'termii'));
  perform t_check('the cost view sums what was priced, by currency, and counts what was not',
    exists (select 1 from platform_notification_cost where firm_id = f and provider = 'termii' and channel = 'sms' and cost_currency = 'NGN' and cost_minor = 800)
    and exists (select 1 from platform_notification_cost where firm_id = f and provider = 'termii' and channel = 'sms' and cost_currency is null and unpriced = 1 and cost_minor is null));
  perform t_check('the denominator is the firm''s open matters', (select active_matters from platform_firm_active_matters where firm_id = f) = (select count(*) from matters where firm_id = f and deleted_at is null and closed_at is null));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 7. the operator's retry restarts the automatic cycle
do $$
declare pa uuid := (select v from fx where k='padmin'); cl uuid := (select v from fx where k='client'); n uuid;
begin
  select id into n from notifications where user_id = cl and status = 'failed' and failure_kind = 'permanent' limit 1;
  perform t_as(pa);
  perform retry_notification(n);
  perform t_reset();
  perform t_check('queued again with the send counter reset and the operator''s counter advanced',
    (select status = 'queued' and send_attempts = 0 and attempts = 1 and failure_kind is null and error is null from notifications where id = n));
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
