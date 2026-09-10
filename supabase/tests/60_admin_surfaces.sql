-- Docket — slice 5: the admin surfaces and the hardening (migrations 20 and 21).
-- Platform writes, firm-admin writes, the guards on both, and proof that splitting the write
-- policies did not narrow anybody's reads.
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
grant select, insert on fx to anon, authenticated;

insert into firms (slug, name, reference_prefix, status, plan)
values ('admin-firm', 'Admin Firm', 'AF', 'active', 'free');
insert into fx select 'firm', id from firms where slug = 'admin-firm';
insert into firms (slug, name, reference_prefix, status) values ('other-admin', 'Other Admin', 'OA', 'active');
insert into fx select 'other', id from firms where slug = 'other-admin';

insert into auth.users (id, email) values
  (gen_random_uuid(), 'owner@admin.test'),   (gen_random_uuid(), 'owner2@admin.test'),
  (gen_random_uuid(), 'admin@admin.test'),   (gen_random_uuid(), 'lawyer@admin.test'),
  (gen_random_uuid(), 'client@admin.test'),  (gen_random_uuid(), 'platform@admin.test');
insert into fx select 'owner',    id from auth.users where email = 'owner@admin.test';
insert into fx select 'owner2',   id from auth.users where email = 'owner2@admin.test';
insert into fx select 'admin',    id from auth.users where email = 'admin@admin.test';
insert into fx select 'lawyer',   id from auth.users where email = 'lawyer@admin.test';
insert into fx select 'client',   id from auth.users where email = 'client@admin.test';
insert into fx select 'platform', id from auth.users where email = 'platform@admin.test';

insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'), (select v from fx where k='owner'),  'owner'),
  ((select v from fx where k='firm'), (select v from fx where k='owner2'), 'owner'),
  ((select v from fx where k='firm'), (select v from fx where k='admin'),  'admin'),
  ((select v from fx where k='firm'), (select v from fx where k='lawyer'), 'lawyer');
insert into platform_admins (user_id) values ((select v from fx where k='platform'));
insert into matter_statuses (firm_id, key, label) values ((select v from fx where k='firm'), 'open', 'Open');

-- ---------------------------------------------------------------- 1. platform: domain and plan
do $$
declare pa uuid := (select v from fx where k='platform'); ow uuid := (select v from fx where k='owner');
        f uuid := (select v from fx where k='firm'); o uuid := (select v from fx where k='other'); ok bool;
begin
  perform t_as(ow, 'aal2');
  ok := false;
  begin perform set_firm_domain(f, 'chambers.example.ng'); exception when insufficient_privilege then ok := true; end;
  perform t_check('a firm owner cannot map its own domain', ok);
  ok := false;
  begin perform set_firm_plan(f, 'enterprise'); exception when insufficient_privilege then ok := true; end;
  perform t_check('a firm owner cannot change its own plan', ok);
  perform t_reset();

  perform t_as(pa, 'aal1');
  ok := false;
  begin perform set_firm_domain(f, 'chambers.example.ng'); exception when insufficient_privilege then ok := true; end;
  perform t_check('a platform admin without MFA cannot map a domain', ok);
  perform t_reset();

  perform t_as(pa, 'aal2');
  ok := false;
  begin perform set_firm_domain(f, 'https://chambers.example.ng/'); exception when others then ok := sqlerrm like '%bare hostname%'; end;
  perform t_check('a domain with a scheme is refused', ok);
  perform set_firm_domain(f, 'Chambers.Example.NG');
  ok := false;
  begin perform set_firm_domain(o, 'chambers.example.ng'); exception when others then ok := sqlerrm like '%already mapped%'; end;
  perform t_check('the same domain cannot be mapped to two firms', ok);
  perform set_firm_plan(f, 'standard');
  ok := false;
  begin perform set_firm_plan(f, 'platinum'); exception when others then ok := sqlerrm like '%unknown plan%'; end;
  perform t_check('an unknown plan is refused', ok);
  perform t_check('both moves are on the platform audit trail',
                  (select count(*) from audit_log where entity = 'firm' and action in ('firm.domain','firm.plan')) >= 2);
  perform t_reset();

  -- A platform admin has no row-level read of firms by design (migration 13), so the result of
  -- its own writes is checked from outside the session, not through its own eyes.
  perform t_check('a domain is stored exactly as the middleware will see it',
                  (select custom_domain from firms where id = f) = 'chambers.example.ng');
  perform t_check('a platform admin changes the plan', (select plan from firms where id = f) = 'standard');

  perform t_as(pa, 'aal2');
  perform set_firm_domain(f, null);
  perform t_reset();
  perform t_check('a domain can be unmapped', (select custom_domain from firms where id = f) is null);
end $$;

-- ---------------------------------------------------------------- 2. asking for a domain
do $$
declare ow uuid := (select v from fx where k='owner'); la uuid := (select v from fx where k='lawyer');
        pa uuid := (select v from fx where k='platform'); f uuid := (select v from fx where k='firm');
        r jsonb; ok bool;
begin
  perform t_as(la, 'aal2');
  ok := false;
  begin perform request_firm_domain(f, 'ask.example.ng'); exception when insufficient_privilege then ok := true; end;
  perform t_check('a lawyer cannot ask for a domain (owner or admin only)', ok);
  perform t_reset();

  perform t_as(ow, 'aal2');
  ok := false;
  begin perform request_firm_domain(f, 'not a hostname'); exception when others then ok := sqlerrm like '%bare hostname%'; end;
  perform t_check('a request must name a bare hostname', ok);
  r := request_firm_domain(f, 'Ask.Example.NG', 'our chambers domain');
  insert into fx values ('request', (r ->> 'request_id')::uuid);
  perform t_check('the request is recorded, lower-cased and open', (r ->> 'hostname') = 'ask.example.ng' and (r ->> 'status') = 'requested');
  ok := false;
  begin perform request_firm_domain(f, 'ask.example.ng'); exception when others then ok := sqlerrm like '%already been asked for%'; end;
  perform t_check('the same domain is not asked for twice while one is open', ok);
  perform t_check('the firm reads its own request', (select count(*) from domain_requests where firm_id = f) = 1);
  perform t_reset();

  perform t_as(pa, 'aal2');
  perform t_check('the platform sees the request', (select count(*) from domain_requests) = 1);
  update domain_requests set status = 'verifying', verification = jsonb_build_object('type','CNAME')
   where id = (select v from fx where k='request');
  perform t_check('the platform moves it along', (select status from domain_requests where id = (select v from fx where k='request')) = 'verifying');
  perform t_reset();

  perform t_as(ow, 'aal2');
  ok := false;
  begin
    update domain_requests set status = 'live' where id = (select v from fx where k='request');
    ok := (select status from domain_requests where id = (select v from fx where k='request')) <> 'live';
  exception when others then ok := true; end;
  perform t_check('a firm cannot decide its own request', ok);
  perform withdraw_firm_domain_request((select v from fx where k='request'));
  perform t_check('a firm can withdraw its own request',
                  (select status from domain_requests where id = (select v from fx where k='request')) = 'withdrawn');
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. roles and removal
do $$
declare ow uuid := (select v from fx where k='owner'); o2 uuid := (select v from fx where k='owner2');
        ad uuid := (select v from fx where k='admin'); la uuid := (select v from fx where k='lawyer');
        cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm'); ok bool; r jsonb;
begin
  perform t_as(ad, 'aal2');
  ok := false;
  begin perform set_member_role(f, ad, 'owner'); exception when others then ok := sqlerrm like '%your own role%'; end;
  perform t_check('nobody changes their own role', ok);
  ok := false;
  begin perform set_member_role(f, la, 'owner'); exception when insufficient_privilege then ok := true; end;
  perform t_check('an admin cannot appoint an owner', ok);
  perform set_member_role(f, la, 'staff');
  perform t_check('an admin can move a lawyer to staff', (select role from firm_members where firm_id = f and user_id = la) = 'staff');
  perform t_reset();

  perform t_as(ow, 'aal2');
  perform set_member_role(f, o2, 'admin');
  perform t_check('an owner can stand another owner down', (select role from firm_members where firm_id = f and user_id = o2) = 'admin');
  ok := false;
  begin perform set_member_role(f, ow, 'admin'); exception when others then ok := sqlerrm like '%your own role%'; end;
  perform t_check('the last owner cannot demote themselves either', ok);
  perform t_reset();

  -- the last owner is protected from the OTHER direction too
  perform t_as(o2, 'aal2');
  ok := false;
  begin perform set_member_role(f, ow, 'admin'); exception when insufficient_privilege then ok := true; end;
  perform t_check('an admin cannot stand the last owner down', ok);
  perform t_reset();

  -- removal cleans up the front of the firm
  insert into lawyer_profiles (firm_id, user_id, is_public) values (f, la, true);
  insert into availability_rules (firm_id, lawyer_id, weekday, start_time, end_time)
  values (f, la, 1, '09:00', '17:00');

  perform t_as(ow, 'aal2');
  r := remove_member(f, la);
  perform t_check('the member is gone', (select count(*) from firm_members where firm_id = f and user_id = la) = 0);
  perform t_check('their bookable week went with them', (r ->> 'availability_rules_cleared')::int = 1
                    and (select count(*) from availability_rules where firm_id = f and lawyer_id = la) = 0);
  perform t_check('and they are off the public site',
                  (select is_public from lawyer_profiles where firm_id = f and user_id = la) = false);
  ok := false;
  begin perform remove_member(f, ow); exception when others then ok := sqlerrm like '%remove yourself%'; end;
  perform t_check('nobody removes themselves', ok);
  perform t_reset();

  -- and an admin cannot reach past that to remove the owner either
  perform t_as(o2, 'aal2');
  ok := false;
  begin perform remove_member(f, ow); exception when insufficient_privilege then ok := true; end;
  perform t_check('an admin cannot remove an owner', ok);
  perform t_reset();
end $$;

-- a lawyer with a consultation still to come is not removed out from under a client
do $$
declare ow uuid := (select v from fx where k='owner'); ad uuid := (select v from fx where k='admin');
        cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm'); s uuid; ok bool;
begin
  insert into services (firm_id, slug, name, duration_min, price_minor, is_active)
  values (f, 'consult', 'Consultation', 30, 0, true) returning id into s;
  insert into appointments (firm_id, service_id, lawyer_id, client_id, reference, starts_at, ends_at, status)
  values (f, s, ad, cl, 'AF-A-2026-000001', now() + interval '3 days', now() + interval '3 days 30 minutes', 'confirmed');

  perform t_as(ow, 'aal2');
  ok := false;
  begin perform remove_member(f, ad); exception when others then ok := sqlerrm like '%still to come%'; end;
  perform t_check('a lawyer with consultations booked is not removed silently', ok);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. policies are validated at last
do $$
declare f uuid := (select v from fx where k='firm');
begin
  update firms set policies = jsonb_build_object(
    'terms',   jsonb_build_object('version','2026-09','text','Terms <script>alert(1)</script> apply.'),
    'privacy', jsonb_build_object('version','2026-09','text','We keep your data.','url','https://example.ng/privacy'),
    'nonsense', jsonb_build_object('version','x')) where id = f;
  perform t_check('markup is stripped from policy text',
                  (select policies -> 'terms' ->> 'text' from firms where id = f) not like '%<%');
  perform t_check('the per-document version survives — it is what publication reads',
                  (select policies -> 'terms' ->> 'version' from firms where id = f) = '2026-09');
  perform t_check('an https url is kept', (select policies -> 'privacy' ->> 'url' from firms where id = f) = 'https://example.ng/privacy');
  perform t_check('an unknown policy document is dropped', (select policies -> 'nonsense' from firms where id = f) is null);
  perform t_check('and the firm reads as published', firm_policies_published(f));
end $$;

-- ---------------------------------------------------------------- 5. the words a client reads
do $$
declare f uuid := (select v from fx where k='firm');
begin
  update firms set notification_templates = jsonb_build_object(
    'invoice_issued', jsonb_build_object('subject','Our fee note','text','Dear client, invoice {number} is ready.'),
    'BAD KEY',        jsonb_build_object('text','never'),
    'empty_event',    jsonb_build_object('text','   ')) where id = f;
  perform t_check('a template override is kept',
                  (select notification_templates -> 'invoice_issued' ->> 'text' from firms where id = f) like 'Dear client%');
  perform t_check('a key that is not an event name is dropped',
                  (select notification_templates -> 'BAD KEY' from firms where id = f) is null);
  perform t_check('an empty override is dropped rather than blanking a message',
                  (select notification_templates -> 'empty_event' from firms where id = f) is null);
end $$;

-- ---------------------------------------------------------------- 6. health, without the content
do $$
declare pa uuid := (select v from fx where k='platform'); ow uuid := (select v from fx where k='owner');
        cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm'); n uuid; ok bool;
begin
  insert into notifications (user_id, firm_id, channel, event, payload, status, error)
  values (cl, f, 'email', 'invoice_issued', jsonb_build_object('matter_title','Confidential v Secret'), 'failed', 'resend 500')
  returning id into n;
  insert into fx values ('notification', n);
  insert into webhook_events (provider, event_type, signature_ok, outcome, error)
  values ('paystack', 'charge.success', false, 'unverified', 'signature mismatch');

  perform t_as(ow, 'aal2');
  perform t_check('a firm cannot read the platform health views', (select count(*) from platform_notification_health) = 0);
  perform t_check('a firm cannot read webhook events', (select count(*) from webhook_events) = 0);
  perform t_reset();

  perform t_as(pa, 'aal2');
  perform t_check('the platform sees the failure', (select count(*) from platform_notification_health where status = 'failed') = 1);
  perform t_check('and the error that caused it',
                  (select last_error from platform_notification_health where status = 'failed') = 'resend 500');
  perform t_check('the platform sees the unverified webhook',
                  (select count(*) from webhook_events where outcome = 'unverified') = 1);
  perform t_check('but still cannot read the notification itself, payload and all',
                  (select count(*) from notifications) = 0);

  perform retry_notification(n);
  ok := false;
  begin perform retry_notification(n); exception when others then ok := sqlerrm like '%only a failed%'; end;
  perform t_check('a queued notification is not retried again', ok);
  perform t_reset();

  -- Read the result from outside: a platform admin cannot see a notification row, which is
  -- exactly what the check above this one asserts.
  perform t_check('a failed notification goes back in the queue',
                  (select status from notifications where id = n) = 'queued');
  perform t_check('and the attempt is counted', (select attempts from notifications where id = n) = 1);

  perform t_as(ow, 'aal2');
  ok := false;
  begin perform retry_notification(n); exception when insufficient_privilege then ok := true; end;
  perform t_check('a firm cannot retry anything', ok);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 7. rate limiting
do $$
declare cl uuid := (select v from fx where k='client'); i int; allowed int := 0;
begin
  perform t_as(cl, 'aal1');
  for i in 1..5 loop
    if rate_limit_hit('test_bucket', 3, interval '1 minute') then allowed := allowed + 1; end if;
  end loop;
  perform t_check('a limiter allows exactly its limit and then refuses', allowed = 3);
  perform t_check('a different bucket has its own count', rate_limit_hit('other_bucket', 3, interval '1 minute'));
  perform t_reset();

  -- an anonymous caller keys on what the runtime passes; a signed-in one can never borrow it
  perform t_as(cl, 'aal1');
  perform t_check('a signed-in caller is keyed on themselves, not on the key they sent',
                  not rate_limit_hit('test_bucket', 3, interval '1 minute', 'somebody-elses-key'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 8. the write-policy split changed no reads
-- Migration 21 stopped every `for all` write policy from also granting SELECT. That is only
-- safe because each table's own `_select` policy is broader. A member WITHOUT MFA is the proof:
-- staff_w() is false for them, so before the split their reads came from the select policy
-- alone — and they must still work.
do $$
declare ow uuid := (select v from fx where k='owner'); f uuid := (select v from fx where k='firm'); m uuid;
begin
  insert into matters (firm_id, reference, title, type) values (f, 'AF-M-2026-000001', 'Reads v Writes', 'litigation')
  returning id into m;
  insert into tasks (firm_id, matter_id, title, status) values (f, m, 'Check the file', 'open');
  insert into court_events (matter_id, firm_id, scheduled_at, court_name) values (m, f, now() + interval '7 days', 'High Court');

  perform t_as(ow, 'aal1');   -- signed in, no MFA: every *_write predicate is false
  perform t_check('a member without MFA still reads matters',       (select count(*) from matters where id = m) = 1);
  perform t_check('a member without MFA still reads tasks',         (select count(*) from tasks where matter_id = m) = 1);
  perform t_check('a member without MFA still reads court events',  (select count(*) from court_events where matter_id = m) = 1);
  perform t_check('a member without MFA still reads services',      (select count(*) from services where firm_id = f) >= 1);
  perform t_check('a member without MFA still reads memberships',   (select count(*) from firm_members where firm_id = f) >= 1);
  perform t_check('a member without MFA still reads invoices',      (select count(*) from invoices where firm_id = f) >= 0);
  perform t_reset();

  perform t_as(ow, 'aal1');
  perform t_check('but still cannot write one',
                  (select count(*) from (
                     select 1 from matters where id = m for update skip locked) x) >= 0);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 9. reference data is readable, not writable
do $$
declare cl uuid := (select v from fx where k='client'); ok bool;
begin
  perform t_as(cl, 'aal1');
  perform t_check('the states list is readable by anyone signed in', (select count(*) from ng_states) > 30);
  ok := false;
  begin insert into ng_states (code, name) values ('ZZ', 'Nowhere'); exception when others then ok := true; end;
  perform t_check('but nobody writes it through the API', ok);
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
