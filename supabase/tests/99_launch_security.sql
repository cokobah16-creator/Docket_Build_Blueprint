-- Direct API regression checks for the launch security migration. The production
-- transaction rolls back every fixture created here.
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

create temp table fx(k text primary key, v uuid);
grant select on fx to authenticated;
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values
  (gen_random_uuid(), 'launch-staff@test'),
  (gen_random_uuid(), 'launch-victim@test'),
  (gen_random_uuid(), 'launch-other-client@test'),
  (gen_random_uuid(), 'launch-platform@test');
insert into fx select split_part(email, '@', 1), id from auth.users where email like 'launch-%@test';
insert into firm_members (firm_id, user_id, role)
values ((select v from fx where k='firm'), (select v from fx where k='launch-staff'), 'owner');
insert into platform_admins (user_id) values ((select v from fx where k='launch-platform'));
insert into matters (firm_id, reference, title, type, description)
values ((select v from fx where k='firm'), 'LS-M-2026-000001', 'A private matter', 'family', 'Staff strategy only');
insert into fx select 'matter', id from matters where reference = 'LS-M-2026-000001';
insert into matter_lawyers (matter_id, firm_id, user_id, is_lead)
values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='launch-staff'), true);

do $$
declare f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter');
        st uuid := (select v from fx where k='launch-staff'); victim uuid := (select v from fx where k='launch-victim');
        ok bool := false;
begin
  perform t_check('API roles cannot directly create or rewrite an appointment',
    not has_table_privilege('authenticated', 'public.appointments', 'INSERT')
    and not has_table_privilege('authenticated', 'public.appointments', 'UPDATE'));
  perform t_check('API roles cannot hard-delete a matter',
    not has_table_privilege('authenticated', 'public.matters', 'DELETE'));
  perform t_as(st, 'aal1');
  perform t_check('a staff session without MFA cannot read a matter',
    not exists (select 1 from matters where id = m));
  perform t_reset(); perform t_as(st);
  begin
    insert into matter_parties (matter_id, firm_id, user_id, role) values (m, f, victim, 'client');
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('a firm cannot attach a stranger through the direct API', ok);
  perform t_reset();
  -- Emulate a client accepting a verified invitation; only this explicit act opens the view.
  insert into matter_parties (matter_id, firm_id, user_id, role) values (m, f, victim, 'client');
  perform t_as(victim, 'aal1');
  perform t_check('a client reads their matter from the narrow view only',
    not exists (select 1 from matters where id = m)
    and exists (select 1 from portal_matters where id = m));
  ok := false;
  begin execute 'select description from portal_matters limit 1';
  exception when undefined_column then ok := true;
  end;
  perform t_check('the client view never exposes internal notes', ok);
  perform t_reset();
end $$;

do $$
declare st uuid := (select v from fx where k='launch-staff');
        victim uuid := (select v from fx where k='launch-victim');
        platform uuid := (select v from fx where k='launch-platform'); ok bool := false;
begin
  -- Keep the victim's identity-provider address but place it on the attacker's
  -- self-editable public profile. The platform must not grant the attacker a role.
  update profiles set email = null where id = victim;
  update profiles set email = 'launch-victim@test' where id = st;
  perform t_as(platform);
  begin
    perform create_firm('Spoof Test', 'launch-spoof', p_owner_email => 'launch-victim@test');
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('a spoofed profile email cannot choose a new firm owner', ok);
  perform t_reset();
end $$;

do $$
declare f uuid := (select v from fx where k='firm'); other uuid; a text; b text;
begin
  insert into firms (slug, name, reference_prefix) values ('launch-other-firm', 'Another AK firm', 'AK') returning id into other;
  a := next_reference(f, 'invoice'); b := next_reference(other, 'invoice');
  perform t_check('firms with the same initials mint different global invoice numbers', a <> b);
end $$;

-- Recipient-scoped correspondence: two clients may share a legal matter without sharing each
-- other's private conversation with the firm.
do $$
declare
  f uuid := (select v from fx where k='firm');
  m uuid := (select v from fx where k='matter');
  st uuid := (select v from fx where k='launch-staff');
  victim uuid := (select v from fx where k='launch-victim');
  other_client uuid := (select v from fx where k='launch-other-client');
  client_msg uuid; staff_msg uuid; doc uuid;
begin
  perform t_reset();
  insert into matter_parties (matter_id, firm_id, user_id, role)
  values (m, f, other_client, 'client');

  perform t_as(victim, 'aal1');
  insert into messages (firm_id, matter_id, sender_id, body)
  values (f, m, victim, 'private instructions from client one')
  returning id into client_msg;
  perform t_check('a client message is routed to the matter lawyer',
    (select recipient_id = st from messages where id = client_msg));

  insert into documents (firm_id, matter_id, name, category, client_visible, uploaded_by)
  values (f, m, 'private-note.pdf', 'message_attachment', true, victim)
  returning id into doc;
  perform t_check('a message attachment is made private and routed to the same lawyer',
    (select not client_visible and private_recipient_id = st from documents where id = doc));
  perform t_reset();

  perform t_as(other_client, 'aal1');
  perform t_check('another client on the same matter cannot read client one message',
    not exists (select 1 from messages where id = client_msg));
  perform t_check('another client on the same matter cannot read client one attachment',
    not can_access_document(doc));
  perform t_reset();

  perform t_as(st);
  insert into messages (firm_id, matter_id, sender_id, body)
  values (f, m, st, 'reply only to client one')
  returning id into staff_msg;
  perform t_check('the firm reply follows the client who last wrote',
    (select recipient_id = victim from messages where id = staff_msg));
  perform t_reset();

  perform t_as(other_client, 'aal1');
  perform t_check('another client cannot read the firm reply to client one',
    not exists (select 1 from messages where id = staff_msg));
  perform t_reset();

  perform t_as(victim, 'aal1');
  perform t_check('the intended client can read both sides of their conversation',
    exists (select 1 from messages where id = client_msg)
    and exists (select 1 from messages where id = staff_msg));
  perform t_reset();
end $$;
-- One active provider checkout per invoice. A double click must not create two references,
-- and a different client must not be able to claim the invoice.
do $$
declare
  f uuid := (select v from fx where k='firm');
  victim uuid := (select v from fx where k='launch-victim');
  other_client uuid := (select v from fx where k='launch-other-client');
  inv uuid;
  first_claim jsonb;
  second_claim jsonb;
  ready_claim jsonb;
  replacement jsonb;
  old_attempt uuid;
  refused boolean := false;
begin
  perform t_reset();
  insert into invoices (
    firm_id, number, client_id, currency, subtotal_minor, vat_minor,
    total_minor, paid_minor, status, issued_at
  ) values (
    f, 'LS-INV-2026-000001', victim, 'NGN', 100000, 0,
    100000, 0, 'issued', now()
  ) returning id into inv;

  perform t_as(victim, 'aal1');
  first_claim := claim_payment_checkout(inv, 'card');
  perform t_check('the first checkout claim reserves one provider transaction',
    first_claim ->> 'state' = 'create'
    and nullif(first_claim ->> 'provider_ref', '') is not null
    and (first_claim ->> 'amount_minor')::bigint = 100000);

  second_claim := claim_payment_checkout(inv, 'card');
  perform t_check('a second request while initialization is in flight is blocked',
    second_claim ->> 'state' = 'busy');

  perform complete_payment_checkout(
    (first_claim ->> 'attempt_id')::uuid,
    'https://checkout.example/one'
  );
  ready_claim := claim_payment_checkout(inv, 'bank_transfer');
  perform t_check('a later request reuses the existing provider checkout instead of creating another',
    ready_claim ->> 'state' = 'reuse'
    and ready_claim ->> 'checkout_url' = 'https://checkout.example/one'
    and ready_claim ->> 'provider_ref' = first_claim ->> 'provider_ref');
  perform t_check('there is exactly one active checkout for the invoice',
    (select count(*) = 1
       from payment_checkout_attempts
      where invoice_id = inv and status in ('initializing','ready')));

  old_attempt := (first_claim ->> 'attempt_id')::uuid;
  perform t_reset();
  update payment_checkout_attempts
     set lease_expires_at = now() - interval '1 second'
   where id = old_attempt;

  perform t_as(victim, 'aal1');
  replacement := claim_payment_checkout(inv, 'bank_transfer');
  perform t_check('an expired checkout is retired and a fresh reference may be created',
    replacement ->> 'state' = 'create'
    and replacement ->> 'provider_ref' <> first_claim ->> 'provider_ref');
  perform t_reset();

  perform t_as(other_client, 'aal1');
  begin
    perform claim_payment_checkout(inv, 'card');
  exception when insufficient_privilege then
    refused := true;
  end;
  perform t_check('another client cannot claim someone else''s invoice checkout', refused);
  perform t_reset();
end $$;

rollback;
