-- A contract another system can build against — versioned, scoped, revocable, and signed.
--
-- The assessment's #19, and the plan was right to hold it until now: publishing a stable external
-- contract over a permission model that is about to change means versioning a mistake. Wave 2 fixed
-- the permission model, so the contract can be written against something that will still be true.
--
-- WHERE THE AUTHORIZATION LIVES. Not in the HTTP layer. Every function below takes the PRESENTED
-- KEY, hashes it, finds the credential, checks that it is live and carries the scope being used,
-- and only then returns anything. The Edge Function that serves the API never names a firm and
-- could not widen the answer if it were rewritten badly: it has no firm id to pass. That is the
-- same rule the rest of Docket follows, applied to a surface where it matters more, because an API
-- key is a credential somebody will eventually paste into a script and forget about.
--
-- WHY AN EDGE FUNCTION AND NOT A NEXT ROUTE. Serving this needs the service role, and the service
-- role is not permitted in `app/` or `src/` anywhere in this codebase. supabase/functions is the
-- one place it belongs, so that is where the API lives.
--
-- WHAT THE CONTRACT IS, AND IS NOT. It is a mapping, not a window onto the tables. `matters`
-- gains and loses columns as this product changes; the v1 shape does not, and where it must, it
-- becomes v2 beside v1 rather than changing under a partner's feet. Docket's schema is Docket's
-- own and is not proposed as a Nigerian legal standard.
--
-- READ ONLY, ON PURPOSE. v1 answers questions and emits events; it changes nothing. A write API
-- over matters and money needs decisions nobody has taken — whose reference wins, what a partial
-- write means, how a conflicting update is resolved — and inventing them here to look complete
-- would be the wrong kind of finished.
--
-- WHAT IS NOT HERE, SAID PLAINLY. A sandbox. The assessment asks for one and it is right to, but a
-- sandbox is a second environment with its own data, and Docket has no staging project yet — that
-- decision is still open (Wave 0.4). Standing up something called a sandbox that is really
-- production with a different key would be worse than not having one, so there is none, and the
-- documentation says so rather than implying otherwise.

-- ================================================================ 1. the credential
create table public.api_credentials (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 2 and 80),
  -- The visible half, so a firm can tell two keys apart in a list and in an audit line. It is not
  -- a secret and is not enough to call anything.
  key_prefix   text not null unique,
  -- sha256 of the whole key. The key itself is shown once, at creation, and is never stored: a
  -- database dump is not a set of working credentials.
  key_hash     text not null unique,
  scopes       text[] not null default '{}',
  expires_on   date,
  last_used_at timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles(id) on delete set null,
  revoke_reason text check (revoke_reason is null or length(revoke_reason) <= 500),
  constraint api_credentials_scopes_chk check (
    scopes <@ array['matters:read', 'invoices:read', 'clients:read', 'events:read']::text[]
    and array_length(scopes, 1) >= 1)
);
create index api_credentials_firm_idx on public.api_credentials (firm_id);
alter table public.api_credentials enable row level security;
-- Owners and admins of the firm may see that a key exists, what it may do and when it was last
-- used. Nobody may read key_hash usefully — it is a hash — and nobody at all can recover the key.
create policy api_credentials_select on public.api_credentials for select using (admin_w(firm_id));
revoke insert, update, delete on public.api_credentials from anon, authenticated;
create trigger api_credentials_audit after insert or update or delete on public.api_credentials
  for each row execute function public.audit_row_change();

comment on table public.api_credentials is
  'A partner API key for one firm: hashed, scoped, expiring, revocable. The key is shown once at creation and never stored.';

-- ================================================================ 2. the outbox
-- A stable id per event, because the first thing a partner needs is to know whether they have seen
-- this one before. The payload is the MAPPED shape, written when the event happens: replaying the
-- feed a year from now gives what was true then, not what the tables say today.
create table public.api_events (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms(id) on delete cascade,
  type        text not null check (type ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  occurred_at timestamptz not null default now(),
  payload     jsonb not null default '{}'::jsonb,
  -- A monotonic cursor. A partner asks for everything after the last sequence they processed, and
  -- that is complete by construction — unlike a timestamp, which two events can share.
  seq         bigint generated always as identity
);
create index api_events_firm_seq_idx on public.api_events (firm_id, seq);
create index api_events_firm_time_idx on public.api_events (firm_id, occurred_at);
alter table public.api_events enable row level security;
create policy api_events_select on public.api_events for select using (admin_w(firm_id));
revoke insert, update, delete on public.api_events from anon, authenticated;

comment on column public.api_events.seq is
  'The cursor a partner pages on. Monotonic per platform; a partner asks for seq > their last and cannot miss one.';

-- Where a firm wants events pushed rather than polled. The secret is what Docket signs with, so it
-- has to be readable by the signer — which is the service role and nothing else. There is no select
-- policy naming it and no grant: an owner sees the endpoint through the view below, never the key.
create table public.api_endpoints (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references public.firms(id) on delete cascade,
  url            text not null check (url ~ '^https://'),
  signing_secret text not null,
  types          text[] not null default '{}',        -- empty: every type
  active         boolean not null default true,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (firm_id, url)
);
alter table public.api_endpoints enable row level security;
-- No policy at all: the only read path is api_endpoint_list() below, which never returns the secret.
revoke select, insert, update, delete on public.api_endpoints from anon, authenticated;
comment on table public.api_endpoints is
  'Where a firm wants its events pushed. signing_secret is what Docket signs with and is readable by the service role alone — no RLS policy exposes this table.';

create table public.api_deliveries (
  id           uuid primary key default gen_random_uuid(),
  endpoint_id  uuid not null references public.api_endpoints(id) on delete cascade,
  event_id     uuid not null references public.api_events(id) on delete cascade,
  attempts     int not null default 0,
  status       text not null default 'pending' check (status in ('pending','delivered','failed')),
  last_status  int,
  last_error   text,
  next_try_at  timestamptz not null default now(),
  delivered_at timestamptz,
  unique (endpoint_id, event_id)
);
create index api_deliveries_due_idx on public.api_deliveries (next_try_at) where status = 'pending';
alter table public.api_deliveries enable row level security;
create policy api_deliveries_select on public.api_deliveries for select
  using (exists (select 1 from api_endpoints e where e.id = endpoint_id and admin_w(e.firm_id)));
revoke insert, update, delete on public.api_deliveries from anon, authenticated;

-- ================================================================ 3. issuing and ending a key
-- The key is returned ONCE, here, and never again. dk_live_ is the visible prefix; the rest is 32
-- random bytes. Nothing stores it.
create or replace function public.issue_api_credential(
  p_firm uuid, p_name text, p_scopes text[], p_expires_on date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_secret text; v_key text; v_prefix text; v_id uuid; v_today date;
begin
  if not admin_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  select (now() at time zone coalesce(timezone, 'Africa/Lagos'))::date into v_today from firms where id = p_firm;
  if p_expires_on is not null and p_expires_on < v_today then
    raise exception 'a key that expired yesterday opens nothing — give a day in the future, or none';
  end if;
  if coalesce(array_length(p_scopes, 1), 0) = 0 then
    raise exception 'a key with no scope can do nothing: name what it may read';
  end if;

  v_prefix := 'dk_live_' || encode(gen_random_bytes(4), 'hex');
  v_secret := encode(gen_random_bytes(32), 'hex');
  v_key    := v_prefix || '_' || v_secret;

  insert into api_credentials (firm_id, name, key_prefix, key_hash, scopes, expires_on, created_by)
  values (p_firm, btrim(p_name), v_prefix, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'),
          p_scopes, p_expires_on, auth.uid())
  returning id into v_id;

  perform audit('api_credential.issued', 'api_credential', v_id, p_firm,
                jsonb_build_object('name', btrim(p_name), 'prefix', v_prefix, 'scopes', to_jsonb(p_scopes),
                                   'expires_on', p_expires_on));
  -- The only time the key exists outside the caller's screen.
  return jsonb_build_object('id', v_id, 'prefix', v_prefix, 'key', v_key);
end $$;
revoke execute on function public.issue_api_credential(uuid, text, text[], date) from public, anon;
grant  execute on function public.issue_api_credential(uuid, text, text[], date) to authenticated;

create or replace function public.revoke_api_credential(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c api_credentials%rowtype;
begin
  select * into c from api_credentials where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  if not admin_w(c.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if c.revoked_at is not null then return; end if;
  update api_credentials set revoked_at = now(), revoked_by = auth.uid(),
                             revoke_reason = nullif(btrim(coalesce(p_reason, '')), '') where id = p_id;
  perform audit('api_credential.revoked', 'api_credential', p_id, c.firm_id,
                jsonb_build_object('prefix', c.key_prefix, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
end $$;
revoke execute on function public.revoke_api_credential(uuid, text) from public, anon;
grant  execute on function public.revoke_api_credential(uuid, text) to authenticated;

-- ================================================================ 4. the gate every call goes through
/**
 * Verify a presented key for one scope, and return the firm it speaks for.
 *
 * This is the whole authorization model of the API. It is executable by the service role alone —
 * the Edge Function that serves the API — and it takes the key, never a firm id, so the caller has
 * nothing to get wrong. A revoked key, an expired key, a key without the scope, or a firm that is
 * suspended all raise here, before a single row is read.
 */
create or replace function public.api_authorize(p_key text, p_scope text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c api_credentials%rowtype; v_today date; v_status text;
begin
  if p_key is null or length(p_key) < 16 then raise exception 'unauthorized' using errcode = '42501'; end if;
  select * into c from api_credentials
   where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
  -- One message for every failure that is about the key. A caller learns whether their key works,
  -- never which part of it was wrong.
  if not found or c.revoked_at is not null then raise exception 'unauthorized' using errcode = '42501'; end if;
  select status, (now() at time zone coalesce(timezone, 'Africa/Lagos'))::date into v_status, v_today
    from firms where id = c.firm_id;
  if v_status <> 'active' then raise exception 'unauthorized' using errcode = '42501'; end if;
  if c.expires_on is not null and c.expires_on < v_today then raise exception 'unauthorized' using errcode = '42501'; end if;
  if not (p_scope = any (c.scopes)) then
    raise exception 'this key does not carry the % scope', p_scope using errcode = '42501';
  end if;
  -- 600 calls a minute per key: generous for a nightly sync, bounded for a runaway loop. The key's
  -- own prefix is the bucket, so one firm's script cannot spend another's allowance.
  if not rate_limit_hit('partner_api', 600, interval '1 minute', c.key_prefix) then
    raise exception 'too many requests' using errcode = '53400';
  end if;
  update api_credentials set last_used_at = now() where id = c.id;
  return c.firm_id;
end $$;
revoke execute on function public.api_authorize(text, text) from public, anon, authenticated;

-- ================================================================ 5. v1 — the mapped shapes
-- Every one of these is a MAPPING. The column names below are the contract; the tables underneath
-- are not, and may be renamed without touching this. Where the shape must change it becomes v2
-- beside v1, never a change under a running integration.
create or replace function public.api_v1_matters(p_key text, p_since timestamptz default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_firm uuid; v_rows jsonb;
begin
  v_firm := api_authorize(p_key, 'matters:read');
  select coalesce(jsonb_agg(r order by r ->> 'updated_at'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
             'id', m.id,
             'reference', m.reference,
             'title', m.title,
             'type', m.type,
             'status', s.label,
             'court', m.court_name,
             'suit_number', m.suit_number,
             'opened_on', m.opened_at,
             'closed_on', m.closed_at,
             'restricted', m.access = 'team',
             'updated_at', greatest(m.created_at, coalesce((select max(u.occurred_at) from updates u where u.matter_id = m.id), m.created_at))) as r
      from matters m left join matter_statuses s on s.id = m.status_id
     where m.firm_id = v_firm and m.deleted_at is null
       and (p_since is null or greatest(m.created_at, coalesce((select max(u.occurred_at) from updates u where u.matter_id = m.id), m.created_at)) > p_since)
     order by 1
     limit greatest(1, least(coalesce(p_limit, 100), 500))) t;
  return v_rows;
end $$;
revoke execute on function public.api_v1_matters(text, timestamptz, int) from public, anon, authenticated;

create or replace function public.api_v1_invoices(p_key text, p_since timestamptz default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_firm uuid; v_rows jsonb;
begin
  v_firm := api_authorize(p_key, 'invoices:read');
  select coalesce(jsonb_agg(r order by r ->> 'issued_at'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
             'id', i.id,
             'number', i.number,
             'matter_id', i.matter_id,
             'status', i.status,
             -- Money is minor units and a currency, together, always. Two currencies are never
             -- summed here and a partner is never handed a bare number.
             'currency', i.currency,
             'total_minor', i.total_minor,
             'paid_minor', i.paid_minor,
             'issued_at', i.issued_at,
             'due_on', i.due_at) as r
      from invoices i
     where i.firm_id = v_firm and i.status <> 'draft'
       and (p_since is null or coalesce(i.issued_at, i.created_at) > p_since)
     order by 1
     limit greatest(1, least(coalesce(p_limit, 100), 500))) t;
  return v_rows;
end $$;
revoke execute on function public.api_v1_invoices(text, timestamptz, int) from public, anon, authenticated;

-- Clients: who the firm acts for, and nothing about what they instructed. No matter is named here,
-- because which matters a person has is the wall's business and an API key is not a way round it.
create or replace function public.api_v1_clients(p_key text, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_firm uuid; v_rows jsonb;
begin
  v_firm := api_authorize(p_key, 'clients:read');
  select coalesce(jsonb_agg(r order by r ->> 'name'), '[]'::jsonb) into v_rows from (
    select distinct jsonb_build_object(
             'id', p.id,
             'name', coalesce(p.full_name, p.company_name),
             'kind', p.client_type,
             'email', p.email,
             'phone', p.phone) as r
      from profiles p
     where exists (select 1 from matter_parties mp join matters mt on mt.id = mp.matter_id
                    where mp.user_id = p.id and mt.firm_id = v_firm and mt.deleted_at is null)
        or exists (select 1 from appointments a where a.client_id = p.id and a.firm_id = v_firm)
     limit greatest(1, least(coalesce(p_limit, 100), 500))) t;
  return v_rows;
end $$;
revoke execute on function public.api_v1_clients(text, int) from public, anon, authenticated;

/** The feed. A partner pages on `seq` and cannot miss an event or process one twice. */
create or replace function public.api_v1_events(p_key text, p_after bigint default 0, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_firm uuid; v_rows jsonb;
begin
  v_firm := api_authorize(p_key, 'events:read');
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'seq', e.seq, 'type', e.type,
           'occurred_at', e.occurred_at, 'data', e.payload) order by e.seq), '[]'::jsonb)
    into v_rows
    from (select * from api_events
           where firm_id = v_firm and seq > coalesce(p_after, 0)
           order by seq limit greatest(1, least(coalesce(p_limit, 100), 500))) e;
  return v_rows;
end $$;
revoke execute on function public.api_v1_events(text, bigint, int) from public, anon, authenticated;

-- ================================================================ 6. what raises an event
-- Written where the act happens, in the mapped shape, so the feed is a record of what was true
-- then. Deliberately few: a matter opening, its stage changing, an invoice issued and an invoice
-- paid. Every one of them is something an accounting or practice-management system would act on,
-- and none of them carries a word of privileged content.
create or replace function public.api_emit(p_firm uuid, p_type text, p_payload jsonb, p_at timestamptz default now())
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into api_events (firm_id, type, occurred_at, payload)
  values (p_firm, p_type, coalesce(p_at, now()), coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  -- Queue it for every endpoint that wants it. A firm with no endpoint has a feed and no deliveries.
  insert into api_deliveries (endpoint_id, event_id)
  select e.id, v_id from api_endpoints e
   where e.firm_id = p_firm and e.active
     and (coalesce(array_length(e.types, 1), 0) = 0 or p_type = any (e.types))
  on conflict (endpoint_id, event_id) do nothing;
  return v_id;
end $$;
revoke execute on function public.api_emit(uuid, text, jsonb, timestamptz) from public, anon, authenticated;

create or replace function public.api_event_on_matter() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform api_emit(new.firm_id, 'matter.opened',
      jsonb_build_object('id', new.id, 'reference', new.reference, 'title', new.title,
                         'type', new.type, 'opened_on', new.opened_at), new.created_at);
  elsif new.status_id is distinct from old.status_id then
    perform api_emit(new.firm_id, 'matter.stage_changed',
      jsonb_build_object('id', new.id, 'reference', new.reference,
                         'status', (select label from matter_statuses where id = new.status_id)));
  elsif new.closed_at is distinct from old.closed_at and new.closed_at is not null then
    perform api_emit(new.firm_id, 'matter.closed',
      jsonb_build_object('id', new.id, 'reference', new.reference, 'closed_on', new.closed_at));
  end if;
  return null;
end $$;
create trigger api_events_matters after insert or update of status_id, closed_at on public.matters
  for each row execute function public.api_event_on_matter();

create or replace function public.api_event_on_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status <> 'draft' then
    perform api_emit(new.firm_id, 'invoice.issued',
      jsonb_build_object('id', new.id, 'number', new.number, 'matter_id', new.matter_id,
                         'currency', new.currency, 'total_minor', new.total_minor), new.created_at);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'paid' then
      perform api_emit(new.firm_id, 'invoice.paid',
        jsonb_build_object('id', new.id, 'number', new.number, 'currency', new.currency,
                           'total_minor', new.total_minor, 'paid_minor', new.paid_minor));
    elsif old.status = 'draft' then
      perform api_emit(new.firm_id, 'invoice.issued',
        jsonb_build_object('id', new.id, 'number', new.number, 'matter_id', new.matter_id,
                           'currency', new.currency, 'total_minor', new.total_minor));
    end if;
  end if;
  return null;
end $$;
create trigger api_events_invoices after insert or update of status on public.invoices
  for each row execute function public.api_event_on_invoice();

-- ================================================================ 7. endpoints, and the push
create or replace function public.set_api_endpoint(p_firm uuid, p_url text, p_types text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_secret text; v_id uuid;
begin
  if not admin_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_url !~ '^https://' then raise exception 'an endpoint must be https'; end if;
  v_secret := encode(gen_random_bytes(32), 'hex');
  insert into api_endpoints (firm_id, url, signing_secret, types, created_by)
  values (p_firm, p_url, v_secret, coalesce(p_types, '{}'), auth.uid())
  on conflict (firm_id, url) do update
    set types = excluded.types, active = true, signing_secret = excluded.signing_secret
  returning id into v_id;
  perform audit('api_endpoint.set', 'api_endpoint', v_id, p_firm, jsonb_build_object('url', p_url, 'types', to_jsonb(coalesce(p_types, '{}'))));
  -- Shown once, like the key: the firm needs it to verify our signature, and we do not show it again.
  return jsonb_build_object('id', v_id, 'signing_secret', v_secret);
end $$;
revoke execute on function public.set_api_endpoint(uuid, text, text[]) from public, anon;
grant  execute on function public.set_api_endpoint(uuid, text, text[]) to authenticated;

create or replace function public.remove_api_endpoint(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e api_endpoints%rowtype;
begin
  select * into e from api_endpoints where id = p_id;
  if not found then return; end if;
  if not admin_w(e.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  update api_endpoints set active = false where id = p_id;
  perform audit('api_endpoint.removed', 'api_endpoint', p_id, e.firm_id, jsonb_build_object('url', e.url));
end $$;
revoke execute on function public.remove_api_endpoint(uuid) from public, anon;
grant  execute on function public.remove_api_endpoint(uuid) to authenticated;

/** What an owner may see of their endpoints: everything except the thing that signs. */
create or replace function public.api_endpoint_list(p_firm uuid)
returns table (id uuid, url text, types text[], active boolean, created_at timestamptz,
               pending bigint, failed bigint, delivered bigint)
language sql stable security definer set search_path = public as $$
  select e.id, e.url, e.types, e.active, e.created_at,
         count(*) filter (where d.status = 'pending'),
         count(*) filter (where d.status = 'failed'),
         count(*) filter (where d.status = 'delivered')
    from api_endpoints e left join api_deliveries d on d.endpoint_id = e.id
   where e.firm_id = p_firm and admin_w(p_firm)
   group by e.id, e.url, e.types, e.active, e.created_at
$$;
revoke execute on function public.api_endpoint_list(uuid) from public, anon;
grant  execute on function public.api_endpoint_list(uuid) to authenticated;

/** The pusher's claim: a bounded batch of deliveries that are due, locked so two runs never race. */
create or replace function public.claim_api_deliveries(p_limit int default 50)
returns table (delivery_id uuid, endpoint_url text, signing_secret text, event_id uuid,
               event_type text, occurred_at timestamptz, seq bigint, payload jsonb, attempts int)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then raise exception 'not permitted' using errcode = '42501'; end if;
  return query
  with due as (
    select d.id from api_deliveries d
     where d.status = 'pending' and d.next_try_at <= now()
     order by d.next_try_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked)
  update api_deliveries d
     set attempts = d.attempts + 1, next_try_at = now() + (interval '2 minutes' * power(3, d.attempts))
    from due, api_endpoints e, api_events ev
   where d.id = due.id and e.id = d.endpoint_id and ev.id = d.event_id
  returning d.id, e.url, e.signing_secret, ev.id, ev.type, ev.occurred_at, ev.seq, ev.payload, d.attempts;
end $$;
revoke execute on function public.claim_api_deliveries(int) from public, anon, authenticated;

create or replace function public.finish_api_delivery(p_id uuid, p_ok boolean, p_status int default null, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then raise exception 'not permitted' using errcode = '42501'; end if;
  update api_deliveries
     set status = case when p_ok then 'delivered'
                       -- Eight tries over roughly a day and a half, then it stops and is visible as
                       -- failed. A queue that retries for ever is a queue nobody looks at.
                       when attempts >= 8 then 'failed' else 'pending' end,
         delivered_at = case when p_ok then now() end,
         last_status = p_status,
         last_error = left(coalesce(p_error, ''), 500)
   where id = p_id;
end $$;
revoke execute on function public.finish_api_delivery(uuid, boolean, int, text) from public, anon, authenticated;

-- ================================================================ 8. the push, scheduled
-- Same shape as the notification dispatcher: the URL and the shared secret live in Vault, and the
-- job is a no-op until both exist, so applying this migration schedules nothing until somebody
-- deliberately deploys the function and stores its address.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or to_regclass('vault.secrets') is null then
    raise notice 'pg_cron / pg_net / vault not available — schedule partner-webhooks by hand';
    return;
  end if;
  execute 'create extension if not exists pg_net';
  if exists (select 1 from cron.job where jobname = 'docket-partner-webhooks') then
    perform cron.unschedule('docket-partner-webhooks');
  end if;
  perform cron.schedule('docket-partner-webhooks', '* * * * *', $j$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'partner_webhooks_url'),
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      body    := '{}'::jsonb,
      timeout_milliseconds := 30000)
    where (select count(*) from vault.decrypted_secrets where name in ('partner_webhooks_url', 'cron_secret')) = 2
  $j$);
end $$;
