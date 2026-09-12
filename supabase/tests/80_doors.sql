-- Doors: every guarded write has exactly one, and the ones with nothing behind them are shut.
--
-- Migration 22 shut firm_members after an audit found a SECURITY DEFINER function "being the rule"
-- beside a table that was open anyway, and asked for the same check on every guarded function.
-- Migration 24 is that audit's result. This suite pins it — and section 1 is the audit itself,
-- as a standing assertion, so the next dead grant fails here before anyone relies on it.
--
-- Run alone or with the others: scripts/db-test-local.sh. Rolls back.

begin;

create or replace function t_as(u uuid, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', aal)::text, false);
  perform set_config('role', 'authenticated', false);
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
-- Runs a statement as the current role and reports whether it was refused with the given code.
create or replace function t_refused(stmt text, code text) returns bool language plpgsql as $$
begin
  execute stmt; return false;
exception when others then
  return sqlstate = code;
end $$;

-- ---------------------------------------------------------------- 1. no write grant without a policy behind it
-- A grant with no policy for its command is a door that returns success and does nothing —
-- until a permissive policy arrives and it opens. Either the command is meant to work (then
-- there is a policy) or it is not (then there is no grant). Never the third state.
do $$
declare bad text := '';
begin
  select string_agg(g.table_name || ':' || g.privilege_type, ' ' order by 1) into bad
    from information_schema.role_table_grants g
    join pg_tables t on t.tablename = g.table_name and t.schemaname = 'public'
   where g.grantee in ('anon', 'authenticated') and g.table_schema = 'public'
     and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
     and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = g.table_name
                        and (p.cmd = g.privilege_type or p.cmd = 'ALL'));
  perform t_check('no API role holds a write grant on a table with no policy for it'
                  || case when bad is not null then ' — DEAD GRANTS: ' || bad else '' end, bad is null);
end $$;

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values (gen_random_uuid(), 'doors-client@test'), (gen_random_uuid(), 'doors-pushy@test'), (gen_random_uuid(), 'doors-owner@test');
insert into fx select 'client', id from auth.users where email = 'doors-client@test';
insert into fx select 'pushy',  id from auth.users where email = 'doors-pushy@test';
insert into fx select 'owner',  id from auth.users where email = 'doors-owner@test';
insert into firm_members (firm_id, user_id, role) values ((select v from fx where k = 'firm'), (select v from fx where k = 'owner'), 'owner');
update profiles set preferred_channel = 'sms', phone = '+2348000000101', email = null where id = (select v from fx where k = 'client');
update profiles set preferred_channel = 'sms', phone = '+2348000000102', email = null where id = (select v from fx where k = 'pushy');
insert into push_subscriptions (user_id, endpoint, keys)
  values ((select v from fx where k = 'pushy'), 'https://push.example/sub-doors', '{"p256dh":"k","auth":"a"}'::jsonb);

-- ---------------------------------------------------------------- 2. a notification: read, yes; resend, no
do $$
declare cl uuid := (select v from fx where k = 'client'); f uuid := (select v from fx where k = 'firm'); n uuid; ok bool;
begin
  perform enqueue_notification(cl, f, 'appointment_confirmed', '{}'::jsonb);
  select id into n from notifications where user_id = cl and channel = 'sms';
  update notifications set status = 'sent', sent_at = now() where id = n;   -- as the dispatcher would

  perform t_as(cl, 'aal1');
  update notifications set read_at = now() where user_id = cl and channel = 'in_app';
  perform t_check('a person marks their own in-app notification read', (select read_at is not null from notifications where user_id = cl and channel = 'in_app'));
  ok := t_refused(format('update notifications set status = ''queued'' where id = %L', n), '42501');
  perform t_check('but cannot queue a sent SMS to be sent again at the firm''s expense', ok);
  ok := t_refused(format('update notifications set payload = ''{"x":1}'' where id = %L', n), '42501');
  perform t_check('nor rewrite what it said', ok);
  perform t_reset();
  perform t_check('and the row is as the dispatcher left it', (select status = 'sent' from notifications where id = n));
end $$;

-- ---------------------------------------------------------------- 3. push only for a person with a subscription
do $$
declare cl uuid := (select v from fx where k = 'client'); pu uuid := (select v from fx where k = 'pushy'); f uuid := (select v from fx where k = 'firm');
begin
  delete from notifications where user_id in (cl, pu);
  perform enqueue_notification(cl, f, 'matter_update', '{}'::jsonb);
  perform enqueue_notification(pu, f, 'matter_update', '{}'::jsonb);
  perform t_check('no push row for a person who never subscribed', not exists (select 1 from notifications where user_id = cl and channel = 'push'));
  perform t_check('their preferred channel still goes out', exists (select 1 from notifications where user_id = cl and channel = 'sms'));
  perform t_check('and the in-app copy is there', exists (select 1 from notifications where user_id = cl and channel = 'in_app'));
  perform t_check('a push row for a person who subscribed', exists (select 1 from notifications where user_id = pu and channel = 'push'));
end $$;

-- ---------------------------------------------------------------- 4. whatsapp selects something that delivers
do $$
declare cl uuid := (select v from fx where k = 'client'); f uuid := (select v from fx where k = 'firm');
begin
  delete from notifications where user_id = cl;
  update profiles set preferred_channel = 'whatsapp' where id = cl;   -- the enum still allows it
  perform enqueue_notification(cl, f, 'matter_update', '{}'::jsonb);
  perform t_check('a stray whatsapp preference is delivered as SMS', exists (select 1 from notifications where user_id = cl and channel = 'sms'));
  perform t_check('and no row is queued to be skipped', not exists (select 1 from notifications where user_id = cl and channel = 'whatsapp'));
  perform t_check('no profile is left on whatsapp by the migration', not exists (select 1 from profiles where preferred_channel = 'whatsapp' and id <> cl));
end $$;

-- ---------------------------------------------------------------- 5. audit_log carries no address column
do $$ begin
  perform t_check('audit_log has no ip column to hold a forged address',
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_log' and column_name = 'ip'));
end $$;

-- ---------------------------------------------------------------- 6. the money tables are the RPCs' to write
-- The general rule Wave 0 drew out of the firm_members escalation: where a SECURITY DEFINER
-- function reads as the authority, check the table beside it is not also open. These four are
-- the money, and their only writers are create_invoice(), issue_invoice(), cancel_invoice() and
-- record_payment(). A write grant here would let a member set paid_minor to the total and call
-- the bill settled, past every refusal those functions make.
do $$
declare held text;
begin
  select string_agg(g.table_name || ':' || g.privilege_type, ' ' order by 1) into held
    from information_schema.role_table_grants g
   where g.grantee in ('anon', 'authenticated') and g.table_schema = 'public'
     and g.table_name in ('invoices', 'invoice_items', 'payments', 'audit_log', 'firm_baselines', 'document_signatures')
     and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  perform t_check('the money and the record are written by their functions alone'
                  || case when held is not null then ' — GRANTS HELD: ' || held else '' end, held is null);
end $$;

-- And the same from the outside: a member of the firm, with a second factor, holding the matter.
do $$
declare f uuid := (select v from fx where k = 'firm'); l uuid := (select v from fx where k = 'owner'); c uuid := (select v from fx where k = 'client'); inv uuid := gen_random_uuid();
begin
  insert into invoices (id, firm_id, number, client_id, currency, subtotal_minor, vat_minor, total_minor, paid_minor, status, issued_at, due_at)
  values (inv, f, 'DR-INV-2026-000001', c, 'NGN', 100000, 0, 100000, 0, 'issued', now(), current_date + 14);
  perform t_as(l);
  perform t_check('a member cannot call an unpaid invoice paid',
    t_refused(format('update invoices set paid_minor = 100000, status = ''paid'' where id = %L', inv), '42501'));
  perform t_check('nor change what it is for, or who owes it',
    t_refused(format('update invoices set total_minor = 1 where id = %L', inv), '42501')
    and t_refused(format('update invoices set currency = ''USD'' where id = %L', inv), '42501')
    and t_refused(format('update invoices set client_id = %L where id = %L', l, inv), '42501'));
  perform t_check('nor delete it, nor add a line to it, nor raise one by hand',
    t_refused(format('delete from invoices where id = %L', inv), '42501')
    and t_refused(format('insert into invoice_items (invoice_id, description, quantity, unit_minor) values (%L, ''Extra'', 1, 5000)', inv), '42501')
    and t_refused(format('insert into invoices (firm_id, number, client_id, currency, subtotal_minor, total_minor, status) values (%L, ''DR-INV-2026-000002'', %L, ''NGN'', 1, 1, ''issued'')', f, c), '42501'));
  perform t_check('and still reads every one of its firm''s invoices', exists (select 1 from invoices where id = inv));
  perform t_reset();
  perform t_check('the invoice is exactly as it was', (select paid_minor = 0 and status = 'issued' and total_minor = 100000 and client_id = c from invoices where id = inv));
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
