-- A message is accepted, delivered, or read — three different facts — and each is written down
-- only when it is known.
--
-- Before this, "sent" meant the provider answered 2xx: the body was never read, so a 200 carrying
-- a provider-side error was "sent", and nothing distinguished the provider ACCEPTING a message
-- from a handset or inbox RECEIVING it. The provider's own message id was thrown away, so no
-- receipt could ever be matched back. Two producers, or two overlapping dispatcher runs, could
-- send the same message twice — nothing in the table refused a duplicate and nothing claimed a
-- row before sending it. A failure was terminal until a platform operator clicked retry, one
-- row at a time, whatever the cause. And nothing knew what any of it cost.
--
-- Now:
--  · a notification carries the provider and its message id, accepted_at (the provider took it),
--    delivered_at (the provider's receipt said the handset or inbox has it), and a delivery
--    status a receipt can set to delivered, bounced or undelivered. Web push has no receipt and
--    stops at accepted; read_at stays what it was — the in-app row, opened. Nothing is ever
--    written as delivered without a verified receipt.
--  · the same words to the same person on the same channel are one message a day: a dedupe key
--    with a unique index, so a producer that fires twice, or a cron that runs twice, makes one row.
--  · the dispatcher CLAIMS rows (claim_notifications(): status 'sending', FOR UPDATE SKIP LOCKED)
--    and FINISHES them (finish_notification()), so two runs can never take the same row. A
--    transient failure (a 5xx, a timeout) goes back in the queue with a growing delay, five
--    times; a permanent one (no phone, a rejected number) fails at once. The operator's own
--    counter, attempts, keeps its meaning: retry_notification() still owns it.
--  · every accepted message records its segments and, where the platform has entered the
--    provider's rate, its cost and currency. Nothing is priced that the platform has not
--    priced: an unpriced message is counted as unpriced, never as free.
--
-- A NEW DISCLOSURE, stated here as migration 20 stated its own: platform admins can now read,
-- per firm and month, how many messages went out, their cost by currency, and how many matters
-- the firm has open — counts and amounts, never a payload, never a recipient. The cost of a
-- message and the number of matters are the platform's to know; what the message said is not.
--
-- Nothing here changes a call the deployed front end makes. The dispatcher must be redeployed
-- (v9) before this migration is applied, or the old one keeps selecting rows the new columns
-- ignore — it still works, it just records nothing new. The receipts function is new.

-- ---------------------------------------------------------------- 1. what a row now says
alter table public.notifications
  add column if not exists provider        text,
  add column if not exists provider_ref    text,
  add column if not exists accepted_at     timestamptz,
  add column if not exists delivered_at    timestamptz,
  add column if not exists delivery_status text check (delivery_status is null or delivery_status in ('accepted','delivered','bounced','undelivered')),
  add column if not exists delivery_note   text,
  add column if not exists failure_kind    text check (failure_kind is null or failure_kind in ('transient','permanent')),
  add column if not exists send_attempts   int not null default 0,
  add column if not exists claimed_at      timestamptz,
  add column if not exists segments        int check (segments is null or segments >= 0),
  add column if not exists cost_minor      bigint check (cost_minor is null or cost_minor >= 0),
  add column if not exists cost_currency   currency,
  add column if not exists dedupe_key      text;
alter table public.notifications drop constraint if exists notifications_status_check;
alter table public.notifications add constraint notifications_status_check check (status in ('queued','sending','sent','failed','skipped'));
alter table public.notifications drop constraint if exists notifications_cost_check;
alter table public.notifications add constraint notifications_cost_check check (cost_minor is null or cost_minor = 0 or cost_currency is not null);
comment on column public.notifications.cost_minor is 'What this message cost, in minor units of cost_currency, from the provider rate in force when it was accepted. Null when the platform has entered no rate: unpriced, never free.';
create unique index if not exists notifications_dedupe_idx on public.notifications (dedupe_key) where dedupe_key is not null;
create index if not exists notifications_claim_idx on public.notifications (send_after) where status = 'queued';
create index if not exists notifications_provider_ref_idx on public.notifications (provider, provider_ref) where provider_ref is not null;
comment on column public.notifications.accepted_at is 'The provider took the message (a 2xx with a message id). Not delivery.';
comment on column public.notifications.delivered_at is 'A verified receipt from the provider said the inbox or handset has it. Never set without one; web push has none.';
comment on column public.notifications.send_attempts is 'Dispatcher claims of this row. attempts is the operator''s retry counter and stays retry_notification()''s.';
comment on column public.notifications.dedupe_key is 'person : channel : event : the payload : the UTC day — the same message to the same person is one row a day.';

-- The API roles may change read_at and nothing else — said once, for every column the table has
-- now or later, instead of a list a new column could fall off.
create or replace function public.notifications_api_read_only() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') and (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'only read_at may be changed on a notification' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- 2. one message a day
create or replace function public.notification_dedupe_key(p_user uuid, p_channel channel, p_event text, p_payload jsonb)
returns text language sql stable set search_path = public as $$
  select p_user::text || ':' || p_channel::text || ':' || p_event || ':' || md5(coalesce(p_payload, '{}'::jsonb)::text)
         || ':' || (now() at time zone 'UTC')::date::text
$$;
revoke execute on function public.notification_dedupe_key(uuid, channel, text, jsonb) from public, anon, authenticated;

create or replace function public.enqueue_notification(p_user uuid, p_firm uuid, p_event text, p_payload jsonb, p_send_after timestamptz default now())
returns void language plpgsql security definer set search_path = public as $$
declare v_pref channel; v_email text; v_ch channel; v_channels channel[];
        v_qs time; v_qe time; v_tz text; v_local time; v_quiet bool := false; v_deferred timestamptz;
begin
  select preferred_channel, email, quiet_hours_start, quiet_hours_end, coalesce(timezone, 'Africa/Lagos')
    into v_pref, v_email, v_qs, v_qe, v_tz from profiles where id = p_user;
  if v_pref = 'whatsapp' then v_pref := 'sms'; end if;

  if v_qs is not null and v_qe is not null and v_qs <> v_qe
     and p_event not in ('appointment_reminder_10m', 'appointment_reminder_now') then
    v_local := (p_send_after at time zone v_tz)::time;
    if v_qs < v_qe then v_quiet := v_local >= v_qs and v_local < v_qe;
    else                v_quiet := v_local >= v_qs or  v_local < v_qe; end if;
    if v_quiet then
      v_deferred := ((p_send_after at time zone v_tz)::date + v_qe) at time zone v_tz;
      if v_deferred <= p_send_after then v_deferred := v_deferred + interval '1 day'; end if;
    end if;
  end if;

  v_channels := array['in_app'::channel];
  if exists (select 1 from push_subscriptions ps where ps.user_id = p_user) then
    v_channels := v_channels || 'push'::channel;
  end if;
  if v_pref not in ('in_app','push') then v_channels := v_channels || v_pref; end if;
  if v_email is not null and v_pref <> 'email' then v_channels := v_channels || 'email'::channel; end if;
  foreach v_ch in array v_channels loop
    if not exists (select 1 from notification_preferences np
                   where np.user_id = p_user and np.event = p_event and np.channel = v_ch and not np.enabled) then
      -- The same message to the same person on the same channel, the same day, is one row.
      insert into notifications (user_id, firm_id, channel, event, payload, status, send_after, sent_at, dedupe_key)
      values (p_user, p_firm, v_ch, p_event, p_payload,
              case when v_ch = 'in_app' then 'sent' else 'queued' end,
              case when v_ch <> 'in_app' and v_quiet then v_deferred else p_send_after end,
              case when v_ch = 'in_app' then now() end,
              notification_dedupe_key(p_user, v_ch, p_event, p_payload))
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- 3. claim, then finish
-- Both are the dispatcher's alone: execute is revoked from every API role, and a caller with a
-- session (auth.uid() set) is refused besides — the service role carries none.
create or replace function public.claim_notifications(p_limit int default 50)
returns table (id uuid, user_id uuid, firm_id uuid, channel channel, event text, payload jsonb, send_attempts int, attempts int,
               email text, phone text, timezone text, full_name text, firm_name text, notification_templates jsonb)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then raise exception 'not permitted' using errcode = '42501'; end if;
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  -- WhatsApp is not offered: a stray row is skipped here rather than carried by the sender.
  update notifications n set status = 'skipped', error = 'whatsapp is not offered', claimed_at = null
   where n.status = 'queued' and n.channel = 'whatsapp';
  -- A claim that never finished — the function died mid-send — goes back in the queue after ten
  -- minutes. The message may or may not have gone; the row says so.
  update notifications n set status = 'queued', claimed_at = null,
         error = 'a send was claimed and never finished — it may have gone out'
   where n.status = 'sending' and n.claimed_at < now() - interval '10 minutes';
  return query
    with c as (
      select n.id from notifications n
       where n.status = 'queued' and n.send_after <= now() and n.channel in ('email', 'sms', 'push')
       order by n.created_at
       limit p_limit
       for update skip locked),
    u as (
      update notifications n
         set status = 'sending', claimed_at = now(), send_attempts = n.send_attempts + 1
        from c where n.id = c.id
      returning n.id, n.user_id, n.firm_id, n.channel, n.event, n.payload, n.send_attempts, n.attempts)
    select u.id, u.user_id, u.firm_id, u.channel, u.event, u.payload, u.send_attempts, u.attempts,
           p.email, p.phone, coalesce(p.timezone, 'Africa/Lagos'), p.full_name, f.name, coalesce(f.notification_templates, '{}'::jsonb)
      from u join profiles p on p.id = u.user_id left join firms f on f.id = u.firm_id;
end $$;
revoke execute on function public.claim_notifications(int) from public, anon, authenticated;

create or replace function public.finish_notification(p_id uuid, p_outcome text, p_provider text default null, p_provider_ref text default null,
                                                       p_error text default null, p_failure_kind text default null, p_segments int default null,
                                                       p_cost_minor bigint default null, p_cost_currency currency default null)
returns void language plpgsql security definer set search_path = public as $$
declare n notifications%rowtype; v_delay interval;
begin
  if auth.uid() is not null then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into n from notifications where id = p_id for update;
  if not found then raise exception 'notification not found'; end if;
  if n.status <> 'sending' then raise exception 'notification is not being sent (status %)', n.status; end if;
  if p_outcome = 'sent' then
    -- Accepted by the provider. Delivery is a receipt's to say.
    update notifications set status = 'sent', sent_at = now(), accepted_at = now(), delivery_status = 'accepted',
           provider = p_provider, provider_ref = p_provider_ref, error = null, failure_kind = null, claimed_at = null,
           segments = p_segments, cost_minor = p_cost_minor, cost_currency = p_cost_currency
     where id = p_id;
  elsif p_outcome = 'skipped' then
    update notifications set status = 'skipped', error = left(p_error, 500), claimed_at = null where id = p_id;
  elsif p_outcome = 'failed' then
    if coalesce(p_failure_kind, 'permanent') = 'transient' and n.send_attempts < 5 then
      -- 2, 4, 8, 16 minutes; the fifth transient failure is final until an operator retries.
      v_delay := interval '1 minute' * power(2, n.send_attempts);
      update notifications set status = 'queued', send_after = now() + v_delay, error = left(p_error, 500),
             failure_kind = 'transient', provider = coalesce(p_provider, provider), claimed_at = null
       where id = p_id;
    else
      update notifications set status = 'failed', error = left(p_error, 500), failure_kind = coalesce(p_failure_kind, 'permanent'),
             provider = coalesce(p_provider, provider), claimed_at = null
       where id = p_id;
    end if;
  else
    raise exception 'unknown outcome %', p_outcome;
  end if;
end $$;
revoke execute on function public.finish_notification(uuid, text, text, text, text, text, int, bigint, currency) from public, anon, authenticated;

-- The operator's retry starts the automatic cycle again.
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
     set status = 'queued', error = null, send_after = now(), attempts = attempts + 1,
         send_attempts = 0, failure_kind = null, claimed_at = null
   where id = p_notification;
  perform audit('notification.retried', 'notifications', p_notification, v_n.firm_id,
                jsonb_build_object('event', v_n.event, 'channel', v_n.channel, 'attempt', v_n.attempts + 1));
end $$;

-- ---------------------------------------------------------------- 4. a receipt, verified, by the provider's own id
alter table public.webhook_events add column if not exists notification_id uuid references public.notifications(id) on delete set null;

create or replace function public.record_delivery_receipt(p_provider text, p_provider_ref text, p_status text, p_at timestamptz default now(), p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_status not in ('delivered', 'bounced', 'undelivered', 'note') then raise exception 'unknown receipt status %', p_status; end if;
  if p_provider_ref is null or p_provider_ref = '' then return null; end if;
  select id into v_id from notifications where provider = p_provider and provider_ref = p_provider_ref order by created_at desc limit 1;
  if v_id is null then return null; end if;
  if p_status = 'delivered' then
    update notifications set delivered_at = coalesce(p_at, now()), delivery_status = 'delivered', delivery_note = left(p_note, 500) where id = v_id;
  elsif p_status = 'note' then
    -- Something short of a verdict (delayed, handed to the carrier): kept, changes no status.
    update notifications set delivery_note = left(p_note, 500) where id = v_id;
  else
    update notifications set delivery_status = p_status, delivery_note = left(p_note, 500), delivered_at = null where id = v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.record_delivery_receipt(text, text, text, timestamptz, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 5. what a message costs, as the platform has entered it
create table if not exists public.provider_rates (
  provider       text not null,
  channel        channel not null,
  currency       currency not null,
  unit_minor     bigint not null check (unit_minor >= 0),
  per_segment    boolean not null default true,
  effective_from date not null default current_date,
  note           text check (note is null or length(note) <= 300),
  set_by         uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (provider, channel, effective_from)
);
comment on table public.provider_rates is 'What a provider charges per message (or per SMS segment), entered by the platform from its contract. Nothing is priced that is not here.';
alter table public.provider_rates enable row level security;
create policy provider_rates_platform_select on public.provider_rates for select using (is_platform_admin());
grant select on public.provider_rates to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.provider_rates from anon, authenticated;

create or replace function public.set_provider_rate(p_provider text, p_channel channel, p_currency currency, p_unit_minor bigint,
                                                    p_effective_from date default current_date, p_per_segment boolean default true, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_platform_admin() and mfa_ok()) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_provider not in ('resend', 'termii', 'twilio', 'webpush') then raise exception 'unknown provider %', p_provider; end if;
  if p_unit_minor is null or p_unit_minor < 0 then raise exception 'a rate is zero or more, in minor units'; end if;
  insert into provider_rates (provider, channel, currency, unit_minor, per_segment, effective_from, note, set_by)
  values (p_provider, p_channel, p_currency, p_unit_minor, coalesce(p_per_segment, true), coalesce(p_effective_from, current_date), nullif(btrim(p_note), ''), auth.uid())
  on conflict (provider, channel, effective_from) do update
     set currency = excluded.currency, unit_minor = excluded.unit_minor, per_segment = excluded.per_segment, note = excluded.note, set_by = excluded.set_by, created_at = now();
  perform audit('provider_rate.set', 'provider_rates', null, null,
                jsonb_build_object('provider', p_provider, 'channel', p_channel, 'currency', p_currency, 'unit_minor', p_unit_minor, 'per_segment', coalesce(p_per_segment, true), 'effective_from', coalesce(p_effective_from, current_date)));
end $$;
revoke execute on function public.set_provider_rate(text, channel, currency, bigint, date, boolean, text) from public, anon;
grant  execute on function public.set_provider_rate(text, channel, currency, bigint, date, boolean, text) to authenticated;

-- The rate in force today, for the dispatcher.
create or replace function public.current_provider_rate(p_provider text, p_channel channel)
returns table (unit_minor bigint, currency currency, per_segment boolean)
language sql stable security definer set search_path = public as $$
  select r.unit_minor, r.currency, r.per_segment from provider_rates r
   where r.provider = p_provider and r.channel = p_channel and r.effective_from <= current_date
   order by r.effective_from desc limit 1
$$;
revoke execute on function public.current_provider_rate(text, channel) from public, anon, authenticated;

-- The audit trail keeps up: the allow-list of migration 20, plus the rate.
drop policy if exists audit_log_platform_select on public.audit_log;
create policy audit_log_platform_select on public.audit_log for select
  using (public.is_platform_admin() and (
    (entity = 'firm' and action in ('firm.created','firm.status','firm.domain','firm.plan'))
    or entity in ('firms','firm_members')
    or entity in ('domain_request','platform_admins','provider_rates')
    or (entity in ('courts','court_vacations','public_holidays') and firm_id is null)
    or action in ('notification.retried', 'provider_rate.set')
  ));

-- ---------------------------------------------------------------- 6. health, delivery and cost — counts, never content
create or replace view public.platform_notification_health with (security_invoker = false) as
  select n.firm_id, f.name as firm_name, f.slug as firm_slug,
         n.status, n.channel, n.event,
         count(*) as rows,
         min(n.created_at) as oldest,
         max(n.created_at) as newest,
         count(*) filter (where n.status = 'queued' and n.send_after < now() - interval '15 minutes') as overdue,
         max(n.attempts) as most_attempts,
         (array_agg(n.error order by n.created_at desc) filter (where n.error is not null))[1] as last_error,
         count(*) filter (where n.delivery_status = 'accepted') as accepted,
         count(*) filter (where n.delivery_status = 'delivered') as delivered,
         count(*) filter (where n.delivery_status = 'bounced') as bounced,
         count(*) filter (where n.delivery_status = 'undelivered') as undelivered,
         max(n.send_attempts) as most_send_attempts
    from public.notifications n
    left join public.firms f on f.id = n.firm_id
   where public.is_platform_admin()
   group by n.firm_id, f.name, f.slug, n.status, n.channel, n.event;

create or replace view public.platform_failed_notifications with (security_invoker = false) as
  select n.id, n.firm_id, f.name as firm_name, f.slug as firm_slug,
         n.channel, n.event, n.attempts, n.error, n.created_at, n.send_after,
         n.failure_kind, n.send_attempts, n.provider
    from public.notifications n
    left join public.firms f on f.id = n.firm_id
   where public.is_platform_admin() and n.status = 'failed';

create or replace view public.platform_notification_cost with (security_invoker = false) as
  select n.firm_id, f.name as firm_name, f.slug as firm_slug,
         -- The firm's month, not UTC's: a message sent at half past midnight in Lagos on the first
         -- is 23:30 UTC on the last day of the month before, and would be billed to it.
         date_trunc('month', n.sent_at at time zone coalesce(f.timezone, 'Africa/Lagos'))::date as month,
         n.provider, n.channel, n.cost_currency,
         count(*) as messages,
         coalesce(sum(n.segments), 0) as segments,
         sum(n.cost_minor) filter (where n.cost_minor is not null) as cost_minor,
         count(*) filter (where n.cost_minor is null) as unpriced
    from public.notifications n
    left join public.firms f on f.id = n.firm_id
   where public.is_platform_admin() and n.status = 'sent' and n.channel in ('email', 'sms', 'push') and n.sent_at is not null
   group by n.firm_id, f.name, f.slug, date_trunc('month', n.sent_at at time zone coalesce(f.timezone, 'Africa/Lagos'))::date, n.provider, n.channel, n.cost_currency;
grant select on public.platform_notification_cost to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.platform_notification_cost from anon, authenticated;

-- The denominator: how many matters each firm has open. A count, and the disclosure this
-- migration's header states.
create or replace view public.platform_firm_active_matters with (security_invoker = false) as
  select f.id as firm_id, f.name as firm_name, f.slug as firm_slug,
         count(m.id) filter (where m.deleted_at is null and m.closed_at is null) as active_matters
    from public.firms f
    left join public.matters m on m.firm_id = f.id
   where public.is_platform_admin()
   group by f.id, f.name, f.slug;
grant select on public.platform_firm_active_matters to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.platform_firm_active_matters from anon, authenticated;
