-- Docket — migration 12: hardening from the platform review.
--
-- Four personas reviewed migrations 9–11 (a second firm's litigation partner,
-- a client in Asaba/Atlanta, a court registrar, a security reviewer) and
-- three Nigerian legal-system fact checks. This migration closes what they
-- found, grouped by theme:
--
--   A. Money settles to the firm — for real. firms.paystack_subaccount was
--      never read: every tenant's fees would have landed in one Paystack
--      account. Prepaid bookings now refuse until the firm has a subaccount,
--      the booking returns it, and record_payment() rejects a settlement to
--      the wrong subaccount.
--   B. A firm is not public until the platform has verified it. Self-serve
--      firms start 'pending'; firm_public lists active firms only; booking
--      refuses inactive firms; verified_at is a platform-admin write. Every
--      firm gets a versioned policies skeleton so the consent gate exists on
--      day one (it shows "not published yet" until the firm writes them).
--   C. Service of process, exhibit-grade. Pinned to the document VERSION
--      (checksum recorded), the served firm reads only its inbox (never the
--      serving firm's row, note or proof), platform service needs the other
--      firm's opt-in, originating processes need counsel's undertaking to
--      accept service, platform service is timestamped by the platform (no
--      backdating), substituted service carries the court's order, service
--      can be revoked, the served firm can link the process to its own
--      matter with a response date. Acknowledgement is evidence of receipt
--      that supports the affidavit of service — never a replacement for it.
--   D. Nigerian reference data, corrected: Court of Appeal numbers in both
--      styles, Lagos and FCT High Court judicial divisions with their own
--      prefixes, Delta's Warri FHC division, a matter carries several court
--      numbers over its life (matter_court_numbers), holidays scoped to a
--      state with an observed date and 2027 seeded, vacations record whether
--      time runs, platform admins maintain all of it through the API
--      (policies courts_platform_write / public_holidays_platform_write / court_vacations_platform_write; the /admin data-entry UI is slice 5).
--   E. Practitioner identity: SCN unique across accounts and normalised,
--      NBA stamp and seal (per practising year) and practising-fee year.
--   F. Firms bring their own lawyers: staff_invites + accept_staff_invite().
--   G. post_court_update() writes court_id and refuses a next date that is
--      not a sitting day unless told the vacation judge will hear it.
--   H. Audit triggers on every new table; a firm-wide notification helper.

-- ================================================================ A. settlement to the firm
alter table public.firms
  add column verified_at              timestamptz,
  add column accepts_platform_service bool  not null default false,
  add column address_for_service      jsonb not null default '{}',
  add column cause_title_style        text;
comment on column public.firms.paystack_subaccount is
  'Paystack subaccount (ACCT_…) that receives this firm''s fees; the platform''s Paystack account only routes. Required before any prepaid booking.';
comment on column public.firms.accepts_platform_service is
  'The firm has undertaken to accept service of non-originating court processes through Docket (its inbox). Off by default.';
comment on column public.firms.address_for_service is
  '{chambers, email, phone, contact_user_id}: the address for service printed on processes; contact_user_id is told first when something is served.';

-- ================================================================ B. lifecycle, verification, policies skeleton
drop view if exists public.firm_public;
create view public.firm_public with (security_invoker = false) as
  select id, slug, name, legal_name, brand, policies, custom_domain, timezone, default_currency,
         paystack_subaccount, (verified_at is not null) as verified
  from public.firms
  where status = 'active';
grant select on public.firm_public to anon, authenticated;

-- staff of active firms may look up other active firms for service (name, address for service, opt-in)
create view public.firm_service_directory with (security_invoker = false) as
  select id, slug, name, legal_name, state_code, accepts_platform_service, address_for_service
  from public.firms where status = 'active';
revoke all on public.firm_service_directory from anon;
grant select on public.firm_service_directory to authenticated;

create or replace function public.seed_firm_defaults(p_firm uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_svc uuid;
begin
  insert into matter_statuses (firm_id, key, label, colour, sort, is_terminal)
  values
    (p_firm, 'new_inquiry',            'New Inquiry',            'slate',   10, false),
    (p_firm, 'consultation_scheduled', 'Consultation Scheduled', 'blue',    20, false),
    (p_firm, 'consultation_completed', 'Consultation Completed', 'blue',    30, false),
    (p_firm, 'awaiting_documents',     'Awaiting Documents',     'amber',   40, false),
    (p_firm, 'under_review',           'Under Review',           'indigo',  50, false),
    (p_firm, 'in_progress',            'In Progress',            'green',   60, false),
    (p_firm, 'filed',                  'Filed in Court',         'green',   65, false),
    (p_firm, 'hearing',                'Hearing Ongoing',        'green',   66, false),
    (p_firm, 'judgment_reserved',      'Judgment Reserved',      'indigo',  67, false),
    (p_firm, 'judgment_delivered',     'Judgment Delivered',     'indigo',  68, false),
    (p_firm, 'appeal',                 'On Appeal',              'indigo',  69, false),
    (p_firm, 'awaiting_client',        'Awaiting Client',        'amber',   70, false),
    (p_firm, 'awaiting_third_party',   'Awaiting Third Party',   'amber',   80, false),
    (p_firm, 'completed',              'Completed',              'gray',    90, true),
    (p_firm, 'closed',                 'Closed',                 'gray',   100, true)
  on conflict (firm_id, key) do nothing;

  if not exists (select 1 from services where firm_id = p_firm) then
    insert into services (firm_id, slug, name, description, price_minor, currency, duration_min,
                          lawyer_category, requires_prepayment, virtual_available, is_active, sort)
    values (p_firm, 'legal-consultation', 'Legal Consultation',
            'A 45-minute face-to-face virtual consultation with a lawyer at the firm.',
            0, (select default_currency from firms where id = p_firm), 45, 'general', true, true, false, 10)
    returning id into v_svc;
  else
    select id into v_svc from services where firm_id = p_firm and slug = 'legal-consultation';
  end if;

  if v_svc is not null and not exists (select 1 from intake_forms where firm_id = p_firm and service_id = v_svc) then
    insert into intake_forms (firm_id, service_id, name, schema, is_active)
    values (p_firm, v_svc, 'Consultation intake',
      jsonb_build_object('questions', jsonb_build_array(
        jsonb_build_object('key','client_type',   'type','choice', 'label','Are you consulting as an individual or for a business?',
                           'options', jsonb_build_array('Individual','Business'), 'required', true),
        jsonb_build_object('key','company_name',  'type','text',   'label','Company name', 'required', true,
                           'show_if', jsonb_build_object('question','client_type','equals','Business')),
        jsonb_build_object('key','area',          'type','choice', 'label','What does your matter concern?', 'required', true,
                           'options', jsonb_build_array('Property or land','Business or contracts','Family','Employment','Debt','Immigration','Intellectual property','Regulatory','Criminal','Other')),
        jsonb_build_object('key','property_location', 'type','text', 'label','Where is the property located (state and area)?',
                           'show_if', jsonb_build_object('question','area','equals','Property or land')),
        jsonb_build_object('key','property_documents', 'type','choice', 'label','Which documents do you hold?',
                           'options', jsonb_build_array('Certificate of Occupancy','Deed of Assignment','Survey plan','Governor''s Consent','None yet'),
                           'multiple', true,
                           'show_if', jsonb_build_object('question','area','equals','Property or land')),
        jsonb_build_object('key','in_court',      'type','choice', 'label','Is this matter already in court?',
                           'options', jsonb_build_array('No','Yes')),
        jsonb_build_object('key','suit_number',   'type','text',   'label','Suit number (if you have it)',
                           'show_if', jsonb_build_object('question','in_court','equals','Yes')),
        jsonb_build_object('key','issue_summary', 'type','longtext', 'label','Briefly describe your legal issue', 'required', true, 'max_length', 2000),
        jsonb_build_object('key','urgency',       'type','choice', 'label','How urgent is this?',
                           'options', jsonb_build_array('Within days','Within weeks','No fixed deadline')),
        jsonb_build_object('key','other_lawyer',  'type','choice', 'label','Is another lawyer currently handling this?',
                           'options', jsonb_build_array('No','Yes')),
        jsonb_build_object('key','documents',     'type','file',   'label','Upload any relevant documents (optional)', 'max_files', 5),
        jsonb_build_object('key','how_heard',     'type','choice', 'label','How did you hear about us?',
                           'options', jsonb_build_array('Referral','Search','Social media','Community or association','Other'))
      )), true);
  end if;

  -- a versioned policies skeleton so the consent gate exists from day one; '0-draft' versions
  -- render as "not published yet" and the firm replaces them in settings before going live
  update firms set policies = jsonb_build_object(
      'terms',        jsonb_build_object('version', '0-draft', 'url', null, 'text', 'To be published by the firm before go-live.'),
      'privacy',      jsonb_build_object('version', '0-draft', 'url', null, 'text', 'To be published by the firm before go-live.'),
      'cancellation', jsonb_build_object('version', '0-draft', 'free_cancel_hours', 24,
                                         'text', 'Consultations may be rescheduled or cancelled free of charge up to 24 hours before the appointment.'),
      'disclaimer',   jsonb_build_object('version', '0-draft',
                                         'text', 'Submitting an inquiry or booking a consultation does not create a lawyer-client relationship. Formal legal advice and representation begin only on a signed engagement.'))
   where id = p_firm and (policies is null or policies = '{}'::jsonb);
end $$;

-- self-serve firms start pending: the console works at once, the public site and booking open when the
-- platform has verified the firm (RC/BN number, the owner's SCN) and set status = 'active'
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
    if not v_platform then raise exception 'only platform admins can create a firm for someone else' using errcode = '42501'; end if;
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

-- platform verification: status and verified_at are the platform's to set; owners edit everything else
create or replace function public.guard_firm_lifecycle_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.status is distinct from old.status or new.verified_at is distinct from old.verified_at or new.plan is distinct from old.plan)
     and not is_platform_admin() and auth.uid() is not null then
    raise exception 'status, plan and verification are set by the platform' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger firms_guard_lifecycle before update on public.firms
  for each row execute function public.guard_firm_lifecycle_columns();

-- ================================================================ A (cont.) booking and payment guards
create or replace function public.available_slots(p_firm uuid, p_lawyer uuid, p_service uuid, p_date date)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_tz text; v_dur int; r record; v_start timestamptz; v_end timestamptz;
        v_day_start timestamptz; v_day_end timestamptz; v_count int;
begin
  select coalesce(p.timezone, f.timezone) into v_tz
    from firms f left join profiles p on p.id = p_lawyer where f.id = p_firm and f.status = 'active';
  select duration_min into v_dur from services where id = p_service and firm_id = p_firm and is_active;
  if v_tz is null or v_dur is null then return; end if;
  if exists (select 1 from availability_exceptions e
             where e.lawyer_id = p_lawyer and e.on_date = p_date and not e.is_available and e.start_time is null) then
    return;
  end if;
  v_day_start := (p_date::timestamp) at time zone v_tz;
  v_day_end   := ((p_date + 1)::timestamp) at time zone v_tz;
  select count(*) into v_count from appointments ap
   where ap.lawyer_id = p_lawyer and ap.status in ('pending','awaiting_payment','confirmed','rescheduled')
     and ap.starts_at >= v_day_start and ap.starts_at < v_day_end;

  for r in select * from availability_rules a
           where a.firm_id = p_firm and a.lawyer_id = p_lawyer and a.weekday = extract(dow from p_date)::int
           order by a.start_time loop
    exit when v_count >= r.max_per_day;
    v_start := (p_date + r.start_time) at time zone v_tz;
    while v_start + make_interval(mins => v_dur) <= (p_date + r.end_time) at time zone v_tz loop
      v_end := v_start + make_interval(mins => v_dur);
      if  v_start >= now() + interval '2 hours'
      and not (r.break_start is not null and r.break_end is not null
               and tstzrange(v_start, v_end) && tstzrange((p_date + r.break_start) at time zone v_tz,
                                                            (p_date + r.break_end)   at time zone v_tz))
      and not exists (select 1 from availability_exceptions e
                      where e.lawyer_id = p_lawyer and e.on_date = p_date and not e.is_available
                        and e.start_time is not null
                        and tstzrange(v_start, v_end) && tstzrange((p_date + e.start_time) at time zone v_tz,
                                                                    (p_date + e.end_time)   at time zone v_tz))
      and not exists (select 1 from appointments ap
                      where ap.lawyer_id = p_lawyer and ap.status in ('pending','awaiting_payment','confirmed','rescheduled')
                        and tstzrange(ap.starts_at, ap.ends_at) && tstzrange(v_start, v_end))
      then
        starts_at := v_start; ends_at := v_end; return next;
      end if;
      v_start := v_start + make_interval(mins => r.slot_min);
    end loop;
  end loop;
end $$;

create or replace function public.book_appointment(
  p_firm uuid, p_service uuid, p_lawyer uuid, p_starts_at timestamptz,
  p_mode appointment_mode default 'virtual', p_client_timezone text default 'Africa/Lagos',
  p_intake jsonb default null, p_intake_form uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid := auth.uid(); v_svc services%rowtype; v_firm firms%rowtype; v_tz text;
        v_ends timestamptz; v_ref text; v_appt uuid; v_inv uuid; v_inv_no text;
        v_vat bigint := 0; v_total bigint := 0; v_status appointment_status;
begin
  if v_client is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_firm from firms where id = p_firm;
  if not found or v_firm.status <> 'active' then raise exception 'this firm is not taking bookings'; end if;
  select * into v_svc  from services where id = p_service and firm_id = p_firm and is_active;
  if not found then raise exception 'service unavailable'; end if;
  if p_mode = 'virtual' and not v_svc.virtual_available then raise exception 'service not available virtually'; end if;
  if v_svc.requires_prepayment and v_svc.price_minor > 0 and v_firm.paystack_subaccount is null then
    raise exception 'this firm is not yet set up to receive payments';
  end if;
  select coalesce(p.timezone, v_firm.timezone) into v_tz from profiles p where p.id = p_lawyer;
  v_tz := coalesce(v_tz, v_firm.timezone);

  if not exists (select 1 from available_slots(p_firm, p_lawyer, p_service, (p_starts_at at time zone v_tz)::date) s
                 where s.starts_at = p_starts_at) then
    raise exception 'slot unavailable';
  end if;

  v_ends   := p_starts_at + make_interval(mins => v_svc.duration_min);
  v_ref    := next_reference(p_firm, 'appointment');
  v_status := case when v_svc.requires_prepayment and v_svc.price_minor > 0 then 'awaiting_payment' else 'confirmed' end;

  begin
    insert into appointments (firm_id, reference, client_id, lawyer_id, service_id, mode, status, starts_at, ends_at,
                              client_timezone, fee_minor, currency, hold_expires_at)
    values (p_firm, v_ref, v_client, p_lawyer, p_service, p_mode, v_status, p_starts_at, v_ends,
            p_client_timezone, v_svc.price_minor, v_svc.currency,
            case when v_status = 'awaiting_payment' then now() + interval '15 minutes' end)
    returning id into v_appt;
  exception when exclusion_violation then
    raise exception 'slot unavailable';
  end;

  if v_svc.price_minor > 0 then
    v_vat   := round(v_svc.price_minor * coalesce(v_firm.vat_rate, 0) / 100.0);
    v_total := v_svc.price_minor + v_vat;
    v_inv_no := next_reference(p_firm, 'invoice');
    insert into invoices (firm_id, number, client_id, appointment_id, currency, subtotal_minor, vat_minor, total_minor,
                          status, issued_at, due_at)
    values (p_firm, v_inv_no, v_client, v_appt, v_svc.currency, v_svc.price_minor, v_vat, v_total,
            'issued', now(), current_date)
    returning id into v_inv;
    insert into invoice_items (invoice_id, description, quantity, unit_minor)
    values (v_inv, format('%s (%s min)', v_svc.name, v_svc.duration_min), 1, v_svc.price_minor);
    update appointments set invoice_id = v_inv where id = v_appt;
  end if;

  if p_intake is not null then
    insert into intake_responses (form_id, firm_id, appointment_id, client_id, answers)
    values (p_intake_form, p_firm, v_appt, v_client, p_intake);
  end if;

  if v_status = 'confirmed' then
    perform enqueue_notification(v_client, p_firm, 'appointment_confirmed',
      jsonb_build_object('appointment_id', v_appt, 'reference', v_ref, 'starts_at', p_starts_at));
  end if;

  return jsonb_build_object('appointment_id', v_appt, 'reference', v_ref, 'status', v_status,
                            'invoice_id', v_inv, 'invoice_number', v_inv_no,
                            'amount_minor', v_total, 'currency', v_svc.currency,
                            'paystack_subaccount', v_firm.paystack_subaccount,
                            'hold_expires_at', case when v_status = 'awaiting_payment' then now() + interval '15 minutes' end);
end $$;

-- record_payment gains the subaccount the provider actually settled to; a mismatch is refused
drop function if exists public.record_payment(text,text,text,bigint,currency,payment_status,jsonb);
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
  if p_status = 'succeeded' and v_expected is not null and p_subaccount is distinct from v_expected then
    raise exception 'settlement account mismatch on invoice %', p_invoice_number;
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
revoke execute on function public.record_payment(text,text,text,bigint,currency,payment_status,jsonb,text) from public, anon, authenticated;

-- ================================================================ H. firm-wide notifications
-- Tells the firm's address-for-service contact (if any) and its owners/admins; lawyers only when asked.
create or replace function public.enqueue_firm_notification(p_firm uuid, p_event text, p_payload jsonb,
                                                            p_roles firm_role[] default array['owner','admin']::firm_role[])
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_contact uuid;
begin
  select nullif(address_for_service ->> 'contact_user_id', '')::uuid into v_contact from firms where id = p_firm;
  for r in select distinct user_id from (
             select user_id from firm_members where firm_id = p_firm and role = any(p_roles)
             union select v_contact where v_contact is not null and exists (select 1 from firm_members where firm_id = p_firm and user_id = v_contact)
           ) u loop
    perform enqueue_notification(r.user_id, p_firm, p_event, p_payload);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.enqueue_firm_notification(uuid,text,jsonb,firm_role[]) from public, anon, authenticated;

-- ================================================================ C. service of process, exhibit-grade
alter type public.service_method add value if not exists 'counsel_address';
alter type public.service_method add value if not exists 'registered_post';
alter type public.service_method add value if not exists 'whatsapp';
alter type public.service_method add value if not exists 'publication';
alter type public.service_method add value if not exists 'pasting';
comment on type public.service_method is
  'How the process reached the other side. ''substituted'' is kept for older rows; new rows record the actual mode and set substituted_by_order with the court''s order.';

-- counsel: which party, on record, undertaking to accept service
alter table public.matter_counsel
  add column party_side      text check (party_side in ('claimant','defendant','appellant','respondent','applicant','prosecution','accused','interested','other')),
  add column on_record       bool not null default false,
  add column accepts_service bool not null default false;
comment on column public.matter_counsel.accepts_service is
  'Counsel has undertaken (in writing, on the record) to accept service for this party. Required before an ORIGINATING process may be served on counsel rather than the party.';
comment on table public.matter_counsel is
  'Counsel for the OTHER parties: an address for service, never portal access. A co-counsel who works our file with portal access is a matter_parties row (role contact) — the two are different things.';
create unique index matter_counsel_firm_once on public.matter_counsel (matter_id, counsel_firm_id) where counsel_firm_id is not null;

-- matter_parties and invites are for clients and their contacts only; counsel never enters through them
alter table public.matter_parties add constraint matter_parties_role_check check (role in ('client','contact'));
alter table public.invites        add constraint invites_role_check        check (role in ('client','contact'));

alter table public.matters add column cause_title text;
comment on column public.matters.cause_title is 'The caption as it appears on the face of the process (e.g. "Okonkwo v Eze & 3 Ors"); title stays the firm''s working name.';

alter table public.process_service
  add column document_version_id  uuid references public.document_versions on delete restrict,
  add column checksum             text,
  add column is_originating       bool not null default false,
  add column substituted_by_order bool not null default false,
  add column authority_document_id uuid references public.documents on delete set null,   -- the order for substituted service
  add column served_on_name       text,
  add column served_on_capacity   text,                                                    -- "litigation clerk at chambers"
  add column served_at_address    text,
  add column server_name          text,                                                    -- who effected service (bailiff, clerk, counsel)
  add column outside_issuing_state bool not null default false,                            -- Sheriffs and Civil Process Act ss.96–99 endorsement
  add column deemed_served_on     date,
  add column revoked_at           timestamptz,
  add column revoked_by           uuid references public.profiles,
  add column revoke_reason        text,
  add column recipient_matter_id  uuid references public.matters on delete set null,       -- the served firm's own matter
  add column recipient_note       text,
  add column response_due_on      date,
  add constraint process_service_substituted_needs_order
    check (not substituted_by_order or authority_document_id is not null);
comment on column public.process_service.acknowledged_at is
  'The served firm''s acknowledgement of receipt in Docket. Evidence that supports the affidavit of service the rules require; not a substitute for it.';

-- the served firm never reads the serving firm's row; its only read path is the inbox view below
drop policy process_service_select on public.process_service;
create policy process_service_select on public.process_service for select using (is_firm_member(firm_id));

-- version-pinned access: the served firm may open exactly the version served, until revoked
create or replace function public.can_access_document_version(v uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (
       select 1 from document_versions dv join documents doc on doc.id = dv.document_id
       where dv.id = v
         and ( public.is_firm_member(doc.firm_id)
            or (doc.client_visible and doc.deleted_at is null
                and (public.is_matter_party(doc.matter_id) or public.is_appointment_client(doc.appointment_id)))
            or exists (select 1 from process_service ps
                       where ps.document_version_id = dv.id and ps.revoked_at is null
                         and public.is_served_firm_member(ps.counsel_id)) ) ) $$;

create or replace function public.can_access_document(d uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (
       select 1 from documents doc
       where doc.id = d
         and ( public.is_firm_member(doc.firm_id)
            or (doc.client_visible and doc.deleted_at is null
                and (public.is_matter_party(doc.matter_id) or public.is_appointment_client(doc.appointment_id)))
            or exists (select 1 from process_service ps
                       where ps.document_id = doc.id and ps.revoked_at is null
                         and public.is_served_firm_member(ps.counsel_id)) ) ) $$;

drop policy document_versions_select on public.document_versions;
create policy document_versions_select on public.document_versions for select using (can_access_document_version(id));

-- storage: reads of documents/{firm}/{document}/{version}.{ext} are version-pinned too
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not present — skipping storage policy update';
    return;
  end if;
  execute $p$ drop policy if exists "documents: read if you can access the document" on storage.objects $p$;
  execute $p$
    create policy "documents: read the version you may access" on storage.objects for select
      using (bucket_id = 'documents'
             and public.can_access_document_version(split_part(storage.filename(name), '.', 1)::uuid))
  $p$;
end $$;

create or replace function public.serve_process(
  p_matter uuid, p_counsel uuid, p_document uuid, p_process_title text,
  p_method public.service_method, p_served_at timestamptz default now(), p_note text default null,
  p_is_originating bool default false, p_substituted_by_order bool default false, p_authority_document uuid default null,
  p_served_on_name text default null, p_served_on_capacity text default null, p_served_at_address text default null,
  p_server_name text default null, p_outside_issuing_state bool default false, p_deemed_served_on date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_m matters%rowtype; v_c matter_counsel%rowtype; v_d documents%rowtype; v_ver document_versions%rowtype;
        v_id uuid; v_firm_name text; v_to text; v_when timestamptz; v_target firms%rowtype;
begin
  select * into v_m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  if not staff_w(v_m.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into v_c from matter_counsel where id = p_counsel and matter_id = p_matter;
  if not found then raise exception 'counsel is not on this matter'; end if;
  select * into v_d from documents where id = p_document and matter_id = p_matter and firm_id = v_m.firm_id and deleted_at is null;
  if not found then raise exception 'document is not on this matter'; end if;
  if v_d.current_version_id is null then raise exception 'document has no uploaded version to serve'; end if;
  select * into v_ver from document_versions where id = v_d.current_version_id;
  if length(trim(coalesce(p_process_title, ''))) = 0 then raise exception 'process title is required'; end if;

  if p_method = 'platform' then
    if v_c.counsel_firm_id is null then raise exception 'counsel is not on Docket — choose another method of service'; end if;
    select * into v_target from firms where id = v_c.counsel_firm_id;
    if v_target.status <> 'active' or not v_target.accepts_platform_service then
      raise exception 'that firm has not undertaken to accept service through Docket — serve at its address for service';
    end if;
    v_when := now();                                          -- platform service is timestamped by the platform
  else
    v_when := coalesce(p_served_at, now());
    if v_when > now() + interval '5 minutes' then raise exception 'service date cannot be in the future'; end if;
    if v_when < now() - interval '90 days' then raise exception 'service date is more than 90 days ago — record it with a note'; end if;
  end if;
  -- an originating process (writ, originating summons, petition, notice of appeal) is served on the party,
  -- not on counsel, unless counsel has undertaken to accept service or the court has ordered otherwise
  if p_is_originating and p_method in ('platform','email','counsel_address','whatsapp') and not v_c.accepts_service and not p_substituted_by_order then
    raise exception 'an originating process may only be served on counsel who has undertaken to accept service, or under an order for substituted service';
  end if;
  if p_substituted_by_order and p_authority_document is null then
    raise exception 'substituted service needs the court''s order attached';
  end if;
  if p_authority_document is not null and not exists (
       select 1 from documents where id = p_authority_document and matter_id = p_matter and firm_id = v_m.firm_id) then
    raise exception 'the order for substituted service must be a document on this matter';
  end if;

  insert into process_service (firm_id, matter_id, counsel_id, document_id, document_version_id, checksum,
                               process_title, case_title, suit_number, court_name,
                               method, served_at, served_by, note, is_originating, substituted_by_order, authority_document_id,
                               served_on_name, served_on_capacity, served_at_address, server_name, outside_issuing_state, deemed_served_on)
  values (v_m.firm_id, p_matter, p_counsel, p_document, v_ver.id, v_ver.checksum,
          trim(p_process_title), coalesce(v_m.cause_title, v_m.title), v_m.suit_number, v_m.court_name,
          p_method, v_when, auth.uid(), p_note, p_is_originating, p_substituted_by_order, p_authority_document,
          p_served_on_name, p_served_on_capacity, p_served_at_address, p_server_name, p_outside_issuing_state, p_deemed_served_on)
  returning id into v_id;

  v_to := coalesce(v_c.counsel_name, v_c.counsel_firm_name, (select name from firms where id = v_c.counsel_firm_id), 'counsel')
          || coalesce(' for ' || v_c.party_name, '');
  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
  values (p_matter, v_m.firm_id, 'filing', 'client',
          format('%s served on %s', trim(p_process_title), v_to), null,
          jsonb_build_object('process_service_id', v_id, 'method', p_method, 'document_id', p_document),
          v_when, auth.uid());

  if v_c.counsel_firm_id is not null then
    select name into v_firm_name from firms where id = v_m.firm_id;
    perform enqueue_firm_notification(v_c.counsel_firm_id, 'process_served',
      jsonb_build_object('process_service_id', v_id, 'process_title', trim(p_process_title),
                         'case_title', coalesce(v_m.cause_title, v_m.title), 'suit_number', v_m.suit_number,
                         'serving_firm_id', v_m.firm_id, 'serving_firm_name', v_firm_name, 'method', p_method));
  end if;

  perform audit('process.served', 'process_service', v_id, v_m.firm_id,
                jsonb_build_object('matter_id', p_matter, 'counsel_id', p_counsel, 'method', p_method,
                                   'document_id', p_document, 'document_version_id', v_ver.id, 'checksum', v_ver.checksum));
  return v_id;
end $$;
-- the 7-argument form from migration 11 is subsumed by the defaults above
drop function if exists public.serve_process(uuid,uuid,uuid,text,public.service_method,timestamptz,text);
revoke execute on function public.serve_process(uuid,uuid,uuid,text,public.service_method,timestamptz,text,bool,bool,uuid,text,text,text,text,bool,date) from public, anon;
grant  execute on function public.serve_process(uuid,uuid,uuid,text,public.service_method,timestamptz,text,bool,bool,uuid,text,text,text,text,bool,date) to authenticated;

create or replace function public.acknowledge_service(p_service uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_s process_service%rowtype; v_c matter_counsel%rowtype; v_ack_firm text;
begin
  select * into v_s from process_service where id = p_service for update;
  if not found then raise exception 'service record not found'; end if;
  select * into v_c from matter_counsel where id = v_s.counsel_id;
  if v_c.counsel_firm_id is null or not staff_w(v_c.counsel_firm_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_s.revoked_at is not null then raise exception 'service was withdrawn by the serving firm'; end if;
  if v_s.acknowledged_at is not null then raise exception 'already acknowledged'; end if;

  update process_service set acknowledged_at = now(), acknowledged_by = auth.uid(), acknowledgement_note = p_note
   where id = p_service;

  select name into v_ack_firm from firms where id = v_c.counsel_firm_id;
  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
  values (v_s.matter_id, v_s.firm_id, 'correspondence', 'internal',
          format('Service of %s acknowledged by %s', v_s.process_title, v_ack_firm), p_note,
          jsonb_build_object('process_service_id', p_service), now(), auth.uid());
  if v_s.served_by is not null then
    perform enqueue_notification(v_s.served_by, v_s.firm_id, 'service_acknowledged',
      jsonb_build_object('process_service_id', p_service, 'process_title', v_s.process_title, 'by_firm', v_ack_firm));
  end if;
  perform audit('process.acknowledged', 'process_service', p_service, v_s.firm_id, jsonb_build_object('by_firm', v_c.counsel_firm_id));
  perform audit('process.acknowledged', 'process_service', p_service, v_c.counsel_firm_id, jsonb_build_object('serving_firm', v_s.firm_id));
end $$;

-- the served firm files the process against its own matter and records when a response is due
create or replace function public.link_service_to_matter(p_service uuid, p_matter uuid, p_response_due_on date default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_s process_service%rowtype; v_c matter_counsel%rowtype; v_m matters%rowtype;
begin
  select * into v_s from process_service where id = p_service for update;
  if not found then raise exception 'service record not found'; end if;
  select * into v_c from matter_counsel where id = v_s.counsel_id;
  if v_c.counsel_firm_id is null or not staff_w(v_c.counsel_firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_s.revoked_at is not null then raise exception 'service was withdrawn by the serving firm'; end if;
  select * into v_m from matters where id = p_matter and firm_id = v_c.counsel_firm_id and deleted_at is null;
  if not found then raise exception 'matter not found in your firm'; end if;
  update process_service set recipient_matter_id = p_matter, response_due_on = p_response_due_on, recipient_note = p_note where id = p_service;
  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
  values (p_matter, v_c.counsel_firm_id, 'correspondence', 'internal',
          format('%s received from %s', v_s.process_title, (select name from firms where id = v_s.firm_id)),
          coalesce(p_note, '') || case when p_response_due_on is not null then format(' Response due %s.', to_char(p_response_due_on, 'FMDD Mon YYYY')) else '' end,
          jsonb_build_object('process_service_id', p_service, 'response_due_on', p_response_due_on), v_s.served_at, auth.uid());
  perform audit('process.filed', 'process_service', p_service, v_c.counsel_firm_id, jsonb_build_object('matter_id', p_matter));
end $$;

-- the serving firm (owner/admin) or the platform withdraws a wrongly served process; access ends at once
create or replace function public.revoke_service(p_service uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_s process_service%rowtype;
begin
  select * into v_s from process_service where id = p_service for update;
  if not found then raise exception 'service record not found'; end if;
  if not (admin_w(v_s.firm_id) or (is_platform_admin() and mfa_ok())) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_s.revoked_at is not null then return; end if;
  update process_service set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = p_reason where id = p_service;
  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
  values (v_s.matter_id, v_s.firm_id, 'correspondence', 'internal',
          format('Service of %s withdrawn', v_s.process_title), p_reason,
          jsonb_build_object('process_service_id', p_service), now(), auth.uid());
  perform audit('process.revoked', 'process_service', p_service, v_s.firm_id, jsonb_build_object('reason', p_reason));
end $$;

drop view if exists public.service_inbox;
create view public.service_inbox with (security_invoker = false) as
  select ps.id, ps.process_title, ps.case_title, ps.suit_number, ps.court_name, ps.method, ps.served_at,
         ps.is_originating, ps.substituted_by_order, ps.served_on_name, ps.deemed_served_on,
         ps.acknowledged_at, ps.document_id, ps.document_version_id, ps.checksum,
         ps.recipient_matter_id, ps.response_due_on,
         ps.firm_id as serving_firm_id, mc.counsel_firm_id as served_firm_id, mc.party_name as served_for_party
  from public.process_service ps
  join public.matter_counsel mc on mc.id = ps.counsel_id
  where mc.counsel_firm_id is not null and ps.revoked_at is null
    and (public.is_firm_member(mc.counsel_firm_id) or public.is_firm_member(ps.firm_id));
revoke all on public.service_inbox from anon;
grant select on public.service_inbox to authenticated;

revoke execute on function public.link_service_to_matter(uuid,uuid,date,text) from public, anon;
grant  execute on function public.link_service_to_matter(uuid,uuid,date,text) to authenticated;
revoke execute on function public.revoke_service(uuid,text) from public, anon;
grant  execute on function public.revoke_service(uuid,text) to authenticated;
revoke execute on function public.can_access_document_version(uuid) from public, anon;
grant  execute on function public.can_access_document_version(uuid) to authenticated;

-- ================================================================ D. reference data, corrected and maintainable
alter table public.courts add column parent_id uuid references public.courts on delete set null,
                          add column address   text;
alter table public.court_events add column courtroom text;

-- Court of Appeal: both numbering styles are in circulation (CA/L/123/2026 and CA/LAG/CV/123/2026)
update public.courts set suit_number_hint =
  case division when 'Lagos' then 'CA/LAG/CV/123/2026 (older: CA/L/123/2026)'
                when 'Abuja' then 'CA/ABJ/CV/123/2026 (older: CA/A/123/2026)'
                else suit_number_hint || ' or CA/<division>/CV/123/2026' end
where level = 'court_of_appeal' and firm_id is null;
update public.courts set name = 'High Court of the Federal Capital Territory, Abuja' where level = 'fct_high' and firm_id is null;
update public.courts set name = 'High Court of Lagos State' where level = 'state_high' and state_code = 'LA' and firm_id is null;

-- Lagos and FCT High Court judicial divisions, each with its own suit prefix; the state row is the parent
insert into public.courts (level, name, short_name, state_code, division, city, suit_number_hint, sort, parent_id)
select 'state_high', 'High Court of Lagos State, ' || d.division || ' Judicial Division', 'Lagos HC ' || d.division,
       'LA', d.division, d.city, d.code || '/1234GCM/2026', 42,
       (select id from public.courts where level = 'state_high' and state_code = 'LA' and division is null and firm_id is null)
from (values ('Lagos','Lagos Island','LD'), ('Ikeja','Ikeja','ID'), ('Ikorodu','Ikorodu','IKD'), ('Epe','Epe','ED'), ('Badagry','Badagry','BD'))
  as d(division, city, code);
insert into public.courts (level, name, short_name, state_code, division, city, suit_number_hint, sort, parent_id)
select 'fct_high', 'High Court of the FCT, ' || d.division || ' Judicial Division', 'FCT HC ' || d.division,
       'FC', d.division, 'Abuja', 'FCT/HC/CV/123/2026', 42,
       (select id from public.courts where level = 'fct_high' and division is null and firm_id is null)
from (values ('Maitama'), ('Apo'), ('Gudu'), ('Wuse'), ('Jabi'), ('Kubwa'), ('Bwari'), ('Gwagwalada'), ('Kuje'), ('Nyanya'), ('Zuba'))
  as d(division);
insert into public.courts (level, name, short_name, state_code, division, city, suit_number_hint, sort)
values ('federal_high', 'Federal High Court, Warri Judicial Division', 'FHC Warri', 'DE', 'Warri', 'Warri', 'FHC/WR/CS/123/2026', 30),
       ('magistrate',   'Small Claims Court of Lagos State', 'Lagos Small Claims', 'LA', null, 'Lagos', 'SCC/<district>/123/2026', 72);

-- a firm admin may correct a colleague's private court (the insert policy still stamps created_by)
drop policy courts_write on public.courts;
create policy courts_insert on public.courts for insert
  with check (firm_id is not null and staff_w(firm_id) and created_by = auth.uid());
create policy courts_update on public.courts for update
  using (firm_id is not null and staff_w(firm_id)) with check (firm_id is not null and staff_w(firm_id));
create policy courts_delete on public.courts for delete using (firm_id is not null and admin_w(firm_id));
-- platform admins maintain the shared directory, holidays and vacations (API now; /admin UI in slice 5)
create policy courts_platform_write on public.courts for all
  using (firm_id is null and is_platform_admin() and mfa_ok()) with check (firm_id is null and is_platform_admin() and mfa_ok());
grant insert, update, delete on public.courts, public.public_holidays, public.court_vacations to authenticated;
create policy public_holidays_platform_write on public.public_holidays for all
  using (is_platform_admin() and mfa_ok()) with check (is_platform_admin() and mfa_ok());
create policy court_vacations_platform_write on public.court_vacations for all
  using (is_platform_admin() and mfa_ok()) with check (is_platform_admin() and mfa_ok());

-- a matter accumulates court numbers over its life (trial suit, appeal, Supreme Court, consolidated)
create table public.matter_court_numbers (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references public.firms on delete cascade,
  matter_id  uuid not null references public.matters on delete cascade,
  court_id   uuid references public.courts on delete set null,
  number     text not null,
  kind       text not null default 'suit' check (kind in ('suit','charge','petition','appeal','motion','consolidated','cross_appeal','other')),
  is_current bool not null default true,
  note       text,
  created_at timestamptz not null default now()
);
comment on table public.matter_court_numbers is
  'Registry numbers are per court and reset yearly — never unique across courts. matters.suit_number stays the current display number.';
create index matter_court_numbers_matter_idx on public.matter_court_numbers (matter_id);
alter table public.matter_court_numbers enable row level security;
create policy matter_court_numbers_select on public.matter_court_numbers for select using (is_firm_member(firm_id) or is_matter_party(matter_id));
create policy matter_court_numbers_write  on public.matter_court_numbers for all using (staff_w(firm_id)) with check (staff_w(firm_id));

-- holidays: state-declared holidays bind state courts; observed_on when the Federal Government shifts a date
alter table public.public_holidays
  add column state_code  text references public.ng_states,
  add column observed_on date,
  add column is_movable  bool not null default false;
alter table public.public_holidays drop constraint public_holidays_pkey;
alter table public.public_holidays add column id uuid not null default gen_random_uuid();
alter table public.public_holidays add primary key (id);
create unique index public_holidays_key on public.public_holidays (country, on_date, coalesce(state_code, ''));
insert into public.public_holidays (on_date, name, is_movable) values
  ('2026-04-03', 'Good Friday', true), ('2026-04-06', 'Easter Monday', true)
on conflict do nothing;
update public.public_holidays set is_movable = true where name in ('Good Friday','Easter Monday');
insert into public.public_holidays (on_date, name, is_movable) values
  ('2027-01-01', 'New Year''s Day', false),
  ('2027-03-26', 'Good Friday', true),
  ('2027-03-29', 'Easter Monday', true),
  ('2027-05-01', 'Workers'' Day', false),
  ('2027-06-12', 'Democracy Day', false),
  ('2027-10-01', 'Independence Day', false),
  ('2027-12-25', 'Christmas Day', false),
  ('2027-12-26', 'Boxing Day', false);

alter table public.court_vacations add column time_runs bool not null default false;
comment on column public.court_vacations.time_runs is
  'Whether time under the rules keeps running during this vacation (Lagos and the FHC suspend it during the annual vacation unless the court directs otherwise).';

create or replace function public.is_public_holiday(p_date date, p_country text default 'NG', p_state text default null) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public_holidays
                    where country = p_country and (on_date = p_date or observed_on = p_date)
                      and (state_code is null or state_code = p_state)) $$;
drop function if exists public.is_public_holiday(date, text);
create or replace function public.is_non_sitting_day(p_date date, p_level public.court_level default null, p_state text default null) returns bool
  language sql stable security definer set search_path = public as
  $$ select extract(isodow from p_date) >= 6
         or public.is_public_holiday(p_date, 'NG', p_state)
         or exists (select 1 from court_vacations v
                    where p_date between v.starts_on and v.ends_on
                      and (v.level is null or v.level = p_level)
                      and (v.state_code is null or v.state_code = p_state)) $$;
grant execute on function public.is_public_holiday(date, text, text) to anon, authenticated;

-- how far ahead the reference data reaches; /admin health shows it
create view public.reference_data_coverage with (security_invoker = false) as
  select (select max(extract(year from on_date))::int from public.public_holidays where state_code is null) as holidays_through_year,
         (select count(*) from public.court_vacations where ends_on >= current_date)                          as upcoming_vacations,
         (select max(ends_on) from public.court_vacations)                                                    as vacations_through,
         (select count(*) from public.courts where firm_id is null and is_active)                              as platform_courts;
grant select on public.reference_data_coverage to authenticated;

-- ================================================================ E. practitioner identity
alter table public.lawyer_profiles
  add column scn_verified_at     timestamptz,
  add column nba_stamp_serial    text,
  add column nba_stamp_year      smallint check (nba_stamp_year between 2015 and 2100),
  add column practising_fee_year smallint check (practising_fee_year between 1900 and 2100);
comment on column public.lawyer_profiles.nba_stamp_serial is 'NBA stamp and seal for the practising year (RPC rule 10); every filed process must bear it.';
comment on column public.lawyer_profiles.practising_fee_year is 'Latest year the annual practising fee was paid (RPC rule 9, due 31 March).';

create or replace function public.normalise_scn() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.scn is not null then
    new.scn := upper(regexp_replace(new.scn, '\s+', '', 'g'));
    if exists (select 1 from lawyer_profiles lp where lp.scn = new.scn and lp.user_id <> new.user_id) then
      raise exception 'enrolment number % is already registered to another practitioner', new.scn;
    end if;
  end if;
  if (new.scn_verified_at is distinct from (case when tg_op = 'UPDATE' then old.scn_verified_at end))
     and auth.uid() is not null and not is_platform_admin() then
    raise exception 'SCN verification is recorded by the platform' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger lawyer_profiles_scn before insert or update on public.lawyer_profiles
  for each row execute function public.normalise_scn();

-- ================================================================ F. firms bring their own lawyers
create table public.staff_invites (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms on delete cascade,
  email       text not null,
  role        firm_role not null default 'lawyer',
  token       text unique not null default encode(gen_random_bytes(24), 'hex'),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_by uuid references public.profiles,
  created_by  uuid references public.profiles,
  created_at  timestamptz not null default now(),
  check (role <> 'owner')
);
create index staff_invites_firm_idx on public.staff_invites (firm_id) where accepted_by is null;
alter table public.staff_invites enable row level security;
create policy staff_invites_select on public.staff_invites for select using (is_firm_member(firm_id));
create policy staff_invites_write  on public.staff_invites for all using (admin_w(firm_id)) with check (admin_w(firm_id) and created_by = auth.uid());

create or replace function public.accept_staff_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv staff_invites%rowtype; v_email text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_inv from staff_invites where token = p_token and accepted_by is null and expires_at > now() for update;
  if not found then raise exception 'invite invalid or expired'; end if;
  select email into v_email from profiles where id = auth.uid();
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
revoke execute on function public.accept_staff_invite(text) from public, anon;
grant  execute on function public.accept_staff_invite(text) to authenticated;

-- ================================================================ G. post_court_update: structured court, sitting-day check
drop function if exists public.post_court_update(uuid,text,timestamptz,text,text,timestamptz,text,text,text);
create or replace function public.post_court_update(
  p_matter uuid, p_outcome text, p_occurred_at timestamptz default now(), p_court_name text default null,
  p_adjourned_at_instance_of text default null, p_next_date timestamptz default null, p_next_purpose text default null,
  p_note_to_client text default null, p_internal_note text default null,
  p_court_id uuid default null, p_judicial_division text default null, p_allow_non_sitting bool default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_m matters%rowtype; v_tz text; v_title text; v_update uuid; v_next_txt text; v_court courts%rowtype; v_court_name text;
begin
  select * into v_m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  if not staff_w(v_m.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_outcome not in ('hearing_held','adjourned','ruling_delivered','judgment_delivered','struck_out','stood_down','mention','court_did_not_sit') then
    raise exception 'unknown outcome %', p_outcome;
  end if;
  select coalesce(p.timezone, f.timezone) into v_tz from firms f left join profiles p on p.id = auth.uid() where f.id = v_m.firm_id;

  if p_court_id is not null then
    select * into v_court from courts where id = p_court_id and (firm_id is null or firm_id = v_m.firm_id);
    if not found then raise exception 'court % is not available to this firm', p_court_id; end if;
  elsif v_m.court_id is not null then
    select * into v_court from courts where id = v_m.court_id;
  end if;
  v_court_name := coalesce(p_court_name,
                           case when v_court.id is not null then v_court.name || coalesce(', ' || coalesce(p_judicial_division, v_m.judicial_division), '') end,
                           v_m.court_name);

  if p_next_date is not null and not p_allow_non_sitting
     and is_non_sitting_day((p_next_date at time zone v_tz)::date, v_court.level, v_court.state_code) then
    raise exception 'next date % is a weekend, public holiday or court vacation — confirm the vacation judge will sit (p_allow_non_sitting)',
      to_char(p_next_date at time zone v_tz, 'FMDD Mon YYYY');
  end if;

  v_next_txt := case when p_next_date is not null
                     then to_char(p_next_date at time zone v_tz, 'FMDD Mon YYYY')
                          || coalesce(' for ' || p_next_purpose, '') end;

  v_title := case p_outcome
    when 'hearing_held'       then 'Hearing held'
    when 'adjourned'          then 'Adjourned' || coalesce(' at the instance of ' || p_adjourned_at_instance_of, '')
                                   || coalesce(' to ' || v_next_txt, '')
    when 'ruling_delivered'   then 'Ruling delivered'
    when 'judgment_delivered' then 'Judgment delivered'
    when 'struck_out'         then 'Matter struck out'
    when 'stood_down'         then 'Matter stood down'
    when 'mention'            then 'Matter came up for mention'
    when 'court_did_not_sit'  then 'Court did not sit'
  end;
  if p_outcome <> 'adjourned' and v_next_txt is not null then
    v_title := v_title || ' — next date ' || v_next_txt;
  end if;

  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
  values (p_matter, v_m.firm_id, 'court_sitting', 'client', v_title, p_note_to_client,
          jsonb_build_object('outcome', p_outcome, 'court_name', v_court_name, 'court_id', v_court.id,
                             'adjourned_at_instance_of', p_adjourned_at_instance_of,
                             'next_date', p_next_date, 'next_purpose', p_next_purpose),
          p_occurred_at, auth.uid())
  returning id into v_update;

  if p_internal_note is not null and length(trim(p_internal_note)) > 0 then
    insert into updates (matter_id, firm_id, kind, visibility, title, body, occurred_at, posted_by)
    values (p_matter, v_m.firm_id, 'note', 'internal', 'Internal note — ' || v_title, p_internal_note, p_occurred_at, auth.uid());
  end if;

  update court_events set outcome_update_id = v_update
   where matter_id = p_matter and outcome_update_id is null
     and (scheduled_at at time zone v_tz)::date = (p_occurred_at at time zone v_tz)::date;

  if p_next_date is not null then
    insert into court_events (matter_id, firm_id, scheduled_at, court_name, court_id, purpose)
    values (p_matter, v_m.firm_id, p_next_date, v_court_name, v_court.id, p_next_purpose);
    update matters set next_event_at = p_next_date, next_event_note = p_next_purpose,
                       court_name = coalesce(v_court_name, court_name),
                       court_id = coalesce(v_court.id, court_id),
                       judicial_division = coalesce(p_judicial_division, judicial_division)
     where id = p_matter;
  else
    update matters set next_event_at = null, next_event_note = null,
                       court_id = coalesce(v_court.id, court_id),
                       judicial_division = coalesce(p_judicial_division, judicial_division)
     where id = p_matter;
  end if;

  return v_update;
end $$;
revoke execute on function public.post_court_update(uuid,text,timestamptz,text,text,timestamptz,text,text,text,uuid,text,bool) from public, anon;
grant  execute on function public.post_court_update(uuid,text,timestamptz,text,text,timestamptz,text,text,text,uuid,text,bool) to authenticated;

-- ================================================================ H. audit every new table
do $$
declare t text;
begin
  foreach t in array array['matter_counsel','process_service','courts','court_vacations','public_holidays',
                           'lawyer_profiles','platform_admins','staff_invites','matter_court_numbers'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.audit_row_change()', t);
  end loop;
end $$;
