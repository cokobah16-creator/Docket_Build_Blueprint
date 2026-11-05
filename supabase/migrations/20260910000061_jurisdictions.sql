-- Docket, migration 61: the jurisdiction registry, and a firm's place in it.
--
-- Docket was built for Nigeria and says so everywhere: the court hierarchy, the states, the
-- holidays and vacations, the practitioner identity, the consent rules, the default timezone and
-- currency. None of that is wrong, and none of it moves. What was missing is the thing above it:
-- a registry that says WHICH countries Docket describes, how far each description has been taken,
-- and whether a firm may practise under it yet.
--
-- THE LIFECYCLE IS THE POINT. A jurisdiction is `designed` (described, not reviewed), `validated`
-- (a platform admin has recorded a legal and regulatory review, by whom and of what), `active`
-- (firms may register under it) or `suspended` (firms stay, registration closes). A firm cannot
-- register under a jurisdiction that is not active, and a jurisdiction cannot be activated from
-- `designed` without a validation in between. Nigeria is active because it is the one whose rules
-- have been built and reviewed; seven others are registered as designed, with notes that say what
-- a validation would have to cover and nothing that pretends it has happened.
--
-- NOTHING ASSUMES ONE COUNTRY'S LAW APPLIES IN ANOTHER. The registry carries a currency, a
-- timezone, a locale and a date format per country and a config object for the rest (court
-- hierarchy, document formats, professional body, data protection law, retention). The config is
-- notes for the people who will do the validation; no function reads a rule out of it, because no
-- rule for those countries has been entered. What IS read: create_firm() refuses an inactive
-- jurisdiction, and takes the jurisdiction's currency and timezone as the firm's defaults where
-- the caller gave none.
--
-- A FIRM'S JURISDICTION IS SET AT REGISTRATION AND IS THE PLATFORM'S TO MOVE. Changing the law a
-- firm practises under is not a settings edit; the trigger below refuses it from anybody but a
-- platform admin with a second factor, in the same way the lifecycle columns are guarded.
--
-- Readable by everybody, anon included: the registration form shows the list to a visitor who has
-- no account yet, exactly as ng_states is read.

-- ================================================================ 1. the registry
create table public.jurisdictions (
  id              uuid not null default gen_random_uuid() unique,
  code            text primary key check (code ~ '^[A-Z]{2}$'),
  name            text not null check (length(btrim(name)) between 2 and 120),
  legal_system    text not null check (legal_system in ('common_law', 'civil_law', 'mixed', 'religious_mixed')),
  currency_code   text not null check (currency_code ~ '^[A-Z]{3}$'),
  timezone        text not null,
  locale          text not null default 'en' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  language        text not null default 'English' check (length(btrim(language)) between 2 and 60),
  date_format     text not null default 'DD/MM/YYYY' check (date_format in ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD')),
  status          text not null default 'designed' check (status in ('designed', 'validated', 'active', 'suspended')),
  -- Notes for the validation: court hierarchy, document formats, professional body, data
  -- protection law, retention. Read by people, never by a rule.
  config          jsonb not null default '{}',
  validation_note text check (validation_note is null or length(validation_note) <= 4000),
  validated_at    timestamptz,
  validated_by    uuid references public.profiles(id) on delete set null,
  activated_at    timestamptz,
  activated_by    uuid references public.profiles(id) on delete set null,
  sort            int not null default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.jurisdictions is
  'Every country Docket describes, and how far the description has been taken: designed, validated, active, suspended. A firm registers only under an active one. Written only by platform admins through set_jurisdiction_status() and upsert_jurisdiction().';
comment on column public.jurisdictions.config is
  'Notes for the people who validate the jurisdiction (courts, document formats, professional body, data protection, retention). No function reads a rule out of it.';

alter table public.jurisdictions enable row level security;
create policy jurisdictions_select on public.jurisdictions for select using (true);
grant select on public.jurisdictions to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.jurisdictions from anon, authenticated;
create trigger jurisdictions_audit after insert or update or delete on public.jurisdictions
  for each row execute function public.audit_row_change();

create table public.jurisdiction_practice_areas (
  jurisdiction_code text not null references public.jurisdictions(code) on delete cascade,
  key               text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  label             text not null check (length(btrim(label)) between 2 and 80),
  sort              int not null default 100,
  primary key (jurisdiction_code, key)
);
comment on table public.jurisdiction_practice_areas is
  'The practice areas a jurisdiction offers on a matter. Labels, not law: a firm picks one and the matter carries it.';
alter table public.jurisdiction_practice_areas enable row level security;
create policy jurisdiction_practice_areas_select on public.jurisdiction_practice_areas for select using (true);
grant select on public.jurisdiction_practice_areas to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.jurisdiction_practice_areas from anon, authenticated;

-- ================================================================ 2. what is registered today
-- Nigeria is active: the migrations before this one are its configuration, and the validation
-- note says which of them. Everything else is designed. The notes name the review a validation
-- must cover; they do not claim that review has happened.
insert into public.jurisdictions (code, name, legal_system, currency_code, timezone, locale, language, date_format, status, sort,
                                  validated_at, validation_note, activated_at, config)
values
  ('NG', 'Nigeria', 'mixed', 'NGN', 'Africa/Lagos', 'en-NG', 'English', 'DD/MM/YYYY', 'active', 10,
   now(),
   'Built as Docket''s first jurisdiction: the court hierarchy and judicial divisions (migrations 10, 12, 13), the 36 states and the FCT, public holidays and court vacations, Supreme Court enrolment and NBA identity, consent at published versions under the Nigeria Data Protection Act 2023, service of process modelled on the civil procedure rules, and deadlines counted only from court rules the platform has entered. Professional rules reviewed against the Rules of Professional Conduct for Legal Practitioners; no NBA approval is claimed.',
   now(),
   jsonb_build_object(
     'legal_system_note', 'English common law with statute, customary law and Sharia in the states that apply it.',
     'courts', 'Supreme Court; Court of Appeal; Federal High Court; State and FCT High Courts; National Industrial Court; Sharia and Customary Courts of Appeal; magistrates, district, customary, area and Sharia courts; tribunals; multi door courthouses. Entered as reference data in the courts table.',
     'professional_body', 'Nigerian Bar Association; practitioners enrolled at the Supreme Court; stamp and seal per practising year.',
     'data_protection', 'Nigeria Data Protection Act 2023 and the NDPC General Application and Implementation Directive.',
     'client_money', 'Firms settle to their own Paystack subaccount; Docket holds no client funds (decision 0002, CLIENT_MONEY_DESIGN.md).',
     'document_formats', 'A4; suit numbers in each registry''s own format (see courts.suit_number_hint).')),
  ('GB', 'United Kingdom', 'common_law', 'GBP', 'Europe/London', 'en-GB', 'English', 'DD/MM/YYYY', 'designed', 20, null, null, null,
   jsonb_build_object(
     'legal_system_note', 'England and Wales is one system; Scotland and Northern Ireland are separate and would need their own court hierarchy and rules.',
     'courts', 'Supreme Court; Court of Appeal; High Court (King''s Bench, Chancery, Family); County Court; Crown and magistrates'' courts; tribunals. Not entered.',
     'professional_body', 'Solicitors Regulation Authority; Bar Standards Board; Law Society; CILEx.',
     'data_protection', 'UK GDPR and the Data Protection Act 2018.',
     'client_money', 'SRA Accounts Rules govern client accounts; nothing here models them.',
     'validation_scope', 'Court directory, Civil Procedure Rules deadlines, SRA transparency and client money rules, Legal Services Act reserved activities, UK GDPR notices.')),
  ('US', 'United States', 'common_law', 'USD', 'America/New_York', 'en-US', 'English', 'MM/DD/YYYY', 'designed', 30, null, null, null,
   jsonb_build_object(
     'legal_system_note', 'Federal and fifty state systems; practice is licensed by state bar.',
     'courts', 'Supreme Court; federal courts of appeals and district courts; state supreme, appellate and trial courts. Not entered.',
     'professional_body', 'State bars; ABA Model Rules as adopted per state.',
     'data_protection', 'No single federal statute; state laws such as the CCPA; attorney client privilege and ethics rules on confidentiality.',
     'validation_scope', 'Per state: court directory, rules of civil procedure, trust accounting (IOLTA), advertising rules, UPL limits on cross border collaboration.')),
  ('CA', 'Canada', 'mixed', 'CAD', 'America/Toronto', 'en-CA', 'English', 'YYYY-MM-DD', 'designed', 40, null, null, null,
   jsonb_build_object(
     'legal_system_note', 'Common law in nine provinces and the territories; civil law in Quebec. Bilingual practice.',
     'courts', 'Supreme Court of Canada; Federal Court; provincial superior and appeal courts; provincial courts. Not entered.',
     'professional_body', 'Provincial and territorial law societies under the Federation of Law Societies.',
     'data_protection', 'PIPEDA federally; provincial statutes where substantially similar.',
     'validation_scope', 'Per province: court directory, rules of civil procedure, trust accounting, advertising rules, French language requirements in Quebec.')),
  ('AU', 'Australia', 'common_law', 'AUD', 'Australia/Sydney', 'en-AU', 'English', 'DD/MM/YYYY', 'designed', 50, null, null, null,
   jsonb_build_object(
     'legal_system_note', 'Federal and state and territory systems; uniform law in NSW, Victoria and WA.',
     'courts', 'High Court; Federal Court; state supreme, district and local courts; tribunals. Not entered.',
     'professional_body', 'State and territory law societies and bar associations under the Legal Profession Uniform Law where adopted.',
     'data_protection', 'Privacy Act 1988 and the Australian Privacy Principles.',
     'validation_scope', 'Per state: court directory, civil procedure rules, trust accounting, costs disclosure.')),
  ('GH', 'Ghana', 'common_law', 'GHS', 'Africa/Accra', 'en-GH', 'English', 'DD/MM/YYYY', 'designed', 60, null, null, null,
   jsonb_build_object(
     'legal_system_note', 'English common law with statute and customary law.',
     'courts', 'Supreme Court; Court of Appeal; High Court; circuit and district courts; specialised divisions. Not entered.',
     'professional_body', 'General Legal Council; Ghana Bar Association; solicitors'' licence per year.',
     'data_protection', 'Data Protection Act 2012 (Act 843) and the Data Protection Commission.',
     'validation_scope', 'Court directory, High Court civil procedure rules (CI 47) deadlines, client account rules, advertising rules.')),
  ('KE', 'Kenya', 'common_law', 'KES', 'Africa/Nairobi', 'en-KE', 'English', 'DD/MM/YYYY', 'designed', 70, null, null, null,
   jsonb_build_object(
     'legal_system_note', 'English common law with statute, customary and Islamic law in the Kadhi courts.',
     'courts', 'Supreme Court; Court of Appeal; High Court; Employment and Labour Relations Court; Environment and Land Court; magistrates'' and Kadhi courts. Not entered.',
     'professional_body', 'Law Society of Kenya; practising certificate per year.',
     'data_protection', 'Data Protection Act 2019 and the Office of the Data Protection Commissioner.',
     'validation_scope', 'Court directory, Civil Procedure Rules 2010 deadlines, Advocates Accounts Rules, advertising rules.')),
  ('ZA', 'South Africa', 'mixed', 'ZAR', 'Africa/Johannesburg', 'en-ZA', 'English', 'YYYY-MM-DD', 'designed', 80, null, null, null,
   jsonb_build_object(
     'legal_system_note', 'Roman Dutch civil law and English common law, with customary law.',
     'courts', 'Constitutional Court; Supreme Court of Appeal; High Court divisions; magistrates'' courts; specialised courts. Not entered.',
     'professional_body', 'Legal Practice Council under the Legal Practice Act 2014.',
     'data_protection', 'Protection of Personal Information Act 2013 (POPIA) and the Information Regulator.',
     'validation_scope', 'Court directory, Uniform Rules of Court deadlines, trust account rules under the Legal Practice Act, Fidelity Fund.'));

insert into public.jurisdiction_practice_areas (jurisdiction_code, key, label, sort)
select j.code, a.key, a.label, a.sort
  from public.jurisdictions j
  cross join (values
    ('litigation', 'Litigation', 10), ('property', 'Property', 20), ('corporate', 'Corporate', 30),
    ('estate', 'Estate', 40), ('family', 'Family', 50), ('employment', 'Employment', 60),
    ('debt_recovery', 'Debt recovery', 70), ('ip', 'Intellectual property', 80), ('regulatory', 'Regulatory', 90),
    ('immigration', 'Immigration', 100), ('advisory', 'Advisory', 110), ('criminal', 'Criminal', 120),
    ('arbitration', 'Arbitration', 130), ('other', 'Other', 140)) as a(key, label, sort);

-- ================================================================ 3. a firm's jurisdiction
alter table public.firms add column jurisdiction_code text not null default 'NG'
  references public.jurisdictions(code);
create index firms_jurisdiction_idx on public.firms (jurisdiction_code);
-- firms.state_code is a foreign key into ng_states and stays Nigeria's. A firm elsewhere records
-- its state, province or region here as the words it uses for it, checked for shape and nothing
-- else, because no other country's regions are reference data yet.
alter table public.firms add column region text check (region is null or length(btrim(region)) between 1 and 80);
comment on column public.firms.region is
  'State, province or region of the principal office for a firm outside Nigeria. Nigerian firms use state_code, which is reference data.';
comment on column public.firms.jurisdiction_code is
  'The jurisdiction the firm registered under. Set by create_firm() and moved only by a platform admin with a second factor.';

create or replace function public.guard_firm_jurisdiction() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.jurisdiction_code is distinct from old.jurisdiction_code
     and not (is_platform_admin() and mfa_ok()) then
    raise exception 'a firm''s jurisdiction is set at registration; moving it is the platform''s act' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.guard_firm_jurisdiction() from public, anon, authenticated;
create trigger firms_guard_jurisdiction before update on public.firms
  for each row execute function public.guard_firm_jurisdiction();

-- firm_public gains the jurisdiction, appended, which is the only change CREATE OR REPLACE VIEW
-- allows and the only one the deployed resolver cannot notice. Writes revoked again, as on every
-- re created view (migration 14).
create or replace view public.firm_public with (security_invoker = false) as
  select id, slug, name, legal_name, brand, policies, custom_domain, timezone, default_currency,
         verified_at is not null as verified, vat_rate, rc_number, jurisdiction_code
    from public.firms
   where status = 'active';
revoke insert, update, delete, truncate, references, trigger on public.firm_public from anon, authenticated;
grant select on public.firm_public to anon, authenticated;

create or replace function public.is_jurisdiction_active(p_code text) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from jurisdictions where code = upper(btrim(p_code)) and status = 'active')
$$;
grant execute on function public.is_jurisdiction_active(text) to anon, authenticated;

-- ================================================================ 4. create_firm() learns the jurisdiction
-- The previous signature is dropped and this one created in its place, as migration 27 did for
-- post_court_update(): every existing caller passes fewer arguments and resolves to this function
-- through the default, and PostgREST has one function of the name to choose. The body is migration
-- 15's with the jurisdiction added: refused unless active; the state check applies to Nigeria;
-- the jurisdiction's currency and timezone are the defaults where the caller gave the Nigerian ones.
drop function if exists public.create_firm(text, text, text, text, text, currency, text, text, jsonb, text, text);

create or replace function public.create_firm(
  p_name text, p_slug text,
  p_legal_name text default null, p_rc_number text default null,
  p_timezone text default 'Africa/Lagos', p_default_currency currency default 'NGN',
  p_reference_prefix text default null, p_state_code text default null,
  p_brand jsonb default '{}', p_owner_email text default null, p_owner_scn text default null,
  p_jurisdiction text default 'NG')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_owner uuid; v_firm uuid; v_slug text := lower(trim(p_slug));
        v_prefix text; v_platform bool; v_j jurisdictions%rowtype;
        v_tz text := p_timezone; v_ccy currency := p_default_currency; v_state text; v_region text;
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

  select * into v_j from jurisdictions where code = upper(btrim(coalesce(p_jurisdiction, 'NG')));
  if not found then raise exception 'unknown jurisdiction %', p_jurisdiction; end if;
  if v_j.status <> 'active' then
    raise exception 'Docket is not yet active in % — it is registered as % and opens to firms after its legal and regulatory validation', v_j.name, v_j.status;
  end if;
  -- The Nigerian defaults are the function''s own; a firm elsewhere that gave none gets its own
  -- jurisdiction''s currency and timezone rather than Lagos and naira.
  if v_j.code <> 'NG' then
    if v_tz is null or v_tz = 'Africa/Lagos' then v_tz := v_j.timezone; end if;
    if v_ccy = 'NGN' then v_ccy := v_j.currency_code::currency; end if;
  end if;

  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'firm name is required'; end if;
  if not is_valid_firm_slug(v_slug) then raise exception 'invalid or reserved slug %', v_slug; end if;
  if exists (select 1 from firms where slug = v_slug) then raise exception 'slug % is already taken', v_slug; end if;
  if v_tz is null or v_tz not in (select name from pg_timezone_names) then raise exception 'unknown timezone %', v_tz; end if;

  -- Nigeria: a state code checked against ng_states, as before. Elsewhere: the region as words,
  -- kept on firms.region, because state_code is a foreign key into Nigeria's states.
  if v_j.code = 'NG' then
    v_state := nullif(upper(trim(coalesce(p_state_code, ''))), '');
    if v_state is not null and not exists (select 1 from ng_states where code = v_state) then
      raise exception 'unknown state %', p_state_code;
    end if;
  else
    v_region := nullif(btrim(coalesce(p_state_code, '')), '');
    if v_region is not null and length(v_region) > 80 then
      raise exception 'a state, province or region is up to 80 characters';
    end if;
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

  insert into firms (slug, name, legal_name, rc_number, reference_prefix, timezone, default_currency, state_code, region, brand, status, jurisdiction_code)
  values (v_slug, trim(p_name), nullif(trim(p_legal_name), ''), nullif(trim(p_rc_number), ''), v_prefix, v_tz,
          v_ccy, v_state, v_region, coalesce(p_brand, '{}'), 'pending', v_j.code)
  returning id into v_firm;

  insert into firm_members (firm_id, user_id, role) values (v_firm, v_owner, 'owner');
  insert into lawyer_profiles (firm_id, user_id, is_public, scn) values (v_firm, v_owner, false, nullif(trim(coalesce(p_owner_scn, '')), ''));
  perform seed_firm_defaults(v_firm);
  perform audit('firm.created', 'firm', v_firm, v_firm,
                jsonb_build_object('slug', v_slug, 'owner', v_owner, 'by_platform_admin', p_owner_email is not null,
                                   'jurisdiction', v_j.code));

  return jsonb_build_object('firm_id', v_firm, 'slug', v_slug, 'owner_id', v_owner, 'reference_prefix', v_prefix,
                            'status', 'pending', 'jurisdiction', v_j.code);
end $$;
revoke execute on function public.create_firm(text,text,text,text,text,currency,text,text,jsonb,text,text,text) from public, anon;
grant  execute on function public.create_firm(text,text,text,text,text,currency,text,text,jsonb,text,text,text) to authenticated;

-- ================================================================ 5. the platform's two doors
/**
 * Move a jurisdiction through its lifecycle. Platform admins with a second factor only.
 *
 *   designed  -> validated   needs a note saying who reviewed what
 *   validated -> active      opens registration
 *   active    -> suspended   closes registration; firms already under it keep working
 *   suspended -> active
 *   validated | suspended -> designed   only while no firm is registered under it
 *
 * `designed -> active` is refused: a validation is what stands between a description and a
 * country Docket lets lawyers practise under.
 */
create or replace function public.set_jurisdiction_status(p_code text, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v jurisdictions%rowtype; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_firms int;
begin
  if not (is_platform_admin() and mfa_ok()) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_status not in ('designed', 'validated', 'active', 'suspended') then raise exception 'unknown status %', p_status; end if;
  select * into v from jurisdictions where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'unknown jurisdiction %', p_code; end if;
  if v.status = p_status then return; end if;

  if p_status = 'active' and v.status = 'designed' then
    raise exception 'a jurisdiction is validated before it is activated: record the legal and regulatory review first';
  end if;
  if p_status = 'validated' and (v_note is null or length(v_note) < 10) then
    raise exception 'say what was reviewed: a validation records who checked the rules and what they checked';
  end if;
  if p_status = 'designed' then
    select count(*) into v_firms from firms where jurisdiction_code = v.code;
    if v_firms > 0 then
      raise exception '% firm(s) are registered under % — a jurisdiction firms practise in cannot go back to designed', v_firms, v.name;
    end if;
  end if;

  update jurisdictions
     set status          = p_status,
         validation_note = case when p_status = 'validated' then v_note else coalesce(v_note, validation_note) end,
         validated_at    = case when p_status = 'validated' then now()
                                when p_status = 'designed'  then null
                                else validated_at end,
         validated_by    = case when p_status = 'validated' then auth.uid()
                                when p_status = 'designed'  then null
                                else validated_by end,
         activated_at    = case when p_status = 'active'   then coalesce(activated_at, now())
                                when p_status = 'designed' then null
                                else activated_at end,
         activated_by    = case when p_status = 'active' and activated_at is null then auth.uid()
                                when p_status = 'designed' then null
                                else activated_by end,
         updated_at      = now()
   where code = v.code;

  perform audit('jurisdiction.status', 'jurisdiction', v.id, null,
                jsonb_build_object('code', v.code, 'from', v.status, 'to', p_status, 'note', v_note));
end $$;
revoke execute on function public.set_jurisdiction_status(text, text, text) from public, anon;
grant  execute on function public.set_jurisdiction_status(text, text, text) to authenticated;

/**
 * Register a country, or correct how one is described. Platform admins with a second factor
 * only. A new jurisdiction is always `designed`; this never touches the status. The timezone is
 * checked against the server's own list and the currency against the currency enum, so a firm
 * registering under it later cannot be handed a value the invoices table refuses.
 */
create or replace function public.upsert_jurisdiction(
  p_code text, p_name text, p_legal_system text, p_currency_code text, p_timezone text,
  p_locale text default 'en', p_language text default 'English', p_date_format text default 'DD/MM/YYYY',
  p_config jsonb default '{}', p_sort int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text := upper(btrim(coalesce(p_code, ''))); v_ccy text := upper(btrim(coalesce(p_currency_code, ''))); v_id uuid; v_new bool;
begin
  if not (is_platform_admin() and mfa_ok()) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_code !~ '^[A-Z]{2}$' then raise exception 'a jurisdiction code is the two letter ISO 3166 country code'; end if;
  if p_timezone is null or p_timezone not in (select name from pg_timezone_names) then raise exception 'unknown timezone %', p_timezone; end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'currency' and e.enumlabel = v_ccy) then
    raise exception 'currency % is not one Docket can invoice in yet — add it to the currency type first', v_ccy;
  end if;
  if p_config is not null and jsonb_typeof(p_config) <> 'object' then raise exception 'config must be an object'; end if;

  v_new := not exists (select 1 from jurisdictions where code = v_code);
  insert into jurisdictions (code, name, legal_system, currency_code, timezone, locale, language, date_format, config, sort)
  values (v_code, btrim(p_name), p_legal_system, v_ccy, p_timezone, coalesce(p_locale, 'en'), coalesce(p_language, 'English'),
          coalesce(p_date_format, 'DD/MM/YYYY'), coalesce(p_config, '{}'), coalesce(p_sort, 100))
  on conflict (code) do update
     set name = excluded.name, legal_system = excluded.legal_system, currency_code = excluded.currency_code,
         timezone = excluded.timezone, locale = excluded.locale, language = excluded.language,
         date_format = excluded.date_format, config = excluded.config, sort = excluded.sort, updated_at = now()
  returning id into v_id;

  perform audit(case when v_new then 'jurisdiction.registered' else 'jurisdiction.described' end, 'jurisdiction', v_id, null,
                jsonb_build_object('code', v_code, 'name', btrim(p_name)));
  return jsonb_build_object('id', v_id, 'code', v_code, 'created', v_new);
end $$;
revoke execute on function public.upsert_jurisdiction(text, text, text, text, text, text, text, text, jsonb, int) from public, anon;
grant  execute on function public.upsert_jurisdiction(text, text, text, text, text, text, text, text, jsonb, int) to authenticated;

-- ================================================================ 6. how far the registry reaches
-- Counts the platform console shows: how many jurisdictions at each stage, and how many firms
-- under each. No firm is named.
create or replace function public.jurisdiction_coverage()
returns table (code text, name text, status text, firms bigint, practice_areas bigint)
language sql stable security definer set search_path = public as $$
  select j.code, j.name, j.status,
         (select count(*) from firms f where f.jurisdiction_code = j.code),
         (select count(*) from jurisdiction_practice_areas a where a.jurisdiction_code = j.code)
    from jurisdictions j
   where is_platform_admin()
   order by j.sort, j.code
$$;
revoke execute on function public.jurisdiction_coverage() from public, anon;
grant  execute on function public.jurisdiction_coverage() to authenticated;
