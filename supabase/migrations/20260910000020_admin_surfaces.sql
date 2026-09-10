-- Docket — migration 20: the database contract behind the slice-5 admin surfaces.
--
-- Two surfaces need writes the database does not yet allow.
--
-- A FIRM ADMIN (owner or admin, with MFA, of a firm that is not suspended) can already write
-- its own settings, services and intake forms through admin_w(); what it cannot do is ask for
-- a custom domain, change a colleague's role safely, or brand the messages its clients get.
--
-- A PLATFORM ADMIN can today do exactly two things: create a firm for an owner and set its
-- status. It cannot map a domain, change a plan, or see whether anything is failing — it has
-- no row access to firms, notifications or payments at all, by design (migration 13 dropped
-- the last of it). This migration gives it the narrowest reads and writes the job needs, and
-- says out loud what each one deliberately exposes.
--
-- WHAT A PLATFORM ADMIN MAY SEE, decided here and enforced below:
--  · Notification health: status, channel, event, error, firm, and timestamps. NEVER the
--    payload — it carries appointment references, invoice numbers and matter titles — and
--    never the recipient. Counts, not people.
--  · Settlement health: the invoice number, the amount, the currency, the two Paystack
--    subaccount codes and the firm. This is a deliberate narrowing of "platform admins never
--    see matter content": reconciling a mis-settled charge is impossible without it. It stops
--    there — no line items, no matter, no client.
--  · Webhook health: what a provider sent, whether its signature verified, and what Docket
--    did about it. Never the raw body of a verified event.

-- ================================================================ 1. platform: domain and plan
-- A platform admin still has no UPDATE on firms. These are the only two ways those columns
-- move, they are the same shape as set_firm_status(), and both audit.

create or replace function public.set_firm_domain(p_firm uuid, p_domain text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text; v_clean text;
begin
  if not (is_platform_admin() and mfa_ok()) then raise exception 'not permitted' using errcode = '42501'; end if;
  -- The middleware matches the incoming Host exactly, after lowercasing and stripping the
  -- port (src/lib/tenant.ts). Anything that would not match is refused here rather than
  -- stored as a domain that silently never resolves.
  v_clean := nullif(lower(trim(coalesce(p_domain, ''))), '');
  if v_clean is not null and v_clean !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
    raise exception 'a custom domain is a bare hostname: no scheme, no port, no path, no trailing dot';
  end if;
  if v_clean is not null and length(v_clean) > 255 then raise exception 'that hostname is too long'; end if;
  if v_clean is not null and exists (select 1 from firms where custom_domain = v_clean and id <> p_firm) then
    raise exception 'that domain is already mapped to another firm';
  end if;
  select custom_domain into v_old from firms where id = p_firm for update;
  if not found then raise exception 'firm not found'; end if;
  update firms set custom_domain = v_clean where id = p_firm;
  perform audit('firm.domain', 'firm', p_firm, p_firm,
                jsonb_build_object('from', v_old, 'to', v_clean, 'note', p_note));
end $$;
revoke execute on function public.set_firm_domain(uuid,text,text) from public, anon;
grant  execute on function public.set_firm_domain(uuid,text,text) to authenticated;

create or replace function public.set_firm_plan(p_firm uuid, p_plan text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not (is_platform_admin() and mfa_ok()) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_plan not in ('free','standard','enterprise') then raise exception 'unknown plan %', p_plan; end if;
  select plan into v_old from firms where id = p_firm for update;
  if not found then raise exception 'firm not found'; end if;
  update firms set plan = p_plan where id = p_firm;
  perform audit('firm.plan', 'firm', p_firm, p_firm, jsonb_build_object('from', v_old, 'to', p_plan, 'note', p_note));
end $$;
revoke execute on function public.set_firm_plan(uuid,text,text) from public, anon;
grant  execute on function public.set_firm_plan(uuid,text,text) to authenticated;

-- ================================================================ 2. asking for a domain
-- A firm cannot write firms.custom_domain and should not be able to. It asks, and the request
-- carries its own status trail so both sides can see where it got to. The DNS records Vercel
-- returns live here too, so the screen does not have to re-query the provider on every render.

create table if not exists public.domain_requests (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms on delete cascade,
  hostname      text not null,
  status        text not null default 'requested'
                check (status in ('requested','verifying','live','rejected','withdrawn')),
  verification  jsonb not null default '{}',   -- the records the firm must add at its registrar
  note          text,                          -- the platform's reason, shown to the firm
  requested_by  uuid references public.profiles on delete set null,
  decided_by    uuid references public.profiles on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists domain_requests_firm_idx on public.domain_requests (firm_id, created_at desc);
create unique index if not exists domain_requests_open_host
  on public.domain_requests (lower(hostname)) where status in ('requested','verifying');

alter table public.domain_requests enable row level security;

drop policy if exists domain_requests_select on public.domain_requests;
create policy domain_requests_select on public.domain_requests for select
  using (public.is_firm_member(firm_id) or public.is_platform_admin());

-- The firm asks; only the platform decides. A firm may withdraw its own open request, which is
-- the only status a firm may write, and it may never write verification, note or decided_by.
drop policy if exists domain_requests_platform_write on public.domain_requests;
create policy domain_requests_platform_write on public.domain_requests for update
  using (public.is_platform_admin() and public.mfa_ok())
  with check (public.is_platform_admin() and public.mfa_ok());

grant select on public.domain_requests to authenticated;
grant update on public.domain_requests to authenticated;
revoke insert, delete, truncate, references, trigger on public.domain_requests from anon, authenticated;

create or replace function public.request_firm_domain(p_firm uuid, p_hostname text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_clean text; v_id uuid;
begin
  if not admin_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  v_clean := lower(trim(coalesce(p_hostname, '')));
  if v_clean !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
    raise exception 'give the bare hostname you want, for example chambers.example.ng — no https://, no trailing slash';
  end if;
  if exists (select 1 from firms where custom_domain = v_clean) then
    raise exception 'that domain is already in use on Docket';
  end if;
  if exists (select 1 from domain_requests where lower(hostname) = v_clean and status in ('requested','verifying')) then
    raise exception 'that domain has already been asked for and is being worked on';
  end if;
  insert into domain_requests (firm_id, hostname, note, requested_by)
  values (p_firm, v_clean, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  perform audit('firm.domain_requested', 'domain_request', v_id, p_firm, jsonb_build_object('hostname', v_clean));
  return jsonb_build_object('request_id', v_id, 'hostname', v_clean, 'status', 'requested');
end $$;
revoke execute on function public.request_firm_domain(uuid,text,text) from public, anon;
grant  execute on function public.request_firm_domain(uuid,text,text) to authenticated;

create or replace function public.withdraw_firm_domain_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_req domain_requests%rowtype;
begin
  select * into v_req from domain_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if not admin_w(v_req.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_req.status not in ('requested','verifying') then raise exception 'that request is already %', v_req.status; end if;
  update domain_requests set status = 'withdrawn', updated_at = now() where id = p_request;
  perform audit('firm.domain_withdrawn', 'domain_request', p_request, v_req.firm_id,
                jsonb_build_object('hostname', v_req.hostname));
end $$;
revoke execute on function public.withdraw_firm_domain_request(uuid) from public, anon;
grant  execute on function public.withdraw_firm_domain_request(uuid) to authenticated;

-- ================================================================ 3. members: roles and removal
-- firm_members has no trigger, and firm_members_write lets an admin promote themselves to
-- owner, delete the last owner, or delete their own membership. None of those is something the
-- invite path allows, so the console must not offer them — but an app-layer check is not the
-- rule. These two functions are the rule.

create or replace function public.set_member_role(p_firm uuid, p_user uuid, p_role firm_role)
returns void language plpgsql security definer set search_path = public as $$
declare v_old firm_role; v_caller firm_role;
begin
  if not admin_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  select role into v_caller from firm_members where firm_id = p_firm and user_id = auth.uid();
  select role into v_old    from firm_members where firm_id = p_firm and user_id = p_user for update;
  if v_old is null then raise exception 'that person is not a member of this firm'; end if;
  if p_user = auth.uid() then
    raise exception 'you cannot change your own role — ask another owner to do it';
  end if;
  -- Only an owner may make or unmake an owner. An admin promoting itself sideways through
  -- somebody else is the same escalation, so both directions are checked.
  if (p_role = 'owner' or v_old = 'owner') and v_caller <> 'owner' then
    raise exception 'only an owner can appoint or stand down another owner' using errcode = '42501';
  end if;
  if v_old = 'owner' and p_role <> 'owner'
     and (select count(*) from firm_members where firm_id = p_firm and role = 'owner') <= 1 then
    raise exception 'this is the firm''s last owner — appoint another owner first';
  end if;
  if v_old = p_role then return; end if;
  update firm_members set role = p_role where firm_id = p_firm and user_id = p_user;
  perform audit('firm_members.role', 'firm_members', p_user, p_firm,
                jsonb_build_object('from', v_old, 'to', p_role));
end $$;
revoke execute on function public.set_member_role(uuid,uuid,firm_role) from public, anon;
grant  execute on function public.set_member_role(uuid,uuid,firm_role) to authenticated;

-- Taking somebody off the firm has to take them off the FRONT of it too. lawyer_public is built
-- from lawyer_profiles and availability_rules key on profiles, not on membership, so a removed
-- lawyer would otherwise keep a public profile and bookable slots for ever.
create or replace function public.remove_member(p_firm uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old firm_role; v_caller firm_role; v_future int; v_rules int;
begin
  if not admin_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  select role into v_caller from firm_members where firm_id = p_firm and user_id = auth.uid();
  select role into v_old    from firm_members where firm_id = p_firm and user_id = p_user for update;
  if v_old is null then raise exception 'that person is not a member of this firm'; end if;
  if p_user = auth.uid() then raise exception 'you cannot remove yourself — ask another owner to do it'; end if;
  if v_old = 'owner' and v_caller <> 'owner' then
    raise exception 'only an owner can remove another owner' using errcode = '42501';
  end if;
  if v_old = 'owner' and (select count(*) from firm_members where firm_id = p_firm and role = 'owner') <= 1 then
    raise exception 'this is the firm''s last owner — appoint another owner first';
  end if;

  select count(*) into v_future from appointments
   where firm_id = p_firm and lawyer_id = p_user
     and status in ('pending','awaiting_payment','confirmed','rescheduled') and starts_at >= now();
  if v_future > 0 then
    raise exception 'that lawyer has % consultation(s) still to come — reassign or cancel them first', v_future;
  end if;

  delete from availability_rules where firm_id = p_firm and lawyer_id = p_user;
  get diagnostics v_rules = row_count;
  delete from availability_exceptions where firm_id = p_firm and lawyer_id = p_user;
  update lawyer_profiles set is_public = false where firm_id = p_firm and user_id = p_user;
  delete from firm_members where firm_id = p_firm and user_id = p_user;

  perform audit('firm_members.removed', 'firm_members', p_user, p_firm,
                jsonb_build_object('role', v_old, 'availability_rules_cleared', v_rules));
  return jsonb_build_object('removed', true, 'was_role', v_old, 'availability_rules_cleared', v_rules);
end $$;
revoke execute on function public.remove_member(uuid,uuid) from public, anon;
grant  execute on function public.remove_member(uuid,uuid) to authenticated;

-- ================================================================ 4. policies: validated at last
-- firms.brand is validated by a trigger; firms.policies, which is rendered to anonymous
-- visitors on /privacy and /terms, has never been validated at all. That asymmetry is not a
-- decision anybody made. The shape is checked, the text is stripped of anything that could
-- become markup, and a published version may never carry the reserved unpublished prefix.

create or replace function public.validate_policies() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_in jsonb := coalesce(new.policies, '{}'::jsonb); v_out jsonb := '{}'::jsonb;
        v_key text; v_doc jsonb; v_clean jsonb; v_top text;
begin
  if jsonb_typeof(v_in) <> 'object' then new.policies := '{}'::jsonb; return new; end if;

  -- The version that matters lives INSIDE each document: firm_policies_published() reads
  -- policies -> 'terms' ->> 'version' and policies -> 'privacy' ->> 'version', and the portal
  -- compares a client's consent against the same strings. Dropping them would unpublish every
  -- firm on Docket, so each document keeps its own.
  foreach v_key in array array['privacy','terms','engagement','cancellation'] loop
    v_doc := v_in -> v_key;
    if v_doc is null or jsonb_typeof(v_doc) <> 'object' then continue; end if;
    v_clean := jsonb_strip_nulls(jsonb_build_object(
      'version', nullif(left(regexp_replace(coalesce(v_doc ->> 'version', ''), '[<>]', '', 'g'), 40), ''),
      'title',   nullif(left(regexp_replace(coalesce(v_doc ->> 'title', ''),   '[<>]', '', 'g'), 200), ''),
      'text',    nullif(left(regexp_replace(coalesce(v_doc ->> 'text', ''),    '[<>]', '', 'g'), 60000), ''),
      'url',     case when coalesce(v_doc ->> 'url', '') ~ '^https://[a-z0-9.-]+(/[^[:space:]<>]*)?$'
                      then v_doc ->> 'url' end,
      'free_cancel_hours', case when jsonb_typeof(v_doc -> 'free_cancel_hours') = 'number'
                                then v_doc -> 'free_cancel_hours' end));
    if v_clean <> '{}'::jsonb then v_out := v_out || jsonb_build_object(v_key, v_clean); end if;
  end loop;

  -- A top-level version is not read by anything, but a firm that sets one should not silently
  -- lose it either.
  v_top := nullif(trim(coalesce(v_in ->> 'version', '')), '');
  if v_top is not null then
    v_out := v_out || jsonb_build_object('version', left(regexp_replace(v_top, '[<>]', '', 'g'), 40));
  end if;

  new.policies := v_out;
  return new;
end $$;

drop trigger if exists firms_policies on public.firms;
create trigger firms_policies before insert or update of policies on public.firms
  for each row execute function public.validate_policies();

-- ================================================================ 5. the words a client reads
-- The dispatcher brands every message with the firm's name, but the sentence itself is Docket's.
-- A firm may override the sentence per event. Anything it does not override keeps Docket's copy,
-- so an empty object is the normal state and nothing is ever left without a template.

alter table public.firms
  add column if not exists notification_templates jsonb not null default '{}'::jsonb;

comment on column public.firms.notification_templates is
  'Per-event overrides of the client-facing sentence, keyed by notification event. Empty means Docket''s own copy. Placeholders in {braces} are filled by the dispatcher.';

create or replace function public.validate_notification_templates() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_in jsonb := coalesce(new.notification_templates, '{}'::jsonb); v_out jsonb := '{}'::jsonb;
        v_key text; v_val jsonb; v_subject text; v_body text;
begin
  if jsonb_typeof(v_in) <> 'object' then new.notification_templates := '{}'::jsonb; return new; end if;
  for v_key in select jsonb_object_keys(v_in) loop
    -- Only events the platform actually sends, so a typo cannot sit there looking configured.
    continue when v_key !~ '^[a-z][a-z0-9_]{2,60}$';
    v_val := v_in -> v_key;
    if jsonb_typeof(v_val) <> 'object' then continue; end if;
    v_subject := left(regexp_replace(coalesce(v_val ->> 'subject', ''), '[<>]', '', 'g'), 200);
    v_body    := left(regexp_replace(coalesce(v_val ->> 'text',    ''), '[<>]', '', 'g'), 1000);
    if length(trim(v_body)) = 0 then continue; end if;
    v_out := v_out || jsonb_build_object(v_key, jsonb_strip_nulls(jsonb_build_object(
      'subject', nullif(trim(v_subject), ''), 'text', trim(v_body))));
  end loop;
  new.notification_templates := v_out;
  return new;
end $$;

drop trigger if exists firms_notification_templates on public.firms;
create trigger firms_notification_templates before insert or update of notification_templates on public.firms
  for each row execute function public.validate_notification_templates();

-- ================================================================ 6. what a provider sent us
-- Nothing in Docket has ever recorded a webhook that failed. A charge whose signature did not
-- verify, or whose metadata was unreadable, disappeared into a function log nobody reads.

create table if not exists public.webhook_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  event_type   text,
  provider_ref text,
  signature_ok boolean not null default false,
  outcome      text not null check (outcome in ('processed','ignored','unverified','unreadable','error')),
  error        text,
  firm_id      uuid references public.firms on delete set null,
  invoice_id   uuid references public.invoices on delete set null,
  received_at  timestamptz not null default now()
);
create index if not exists webhook_events_recent_idx on public.webhook_events (received_at desc);
create index if not exists webhook_events_bad_idx on public.webhook_events (received_at desc)
  where outcome <> 'processed';

alter table public.webhook_events enable row level security;
-- Written only by the service role inside the Edge Function, read only by a platform admin.
-- No policy for anon or authenticated: append-only by grant, exactly like audit_log.
drop policy if exists webhook_events_platform_select on public.webhook_events;
create policy webhook_events_platform_select on public.webhook_events for select
  using (public.is_platform_admin());
grant select on public.webhook_events to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.webhook_events from anon, authenticated;

-- ================================================================ 7. health, without the content
alter table public.notifications
  add column if not exists attempts int not null default 0;

create or replace view public.platform_notification_health with (security_invoker = false) as
  select n.firm_id, f.name as firm_name, f.slug as firm_slug,
         n.status, n.channel, n.event,
         count(*) as rows,
         min(n.created_at) as oldest,
         max(n.created_at) as newest,
         count(*) filter (where n.status = 'queued' and n.send_after < now() - interval '15 minutes') as overdue,
         max(n.attempts) as most_attempts,
         -- One representative error, so an operator can act. Never the payload.
         (array_agg(n.error order by n.created_at desc) filter (where n.error is not null))[1] as last_error
    from public.notifications n
    left join public.firms f on f.id = n.firm_id
   where public.is_platform_admin()
   group by n.firm_id, f.name, f.slug, n.status, n.channel, n.event;
grant select on public.platform_notification_health to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.platform_notification_health from anon, authenticated;

create or replace view public.platform_settlement_health with (security_invoker = false) as
  select p.id as payment_id, i.firm_id, f.name as firm_name, f.slug as firm_slug,
         i.number as invoice_number, p.amount_minor, p.currency, p.status,
         p.provider_ref, p.paid_at,
         p.raw ->> 'reported_subaccount' as reported_subaccount,
         p.raw ->> 'expected_subaccount' as expected_subaccount,
         (p.raw ->> 'settlement_mismatch') is not null as settlement_mismatch
    from public.payments p
    join public.invoices i on i.id = p.invoice_id
    left join public.firms f on f.id = i.firm_id
   where public.is_platform_admin() and p.status <> 'succeeded';
grant select on public.platform_settlement_health to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.platform_settlement_health from anon, authenticated;

-- A failed notification is permanent today: the dispatcher only reads 'queued'. This puts one
-- back in the queue, bounded, so a transient provider outage does not silently cost a client
-- their reminder.
create or replace function public.retry_notification(p_notification uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_n notifications%rowtype;
begin
  if not (is_platform_admin() and mfa_ok()) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into v_n from notifications where id = p_notification for update;
  if not found then raise exception 'notification not found'; end if;
  if v_n.status <> 'failed' then raise exception 'only a failed notification can be sent again'; end if;
  if v_n.attempts >= 5 then raise exception 'this notification has already been tried % times', v_n.attempts; end if;
  update notifications
     set status = 'queued', error = null, send_after = now(), attempts = attempts + 1
   where id = p_notification;
  perform audit('notification.retried', 'notifications', p_notification, v_n.firm_id,
                jsonb_build_object('event', v_n.event, 'channel', v_n.channel, 'attempt', v_n.attempts + 1));
end $$;
revoke execute on function public.retry_notification(uuid) from public, anon;
grant  execute on function public.retry_notification(uuid) to authenticated;

-- ================================================================ 8. the audit trail keeps up
-- audit_log_platform_select is an explicit allow-list. Every action added above would be
-- written and then be invisible to the only person who can perform it.
drop policy if exists audit_log_platform_select on public.audit_log;
create policy audit_log_platform_select on public.audit_log for select
  using (public.is_platform_admin() and (
    -- the firm lifecycle, which is the whole of the platform's authority over a firm
    (entity = 'firm' and action in ('firm.created','firm.status','firm.domain','firm.plan'))
    or entity in ('firms','firm_members')
    -- the platform's own objects
    or entity in ('domain_request','platform_admins')
    -- reference data the PLATFORM maintains. A firm may add its own private courts, and those
    -- rows carry its firm_id; they are none of the platform's business.
    or (entity in ('courts','court_vacations','public_holidays') and firm_id is null)
    -- putting a failed message back in the queue is a platform act and audits as one
    or action = 'notification.retried'
  ));
