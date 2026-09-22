-- Launch blockers: protect staff reads, client links, and private matter fields at the
-- database boundary. Existing rows are preserved; review historical links separately.

-- A staff session needs its second factor before it can read firm data through PostgREST,
-- storage helpers, or SECURITY DEFINER projections. The web layouts already require aal2.
create or replace function public.is_firm_member(f uuid) returns bool
language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and exists
    (select 1 from firm_members where firm_id = f and user_id = auth.uid())
$$;
create or replace function public.has_firm_role(f uuid, roles firm_role[]) returns bool
language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and exists
    (select 1 from firm_members where firm_id = f and user_id = auth.uid() and role = any(roles))
$$;

-- The most recent can_see_profile includes registry members. It must not be an aal1
-- bypass for staff profile/contact details.
create or replace function public.can_see_profile(p uuid) returns bool
language sql stable security definer set search_path = public as $$
  select p = auth.uid()
      or (mfa_ok() and (
          exists (select 1 from firm_members me join firm_members other on other.firm_id = me.firm_id
                  where me.user_id = auth.uid() and other.user_id = p)
       or exists (select 1 from firm_members me join appointments a on a.firm_id = me.firm_id
                  where me.user_id = auth.uid() and a.client_id = p)
       or exists (select 1 from firm_members me join matter_parties mp on mp.firm_id = me.firm_id
                  where me.user_id = auth.uid() and mp.user_id = p)
       or exists (select 1 from registry_members me join registry_members other on other.registry_id = me.registry_id
                  where me.user_id = auth.uid() and other.user_id = p)
       or (is_platform_admin() and exists (select 1 from registry_members rm where rm.user_id = p)) ))
$$;

-- No direct appointment insert or identity rewrite: book_appointment() always books for
-- auth.uid(), and the cancellation/check-in RPCs remain the only writers.
revoke insert, update, delete on public.appointments from anon, authenticated;
drop policy if exists appointments_staff_write_ins on public.appointments;
drop policy if exists appointments_staff_write_upd on public.appointments;
drop policy if exists appointments_staff_write_del on public.appointments;

-- The initial relationship must be initiated by the client (booking or redeeming an
-- invitation). Staff may link someone already known to their firm. This trigger runs inside
-- open_matter() too, so a SECURITY DEFINER function cannot bypass the rule.
create or replace function public.guard_matter_party_relationship() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.user_id = old.user_id and new.firm_id = old.firm_id
      and new.matter_id = old.matter_id then return new; end if;
  -- Internal migrations and the service role seed fixtures without a user session. API
  -- callers have SET ROLE authenticated/anon and do not take this branch.
  if auth.uid() is null and coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.user_id = auth.uid() then return new; end if;
  if exists (select 1 from appointments a where a.firm_id = new.firm_id and a.client_id = new.user_id)
     or exists (select 1 from matter_parties mp where mp.firm_id = new.firm_id and mp.user_id = new.user_id) then
    return new;
  end if;
  raise exception 'invite this person to the firm or let them book before adding them to a matter'
    using errcode = '42501';
end $$;
create trigger matter_parties_relationship before insert or update of user_id, firm_id, matter_id
  on public.matter_parties for each row execute function public.guard_matter_party_relationship();

-- A deleted matter is still a legal record. The web app uses deleted_at; no user role
-- may DELETE the row and cascade away its timeline, documents, invoices and audit history.
revoke delete on public.matters from anon, authenticated;
drop policy if exists matters_write_del on public.matters;

-- Clients can read only these fields. Full matters rows contain description, next_action,
-- internal handling, and other staff work product. A projection in the UI is insufficient:
-- a signed-in client can call the REST endpoint directly.
drop policy if exists matters_select on public.matters;
create policy matters_select on public.matters for select using
  (is_firm_member(firm_id) and (access = 'firm' or exists
    (select 1 from matter_lawyers ml where ml.matter_id = matters.id and ml.user_id = auth.uid())));
create or replace view public.portal_matters with (security_barrier = true) as
  select m.id, m.firm_id, m.reference, m.title, m.type, m.status_id,
         m.court_name, m.suit_number, m.next_event_at, m.next_event_note,
         m.opened_at, m.closed_at
    from public.matters m
   where m.deleted_at is null and public.is_matter_party(m.id);
revoke all on public.portal_matters from public, anon;
grant select on public.portal_matters to authenticated;
comment on view public.portal_matters is 'Client-readable matter fields; never select the staff matter row from the portal.';

-- The public booking page must quote the same VAT the server adds to the invoice.
create or replace view public.firm_public as
  select id, slug, name, legal_name, brand, policies, custom_domain, timezone, default_currency,
         (verified_at is not null) as verified, vat_rate
    from public.firms where status = 'active';
revoke all on public.firm_public from public, anon;
grant select on public.firm_public to anon, authenticated;

-- Reference numbers are globally unique in appointments, matters and invoices. When two
-- firms choose the same initials, add their unique slug to the prefix before minting a
-- reference. Existing references keep their original spelling.
create or replace function public.next_reference(p_firm uuid, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare v_year int := extract(year from now())::int; v_val int; v_prefix text; v_slug text;
begin
  insert into firm_counters (firm_id, kind, year, value) values (p_firm, p_kind, v_year, 1)
  on conflict (firm_id, kind, year) do update set value = firm_counters.value + 1
  returning value into v_val;
  select reference_prefix, slug into v_prefix, v_slug from firms where id = p_firm;
  if v_prefix is null then raise exception 'firm not found'; end if;
  if exists (select 1 from firms where id <> p_firm and upper(reference_prefix) = upper(v_prefix)) then
    v_prefix := v_prefix || '-' || upper(v_slug);
  end if;
  return case p_kind
    when 'appointment' then format('%s-%s-%s', v_prefix, v_year, lpad(v_val::text, 6, '0'))
    when 'matter'      then format('%s-M-%s-%s', v_prefix, v_year, lpad(v_val::text, 6, '0'))
    when 'invoice'     then format('%s-INV-%s-%s', v_prefix, v_year, lpad(v_val::text, 6, '0'))
    else                    format('%s-%s-%s-%s', v_prefix, upper(p_kind), v_year, lpad(v_val::text, 6, '0'))
  end;
end $$;
revoke execute on function public.next_reference(uuid,text) from public, anon, authenticated;

-- Profile email is contact data and is self-editable. Both platform flows used it to
-- choose a user ID. Preserve the existing RPCs behind non-executable names and reject a
-- profile match unless the identity provider identifies the same account by that email.
alter function public.create_firm(text,text,text,text,text,currency,text,text,jsonb,text,text)
  rename to create_firm_verified_inner;
revoke execute on function public.create_firm_verified_inner(text,text,text,text,text,currency,text,text,jsonb,text,text)
  from public, anon, authenticated;
create function public.create_firm(
  p_name text, p_slug text,
  p_legal_name text default null, p_rc_number text default null,
  p_timezone text default 'Africa/Lagos', p_default_currency currency default 'NGN',
  p_reference_prefix text default null, p_state_code text default null,
  p_brand jsonb default '{}', p_owner_email text default null, p_owner_scn text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_profile uuid; v_identity uuid;
begin
  if p_owner_email is not null then
    select id into v_profile from profiles where lower(email) = lower(btrim(p_owner_email));
    select id into v_identity from auth.users where lower(email) = lower(btrim(p_owner_email));
    if v_profile is null or v_identity is distinct from v_profile then
      raise exception 'the owner must sign up first with that email before they can be added'
        using errcode = '42501';
    end if;
  end if;
  return public.create_firm_verified_inner(p_name, p_slug, p_legal_name, p_rc_number,
    p_timezone, p_default_currency, p_reference_prefix, p_state_code, p_brand,
    p_owner_email, p_owner_scn);
end $$;
revoke execute on function public.create_firm(text,text,text,text,text,currency,text,text,jsonb,text,text) from public, anon;
grant execute on function public.create_firm(text,text,text,text,text,currency,text,text,jsonb,text,text) to authenticated;

alter function public.add_registry_member(uuid,text,public.registry_role)
  rename to add_registry_member_verified_inner;
revoke execute on function public.add_registry_member_verified_inner(uuid,text,public.registry_role)
  from public, anon, authenticated;
create function public.add_registry_member(p_registry uuid, p_email text, p_role public.registry_role)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_profile uuid; v_identity uuid;
begin
  select id into v_profile from profiles where lower(email) = lower(btrim(p_email));
  select id into v_identity from auth.users where lower(email) = lower(btrim(p_email));
  if v_profile is null or v_identity is distinct from v_profile then
    raise exception 'the registrar must sign up with that email before they can be added'
      using errcode = '42501';
  end if;
  return public.add_registry_member_verified_inner(p_registry, p_email, p_role);
end $$;
revoke execute on function public.add_registry_member(uuid,text,public.registry_role) from public, anon;
grant execute on function public.add_registry_member(uuid,text,public.registry_role) to authenticated;

-- The served/collaborating firm's file grant is for one pinned version of one document
-- on the originating matter. Check all joins explicitly, and stop access to a deleted file.
create or replace function public.can_access_document_version(v uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from document_versions dv join documents doc on doc.id = dv.document_id
     where dv.id = v and doc.deleted_at is null
       and (public.matter_row_r(doc.firm_id, doc.matter_id)
         or (doc.client_visible and
             (public.party_may_see_docs(doc.matter_id)
              or public.acts_for_matter(doc.matter_id, 'docs')
              or public.is_appointment_client(doc.appointment_id)))
         or exists (select 1 from process_service ps
                     where ps.document_version_id = dv.id and ps.document_id = doc.id
                       and ps.firm_id = doc.firm_id and public.is_served_firm(ps.id))
         or exists (select 1 from collaboration_documents cd
                     join matter_collaborations mc on mc.id = cd.collaboration_id
                     where cd.document_version_id = dv.id and cd.document_id = doc.id
                       and mc.firm_id = doc.firm_id and mc.matter_id = doc.matter_id
                       and cd.withdrawn_at is null and public.is_collaborating_firm(mc.id)))
  )
$$;

-- Keep the real charge on the ledger, while making an expired booking or excess
-- payment visible to the firm for a refund/rebooking decision. The webhook inserts a
-- payment before record_payment() updates the invoice, so the outstanding balance here
-- is the balance immediately before this charge. Provider refs remain idempotent.
create table public.payment_review_flags (
  payment_id uuid primary key references public.payments(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  firm_id uuid not null references public.firms(id) on delete restrict,
  reason text not null check (reason in ('overpayment', 'booking_closed')),
  created_at timestamptz not null default now()
);
alter table public.payment_review_flags enable row level security;
create policy payment_review_flags_select on public.payment_review_flags for select using (is_firm_member(firm_id));
revoke all on public.payment_review_flags from public, anon, authenticated;
grant select on public.payment_review_flags to authenticated;

create function public.flag_payment_for_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv invoices%rowtype; ap appointments%rowtype; why text;
begin
  if new.status <> 'succeeded' then return new; end if;
  select * into inv from invoices where id = new.invoice_id;
  if inv.appointment_id is not null then
    select * into ap from appointments where id = inv.appointment_id;
    if not found or ap.status in ('cancelled', 'no_show', 'completed')
        or (ap.hold_expires_at is not null and ap.hold_expires_at <= now()) then
      why := 'booking_closed';
    end if;
  end if;
  if inv.paid_minor + new.amount_minor > inv.total_minor then
    why := 'overpayment';
  end if;
  if why is not null then
    insert into payment_review_flags (payment_id, invoice_id, firm_id, reason)
    values (new.id, inv.id, inv.firm_id, why);
    perform enqueue_firm_notification(inv.firm_id, 'payment_review_required',
      jsonb_build_object('invoice_id', inv.id, 'invoice_number', inv.number,
                         'payment_id', new.id, 'amount_minor', new.amount_minor, 'reason', why));
  end if;
  return new;
end $$;
create trigger payments_flag_review after insert on public.payments
  for each row execute function public.flag_payment_for_review();
revoke execute on function public.flag_payment_for_review() from public, anon, authenticated;
