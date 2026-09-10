-- Docket — migration 14: second adversarial review of the branch (five reviewers with scratch
-- databases). Everything here was demonstrated with a query before it was fixed.
--
--   1. Security-definer views were writable: Supabase's default privileges grant INSERT/UPDATE/
--      DELETE on views too, and the view owner bypasses RLS, so `update firm_public set name…`
--      worked for anon. Every view is now read-only; TRUNCATE/TRIGGER/REFERENCES are revoked on
--      every table (RLS does not govern them); default privileges no longer hand them out.
--   2. Rows on matter-linked tables could name another firm's matter (the policy only checked the
--      writer's own firm_id): check_row_firm() now asserts firm_id matches the matter's or the
--      appointment's firm on every such table; matter_court_numbers' court must be visible.
--   3. Staff-invite tokens were readable by every member and the email check could be defeated by
--      editing profiles.email: invites are admin-only to read; acceptance compares the identity
--      provider's email (JWT claim / auth.users).
--   4. FOR ALL platform policies called is_platform_admin(), whose EXECUTE was revoked from anon, so
--      anon could no longer read the court directory: anon may evaluate it (it is simply false).
--   5. Owners could rename the slug to a reserved platform name or set a custom domain: slug is
--      check-constrained and slug/custom_domain changes are the platform's.
--   6. Platform admins creating a firm for someone else needed no MFA; now they do.
--   7. lawyer_public, services, intake forms and content of pending/suspended firms were public.
--   8. The SCN uniqueness check was a cross-tenant oracle and let a squatter block the real holder:
--      uniqueness is enforced against VERIFIED practitioners only, with a generic message.
--   9. The platform audit view leaked changed columns of firms (subaccount, TIN): narrowed to
--      lifecycle actions.
--  10. The served firm saw the serving firm's documents row (uploaded_by, matter_id) and the serving
--      lawyer's email: the inbox now carries document name/mime, the documents row is no longer
--      readable through service, and practitioner labels never fall back to email.
--  11. proof/authority documents on a service record could reference another firm's document ids;
--      firm_service_directory was readable by any signed-in user.
--  12. A settlement to the wrong subaccount (or to a firm with none) made the webhook return 500
--      forever while the client stayed unconfirmed: it is now recorded as a failed payment flagged
--      settlement_mismatch, the firm is told, and the webhook returns 200.
--  13. Court of Appeal hints carried a literal "<division>" template; only the verified style stays.

-- ---------------------------------------------------------------- 1. views read-only; no TRUNCATE for API roles
revoke insert, update, delete, truncate, references, trigger
  on public.firm_public, public.firm_service_directory, public.firm_admin, public.lawyer_public, public.service_inbox,
     public.reference_data_coverage, public.firm_cause_list, public.partner_attribution
  from anon, authenticated;
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t);
  end loop;
end $$;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;
-- NOTE for future migrations: a new VIEW still receives insert/update/delete from the default
-- privileges — revoke them on every definer view you create (see the block above).

-- ---------------------------------------------------------------- 2. a row belongs to the firm that owns its matter / appointment
create or replace function public.check_row_firm() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb := to_jsonb(new); v_f uuid := (v ->> 'firm_id')::uuid; v_m uuid := (v ->> 'matter_id')::uuid; v_a uuid := (v ->> 'appointment_id')::uuid;
begin
  if v_m is not null and v_f is distinct from (select firm_id from matters where id = v_m) then
    raise exception 'row does not belong to the firm that owns the matter';
  end if;
  if v_a is not null and v_f is distinct from (select firm_id from appointments where id = v_a) then
    raise exception 'row does not belong to the firm that owns the appointment';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['updates','court_events','documents','tasks','matter_lawyers','matter_parties','matter_court_numbers',
                           'messages','invoices','consultation_notes','consultation_internal_notes','intake_responses','invites'] loop
    execute format('create trigger %1$s_check_firm before insert or update on public.%1$s for each row execute function public.check_row_firm()', t);
  end loop;
end $$;
create or replace function public.check_court_visible() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb := to_jsonb(new); v_c uuid := (v ->> 'court_id')::uuid; v_f uuid := (v ->> 'firm_id')::uuid;
begin
  if v_c is not null and not exists (select 1 from courts c where c.id = v_c and (c.firm_id is null or c.firm_id = v_f)) then
    raise exception 'court % is not available to this firm', v_c;
  end if;
  return new;
end $$;
create trigger matter_court_numbers_check_court before insert or update of court_id on public.matter_court_numbers
  for each row execute function public.check_court_visible();

-- ---------------------------------------------------------------- 3. staff invites: admin-only reads, identity-provider email
drop policy staff_invites_select on public.staff_invites;
create policy staff_invites_select on public.staff_invites for select using (admin_w(firm_id));

create or replace function public.accept_staff_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv staff_invites%rowtype; v_email text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_inv from staff_invites where token = p_token and accepted_by is null and expires_at > now() for update;
  if not found then raise exception 'invite invalid or expired'; end if;
  -- the email the identity provider vouches for, never the self-editable profile
  v_email := coalesce(auth.jwt() ->> 'email', (select email from auth.users where id = auth.uid()));
  if v_email is null or lower(v_email) <> lower(v_inv.email) then
    raise exception 'this invite was sent to a different email address' using errcode = '42501';
  end if;
  insert into firm_members (firm_id, user_id, role) values (v_inv.firm_id, auth.uid(), v_inv.role)
  on conflict (firm_id, user_id) do update set role = excluded.role;
  if v_inv.role in ('lawyer','admin','owner') then
    insert into lawyer_profiles (firm_id, user_id, is_public) values (v_inv.firm_id, auth.uid(), false)
    on conflict (firm_id, user_id) do nothing;
  end if;
  update staff_invites set accepted_by = auth.uid() where id = v_inv.id;
  perform audit('staff_invite.accepted', 'staff_invite', v_inv.id, v_inv.firm_id, jsonb_build_object('role', v_inv.role));
  return jsonb_build_object('firm_id', v_inv.firm_id, 'role', v_inv.role);
end $$;

-- ---------------------------------------------------------------- 4. anon may evaluate is_platform_admin() (always false)
grant execute on function public.is_platform_admin() to anon;

-- ---------------------------------------------------------------- 5. slug and custom domain are the platform's to change
alter table public.firms add constraint firms_slug_valid check (is_valid_firm_slug(slug));
create or replace function public.guard_firm_lifecycle_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.status is distinct from old.status or new.verified_at is distinct from old.verified_at or new.plan is distinct from old.plan
      or new.slug is distinct from old.slug or new.custom_domain is distinct from old.custom_domain)
     and not is_platform_admin() and auth.uid() is not null then
    raise exception 'status, plan, verification, slug and custom domain are set by the platform' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- 6. platform admins act with MFA, everywhere
create or replace function public.create_firm(
  p_name text, p_slug text,
  p_legal_name text default null, p_rc_number text default null,
  p_timezone text default 'Africa/Lagos', p_default_currency currency default 'NGN',
  p_reference_prefix text default null, p_state_code text default null,
  p_brand jsonb default '{}', p_owner_email text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_owner uuid; v_firm uuid; v_slug text := lower(trim(p_slug));
        v_prefix text; v_platform bool;
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_platform := is_platform_admin();

  if p_owner_email is not null then
    if not (v_platform and mfa_ok()) then raise exception 'only platform admins (with two-factor) can create a firm for someone else' using errcode = '42501'; end if;
    select id into v_owner from profiles where lower(email) = lower(trim(p_owner_email));
    if v_owner is null then raise exception 'no account with that email yet — the owner must sign up first'; end if;
  else
    v_owner := v_me;
  end if;

  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'firm name is required'; end if;
  if not is_valid_firm_slug(v_slug) then raise exception 'invalid or reserved slug %', v_slug; end if;
  if exists (select 1 from firms where slug = v_slug) then raise exception 'slug % is already taken', v_slug; end if;
  if p_timezone is null or p_timezone not in (select name from pg_timezone_names) then raise exception 'unknown timezone %', p_timezone; end if;
  if p_state_code is not null and nullif(upper(trim(p_state_code)), '') is not null
     and not exists (select 1 from ng_states where code = upper(trim(p_state_code))) then
    raise exception 'unknown state %', p_state_code;
  end if;

  if not v_platform and (select count(*) from firm_members where user_id = v_owner and role = 'owner') >= 3 then
    raise exception 'this account already owns the maximum number of firms';
  end if;

  v_prefix := upper(regexp_replace(coalesce(p_reference_prefix, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_prefix = '' then
    select upper(string_agg(left(w, 1), '')) into v_prefix
    from regexp_split_to_table(trim(p_name), '\s+') w where w ~ '^[A-Za-z]';
    v_prefix := coalesce(left(v_prefix, 4), 'DK');
  end if;

  insert into firms (slug, name, legal_name, rc_number, reference_prefix, timezone, default_currency, state_code, brand, status)
  values (v_slug, trim(p_name), nullif(trim(p_legal_name), ''), nullif(trim(p_rc_number), ''), v_prefix, p_timezone,
          p_default_currency, nullif(upper(trim(p_state_code)), ''), coalesce(p_brand, '{}'), 'pending')
  returning id into v_firm;

  insert into firm_members (firm_id, user_id, role) values (v_firm, v_owner, 'owner');
  perform seed_firm_defaults(v_firm);
  perform audit('firm.created', 'firm', v_firm, v_firm,
                jsonb_build_object('slug', v_slug, 'owner', v_owner, 'by_platform_admin', p_owner_email is not null));

  return jsonb_build_object('firm_id', v_firm, 'slug', v_slug, 'owner_id', v_owner, 'reference_prefix', v_prefix, 'status', 'pending');
end $$;

-- ---------------------------------------------------------------- 7. only active firms are public
create or replace function public.firm_is_active(f uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from firms where id = f and status = 'active') $$;
grant execute on function public.firm_is_active(uuid) to anon, authenticated;

drop view if exists public.lawyer_public;
create view public.lawyer_public with (security_invoker = false) as
  select lp.firm_id, lp.user_id as id, lp.slug, lp.title, lp.bio, lp.photo_path,
         lp.practice_areas, lp.category, lp.year_of_call, p.full_name, p.timezone
  from public.lawyer_profiles lp
  join public.profiles p on p.id = lp.user_id
  join public.firms f on f.id = lp.firm_id and f.status = 'active'
  where lp.is_public;
grant select on public.lawyer_public to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.lawyer_public from anon, authenticated;

drop policy services_select on public.services;
create policy services_select on public.services for select using ((is_active and firm_is_active(firm_id)) or is_firm_member(firm_id));
drop policy intake_forms_select on public.intake_forms;
create policy intake_forms_select on public.intake_forms for select using ((is_active and firm_is_active(firm_id)) or is_firm_member(firm_id));
drop policy content_select on public.content;
create policy content_select on public.content for select using ((status = 'published' and firm_is_active(firm_id)) or is_firm_member(firm_id));

-- ---------------------------------------------------------------- 8. SCN: no oracle, no squatting
create or replace function public.normalise_scn() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.scn is not null then
    new.scn := upper(regexp_replace(new.scn, '\s+', '', 'g'));
    -- a verified practitioner owns the number; unverified duplicates are resolved at verification
    if exists (select 1 from lawyer_profiles lp where lp.scn = new.scn and lp.user_id <> new.user_id and lp.scn_verified_at is not null) then
      raise exception 'this enrolment number cannot be registered — contact Docket support';
    end if;
  end if;
  if (new.scn_verified_at is distinct from (case when tg_op = 'UPDATE' then old.scn_verified_at end))
     and auth.uid() is not null and not is_platform_admin() then
    raise exception 'SCN verification is recorded by the platform' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- 9. platform audit reads: lifecycle only
drop policy audit_log_platform_select on public.audit_log;
create policy audit_log_platform_select on public.audit_log for select
  using (is_platform_admin() and ((entity = 'firm' and action in ('firm.created','firm.status')) or entity = 'firm_members'));

-- ---------------------------------------------------------------- 10. what the served firm sees of the document and the lawyer
create or replace function public.practitioner_label(p_user uuid, p_firm uuid) returns text
  language sql stable security definer set search_path = public as
  $$ select coalesce(nullif(trim(p.full_name), ''), 'counsel') || coalesce(' (' || lp.scn || ')', '')
       from profiles p left join lawyer_profiles lp on lp.user_id = p.id and lp.firm_id = p_firm
      where p.id = p_user $$;

-- the documents row itself is the serving firm's; service grants the pinned version (and its storage object) only
create or replace function public.can_access_document(d uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (
       select 1 from documents doc
       where doc.id = d
         and ( public.is_firm_member(doc.firm_id)
            or (doc.client_visible and doc.deleted_at is null
                and (public.is_matter_party(doc.matter_id) or public.is_appointment_client(doc.appointment_id))) ) ) $$;

drop view if exists public.service_inbox;
create view public.service_inbox with (security_invoker = false) as
  -- INVARIANT: the served firm's ONLY read path. Never select *, never add note / proof / internal columns.
  select ps.id, ps.process_title, ps.case_title, ps.suit_number, ps.court_name, ps.method, ps.served_at,
         ps.is_originating, ps.substituted_by_order, ps.served_on_name, ps.deemed_served_on,
         ps.served_by_name, ps.served_by_scn,
         ps.acknowledged_at, ps.acknowledged_by_name, ps.document_id, ps.document_version_id, ps.checksum,
         d.name as document_name, dv.mime as document_mime, dv.size_bytes as document_size_bytes,
         ps.recipient_matter_id, ps.response_due_on,
         ps.firm_id as serving_firm_id, ps.served_firm_id, mc.party_name as served_for_party
  from public.process_service ps
  join public.matter_counsel mc on mc.id = ps.counsel_id
  join public.documents d on d.id = ps.document_id
  left join public.document_versions dv on dv.id = ps.document_version_id
  where ps.served_firm_id is not null and ps.revoked_at is null and ps.method = 'platform'
    and (public.is_firm_member(ps.served_firm_id) or public.is_firm_member(ps.firm_id));
comment on view public.service_inbox is
  'The served firm''s only read path to a process served on it. Columns are listed explicitly on purpose: adding one widens what opposing counsel sees.';
revoke all on public.service_inbox from anon;
grant select on public.service_inbox to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.service_inbox from anon, authenticated;

-- ---------------------------------------------------------------- 11. service bookkeeping references stay inside the firm; the directory is for firm staff
create or replace function public.check_process_service_refs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.proof_document_id is not null and not exists (select 1 from documents where id = new.proof_document_id and firm_id = new.firm_id) then
    raise exception 'proof of service must be one of your firm''s documents';
  end if;
  if new.authority_document_id is not null and not exists (select 1 from documents where id = new.authority_document_id and firm_id = new.firm_id) then
    raise exception 'the order for substituted service must be one of your firm''s documents';
  end if;
  return new;
end $$;
create trigger process_service_check_refs before insert or update of proof_document_id, authority_document_id on public.process_service
  for each row execute function public.check_process_service_refs();

drop view if exists public.firm_service_directory;
create view public.firm_service_directory with (security_invoker = false) as
  select id, slug, name, legal_name, state_code, accepts_platform_service, address_for_service
  from public.firms
  where status = 'active'
    and exists (select 1 from public.firm_members m where m.user_id = auth.uid());
revoke all on public.firm_service_directory from anon;
grant select on public.firm_service_directory to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.firm_service_directory from anon, authenticated;

-- ---------------------------------------------------------------- 12. a mis-settled payment is recorded, flagged and reported — never retried forever
create or replace function public.record_payment(
  p_provider text, p_provider_ref text, p_invoice_number text,
  p_amount_minor bigint, p_currency currency, p_status payment_status, p_raw jsonb default '{}',
  p_subaccount text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype; v_pay uuid; v_appt appointments%rowtype; v_expected text;
begin
  select * into v_inv from invoices where number = p_invoice_number for update;
  if not found then raise exception 'unknown invoice %', p_invoice_number; end if;
  select paystack_subaccount into v_expected from firms where id = v_inv.firm_id;

  -- money that did not settle to the firm's own subaccount confirms nothing: it is recorded as a
  -- failed payment carrying the mismatch, the firm is told, and the webhook is acknowledged
  if p_status = 'succeeded' and (v_expected is null or p_subaccount is distinct from v_expected) then
    insert into payments (invoice_id, provider, provider_ref, status, amount_minor, currency, paid_at, raw)
    values (v_inv.id, p_provider, p_provider_ref, 'failed', p_amount_minor, p_currency, null,
            coalesce(p_raw, '{}') || jsonb_build_object('settlement_mismatch', true, 'reported_subaccount', p_subaccount, 'expected_subaccount', v_expected))
    on conflict (provider_ref) do nothing
    returning id into v_pay;
    if v_pay is null then return jsonb_build_object('duplicate', true, 'invoice_status', v_inv.status); end if;
    perform audit('payment.settlement_mismatch', 'payment', v_pay, v_inv.firm_id,
                  jsonb_build_object('provider', p_provider, 'ref', p_provider_ref, 'amount_minor', p_amount_minor,
                                     'reported_subaccount', p_subaccount, 'expected_subaccount', v_expected));
    perform enqueue_firm_notification(v_inv.firm_id, 'settlement_mismatch',
      jsonb_build_object('invoice_number', v_inv.number, 'amount_minor', p_amount_minor, 'currency', p_currency,
                         'reported_subaccount', p_subaccount, 'provider_ref', p_provider_ref));
    return jsonb_build_object('payment_id', v_pay, 'settlement_mismatch', true, 'invoice_status', v_inv.status, 'appointment_id', v_inv.appointment_id);
  end if;

  insert into payments (invoice_id, provider, provider_ref, status, amount_minor, currency, paid_at, raw)
  values (v_inv.id, p_provider, p_provider_ref, p_status, p_amount_minor, p_currency,
          case when p_status = 'succeeded' then now() end, p_raw)
  on conflict (provider_ref) do nothing
  returning id into v_pay;
  if v_pay is null then
    return jsonb_build_object('duplicate', true, 'invoice_status', v_inv.status);
  end if;

  if p_status = 'succeeded' then
    if p_currency <> v_inv.currency then raise exception 'currency mismatch on invoice %', p_invoice_number; end if;
    update invoices
       set paid_minor = paid_minor + p_amount_minor,
           status = case when paid_minor + p_amount_minor >= total_minor then 'paid'::invoice_status
                         else 'partially_paid'::invoice_status end
     where id = v_inv.id
     returning * into v_inv;

    if v_inv.status = 'paid' and v_inv.appointment_id is not null then
      update appointments set status = 'confirmed', hold_expires_at = null
       where id = v_inv.appointment_id and status in ('pending','awaiting_payment')
       returning * into v_appt;
      if v_appt.id is not null then
        perform enqueue_notification(v_appt.client_id, v_appt.firm_id, 'appointment_confirmed',
          jsonb_build_object('appointment_id', v_appt.id, 'reference', v_appt.reference, 'starts_at', v_appt.starts_at));
      end if;
    end if;
    perform enqueue_notification(v_inv.client_id, v_inv.firm_id, 'payment_confirmed',
      jsonb_build_object('invoice_number', v_inv.number, 'amount_minor', p_amount_minor, 'currency', p_currency));
  end if;

  perform audit('payment.' || p_status, 'payment', v_pay, v_inv.firm_id,
                jsonb_build_object('provider', p_provider, 'ref', p_provider_ref, 'amount_minor', p_amount_minor, 'subaccount', p_subaccount));
  return jsonb_build_object('payment_id', v_pay, 'invoice_status', v_inv.status, 'appointment_id', v_inv.appointment_id);
end $$;

-- ---------------------------------------------------------------- 13. Court of Appeal hints: verified style only
update public.courts set suit_number_hint = regexp_replace(suit_number_hint, ' or CA/<division>/CV/123/2026$', '')
 where level = 'court_of_appeal' and firm_id is null;
