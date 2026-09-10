-- Docket — migration 13: security and registrar review of migrations 9–12.
--
-- A security reviewer probed the served-firm surface and the platform-admin
-- surface with live queries; a court registrar reviewed what a sitting record
-- needs. Everything confirmed is closed here:
--
--   1. Served-firm access is pinned to process_service.served_firm_id, set
--      once at service time — never to the mutable matter_counsel row — and
--      only platform service grants it; a counsel row that has been served
--      cannot be re-pointed at another firm.
--   2. Storage uploads use can_upload_document(): no served-firm branch, so
--      opposing counsel can never write into the serving firm's folder.
--   3. lawyer_profiles is member-only; the public site reads lawyer_public.
--   4. A suspended firm's staff cannot write (staff_w / admin_w), and neither
--      side of a service may be pending or suspended.
--   5. Platform admins lose the row-level update on firms: they read the
--      lifecycle-only firm_admin view and change status through
--      set_firm_status(); the settlement subaccount is read by the paying
--      client through invoice_settlement(), not from firm_public.
--   6. Acknowledgement needs an owner/admin/lawyer of the served firm; the
--      record snapshots who served and who acknowledged by name and SCN.
--   7. matter_counsel.firm_id must be the matter's firm; court_events.court_id
--      is guarded like matters.court_id.
--   8. create_firm() validates brand JSON (it is rendered into CSS and a
--      fonts URL for every visitor).
--   9. Registrar: a fixed date can be vacated and refixed (reminders and the
--      digest skip vacated dates), hearing notices and adjournments sine die
--      are outcomes, sittings carry judge / courtroom / purpose kind, suit
--      numbers get a normalised match key, firm_cause_list lists the day's
--      sittings by court, and every suit-number hint we could not verify is
--      null rather than invented.

-- ================================================================ 1. served-firm access pinned at service time
alter table public.process_service
  add column served_firm_id       uuid references public.firms on delete restrict,
  add column served_by_name       text,
  add column served_by_scn        text,
  add column acknowledged_by_name text;
update public.process_service ps set served_firm_id = mc.counsel_firm_id
  from public.matter_counsel mc where mc.id = ps.counsel_id and ps.method = 'platform';
comment on column public.process_service.served_firm_id is
  'The firm that received platform service, fixed at service time. Every served-firm read is keyed on this column, never on matter_counsel.';

-- member of the firm that was served through the platform (the only method that grants access)
create or replace function public.is_served_firm(p_service uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from process_service ps
                    where ps.id = p_service and ps.served_firm_id is not null and ps.revoked_at is null
                      and ps.method = 'platform' and public.is_firm_member(ps.served_firm_id)) $$;
revoke execute on function public.is_served_firm(uuid) from public, anon;
grant  execute on function public.is_served_firm(uuid) to authenticated;

create or replace function public.can_access_document(d uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (
       select 1 from documents doc
       where doc.id = d
         and ( public.is_firm_member(doc.firm_id)
            or (doc.client_visible and doc.deleted_at is null
                and (public.is_matter_party(doc.matter_id) or public.is_appointment_client(doc.appointment_id)))
            or exists (select 1 from process_service ps where ps.document_id = doc.id and public.is_served_firm(ps.id)) ) ) $$;

create or replace function public.can_access_document_version(v uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (
       select 1 from document_versions dv join documents doc on doc.id = dv.document_id
       where dv.id = v
         and ( public.is_firm_member(doc.firm_id)
            or (doc.client_visible and doc.deleted_at is null
                and (public.is_matter_party(doc.matter_id) or public.is_appointment_client(doc.appointment_id)))
            or exists (select 1 from process_service ps where ps.document_version_id = dv.id and public.is_served_firm(ps.id)) ) ) $$;

-- a counsel row that has been served through the platform is frozen to that firm; counsel rows belong to the matter's firm
create or replace function public.check_matter_counsel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.firm_id <> (select firm_id from matters where id = new.matter_id) then
    raise exception 'counsel rows belong to the firm that owns the matter';
  end if;
  if tg_op = 'UPDATE' and new.counsel_firm_id is distinct from old.counsel_firm_id
     and exists (select 1 from process_service where counsel_id = old.id and served_firm_id is not null) then
    raise exception 'this counsel has been served through Docket — record new counsel as a new row';
  end if;
  return new;
end $$;
create trigger matter_counsel_check before insert or update on public.matter_counsel
  for each row execute function public.check_matter_counsel();

-- ================================================================ 2. uploads never follow service
create or replace function public.can_upload_document(d uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (
       select 1 from documents doc
       where doc.id = d and doc.deleted_at is null
         and ( public.staff_w(doc.firm_id)
            or (doc.client_visible
                and (public.is_matter_party(doc.matter_id) or public.is_appointment_client(doc.appointment_id))) ) ) $$;
revoke execute on function public.can_upload_document(uuid) from public, anon;
grant  execute on function public.can_upload_document(uuid) to authenticated;
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not present — skipping storage upload policy update';
    return;
  end if;
  execute $p$ drop policy if exists "documents: upload if you can access the document" on storage.objects $p$;
  execute $p$
    create policy "documents: upload if you may add to the document" on storage.objects for insert
      with check (bucket_id = 'documents'
                  and public.can_upload_document(((storage.foldername(name))[2])::uuid))
  $p$;
end $$;
drop policy document_versions_insert on public.document_versions;
create policy document_versions_insert on public.document_versions for insert
  with check (uploaded_by = auth.uid() and can_upload_document(document_id));

-- ================================================================ 3. practitioner records are the firm's
drop policy lawyer_profiles_select on public.lawyer_profiles;
create policy lawyer_profiles_select on public.lawyer_profiles for select using (is_firm_member(firm_id));
revoke select on public.lawyer_profiles from anon;
-- the public site keeps reading the anon-safe lawyer_public projection (name, title, bio, practice areas, year of call)

-- ================================================================ 4. suspension bites
create or replace function public.firm_not_suspended(f uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from firms where id = f and status <> 'suspended') $$;
create or replace function public.staff_w(f uuid) returns bool
  language sql stable set search_path = public as
  $$ select public.is_firm_member(f) and public.mfa_ok() and public.firm_not_suspended(f) $$;
create or replace function public.admin_w(f uuid) returns bool
  language sql stable set search_path = public as
  $$ select public.has_firm_role(f, array['owner','admin']::firm_role[]) and public.mfa_ok() and public.firm_not_suspended(f) $$;

-- ================================================================ 5. platform admin: lifecycle only, through RPCs
drop policy firms_platform_update on public.firms;
drop policy firms_platform_select on public.firms;
create view public.firm_admin with (security_invoker = false) as
  select id, slug, name, legal_name, rc_number, state_code, plan, status, verified_at, custom_domain,
         (paystack_subaccount is not null) as has_settlement_account, created_at,
         (select count(*) from public.firm_members m where m.firm_id = f.id) as member_count
  from public.firms f
  where public.is_platform_admin();
revoke all on public.firm_admin from anon;
grant select on public.firm_admin to authenticated;

create or replace function public.set_firm_status(p_firm uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not (is_platform_admin() and mfa_ok()) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_status not in ('pending','active','suspended') then raise exception 'unknown status %', p_status; end if;
  select status into v_old from firms where id = p_firm for update;
  if not found then raise exception 'firm not found'; end if;
  update firms set status = p_status,
                   verified_at = case when p_status = 'active' then coalesce(verified_at, now()) else verified_at end
   where id = p_firm;
  perform audit('firm.status', 'firm', p_firm, p_firm, jsonb_build_object('from', v_old, 'to', p_status, 'note', p_note));
  if p_status = 'active' and v_old = 'pending' then
    perform enqueue_firm_notification(p_firm, 'firm_activated', jsonb_build_object('firm_id', p_firm));
  end if;
end $$;
revoke execute on function public.set_firm_status(uuid,text,text) from public, anon;
grant  execute on function public.set_firm_status(uuid,text,text) to authenticated;

-- the paying client learns the settlement subaccount for her own invoice; firm_public no longer carries it
drop view if exists public.firm_public;
create view public.firm_public with (security_invoker = false) as
  select id, slug, name, legal_name, brand, policies, custom_domain, timezone, default_currency,
         (verified_at is not null) as verified
  from public.firms
  where status = 'active';
grant select on public.firm_public to anon, authenticated;

create or replace function public.invoice_settlement(p_invoice uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype; v_sub text; v_status text;
begin
  select * into v_inv from invoices where id = p_invoice;
  if not found or not (v_inv.client_id = auth.uid() or is_firm_member(v_inv.firm_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select paystack_subaccount, status into v_sub, v_status from firms where id = v_inv.firm_id;
  return jsonb_build_object('paystack_subaccount', v_sub, 'firm_status', v_status,
                            'invoice_number', v_inv.number, 'total_minor', v_inv.total_minor, 'currency', v_inv.currency);
end $$;
revoke execute on function public.invoice_settlement(uuid) from public, anon;
grant  execute on function public.invoice_settlement(uuid) to authenticated;

-- ================================================================ 6. who served, who acknowledged
create or replace function public.practitioner_label(p_user uuid, p_firm uuid) returns text
  language sql stable security definer set search_path = public as
  $$ select coalesce(p.full_name, p.email, 'staff') || coalesce(' (' || lp.scn || ')', '')
       from profiles p left join lawyer_profiles lp on lp.user_id = p.id and lp.firm_id = p_firm
      where p.id = p_user $$;
revoke execute on function public.practitioner_label(uuid,uuid) from public, anon, authenticated;

create or replace function public.serve_process(
  p_matter uuid, p_counsel uuid, p_document uuid, p_process_title text,
  p_method public.service_method, p_served_at timestamptz default now(), p_note text default null,
  p_is_originating bool default false, p_substituted_by_order bool default false, p_authority_document uuid default null,
  p_served_on_name text default null, p_served_on_capacity text default null, p_served_at_address text default null,
  p_server_name text default null, p_outside_issuing_state bool default false, p_deemed_served_on date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_m matters%rowtype; v_c matter_counsel%rowtype; v_d documents%rowtype; v_ver document_versions%rowtype;
        v_id uuid; v_firm firms%rowtype; v_to text; v_when timestamptz; v_target firms%rowtype; v_served_firm uuid;
        v_scn text;
begin
  select * into v_m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  if not staff_w(v_m.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into v_firm from firms where id = v_m.firm_id;
  if v_firm.status <> 'active' then raise exception 'your firm must be active on Docket to serve processes'; end if;
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
    v_when := now();
    v_served_firm := v_c.counsel_firm_id;
  else
    v_when := coalesce(p_served_at, now());
    if v_when > now() + interval '5 minutes' then raise exception 'service date cannot be in the future'; end if;
    if v_when < now() - interval '90 days' then raise exception 'service date is more than 90 days ago — record it with a note'; end if;
  end if;
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

  select scn into v_scn from lawyer_profiles where firm_id = v_m.firm_id and user_id = auth.uid();
  insert into process_service (firm_id, matter_id, counsel_id, served_firm_id, document_id, document_version_id, checksum,
                               process_title, case_title, suit_number, court_name,
                               method, served_at, served_by, served_by_name, served_by_scn, note,
                               is_originating, substituted_by_order, authority_document_id,
                               served_on_name, served_on_capacity, served_at_address, server_name, outside_issuing_state, deemed_served_on)
  values (v_m.firm_id, p_matter, p_counsel, v_served_firm, p_document, v_ver.id, v_ver.checksum,
          trim(p_process_title), coalesce(v_m.cause_title, v_m.title), v_m.suit_number, v_m.court_name,
          p_method, v_when, auth.uid(), practitioner_label(auth.uid(), v_m.firm_id), v_scn, p_note,
          p_is_originating, p_substituted_by_order, p_authority_document,
          p_served_on_name, p_served_on_capacity, p_served_at_address, p_server_name, p_outside_issuing_state, p_deemed_served_on)
  returning id into v_id;

  v_to := coalesce(v_c.counsel_name, v_c.counsel_firm_name, (select name from firms where id = v_c.counsel_firm_id), 'counsel')
          || coalesce(' for ' || v_c.party_name, '');
  insert into updates (matter_id, firm_id, kind, visibility, title, payload, occurred_at, posted_by)
  values (p_matter, v_m.firm_id, 'service', 'client',
          format('%s served on %s', trim(p_process_title), v_to),
          jsonb_build_object('process_service_id', v_id, 'method', p_method, 'document_id', p_document),
          v_when, auth.uid());

  if v_served_firm is not null then
    perform enqueue_firm_notification(v_served_firm, 'process_served',
      jsonb_build_object('process_service_id', v_id, 'process_title', trim(p_process_title),
                         'case_title', coalesce(v_m.cause_title, v_m.title), 'suit_number', v_m.suit_number,
                         'serving_firm_id', v_m.firm_id, 'serving_firm_name', v_firm.name, 'method', p_method));
    perform audit('process.received', 'process_service', v_id, v_served_firm,
                  jsonb_build_object('serving_firm', v_m.firm_id, 'process_title', trim(p_process_title)));
  end if;

  perform audit('process.served', 'process_service', v_id, v_m.firm_id,
                jsonb_build_object('matter_id', p_matter, 'counsel_id', p_counsel, 'method', p_method,
                                   'document_id', p_document, 'document_version_id', v_ver.id, 'checksum', v_ver.checksum));
  return v_id;
end $$;

create or replace function public.acknowledge_service(p_service uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_s process_service%rowtype; v_ack_firm text;
begin
  select * into v_s from process_service where id = p_service for update;
  if not found then raise exception 'service record not found'; end if;
  if v_s.served_firm_id is null
     or not (has_firm_role(v_s.served_firm_id, array['owner','admin','lawyer']::firm_role[]) and mfa_ok() and firm_not_suspended(v_s.served_firm_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_s.revoked_at is not null then raise exception 'service was withdrawn by the serving firm'; end if;
  if v_s.acknowledged_at is not null then raise exception 'already acknowledged'; end if;

  select name into v_ack_firm from firms where id = v_s.served_firm_id;
  update process_service
     set acknowledged_at = now(), acknowledged_by = auth.uid(), acknowledgement_note = p_note,
         acknowledged_by_name = practitioner_label(auth.uid(), v_s.served_firm_id) || ', ' || v_ack_firm
   where id = p_service;

  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
  values (v_s.matter_id, v_s.firm_id, 'service', 'internal',
          format('Service of %s acknowledged by %s', v_s.process_title, v_ack_firm), p_note,
          jsonb_build_object('process_service_id', p_service), now(), auth.uid());
  if v_s.served_by is not null then
    perform enqueue_notification(v_s.served_by, v_s.firm_id, 'service_acknowledged',
      jsonb_build_object('process_service_id', p_service, 'process_title', v_s.process_title, 'by_firm', v_ack_firm, 'matter_id', v_s.matter_id));
  end if;
  perform audit('process.acknowledged', 'process_service', p_service, v_s.firm_id, jsonb_build_object('by_firm', v_s.served_firm_id));
  perform audit('process.acknowledged', 'process_service', p_service, v_s.served_firm_id, jsonb_build_object('serving_firm', v_s.firm_id));
end $$;

create or replace function public.link_service_to_matter(p_service uuid, p_matter uuid, p_response_due_on date default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_s process_service%rowtype; v_m matters%rowtype;
begin
  select * into v_s from process_service where id = p_service for update;
  if not found then raise exception 'service record not found'; end if;
  if v_s.served_firm_id is null or not staff_w(v_s.served_firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_s.revoked_at is not null then raise exception 'service was withdrawn by the serving firm'; end if;
  select * into v_m from matters where id = p_matter and firm_id = v_s.served_firm_id and deleted_at is null;
  if not found then raise exception 'matter not found in your firm'; end if;
  update process_service set recipient_matter_id = p_matter, response_due_on = p_response_due_on, recipient_note = p_note where id = p_service;
  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
  values (p_matter, v_s.served_firm_id, 'service', 'internal',
          format('%s received from %s', v_s.process_title, (select name from firms where id = v_s.firm_id)),
          coalesce(p_note, '') || case when p_response_due_on is not null then format(' Response due %s.', to_char(p_response_due_on, 'FMDD Mon YYYY')) else '' end,
          jsonb_build_object('process_service_id', p_service, 'response_due_on', p_response_due_on), v_s.served_at, auth.uid());
  perform audit('process.filed', 'process_service', p_service, v_s.served_firm_id, jsonb_build_object('matter_id', p_matter));
end $$;

drop view if exists public.service_inbox;
create view public.service_inbox with (security_invoker = false) as
  -- INVARIANT: the served firm's ONLY read path. Never select *, never add note / proof / internal columns.
  select ps.id, ps.process_title, ps.case_title, ps.suit_number, ps.court_name, ps.method, ps.served_at,
         ps.is_originating, ps.substituted_by_order, ps.served_on_name, ps.deemed_served_on,
         ps.served_by_name, ps.served_by_scn,
         ps.acknowledged_at, ps.acknowledged_by_name, ps.document_id, ps.document_version_id, ps.checksum,
         ps.recipient_matter_id, ps.response_due_on,
         ps.firm_id as serving_firm_id, ps.served_firm_id, mc.party_name as served_for_party
  from public.process_service ps
  join public.matter_counsel mc on mc.id = ps.counsel_id
  where ps.served_firm_id is not null and ps.revoked_at is null and ps.method = 'platform'
    and (public.is_firm_member(ps.served_firm_id) or public.is_firm_member(ps.firm_id));
comment on view public.service_inbox is
  'The served firm''s only read path to a process served on it. Columns are listed explicitly on purpose: adding one widens what opposing counsel sees.';
revoke all on public.service_inbox from anon;
grant select on public.service_inbox to authenticated;

drop function if exists public.is_served_firm_member(uuid);

-- ================================================================ 7. court_events guarded like matters
create trigger court_events_check_court before insert or update of court_id on public.court_events
  for each row execute function public.check_matter_court();   -- same guard: court must be platform-wide or the firm's own

-- ================================================================ 8. brand JSON is rendered for every visitor: validate it
create or replace function public.validate_brand(p jsonb) returns jsonb
language plpgsql immutable as $$
declare v jsonb := '{}'; c jsonb; f jsonb; k text; x text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'; end if;
  foreach k in array array['tagline','cta','logo_path'] loop
    x := p ->> k;
    if x is not null and length(x) <= 200 and x !~ '[<>]' then v := v || jsonb_build_object(k, x); end if;
  end loop;
  c := '{}';
  foreach k in array array['primary','accent','surface'] loop
    x := p -> 'colours' ->> k;
    if x ~ '^#[0-9a-fA-F]{6}$' then c := c || jsonb_build_object(k, lower(x)); end if;
  end loop;
  if c <> '{}' then v := v || jsonb_build_object('colours', c); end if;
  f := '{}';
  foreach k in array array['heading','body'] loop
    x := p -> 'fonts' ->> k;
    if x ~ '^[A-Za-z0-9 ]{1,40}$' then f := f || jsonb_build_object(k, x); end if;
  end loop;
  if f <> '{}' then v := v || jsonb_build_object('fonts', f); end if;
  c := '{}';
  foreach k in array array['email','phone','address','whatsapp'] loop
    x := p -> 'contact' ->> k;
    if x is not null and length(x) <= 200 and x !~ '[<>]' then c := c || jsonb_build_object(k, x); end if;
  end loop;
  if c <> '{}' then v := v || jsonb_build_object('contact', c); end if;
  return v;
end $$;
create or replace function public.firms_validate_brand() returns trigger
language plpgsql as $$
begin
  new.brand := validate_brand(new.brand);
  return new;
end $$;
create trigger firms_brand before insert or update of brand on public.firms
  for each row execute function public.firms_validate_brand();

-- ================================================================ 9. what a sitting record needs (registrar)
alter type public.update_kind add value if not exists 'service';

-- the Federal High Court's Lagos division sits in Lagos, not at the state capital
update public.courts set name = 'Federal High Court, Lagos Judicial Division', short_name = 'FHC Lagos', division = 'Lagos', city = 'Lagos'
 where level = 'federal_high' and state_code = 'LA' and firm_id is null;
insert into public.courts (level, name, short_name, state_code, division, city, suit_number_hint, sort)
values ('national_industrial', 'National Industrial Court, Yenagoa Judicial Division', 'NICN Yenagoa', 'BY', 'Yenagoa', 'Yenagoa', 'NICN/YEN/123/2026', 50)
on conflict do nothing;

-- suit-number hints: only registry formats we could verify; everything else is null, never invented
comment on column public.courts.suit_number_hint is 'Example of the registry''s format, shown as a placeholder. Never validated, never generated.';
update public.courts set suit_number_hint = case state_code
    when 'LA' then 'FHC/L/CS/123/2026'   when 'FC' then 'FHC/ABJ/CS/123/2026' when 'RI' then 'FHC/PH/CS/123/2026'
    when 'OY' then 'FHC/IB/CS/123/2026'  when 'EN' then 'FHC/EN/CS/123/2026'  when 'KD' then 'FHC/KD/CS/123/2026'
    when 'KN' then 'FHC/KN/CS/123/2026'  when 'CR' then 'FHC/CA/CS/123/2026'  when 'AK' then 'FHC/UY/CS/123/2026'
    when 'AN' then 'FHC/AWK/CS/123/2026' when 'ON' then 'FHC/AK/CS/123/2026'  when 'DE' then case division when 'Warri' then null else 'FHC/ASB/CS/123/2026' end
    when 'BY' then 'FHC/YEN/CS/123/2026' else null end
 where level = 'federal_high' and firm_id is null;
update public.courts set suit_number_hint = null
 where firm_id is null and level = 'national_industrial'
   and division in ('Makurdi','Gombe','Yola','Sokoto','Bauchi','Minna','Lokoja','Uyo');
update public.courts set suit_number_hint = null
 where firm_id is null and (level in ('magistrate','district','tribunal','multi_door','sharia_appeal','customary_appeal')
                            or (level = 'state_high' and state_code <> 'LA'));

-- a normalised match key for suit numbers (registries reset them yearly; never unique across courts)
alter table public.matters
  add column suit_number_norm text generated always as (upper(regexp_replace(coalesce(suit_number, ''), '\s', '', 'g'))) stored,
  add column court_case_ref   text,                        -- the court's own CMS / e-filing case id, distinct from the suit number
  add column awaiting_date    bool not null default false; -- adjourned sine die / date to be communicated
create index matters_suit_number_idx on public.matters (court_id, suit_number_norm) where deleted_at is null and suit_number is not null;

-- sittings: judge, courtroom, controlled purpose, source, and the ability to vacate and refix a date
alter table public.court_events
  add column judge          text,
  add column purpose_kind   text check (purpose_kind in ('mention','hearing','cmc','pre_trial','motion','ruling','judgment','arraignment','trial','other')),
  add column source         text not null default 'firm' check (source in ('firm','hearing_notice','cause_list')),
  add column vacated_at     timestamptz,
  add column vacated_reason text,
  add column refixed_to     uuid references public.court_events on delete set null;
drop index if exists public.court_events_scheduled_at_idx;
create index court_events_open_idx on public.court_events (scheduled_at) where outcome_update_id is null and vacated_at is null;

create or replace function public.enqueue_court_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; p record; n int := 0; v_key text; v_win interval;
begin
  for r in select * from court_events where outcome_update_id is null and vacated_at is null
                                        and scheduled_at between now() and now() + interval '4 days' loop
    foreach v_key in array array['t3','t1'] loop
      v_win := case v_key when 't3' then interval '3 days' else interval '1 day' end;
      if not (v_key = any(r.reminders_sent)) and r.scheduled_at - now() <= v_win then
        for p in select user_id from matter_parties where matter_id = r.matter_id and role in ('client','contact')
                 union select user_id from matter_lawyers where matter_id = r.matter_id loop
          perform enqueue_notification(p.user_id, r.firm_id, 'court_date_' || v_key,
            jsonb_build_object('matter_id', r.matter_id, 'scheduled_at', r.scheduled_at, 'purpose', r.purpose, 'court_name', r.court_name));
        end loop;
        update court_events set reminders_sent = reminders_sent || v_key where id = r.id;
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;

create or replace function public.digest_sittings_without_update() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select ce.id, ce.firm_id, ce.matter_id, ce.scheduled_at, ml.user_id
             from court_events ce join matter_lawyers ml on ml.matter_id = ce.matter_id
            where ce.outcome_update_id is null and ce.vacated_at is null and ce.scheduled_at < now() - interval '6 hours'
              and ce.scheduled_at > now() - interval '7 days' loop
    perform enqueue_notification(r.user_id, r.firm_id, 'sitting_without_update',
      jsonb_build_object('matter_id', r.matter_id, 'scheduled_at', r.scheduled_at, 'court_event_id', r.id));
    n := n + 1;
  end loop;
  return n;
end $$;

-- the registry vacates a date (judge on leave, transferred, election duty); the firm records it and the refixed date
create or replace function public.vacate_court_event(p_event uuid, p_reason text, p_new_date timestamptz default null, p_new_purpose text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_e court_events%rowtype; v_new uuid; v_m matters%rowtype; v_court courts%rowtype; v_title text;
begin
  select * into v_e from court_events where id = p_event for update;
  if not found then raise exception 'court event not found'; end if;
  if not staff_w(v_e.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_e.vacated_at is not null then raise exception 'already vacated'; end if;
  select * into v_m from matters where id = v_e.matter_id;
  if v_e.court_id is not null then select * into v_court from courts where id = v_e.court_id; end if;
  if p_new_date is not null and is_non_sitting_day((p_new_date at time zone 'Africa/Lagos')::date, v_court.level, v_court.state_code) then
    raise exception 'refixed date % is a weekend, public holiday or court vacation', to_char(p_new_date at time zone 'Africa/Lagos', 'FMDD Mon YYYY');
  end if;

  if p_new_date is not null then
    insert into court_events (matter_id, firm_id, scheduled_at, court_name, court_id, purpose, purpose_kind, judge, courtroom, source)
    values (v_e.matter_id, v_e.firm_id, p_new_date, v_e.court_name, v_e.court_id, coalesce(p_new_purpose, v_e.purpose), v_e.purpose_kind, v_e.judge, v_e.courtroom, 'hearing_notice')
    returning id into v_new;
    update matters set next_event_at = p_new_date, next_event_note = coalesce(p_new_purpose, v_e.purpose), awaiting_date = false where id = v_e.matter_id;
    v_title := format('Date of %s vacated — refixed to %s', to_char(v_e.scheduled_at at time zone 'Africa/Lagos', 'FMDD Mon YYYY'),
                      to_char(p_new_date at time zone 'Africa/Lagos', 'FMDD Mon YYYY'));
  else
    update matters set next_event_at = null, next_event_note = null, awaiting_date = true where id = v_e.matter_id;
    v_title := format('Date of %s vacated — new date to be communicated', to_char(v_e.scheduled_at at time zone 'Africa/Lagos', 'FMDD Mon YYYY'));
  end if;
  update court_events set vacated_at = now(), vacated_reason = p_reason, refixed_to = v_new where id = p_event;

  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
  values (v_e.matter_id, v_e.firm_id, 'court_sitting', 'client', v_title, p_reason,
          jsonb_build_object('outcome', 'vacated', 'court_event_id', p_event, 'refixed_to', v_new, 'next_date', p_new_date), now(), auth.uid());
  perform audit('court_event.vacated', 'court_event', p_event, v_e.firm_id, jsonb_build_object('reason', p_reason, 'refixed_to', v_new));
  return v_new;
end $$;
revoke execute on function public.vacate_court_event(uuid,text,timestamptz,text) from public, anon;
grant  execute on function public.vacate_court_event(uuid,text,timestamptz,text) to authenticated;

-- post_court_update: hearing notices and adjournments sine die; the day-match happens in court time (Africa/Lagos)
drop function if exists public.post_court_update(uuid,text,timestamptz,text,text,timestamptz,text,text,text,uuid,text,bool);
create or replace function public.post_court_update(
  p_matter uuid, p_outcome text, p_occurred_at timestamptz default now(), p_court_name text default null,
  p_adjourned_at_instance_of text default null, p_next_date timestamptz default null, p_next_purpose text default null,
  p_note_to_client text default null, p_internal_note text default null,
  p_court_id uuid default null, p_judicial_division text default null, p_allow_non_sitting bool default false,
  p_judge text default null, p_courtroom text default null, p_purpose_kind text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_m matters%rowtype; v_tz text := 'Africa/Lagos'; v_title text; v_update uuid; v_next_txt text; v_court courts%rowtype; v_court_name text;
begin
  select * into v_m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  if not staff_w(v_m.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_outcome not in ('hearing_held','adjourned','ruling_delivered','judgment_delivered','struck_out','stood_down','mention',
                       'court_did_not_sit','hearing_notice','adjourned_sine_die') then
    raise exception 'unknown outcome %', p_outcome;
  end if;
  if p_outcome = 'hearing_notice' and p_next_date is null then raise exception 'a hearing notice fixes a date'; end if;

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
    when 'adjourned_sine_die' then 'Adjourned sine die — a new date will be communicated by the court'
    when 'hearing_notice'     then 'Hearing notice: matter fixed for ' || v_next_txt
    when 'ruling_delivered'   then 'Ruling delivered'
    when 'judgment_delivered' then 'Judgment delivered'
    when 'struck_out'         then 'Matter struck out'
    when 'stood_down'         then 'Matter stood down'
    when 'mention'            then 'Matter came up for mention'
    when 'court_did_not_sit'  then 'Court did not sit'
  end;
  if p_outcome not in ('adjourned','hearing_notice','adjourned_sine_die') and v_next_txt is not null then
    v_title := v_title || ' — next date ' || v_next_txt;
  end if;

  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
  values (p_matter, v_m.firm_id, 'court_sitting', 'client', v_title, p_note_to_client,
          jsonb_build_object('outcome', p_outcome, 'court_name', v_court_name, 'court_id', v_court.id,
                             'adjourned_at_instance_of', p_adjourned_at_instance_of,
                             'next_date', p_next_date, 'next_purpose', p_next_purpose, 'judge', p_judge, 'courtroom', p_courtroom),
          p_occurred_at, auth.uid())
  returning id into v_update;

  if p_internal_note is not null and length(trim(p_internal_note)) > 0 then
    insert into updates (matter_id, firm_id, kind, visibility, title, body, occurred_at, posted_by)
    values (p_matter, v_m.firm_id, 'note', 'internal', 'Internal note — ' || v_title, p_internal_note, p_occurred_at, auth.uid());
  end if;

  -- a sitting closes the event fixed for that court day; a hearing notice does not (no sitting happened)
  if p_outcome <> 'hearing_notice' then
    update court_events set outcome_update_id = v_update
     where matter_id = p_matter and outcome_update_id is null and vacated_at is null
       and (scheduled_at at time zone v_tz)::date = (p_occurred_at at time zone v_tz)::date;
  end if;

  if p_next_date is not null then
    insert into court_events (matter_id, firm_id, scheduled_at, court_name, court_id, purpose, purpose_kind, judge, courtroom, source)
    values (p_matter, v_m.firm_id, p_next_date, v_court_name, v_court.id, p_next_purpose, p_purpose_kind, p_judge, p_courtroom,
            case when p_outcome = 'hearing_notice' then 'hearing_notice' else 'firm' end);
    update matters set next_event_at = p_next_date, next_event_note = p_next_purpose, awaiting_date = false,
                       court_name = coalesce(v_court_name, court_name),
                       court_id = coalesce(v_court.id, court_id),
                       judicial_division = coalesce(p_judicial_division, judicial_division),
                       judge = coalesce(p_judge, judge)
     where id = p_matter;
  else
    update matters set next_event_at = null, next_event_note = null, awaiting_date = (p_outcome = 'adjourned_sine_die'),
                       court_id = coalesce(v_court.id, court_id),
                       judicial_division = coalesce(p_judicial_division, judicial_division),
                       judge = coalesce(p_judge, judge)
     where id = p_matter;
  end if;

  return v_update;
end $$;
revoke execute on function public.post_court_update(uuid,text,timestamptz,text,text,timestamptz,text,text,text,uuid,text,bool,text,text,text) from public, anon;
grant  execute on function public.post_court_update(uuid,text,timestamptz,text,text,timestamptz,text,text,text,uuid,text,bool,text,text,text) to authenticated;

-- today's sittings by court, for the firm (and for a client, her own matters) — the firm-side cause list
create view public.firm_cause_list with (security_invoker = true) as
  select ce.id as court_event_id, ce.firm_id, ce.matter_id, m.reference, coalesce(m.cause_title, m.title) as cause_title,
         m.suit_number, ce.scheduled_at, (ce.scheduled_at at time zone 'Africa/Lagos')::date as on_date,
         ce.court_id, coalesce(c.name, ce.court_name) as court, ce.courtroom, ce.judge, ce.purpose_kind, ce.purpose, ce.source
  from public.court_events ce
  join public.matters m on m.id = ce.matter_id and m.deleted_at is null
  left join public.courts c on c.id = ce.court_id
  where ce.outcome_update_id is null and ce.vacated_at is null;
grant select on public.firm_cause_list to authenticated;
