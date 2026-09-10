-- Docket — migration 9: platform-first firm lifecycle.
--
-- Docket is the platform; every law firm on it is a tenant. Attorneys
-- Klinique is tenant #1 and gets nothing another firm cannot get. Until now a
-- firm could only be created by the platform (service role + seed.sql), which
-- made Klinique special in practice. This migration makes firm creation a
-- product feature:
--
--   create_firm()          — any signed-in user opens a firm and becomes its
--                            owner (self-serve at /firm/start); a platform
--                            admin can open one for an existing owner instead
--   seed_firm_defaults()   — the scaffold every new firm gets: matter statuses
--                            that follow a Nigerian matter through court, a
--                            consultation service (inactive until priced) and
--                            a generic intake form. seed.sql now uses it for
--                            Klinique, so Klinique is provably "just a firm".
--   platform_admins        — the /admin surface reads this table, not an env
--                            allowlist. Platform admins manage firms and never
--                            gain access to matter content.
--   firms.plan / status    — free forever for firms of three lawyers or fewer
--                            (blueprint §11); suspension without deletion.
--
-- Additive, and decision 0002's leftover (firms.stripe_account) is dropped.

-- ---------------------------------------------------------------- firms: plan, status, tax id
alter table public.firms
  add column plan   text not null default 'free'   check (plan in ('free','standard','enterprise')),
  add column status text not null default 'active' check (status in ('pending','active','suspended')),
  add column tin    text,
  add column state_code text;   -- state of the principal office (FK added in migration 10)
alter table public.firms drop column if exists stripe_account;

comment on column public.firms.plan   is 'free: up to three lawyers, no charge (blueprint §11). Billing to firms is a platform-admin concern.';
comment on column public.firms.status is 'pending: created, owner has not finished setup; active; suspended: sites and console return 404/403, data retained.';
comment on column public.firms.tin    is 'FIRS Tax Identification Number, printed on invoices where VAT applies.';

-- ---------------------------------------------------------------- platform admins
create table public.platform_admins (
  user_id    uuid primary key references public.profiles on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
comment on table public.platform_admins is
  'Docket platform staff. Rows are inserted with the service role or SQL only — never from the app. Grants firm lifecycle powers, never matter content.';

alter table public.platform_admins enable row level security;
-- a user may see their own row (the /admin gate); nobody writes through the API
create policy platform_admins_self on public.platform_admins for select using (user_id = auth.uid());
revoke insert, update, delete on public.platform_admins from anon, authenticated;

create or replace function public.is_platform_admin() returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from platform_admins where user_id = auth.uid()) $$;

-- platform admins see every firm and its members (lifecycle), nothing else
create policy firms_platform_select        on public.firms        for select using (is_platform_admin());
create policy firms_platform_update        on public.firms        for update using (is_platform_admin() and mfa_ok())
                                                                  with check (is_platform_admin() and mfa_ok());
create policy firm_members_platform_select on public.firm_members for select using (is_platform_admin());
create policy audit_log_platform_select    on public.audit_log    for select using (is_platform_admin() and entity in ('firms','firm_members','firm'));

-- ---------------------------------------------------------------- defaults every firm receives
-- Statuses follow a matter from first contact through the Nigerian court
-- process; services and intake are the minimum a firm needs to take its first
-- booking. Idempotent: safe to call again after an admin edits the lists.
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

  -- a firm with no services yet gets one consultation service, inactive until the owner sets a fee
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

  -- generic Nigerian consultation intake: minimal data, conditional questions
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
end $$;

-- ---------------------------------------------------------------- create_firm
-- Slugs become {slug}.docket.app and the public-site path, so they are
-- validated and a few are reserved for the platform itself.
create or replace function public.is_valid_firm_slug(p_slug text) returns bool
  language sql immutable as
  $$ select p_slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'
        and p_slug !~ '--' and p_slug !~ '-$'
        and p_slug not in ('www','app','api','admin','auth','firm','docket','static','assets','mail','help',
                           'support','status','dev','staging','test','login','signup','start') $$;

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

  -- who owns the new firm: the caller, or (platform admins only) an existing account by email
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

  -- self-serve abuse guard: an ordinary account may own at most three firms
  if not v_platform and (select count(*) from firm_members where user_id = v_owner and role = 'owner') >= 3 then
    raise exception 'this account already owns the maximum number of firms';
  end if;

  -- reference prefix: given, else the initials of the name (AK for Attorneys Klinique), else DK
  v_prefix := upper(regexp_replace(coalesce(p_reference_prefix, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_prefix = '' then
    select upper(string_agg(left(w, 1), '')) into v_prefix
    from regexp_split_to_table(trim(p_name), '\s+') w where w ~ '^[A-Za-z]';
    v_prefix := coalesce(left(v_prefix, 4), 'DK');
  end if;

  insert into firms (slug, name, legal_name, rc_number, reference_prefix, timezone, default_currency, state_code, brand, status)
  values (v_slug, trim(p_name), nullif(trim(p_legal_name), ''), nullif(trim(p_rc_number), ''), v_prefix, p_timezone,
          p_default_currency, nullif(upper(trim(p_state_code)), ''), coalesce(p_brand, '{}'),
          case when p_owner_email is null then 'active' else 'pending' end)
  returning id into v_firm;

  insert into firm_members (firm_id, user_id, role) values (v_firm, v_owner, 'owner');
  perform seed_firm_defaults(v_firm);
  perform audit('firm.created', 'firm', v_firm, v_firm,
                jsonb_build_object('slug', v_slug, 'owner', v_owner, 'by_platform_admin', p_owner_email is not null));

  return jsonb_build_object('firm_id', v_firm, 'slug', v_slug, 'owner_id', v_owner, 'reference_prefix', v_prefix);
end $$;

revoke execute on function public.seed_firm_defaults(uuid) from public, anon, authenticated;
revoke execute on function public.is_platform_admin() from public, anon;
grant  execute on function public.is_platform_admin() to authenticated;
grant  execute on function public.is_valid_firm_slug(text) to anon, authenticated;
revoke execute on function public.create_firm(text,text,text,text,text,currency,text,text,jsonb,text) from public, anon;
grant  execute on function public.create_firm(text,text,text,text,text,currency,text,text,jsonb,text) to authenticated;
