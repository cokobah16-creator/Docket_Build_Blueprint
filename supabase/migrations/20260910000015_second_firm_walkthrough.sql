-- Docket — migration 15: what a second firm's IT lead hit when following only the docs.
--
--   1. Partnerships have several owners: an existing OWNER may invite an owner (an admin may not).
--   2. The firm's registrant is a practitioner: create_firm() takes the owner's enrolment number,
--      opens their (private) lawyer profile, and firm_admin shows owners' SCNs so verification has
--      something to check.
--   3. A client cannot be asked to consent to unpublished drafts, and cannot book without terms
--      to consent to: book_appointment() refuses while terms or privacy are missing or '0-…'.
--   4. Staff could not open a matter (next_reference() is service-only): open_matter() creates the
--      matter with its reference, the client party, the lead lawyer, the court and suit number,
--      posts the first client-visible entry and audits it.

-- ---------------------------------------------------------------- 1. owner invites
alter table public.staff_invites drop constraint staff_invites_role_check;
create or replace function public.check_staff_invite_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'owner' and auth.uid() is not null
     and not has_firm_role(new.firm_id, array['owner']::firm_role[]) then
    raise exception 'only an owner may invite another owner' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger staff_invites_check_role before insert or update of role on public.staff_invites
  for each row execute function public.check_staff_invite_role();

-- ---------------------------------------------------------------- 2. the registrant is a practitioner
drop function if exists public.create_firm(text,text,text,text,text,currency,text,text,jsonb,text);
create or replace function public.create_firm(
  p_name text, p_slug text,
  p_legal_name text default null, p_rc_number text default null,
  p_timezone text default 'Africa/Lagos', p_default_currency currency default 'NGN',
  p_reference_prefix text default null, p_state_code text default null,
  p_brand jsonb default '{}', p_owner_email text default null, p_owner_scn text default null)
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
  -- the owner's practitioner profile: private until they complete it; SCN verified by the platform
  insert into lawyer_profiles (firm_id, user_id, is_public, scn) values (v_firm, v_owner, false, nullif(trim(coalesce(p_owner_scn, '')), ''));
  perform seed_firm_defaults(v_firm);
  perform audit('firm.created', 'firm', v_firm, v_firm,
                jsonb_build_object('slug', v_slug, 'owner', v_owner, 'by_platform_admin', p_owner_email is not null));

  return jsonb_build_object('firm_id', v_firm, 'slug', v_slug, 'owner_id', v_owner, 'reference_prefix', v_prefix, 'status', 'pending');
end $$;
revoke execute on function public.create_firm(text,text,text,text,text,currency,text,text,jsonb,text,text) from public, anon;
grant  execute on function public.create_firm(text,text,text,text,text,currency,text,text,jsonb,text,text) to authenticated;

drop view if exists public.firm_admin;
create view public.firm_admin with (security_invoker = false) as
  select f.id, f.slug, f.name, f.legal_name, f.rc_number, f.state_code, f.plan, f.status, f.verified_at, f.custom_domain,
         (f.paystack_subaccount is not null) as has_settlement_account, f.created_at,
         (select count(*) from public.firm_members m where m.firm_id = f.id) as member_count,
         (select string_agg(coalesce(p.full_name, p.email, '?') || coalesce(' — ' || lp.scn, ' — no SCN'), '; ')
            from public.firm_members m
            join public.profiles p on p.id = m.user_id
            left join public.lawyer_profiles lp on lp.firm_id = f.id and lp.user_id = m.user_id
           where m.firm_id = f.id and m.role = 'owner') as owners,
         (f.policies -> 'terms' ->> 'version') not like '0-%' and (f.policies -> 'privacy' ->> 'version') not like '0-%' as policies_published
  from public.firms f
  where public.is_platform_admin();
revoke all on public.firm_admin from anon;
grant select on public.firm_admin to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.firm_admin from anon, authenticated;

-- ---------------------------------------------------------------- 3. no booking without published terms
create or replace function public.firm_policies_published(f uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from firms
                    where id = f
                      and coalesce(policies -> 'terms' ->> 'version', '') not like '0-%' and coalesce(policies -> 'terms' ->> 'version', '') <> ''
                      and coalesce(policies -> 'privacy' ->> 'version', '') not like '0-%' and coalesce(policies -> 'privacy' ->> 'version', '') <> '') $$;
grant execute on function public.firm_policies_published(uuid) to anon, authenticated;

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
  if not firm_policies_published(p_firm) then raise exception 'this firm has not published its terms and privacy notice yet'; end if;
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

-- ---------------------------------------------------------------- 4. open a matter
create or replace function public.open_matter(
  p_firm uuid, p_title text, p_type matter_type,
  p_client uuid default null, p_cause_title text default null, p_description text default null,
  p_court_id uuid default null, p_suit_number text default null, p_judicial_division text default null,
  p_originating_lawyer uuid default null, p_handling_lawyer uuid default null,
  p_status_key text default 'new_inquiry', p_note_to_client text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text; v_status uuid; v_lead uuid;
begin
  if not staff_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  if length(trim(coalesce(p_title, ''))) < 2 then raise exception 'matter title is required'; end if;
  if p_client is not null and not exists (select 1 from profiles where id = p_client) then raise exception 'client account not found'; end if;
  if p_client is not null and exists (select 1 from firm_members where firm_id = p_firm and user_id = p_client) then
    raise exception 'a member of the firm cannot be its client on a matter';
  end if;
  select id into v_status from matter_statuses where firm_id = p_firm and key = coalesce(p_status_key, 'new_inquiry');
  v_lead := coalesce(p_handling_lawyer, auth.uid());
  if not exists (select 1 from firm_members where firm_id = p_firm and user_id = v_lead) then raise exception 'handling lawyer is not a member of the firm'; end if;
  if p_originating_lawyer is not null and not exists (select 1 from firm_members where firm_id = p_firm and user_id = p_originating_lawyer) then
    raise exception 'originating lawyer is not a member of the firm';
  end if;

  v_ref := next_reference(p_firm, 'matter');
  insert into matters (firm_id, reference, title, cause_title, type, status_id, description, court_id, suit_number, judicial_division,
                       originating_lawyer_id, handling_lawyer_id, created_by)
  values (p_firm, v_ref, trim(p_title), nullif(trim(coalesce(p_cause_title, '')), ''), p_type, v_status, p_description, p_court_id,
          nullif(trim(coalesce(p_suit_number, '')), ''), p_judicial_division, coalesce(p_originating_lawyer, v_lead), v_lead, auth.uid())
  returning id into v_id;
  insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values (v_id, p_firm, v_lead, true);
  if p_suit_number is not null and length(trim(p_suit_number)) > 0 then
    insert into matter_court_numbers (firm_id, matter_id, court_id, number, kind) values (p_firm, v_id, p_court_id, trim(p_suit_number), 'suit');
  end if;
  if p_client is not null then
    insert into matter_parties (matter_id, firm_id, user_id, role, invited_by) values (v_id, p_firm, p_client, 'client', auth.uid());
    insert into updates (matter_id, firm_id, kind, visibility, title, body, occurred_at, posted_by)
    values (v_id, p_firm, 'milestone', 'client', 'Matter opened: ' || trim(p_title),
            coalesce(p_note_to_client, 'Your matter has been opened. Updates on every court sitting and filing will appear here.'), now(), auth.uid());
  end if;
  perform audit('matter.opened', 'matter', v_id, p_firm, jsonb_build_object('reference', v_ref, 'client', p_client, 'court_id', p_court_id));
  return jsonb_build_object('matter_id', v_id, 'reference', v_ref);
end $$;
revoke execute on function public.open_matter(uuid,text,matter_type,uuid,text,text,uuid,text,text,uuid,uuid,text,text) from public, anon;
grant  execute on function public.open_matter(uuid,text,matter_type,uuid,text,text,uuid,text,text,uuid,uuid,text,text) to authenticated;
