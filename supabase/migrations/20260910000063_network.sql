-- Docket, migration 63: Docket Network. Firms find, verify, connect with and work beside each other.
--
-- Migration 45 already solved the hard part and it is the strongest thing in the product: one firm
-- hands another a NAMED VERSION of a document on one matter, the other firm reads it through one
-- definer view and nothing else, and ending the arrangement closes every door at once. That is a
-- matter level act. This migration adds the firm level above it: who a firm is on the network, how
-- two firms come to be connected, what each may ask of the other, and the standing relationships
-- that outlast one matter. Nothing in 45 changes meaning; it gains a role and a precondition.
--
-- HOW A CONNECTION COMES TO EXIST, AND WHAT EACH STEP PROVES.
--
--  1. A member with the invite_firms permission at a verified firm invites an official email
--     address. invite_firm() mints two secrets: a LINK TOKEN (32 random bytes) that identifies the
--     invitation, and a CODE (eight characters from an alphabet with no 0/O or 1/I) that proves the
--     email was received. Both are stored as SHA 256 hashes; the code's hash is salted. The clear
--     text of either exists in exactly one place: the email, which is written to an outbox the
--     service role alone can read and the dispatcher alone sends. The function returns neither.
--  2. Whoever opens the link signs in and types the code. verify_network_invitation() finds the
--     invitation by the token's hash, refuses an expired one, refuses after five wrong attempts,
--     compares the code's hash, and records who verified it. A verified invitation GRANTS NOTHING:
--     it is a fact about an email, not a decision about a firm.
--  3. A member of the receiving firm who holds invite_firms accepts or declines, naming the firm.
--     The verifier must be a member of that same firm, so a verification by a stranger cannot be
--     claimed by another firm. Accepting creates the connection. Where the invited email's domain
--     matches nothing the accepting firm has told Docket about itself (its network profile's
--     official email or website, or a member's email), the connection is created in `review` and
--     a platform admin settles it; the firms are told so in words.
--  4. Either firm may suspend or end the connection. Ending it ends every live collaboration
--     between the two firms the same second, through the same columns migration 45 reads, and
--     recalls nothing already downloaded, which the screens say.
--
-- WHAT A CONNECTION IS NOT. It is not access. A connected firm reads the other's network profile
-- (what the profile chooses to show) and can propose a collaboration, an introduction or an
-- alliance. It reads no matter, no document, no client and no invoice until a collaboration under
-- migration 45 hands it one named thing. Firms' private databases are never merged.
--
-- THE CODE'S SECURITY, STATED. Eight characters from 32 symbols is 2^40 codes. Online guessing is
-- bounded at five attempts per invitation and three resends, and a resend invalidates the earlier
-- code. Offline guessing needs the salted hash, which no API role can select (the secret columns
-- have no grant). A member of the inviting firm could compute the code from their own firm's row
-- only with the service role, which no app surface holds.

-- ================================================================ 1. who a firm is on the network
create table public.firm_network_profiles (
  firm_id              uuid primary key references public.firms(id) on delete cascade,
  -- network: every verified firm on Docket may find it; connections: only firms connected to it;
  -- private: nobody finds it, though it can still invite and be invited by email.
  visibility           text not null default 'network' check (visibility in ('network', 'connections', 'private')),
  official_email       text check (official_email is null or official_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  website              text check (website is null or length(website) <= 200),
  telephone            text check (telephone is null or length(telephone) <= 40),
  office_address       text check (office_address is null or length(office_address) <= 400),
  registration_details text check (registration_details is null or length(registration_details) <= 400),
  country_code         text not null check (country_code ~ '^[A-Z]{2}$'),
  region               text check (region is null or length(region) <= 80),
  city                 text check (city is null or length(city) <= 80),
  practice_areas       text[] not null default '{}',
  jurisdictions        text[] not null default '{}',
  languages            text[] not null default '{English}',
  specialisms          text[] not null default '{}',
  description          text check (description is null or length(description) <= 2000),
  accepts_referrals    boolean not null default true,
  accepts_joint_matters boolean not null default true,
  accepts_introductions boolean not null default true,
  -- Whether connected firms see the official email, telephone, address and the owners' names.
  share_contacts       boolean not null default true,
  updated_by           uuid references public.profiles(id) on delete set null,
  updated_at           timestamptz not null default now()
);
comment on table public.firm_network_profiles is
  'A firm as other firms on Docket may see it. Written by upsert_network_profile() only. Contact details reach connected firms only where share_contacts is on.';
alter table public.firm_network_profiles enable row level security;
create policy firm_network_profiles_select on public.firm_network_profiles for select using (is_firm_member(firm_id));
revoke insert, update, delete, truncate, references, trigger on public.firm_network_profiles from anon, authenticated;
grant select on public.firm_network_profiles to authenticated;
create trigger firm_network_profiles_audit after insert or update or delete on public.firm_network_profiles
  for each row execute function public.audit_row_change();

create or replace function public.firm_is_verified(f uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from firms where id = f and status = 'active' and verified_at is not null)
$$;

create or replace function public.upsert_network_profile(p_firm uuid, p_profile jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_country text; v_areas text[]; v_jur text[]; v_langs text[]; v_spec text[]; v_vis text;
begin
  if not (admin_w(p_firm) and has_permission(p_firm, 'manage_settings')) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then raise exception 'the profile must be an object'; end if;
  v_vis := coalesce(p_profile ->> 'visibility', 'network');
  if v_vis not in ('network', 'connections', 'private') then raise exception 'visibility is network, connections or private'; end if;
  v_country := upper(coalesce(nullif(btrim(p_profile ->> 'country_code'), ''), (select jurisdiction_code from firms where id = p_firm)));
  select coalesce(array_agg(x), '{}') into v_areas from jsonb_array_elements_text(coalesce(p_profile -> 'practice_areas', '[]')) x where x ~ '^[a-z0-9_]{2,40}$';
  select coalesce(array_agg(upper(x)), '{}') into v_jur from jsonb_array_elements_text(coalesce(p_profile -> 'jurisdictions', '[]')) x where x ~* '^[a-z]{2}$';
  select coalesce(array_agg(btrim(x)), '{English}') into v_langs from jsonb_array_elements_text(coalesce(p_profile -> 'languages', '["English"]')) x where length(btrim(x)) between 2 and 40;
  select coalesce(array_agg(btrim(x)), '{}') into v_spec from jsonb_array_elements_text(coalesce(p_profile -> 'specialisms', '[]')) x where length(btrim(x)) between 2 and 80;
  if array_length(v_areas, 1) > 30 or array_length(v_spec, 1) > 30 or array_length(v_langs, 1) > 20 then raise exception 'too many entries in a list'; end if;

  insert into firm_network_profiles (firm_id, visibility, official_email, website, telephone, office_address, registration_details,
                                     country_code, region, city, practice_areas, jurisdictions, languages, specialisms, description,
                                     accepts_referrals, accepts_joint_matters, accepts_introductions, share_contacts, updated_by)
  values (p_firm, v_vis,
          nullif(lower(btrim(p_profile ->> 'official_email')), ''), nullif(btrim(p_profile ->> 'website'), ''),
          nullif(btrim(p_profile ->> 'telephone'), ''), nullif(btrim(p_profile ->> 'office_address'), ''),
          nullif(btrim(p_profile ->> 'registration_details'), ''),
          v_country, nullif(btrim(p_profile ->> 'region'), ''), nullif(btrim(p_profile ->> 'city'), ''),
          v_areas, v_jur, v_langs, v_spec, nullif(btrim(p_profile ->> 'description'), ''),
          coalesce((p_profile ->> 'accepts_referrals')::boolean, true), coalesce((p_profile ->> 'accepts_joint_matters')::boolean, true),
          coalesce((p_profile ->> 'accepts_introductions')::boolean, true), coalesce((p_profile ->> 'share_contacts')::boolean, true), auth.uid())
  on conflict (firm_id) do update
    set visibility = excluded.visibility, official_email = excluded.official_email, website = excluded.website,
        telephone = excluded.telephone, office_address = excluded.office_address, registration_details = excluded.registration_details,
        country_code = excluded.country_code, region = excluded.region, city = excluded.city,
        practice_areas = excluded.practice_areas, jurisdictions = excluded.jurisdictions, languages = excluded.languages,
        specialisms = excluded.specialisms, description = excluded.description,
        accepts_referrals = excluded.accepts_referrals, accepts_joint_matters = excluded.accepts_joint_matters,
        accepts_introductions = excluded.accepts_introductions, share_contacts = excluded.share_contacts,
        updated_by = excluded.updated_by, updated_at = now();
  perform audit('network.profile_saved', 'firm_network_profiles', p_firm, p_firm, jsonb_build_object('visibility', v_vis));
end $$;
revoke execute on function public.upsert_network_profile(uuid, jsonb) from public, anon;
grant  execute on function public.upsert_network_profile(uuid, jsonb) to authenticated;

-- ================================================================ 2. the connection
create table public.firm_connections (
  id                   uuid primary key default gen_random_uuid(),
  firm_a_id            uuid not null references public.firms(id) on delete cascade,
  firm_b_id            uuid not null references public.firms(id) on delete cascade,
  status               text not null default 'active' check (status in ('active', 'review', 'suspended', 'ended')),
  invitation_id        uuid,
  -- Each side's choices about the other, written by that side alone.
  settings_a           jsonb not null default '{"share_contacts": true, "allow_joint_matters": true, "allow_referrals": true, "allow_introductions": true}',
  settings_b           jsonb not null default '{"share_contacts": true, "allow_joint_matters": true, "allow_referrals": true, "allow_introductions": true}',
  review_note          text check (review_note is null or length(review_note) <= 1000),
  reviewed_at          timestamptz,
  reviewed_by          uuid references public.profiles(id) on delete set null,
  connected_at         timestamptz not null default now(),
  suspended_at         timestamptz,
  suspended_by_firm_id uuid references public.firms(id) on delete set null,
  suspend_reason       text check (suspend_reason is null or length(suspend_reason) <= 1000),
  ended_at             timestamptz,
  ended_by_firm_id     uuid references public.firms(id) on delete set null,
  end_reason           text check (end_reason is null or length(end_reason) <= 1000),
  created_at           timestamptz not null default now(),
  constraint firm_connections_ordered_chk check (firm_a_id < firm_b_id),
  constraint firm_connections_pair_key unique (firm_a_id, firm_b_id)
);
comment on table public.firm_connections is
  'Two firms that verified each other. Not access: a connected firm reads the other''s network profile and may propose work; it reads no matter until migration 45 hands it one. Written by its doors only.';
create index firm_connections_b_idx on public.firm_connections (firm_b_id);
alter table public.firm_connections enable row level security;
create policy firm_connections_select on public.firm_connections for select
  using (is_firm_member(firm_a_id) or is_firm_member(firm_b_id) or is_platform_admin());
revoke insert, update, delete, truncate, references, trigger on public.firm_connections from anon, authenticated;
grant select on public.firm_connections to authenticated;
create trigger firm_connections_audit after insert or update or delete on public.firm_connections
  for each row execute function public.audit_row_change();

/** The live connection between two firms, or null. */
create or replace function public.connection_between(a uuid, b uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from firm_connections
   where firm_a_id = least(a, b) and firm_b_id = greatest(a, b) and status = 'active'
$$;
create or replace function public.firms_connected(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select connection_between(a, b) is not null
$$;

-- ================================================================ 3. the outbox, for an email that has no account behind it
-- enqueue_notification() needs a profile to send to. An invitation goes to an address that may
-- have none, so it is a row here, drained by the dispatcher through the two doors below, exactly
-- as notifications are. No API role can read it: the code is in the body in clear.
create table public.outbound_emails (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid references public.firms(id) on delete set null,
  kind          text not null,
  to_email      text not null,
  from_name     text not null default 'Docket',
  subject       text not null,
  body          text not null,
  -- A path under APP_URL, which only the dispatcher knows. Rendered into {link} in the body.
  link_path     text,
  status        text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  send_after    timestamptz not null default now(),
  claimed_at    timestamptz,
  sent_at       timestamptz,
  provider      text,
  provider_ref  text,
  error         text,
  send_attempts int not null default 0,
  created_at    timestamptz not null default now()
);
create index outbound_emails_queue_idx on public.outbound_emails (send_after) where status = 'queued';
alter table public.outbound_emails enable row level security;
revoke all on public.outbound_emails from anon, authenticated;
comment on table public.outbound_emails is
  'Emails to addresses with no account: network invitations. Service role only; drained by dispatch-notifications through claim_outbound_emails() and finish_outbound_email().';

create or replace function public.claim_outbound_emails(p_limit int default 20)
returns table (id uuid, kind text, to_email text, from_name text, subject text, body text, link_path text, send_attempts int)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then raise exception 'not permitted' using errcode = '42501'; end if;
  p_limit := least(greatest(coalesce(p_limit, 20), 1), 100);
  update outbound_emails e set status = 'queued', claimed_at = null, error = 'a send was claimed and never finished — it may have gone out'
   where e.status = 'sending' and e.claimed_at < now() - interval '10 minutes';
  return query
    with c as (
      select e.id from outbound_emails e
       where e.status = 'queued' and e.send_after <= now()
       order by e.created_at limit p_limit for update skip locked),
    u as (
      update outbound_emails e set status = 'sending', claimed_at = now(), send_attempts = e.send_attempts + 1
        from c where e.id = c.id
      returning e.id, e.kind, e.to_email, e.from_name, e.subject, e.body, e.link_path, e.send_attempts)
    select * from u;
end $$;
revoke execute on function public.claim_outbound_emails(int) from public, anon, authenticated;

create or replace function public.finish_outbound_email(
  p_id uuid, p_outcome text, p_provider text default null, p_provider_ref text default null,
  p_error text default null, p_failure_kind text default null)
returns void language plpgsql security definer set search_path = public as $$
declare e outbound_emails%rowtype;
begin
  if auth.uid() is not null then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into e from outbound_emails where id = p_id for update;
  if not found then raise exception 'email not found'; end if;
  if e.status <> 'sending' then raise exception 'email is not being sent (status %)', e.status; end if;
  if p_outcome = 'sent' then
    update outbound_emails set status = 'sent', sent_at = now(), provider = p_provider, provider_ref = p_provider_ref, error = null, claimed_at = null where id = p_id;
  elsif p_outcome = 'failed' then
    if coalesce(p_failure_kind, 'permanent') = 'transient' and e.send_attempts < 5 then
      update outbound_emails set status = 'queued', send_after = now() + interval '1 minute' * power(2, e.send_attempts),
             error = left(p_error, 500), provider = coalesce(p_provider, provider), claimed_at = null where id = p_id;
    else
      update outbound_emails set status = 'failed', error = left(p_error, 500), provider = coalesce(p_provider, provider), claimed_at = null where id = p_id;
    end if;
  elsif p_outcome = 'skipped' then
    update outbound_emails set status = 'skipped', error = left(p_error, 500), claimed_at = null where id = p_id;
  else
    raise exception 'unknown outcome %', p_outcome;
  end if;
end $$;
revoke execute on function public.finish_outbound_email(uuid, text, text, text, text, text) from public, anon, authenticated;

-- ================================================================ 4. the invitation
create table public.network_invitations (
  id                   uuid primary key default gen_random_uuid(),
  from_firm_id         uuid not null references public.firms(id) on delete cascade,
  to_email             text not null,
  -- What the recipient is told about the inviting firm: a snapshot, as migration 45 snapshots a matter.
  from_firm_name       text not null,
  from_country         text,
  from_practice_areas  text[] not null default '{}',
  from_representative  text,
  reason               text not null check (length(btrim(reason)) between 10 and 2000),
  status               text not null default 'pending' check (status in ('pending', 'verified', 'accepted', 'declined', 'expired', 'revoked')),
  token_hash           text not null unique,
  code_hash            text not null,
  code_salt            text not null,
  code_expires_at      timestamptz not null,
  attempts             int not null default 0,
  max_attempts         int not null default 5,
  resends              int not null default 0,
  max_resends          int not null default 3,
  last_sent_at         timestamptz,
  verified_at          timestamptz,
  verified_by          uuid references public.profiles(id) on delete set null,
  accepted_at          timestamptz,
  accepted_by          uuid references public.profiles(id) on delete set null,
  accepted_firm_id     uuid references public.firms(id) on delete set null,
  connection_id        uuid references public.firm_connections(id) on delete set null,
  declined_at          timestamptz,
  declined_by          uuid references public.profiles(id) on delete set null,
  decline_reason       text check (decline_reason is null or length(decline_reason) <= 1000),
  revoked_at           timestamptz,
  revoked_by           uuid references public.profiles(id) on delete set null,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now()
);
comment on table public.network_invitations is
  'An invitation to connect, sent to an official email. The code and the link token are stored as hashes and never returned; the clear text is in the outbox email alone. A verified invitation grants nothing until a member of the receiving firm who holds invite_firms accepts it.';
create index network_invitations_from_idx on public.network_invitations (from_firm_id, status);
create index network_invitations_email_idx on public.network_invitations (lower(to_email)) where status in ('pending', 'verified');
alter table public.firm_connections add constraint firm_connections_invitation_fk
  foreign key (invitation_id) references public.network_invitations(id) on delete set null;
alter table public.network_invitations enable row level security;
-- The inviting firm's members, the person who verified it, and the members of the firm that
-- answered it. The three secret columns have no grant for any API role, whoever the row is for.
create policy network_invitations_select on public.network_invitations for select
  using (is_firm_member(from_firm_id) or verified_by = (select auth.uid())
         or (accepted_firm_id is not null and is_firm_member(accepted_firm_id)));
revoke all on public.network_invitations from anon, authenticated;
grant select (id, from_firm_id, to_email, from_firm_name, from_country, from_practice_areas, from_representative, reason, status,
              code_expires_at, attempts, max_attempts, resends, max_resends, last_sent_at, verified_at, verified_by,
              accepted_at, accepted_by, accepted_firm_id, connection_id, declined_at, declined_by, decline_reason,
              revoked_at, revoked_by, created_by, created_at)
  on public.network_invitations to authenticated;
-- No audit_row_change() trigger here, on purpose: it records every changed column, and the hash
-- and salt would land in audit_log.meta for the inviting firm's admins to read. The functions
-- audit each act by name instead.

/** Eight characters from an alphabet with no 0/O or 1/I, as ABCD-EFGH. 2^40 codes. */
create or replace function public.network_mint_code() returns text
language plpgsql volatile set search_path = public as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea := gen_random_bytes(8); s text := ''; i int;
begin
  for i in 0..7 loop
    s := s || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return left(s, 4) || '-' || right(s, 4);
end $$;
revoke execute on function public.network_mint_code() from public, anon, authenticated;

create or replace function public.network_code_hash(p_salt text, p_code text) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(p_salt || ':' || upper(replace(btrim(p_code), '-', '')), 'UTF8')), 'hex')
$$;
revoke execute on function public.network_code_hash(text, text) from public, anon, authenticated;

/** The email, written once, read by the dispatcher. */
create or replace function public.network_invitation_email(p_inv network_invitations, p_code text, p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into outbound_emails (firm_id, kind, to_email, from_name, subject, body, link_path)
  values (p_inv.from_firm_id, 'network_invitation', p_inv.to_email, 'Docket',
          format('%s invites your firm to connect on Docket', p_inv.from_firm_name),
          coalesce(p_inv.from_representative || ' of ', '') || p_inv.from_firm_name
            || E' has invited your firm to connect on Docket, the global legal workspace.\n\n'
            || E'Why they are asking:\n' || btrim(p_inv.reason) || E'\n\n'
            || E'To accept or decline, open this link and enter the verification code below. The code is for your firm''s authorised representative, works once, and expires on '
            || to_char(p_inv.code_expires_at at time zone 'UTC', 'DD Mon YYYY HH24:MI "UTC"') || E'.\n\n'
            || 'Verification code: ' || p_code || E'\n\nLink: {link}\n\n'
            || 'Entering the code proves this email reached your firm. It grants no access on its own: an owner or administrator of your firm then decides whether to connect. '
            || 'If your firm is not on Docket yet, the link lets you register it first. If you were not expecting this, ignore it; nothing happens without the code.',
          '/network/join?token=' || p_token);
end $$;
revoke execute on function public.network_invitation_email(network_invitations, text, text) from public, anon, authenticated;

/**
 * Invite an official email to connect. Returns the invitation's id and expiry, never the code or
 * the token. A member of a verified firm who holds invite_firms; twenty a day per person.
 */
create or replace function public.invite_firm(p_firm uuid, p_to_email text, p_reason text, p_representative text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email text := lower(btrim(coalesce(p_to_email, ''))); v_inv network_invitations%rowtype; v_code text; v_token text; v_salt text;
        v_name text; v_country text; v_areas text[]; v_rep text; r record;
begin
  if not (staff_w(p_firm) and has_permission(p_firm, 'invite_firms')) then raise exception 'not permitted' using errcode = '42501'; end if;
  if not firm_is_verified(p_firm) then
    raise exception 'your firm must be verified by Docket before it can invite other firms';
  end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'give the firm''s official email address'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'say why you are asking to connect, in at least ten characters'; end if;
  if exists (select 1 from firm_members fm join profiles p on p.id = fm.user_id where fm.firm_id = p_firm and lower(p.email) = v_email) then
    raise exception 'that address belongs to a member of your own firm';
  end if;
  if exists (select 1 from network_invitations where from_firm_id = p_firm and lower(to_email) = v_email and status in ('pending', 'verified')) then
    raise exception 'an invitation to that address is already open — resend it rather than sending another';
  end if;
  if not rate_limit_hit('network_invite', 20, interval '1 day') then
    raise exception 'too many invitations today — try again tomorrow';
  end if;

  select f.name, coalesce(np.country_code, f.jurisdiction_code), coalesce(np.practice_areas, '{}')
    into v_name, v_country, v_areas
    from firms f left join firm_network_profiles np on np.firm_id = f.id where f.id = p_firm;
  v_rep := nullif(btrim(coalesce(p_representative, '')), '');
  if v_rep is null then
    select coalesce(p.full_name, p.email) into v_rep from profiles p where p.id = auth.uid();
  end if;

  v_code  := network_mint_code();
  v_token := encode(gen_random_bytes(32), 'hex');
  v_salt  := encode(gen_random_bytes(16), 'hex');
  insert into network_invitations (from_firm_id, to_email, from_firm_name, from_country, from_practice_areas, from_representative, reason,
                                   token_hash, code_hash, code_salt, code_expires_at, last_sent_at, created_by)
  values (p_firm, v_email, v_name, v_country, v_areas, v_rep, btrim(p_reason),
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), network_code_hash(v_salt, v_code), v_salt, now() + interval '72 hours', now(), auth.uid())
  returning * into v_inv;

  perform network_invitation_email(v_inv, v_code, v_token);

  -- Somebody on Docket already uses that address: tell them in the app too, so the email is not
  -- the only route. Tells them nothing the email does not.
  for r in select p.id from profiles p where lower(p.email) = v_email loop
    perform enqueue_notification(r.id, null, 'network_invitation_received',
      jsonb_build_object('invitation_id', v_inv.id, 'from_firm_name', v_name, 'from_country', v_country));
  end loop;

  perform audit('network.invited', 'network_invitations', v_inv.id, p_firm,
                jsonb_build_object('to_email', v_email, 'representative', v_rep));
  return jsonb_build_object('invitation_id', v_inv.id, 'expires_at', v_inv.code_expires_at, 'to_email', v_email);
end $$;
revoke execute on function public.invite_firm(uuid, text, text, text) from public, anon;
grant  execute on function public.invite_firm(uuid, text, text, text) to authenticated;

/** A fresh code and a fresh email for an open invitation. The earlier code stops working. Three times. */
create or replace function public.resend_network_invitation(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv network_invitations%rowtype; v_code text; v_token text; v_salt text;
begin
  select * into v_inv from network_invitations where id = p_id for update;
  if not found then raise exception 'invitation not found'; end if;
  if not (staff_w(v_inv.from_firm_id) and has_permission(v_inv.from_firm_id, 'invite_firms')) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_inv.status <> 'pending' then raise exception 'this invitation is %, and only a pending one can be resent', v_inv.status; end if;
  if v_inv.resends >= v_inv.max_resends then
    raise exception 'this invitation has been resent % times — withdraw it and create a new one', v_inv.max_resends;
  end if;
  v_code  := network_mint_code();
  v_token := encode(gen_random_bytes(32), 'hex');
  v_salt  := encode(gen_random_bytes(16), 'hex');
  update network_invitations
     set code_salt = v_salt, code_hash = network_code_hash(v_salt, v_code), resends = resends + 1, attempts = 0,
         code_expires_at = now() + interval '72 hours', last_sent_at = now(),
         token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex')
   where id = p_id returning * into v_inv;
  perform network_invitation_email(v_inv, v_code, v_token);
  perform audit('network.invitation_resent', 'network_invitations', p_id, v_inv.from_firm_id, jsonb_build_object('resends', v_inv.resends));
  return jsonb_build_object('invitation_id', p_id, 'expires_at', v_inv.code_expires_at, 'resends', v_inv.resends);
end $$;
revoke execute on function public.resend_network_invitation(uuid) from public, anon;
grant  execute on function public.resend_network_invitation(uuid) to authenticated;

create or replace function public.revoke_network_invitation(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_inv network_invitations%rowtype;
begin
  select * into v_inv from network_invitations where id = p_id for update;
  if not found then raise exception 'invitation not found'; end if;
  if not (staff_w(v_inv.from_firm_id) and has_permission(v_inv.from_firm_id, 'invite_firms')) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_inv.status not in ('pending', 'verified') then raise exception 'this invitation is already %', v_inv.status; end if;
  update network_invitations set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), code_hash = 'revoked' where id = p_id;
  perform audit('network.invitation_revoked', 'network_invitations', p_id, v_inv.from_firm_id,
                jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), '')));
end $$;
revoke execute on function public.revoke_network_invitation(uuid, text) from public, anon;
grant  execute on function public.revoke_network_invitation(uuid, text) to authenticated;

/**
 * Prove the email was received: the link's token and the code, together. Signed in, any firm or
 * none. Five wrong codes lock the invitation; an expired code is refused; a used code is refused.
 * Records who verified it. Grants nothing.
 *
 * A WRONG CODE IS AN ANSWER, NOT AN ERROR. An exception unwinds everything the function wrote,
 * the attempt counter included, so a function that raised on a wrong code could never count one
 * and the five attempt bound would be a sentence rather than a rule. So a wrong code returns
 * {status: 'wrong_code', attempts_left}, a locked invitation returns {status: 'locked'}, and the
 * counter is committed. A link that is not an invitation, an expired one and a spent one raise.
 */
create or replace function public.verify_network_invitation(p_token text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv network_invitations%rowtype; v_left int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_token !~ '^[0-9a-f]{64}$' then raise exception 'this invitation link is not valid'; end if;
  select * into v_inv from network_invitations where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if not found then raise exception 'this invitation link is not valid'; end if;
  if v_inv.status = 'verified' then
    -- Already proved. The same person may carry on to accept; anybody else is told it is spoken for.
    if v_inv.verified_by = auth.uid() then
      return jsonb_build_object('invitation_id', v_inv.id, 'status', 'verified', 'from_firm_name', v_inv.from_firm_name,
                                'from_country', v_inv.from_country, 'from_practice_areas', to_jsonb(v_inv.from_practice_areas),
                                'from_representative', v_inv.from_representative, 'reason', v_inv.reason, 'to_email', v_inv.to_email);
    end if;
    raise exception 'this invitation has already been verified by somebody else; ask the person who entered the code to answer it, or ask the inviting firm to send another';
  end if;
  if v_inv.status <> 'pending' then raise exception 'this invitation is %', v_inv.status; end if;
  if v_inv.code_expires_at < now() then
    update network_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'this invitation has expired — ask the inviting firm to send it again';
  end if;
  if v_inv.attempts >= v_inv.max_attempts then
    return jsonb_build_object('invitation_id', v_inv.id, 'status', 'locked', 'attempts_left', 0);
  end if;
  if network_code_hash(v_inv.code_salt, coalesce(p_code, '')) <> v_inv.code_hash then
    update network_invitations set attempts = attempts + 1 where id = v_inv.id;
    v_left := v_inv.max_attempts - v_inv.attempts - 1;
    perform audit('network.code_wrong', 'network_invitations', v_inv.id, v_inv.from_firm_id, jsonb_build_object('attempts_left', v_left));
    return jsonb_build_object('invitation_id', v_inv.id, 'status', case when v_left <= 0 then 'locked' else 'wrong_code' end, 'attempts_left', greatest(v_left, 0));
  end if;

  update network_invitations
     set status = 'verified', verified_at = now(), verified_by = auth.uid(), code_hash = 'used'
   where id = v_inv.id;
  perform audit('network.invitation_verified', 'network_invitations', v_inv.id, v_inv.from_firm_id, jsonb_build_object('by', auth.uid()));
  if v_inv.created_by is not null then
    perform enqueue_notification(v_inv.created_by, v_inv.from_firm_id, 'network_invitation_verified',
      jsonb_build_object('invitation_id', v_inv.id, 'to_email', v_inv.to_email));
  end if;
  return jsonb_build_object('invitation_id', v_inv.id, 'status', 'verified', 'from_firm_name', v_inv.from_firm_name,
                            'from_country', v_inv.from_country, 'from_practice_areas', to_jsonb(v_inv.from_practice_areas),
                            'from_representative', v_inv.from_representative, 'reason', v_inv.reason, 'to_email', v_inv.to_email);
end $$;
revoke execute on function public.verify_network_invitation(text, text) from public, anon;
grant  execute on function public.verify_network_invitation(text, text) to authenticated;

/** Does the invited address's domain match anything this firm has told Docket about itself? */
create or replace function public.network_domain_matches(p_firm uuid, p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  with d as (select lower(split_part(p_email, '@', 2)) as dom)
  select exists (
    select 1 from d, firm_network_profiles np
     where np.firm_id = p_firm
       and (lower(split_part(coalesce(np.official_email, ''), '@', 2)) = d.dom
            or regexp_replace(lower(coalesce(np.website, '')), '^https?://(www\.)?|/.*$', '', 'g') = d.dom))
  or exists (select 1 from d, firm_members fm join profiles p on p.id = fm.user_id
              where fm.firm_id = p_firm and lower(split_part(coalesce(p.email, ''), '@', 2)) = d.dom)
  or exists (select 1 from d, firms f where f.id = p_firm and regexp_replace(lower(coalesce(f.custom_domain, '')), '^www\.', '') = d.dom)
$$;
revoke execute on function public.network_domain_matches(uuid, text) from public, anon, authenticated;

/**
 * The receiving firm's answer. A member of p_firm who holds invite_firms, with a verified session,
 * on an invitation that a member of p_firm verified. Accepting creates the connection, active where
 * the invited domain matches the firm, in review where it does not. Declining tells the inviting
 * firm. Either way the invitation is closed.
 */
create or replace function public.respond_network_invitation(p_id uuid, p_firm uuid, p_accept boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv network_invitations%rowtype; v_conn firm_connections%rowtype; v_status text; v_name text; v_from_name text; r record;
        v_a uuid; v_b uuid; v_existing firm_connections%rowtype;
begin
  if not (staff_w(p_firm) and has_permission(p_firm, 'invite_firms')) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into v_inv from network_invitations where id = p_id for update;
  if not found then raise exception 'invitation not found'; end if;
  if v_inv.status <> 'verified' then raise exception 'this invitation is % — the code has to be entered first', v_inv.status; end if;
  if v_inv.verified_at < now() - interval '14 days' then
    update network_invitations set status = 'expired' where id = p_id;
    raise exception 'this invitation was verified more than fourteen days ago and has expired';
  end if;
  if not exists (select 1 from firm_members where firm_id = p_firm and user_id = v_inv.verified_by) then
    raise exception 'the code was entered by somebody who is not a member of that firm — only the firm whose member verified it can answer';
  end if;
  if p_firm = v_inv.from_firm_id then raise exception 'a firm cannot connect to itself'; end if;
  if not firm_is_verified(p_firm) then raise exception 'your firm must be verified by Docket before it can connect with other firms'; end if;

  select name into v_name from firms where id = p_firm;
  v_from_name := v_inv.from_firm_name;

  if not p_accept then
    update network_invitations
       set status = 'declined', declined_at = now(), declined_by = auth.uid(), accepted_firm_id = p_firm,
           decline_reason = nullif(btrim(coalesce(p_reason, '')), '')
     where id = p_id;
    perform enqueue_firm_notification(v_inv.from_firm_id, 'network_connection_declined',
      jsonb_build_object('invitation_id', p_id, 'firm_name', v_name, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
    perform audit('network.declined', 'network_invitations', p_id, p_firm, jsonb_build_object('from_firm_id', v_inv.from_firm_id));
    perform audit('network.declined', 'network_invitations', p_id, v_inv.from_firm_id, jsonb_build_object('by_firm_id', p_firm));
    return jsonb_build_object('status', 'declined');
  end if;

  v_status := case when network_domain_matches(p_firm, v_inv.to_email) then 'active' else 'review' end;
  v_a := least(p_firm, v_inv.from_firm_id); v_b := greatest(p_firm, v_inv.from_firm_id);
  select * into v_existing from firm_connections where firm_a_id = v_a and firm_b_id = v_b for update;
  if found then
    if v_existing.status in ('active', 'review') then raise exception 'these two firms are already connected'; end if;
    if v_existing.status = 'suspended' then raise exception 'the connection between these firms is suspended — lift the suspension rather than inviting again'; end if;
    update firm_connections
       set status = v_status, invitation_id = p_id, connected_at = now(), ended_at = null, ended_by_firm_id = null, end_reason = null,
           suspended_at = null, suspended_by_firm_id = null, suspend_reason = null, reviewed_at = null, reviewed_by = null, review_note = null
     where id = v_existing.id returning * into v_conn;
  else
    insert into firm_connections (firm_a_id, firm_b_id, status, invitation_id) values (v_a, v_b, v_status, p_id) returning * into v_conn;
  end if;

  update network_invitations
     set status = 'accepted', accepted_at = now(), accepted_by = auth.uid(), accepted_firm_id = p_firm, connection_id = v_conn.id
   where id = p_id;

  perform enqueue_firm_notification(v_inv.from_firm_id,
    case when v_status = 'active' then 'network_connection_accepted' else 'network_connection_review' end,
    jsonb_build_object('connection_id', v_conn.id, 'firm_name', v_name));
  perform enqueue_firm_notification(p_firm,
    case when v_status = 'active' then 'network_connection_accepted' else 'network_connection_review' end,
    jsonb_build_object('connection_id', v_conn.id, 'firm_name', v_from_name));
  perform audit('network.connected', 'firm_connections', v_conn.id, p_firm,
                jsonb_build_object('with_firm_id', v_inv.from_firm_id, 'status', v_status, 'invitation_id', p_id));
  perform audit('network.connected', 'firm_connections', v_conn.id, v_inv.from_firm_id,
                jsonb_build_object('with_firm_id', p_firm, 'status', v_status, 'invitation_id', p_id));
  return jsonb_build_object('status', v_status, 'connection_id', v_conn.id);
end $$;
revoke execute on function public.respond_network_invitation(uuid, uuid, boolean, text) from public, anon;
grant  execute on function public.respond_network_invitation(uuid, uuid, boolean, text) to authenticated;

/** A platform admin settles a connection in review: the domain did not match, a person checked. */
create or replace function public.review_connection(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c firm_connections%rowtype;
begin
  if not (is_platform_admin() and mfa_ok()) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into c from firm_connections where id = p_id for update;
  if not found then raise exception 'connection not found'; end if;
  if c.status <> 'review' then raise exception 'this connection is %, not in review', c.status; end if;
  update firm_connections
     set status = case when p_approve then 'active' else 'ended' end,
         reviewed_at = now(), reviewed_by = auth.uid(), review_note = nullif(btrim(coalesce(p_note, '')), ''),
         ended_at = case when p_approve then null else now() end,
         end_reason = case when p_approve then null else 'not approved by Docket after review' end
   where id = p_id;
  perform enqueue_firm_notification(c.firm_a_id, case when p_approve then 'network_connection_accepted' else 'network_connection_ended' end,
    jsonb_build_object('connection_id', p_id, 'firm_name', (select name from firms where id = c.firm_b_id), 'by_firm_name', 'Docket'));
  perform enqueue_firm_notification(c.firm_b_id, case when p_approve then 'network_connection_accepted' else 'network_connection_ended' end,
    jsonb_build_object('connection_id', p_id, 'firm_name', (select name from firms where id = c.firm_a_id), 'by_firm_name', 'Docket'));
  perform audit('network.reviewed', 'firm_connections', p_id, null, jsonb_build_object('approved', p_approve, 'note', p_note));
end $$;
revoke execute on function public.review_connection(uuid, boolean, text) from public, anon;
grant  execute on function public.review_connection(uuid, boolean, text) to authenticated;

/** Which side of a connection the caller's firm is: 'a', 'b', or null. */
create or replace function public.connection_side(p_connection uuid, p_firm uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when c.firm_a_id = p_firm then 'a' when c.firm_b_id = p_firm then 'b' end
    from firm_connections c where c.id = p_connection
$$;
revoke execute on function public.connection_side(uuid, uuid) from public, anon, authenticated;

/**
 * Suspend, lift or end a connection. A member of either firm who holds invite_firms. A suspension
 * is lifted only by the firm that made it. Ending it ends every live collaboration between the two
 * firms the same second: nothing is deleted, nothing is recalled, and both firms are told.
 */
create or replace function public.set_connection_status(p_id uuid, p_firm uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c firm_connections%rowtype; v_other uuid; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_name text; v_ended int := 0; r record;
begin
  if not (staff_w(p_firm) and has_permission(p_firm, 'invite_firms')) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into c from firm_connections where id = p_id and (firm_a_id = p_firm or firm_b_id = p_firm) for update;
  if not found then raise exception 'connection not found'; end if;
  v_other := case when c.firm_a_id = p_firm then c.firm_b_id else c.firm_a_id end;
  select name into v_name from firms where id = p_firm;
  if p_status not in ('active', 'suspended', 'ended') then raise exception 'a connection is active, suspended or ended'; end if;
  if c.status = 'ended' then raise exception 'this connection has ended — a new invitation makes a new one'; end if;
  if c.status = 'review' and p_status = 'active' then raise exception 'this connection is in review; Docket settles it'; end if;
  if c.status = p_status then return; end if;

  if p_status = 'suspended' then
    update firm_connections set status = 'suspended', suspended_at = now(), suspended_by_firm_id = p_firm, suspend_reason = v_reason where id = p_id;
    perform enqueue_firm_notification(v_other, 'network_connection_suspended', jsonb_build_object('connection_id', p_id, 'firm_name', v_name, 'reason', v_reason));
  elsif p_status = 'active' then
    if c.suspended_by_firm_id is distinct from p_firm then
      raise exception 'only the firm that suspended this connection can lift the suspension';
    end if;
    update firm_connections set status = 'active', suspended_at = null, suspended_by_firm_id = null, suspend_reason = null where id = p_id;
    perform enqueue_firm_notification(v_other, 'network_connection_accepted', jsonb_build_object('connection_id', p_id, 'firm_name', v_name));
  else
    update firm_connections set status = 'ended', ended_at = now(), ended_by_firm_id = p_firm, end_reason = v_reason where id = p_id;
    -- Every live collaboration between the two firms, in either direction, ends now. The columns
    -- migration 45 reads are written directly; collaboration_live() is false from this instant.
    for r in select mc.id, mc.firm_id, mc.with_firm_id, mc.case_title from matter_collaborations mc
              where ((mc.firm_id = p_firm and mc.with_firm_id = v_other) or (mc.firm_id = v_other and mc.with_firm_id = p_firm))
                and mc.ended_at is null and mc.declined_at is null loop
      update matter_collaborations set ended_at = now(), ended_by = auth.uid(),
             end_reason = coalesce('the connection between the firms ended' || case when v_reason is not null then ': ' || v_reason else '' end, '')
       where id = r.id;
      perform audit('collaboration.ended', 'matter_collaboration', r.id, r.firm_id, jsonb_build_object('with_firm_id', r.with_firm_id, 'reason', 'connection ended'));
      perform audit('collaboration.ended', 'matter_collaboration', r.id, r.with_firm_id, jsonb_build_object('firm_id', r.firm_id, 'reason', 'connection ended'));
      v_ended := v_ended + 1;
    end loop;
    perform enqueue_firm_notification(v_other, 'network_connection_ended',
      jsonb_build_object('connection_id', p_id, 'firm_name', v_name, 'by_firm_name', v_name, 'reason', v_reason, 'collaborations_ended', v_ended));
  end if;
  perform audit('network.connection_' || p_status, 'firm_connections', p_id, p_firm, jsonb_build_object('with_firm_id', v_other, 'reason', v_reason, 'collaborations_ended', v_ended));
  perform audit('network.connection_' || p_status, 'firm_connections', p_id, v_other, jsonb_build_object('by_firm_id', p_firm, 'reason', v_reason, 'collaborations_ended', v_ended));
end $$;
revoke execute on function public.set_connection_status(uuid, uuid, text, text) from public, anon;
grant  execute on function public.set_connection_status(uuid, uuid, text, text) to authenticated;

/** What the caller's firm allows the other firm on this connection: its own side only. */
create or replace function public.set_connection_settings(p_id uuid, p_firm uuid, p_settings jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_side text; v_clean jsonb;
begin
  if not (staff_w(p_firm) and has_permission(p_firm, 'invite_firms')) then raise exception 'not permitted' using errcode = '42501'; end if;
  v_side := connection_side(p_id, p_firm);
  if v_side is null then raise exception 'connection not found'; end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then raise exception 'settings must be an object'; end if;
  v_clean := jsonb_build_object(
    'share_contacts',      coalesce((p_settings ->> 'share_contacts')::boolean, true),
    'allow_joint_matters', coalesce((p_settings ->> 'allow_joint_matters')::boolean, true),
    'allow_referrals',     coalesce((p_settings ->> 'allow_referrals')::boolean, true),
    'allow_introductions', coalesce((p_settings ->> 'allow_introductions')::boolean, true));
  if v_side = 'a' then update firm_connections set settings_a = v_clean where id = p_id;
  else update firm_connections set settings_b = v_clean where id = p_id; end if;
  perform audit('network.connection_settings', 'firm_connections', p_id, p_firm, v_clean);
end $$;
revoke execute on function public.set_connection_settings(uuid, uuid, jsonb) from public, anon;
grant  execute on function public.set_connection_settings(uuid, uuid, jsonb) to authenticated;

-- ================================================================ 5. what a firm reads of other firms
-- INVARIANT: these two views are the only read paths into another firm's network profile. Fixed
-- column lists, never select *, never a column that reaches a matter, a client or an invoice.

-- The directory. Verified, active firms whose profile says they may be found, to members of any
-- firm. No contact details here: those travel through connected_firms, where the other firm chose.
create view public.network_directory with (security_invoker = false) as
  select f.id as firm_id, f.name, f.legal_name, f.jurisdiction_code,
         np.country_code, np.region, np.city, np.website,
         np.practice_areas, np.jurisdictions, np.languages, np.specialisms, np.description,
         np.accepts_referrals, np.accepts_joint_matters, np.accepts_introductions,
         true as verified,
         exists (select 1 from firm_connections c
                  where c.status = 'active'
                    and ((c.firm_a_id = f.id and is_firm_member(c.firm_b_id)) or (c.firm_b_id = f.id and is_firm_member(c.firm_a_id)))) as connected,
         is_firm_member(f.id) as mine
    from firms f
    join firm_network_profiles np on np.firm_id = f.id
   where f.status = 'active' and f.verified_at is not null
     and exists (select 1 from firm_members m where m.user_id = auth.uid())
     and (np.visibility = 'network'
          or is_firm_member(f.id)
          or (np.visibility = 'connections'
              and exists (select 1 from firm_connections c
                           where c.status = 'active'
                             and ((c.firm_a_id = f.id and is_firm_member(c.firm_b_id)) or (c.firm_b_id = f.id and is_firm_member(c.firm_a_id))))));
revoke all on public.network_directory from anon;
grant select on public.network_directory to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.network_directory from anon, authenticated;
comment on view public.network_directory is
  'INVARIANT: the only read path into another firm''s profile for a firm that is not connected to it. Fixed columns, no contact details, nothing that reaches a matter.';

-- The firms connected to the caller's firms, one row per connection and side, with the OTHER
-- firm's contact details only where that firm chose to share them with connections.
create view public.connected_firms with (security_invoker = false) as
  select c.id as connection_id, c.status, c.connected_at, c.suspended_at, c.suspended_by_firm_id, c.ended_at, c.ended_by_firm_id,
         c.end_reason, c.suspend_reason, c.reviewed_at,
         mine.firm_id as my_firm_id, other.firm_id as other_firm_id,
         f.name as other_firm_name, f.legal_name as other_legal_name, f.jurisdiction_code as other_jurisdiction_code,
         np.country_code, np.region, np.city, np.website, np.practice_areas, np.jurisdictions, np.languages, np.specialisms, np.description,
         case when coalesce((other.settings ->> 'share_contacts')::boolean, true) and coalesce(np.share_contacts, true) then np.official_email end as official_email,
         case when coalesce((other.settings ->> 'share_contacts')::boolean, true) and coalesce(np.share_contacts, true) then np.telephone end as telephone,
         case when coalesce((other.settings ->> 'share_contacts')::boolean, true) and coalesce(np.share_contacts, true) then np.office_address end as office_address,
         case when coalesce((other.settings ->> 'share_contacts')::boolean, true) and coalesce(np.share_contacts, true) then
           (select jsonb_agg(jsonb_build_object('name', coalesce(p.full_name, 'A member'), 'title', coalesce(fm.title, initcap(fm.role::text)), 'email', p.email) order by fm.role, p.full_name)
              from firm_members fm join profiles p on p.id = fm.user_id
             where fm.firm_id = other.firm_id and fm.role in ('owner', 'admin'))
         end as contacts,
         mine.settings as my_settings, other.settings as their_settings
    from firm_connections c
    cross join lateral (values (c.firm_a_id, c.settings_a, c.firm_b_id, c.settings_b), (c.firm_b_id, c.settings_b, c.firm_a_id, c.settings_a))
      as sides(my_firm, my_settings, other_firm, other_settings)
    cross join lateral (select sides.my_firm as firm_id, sides.my_settings as settings) mine
    cross join lateral (select sides.other_firm as firm_id, sides.other_settings as settings) other
    join firms f on f.id = other.firm_id
    left join firm_network_profiles np on np.firm_id = other.firm_id
   where is_firm_member(mine.firm_id);
revoke all on public.connected_firms from anon;
grant select on public.connected_firms to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.connected_firms from anon, authenticated;
comment on view public.connected_firms is
  'INVARIANT: a connected firm''s contact details reach the caller only where that firm chose share_contacts on its profile and on this connection. Fixed columns, nothing that reaches a matter.';

-- ================================================================ 6. joint matters: a role, a precondition, shared tasks
alter table public.matter_collaborations add column role text
  check (role is null or role in ('lead_counsel', 'supporting_counsel', 'local_counsel', 'foreign_counsel', 'co_counsel', 'specialist_consultant'));
comment on column public.matter_collaborations.role is
  'The other firm''s role on the matter, as the lead firm designated it. The lead firm is the matter''s owner.';

-- Migration 45's propose_collaboration(), with a role and one precondition: a pair of firms whose
-- connection is suspended or ended may not start new work together. Firms with no connection row
-- at all may still collaborate, as they could before this migration. The previous signature is
-- dropped and this one created in its place; every existing caller resolves through the default.
drop function if exists public.propose_collaboration(uuid, uuid, text, text, boolean, date);
create or replace function public.propose_collaboration(
  p_matter uuid, p_with_firm uuid, p_kind text, p_scope_note text,
  p_share_updates boolean default false, p_ends_on date default null, p_role text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m matters%rowtype; v_id uuid; v_tz text; v_name text; r record; v_conn firm_connections%rowtype; v_role text;
begin
  select * into m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  if not matter_row_w(m.firm_id, p_matter) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_with_firm = m.firm_id then raise exception 'a firm does not collaborate with itself'; end if;
  if not exists (select 1 from firms f where f.id = p_with_firm and f.status = 'active') then
    raise exception 'that firm is not on Docket, or is not active — record an off-platform arrangement as a note instead';
  end if;
  select * into v_conn from firm_connections where firm_a_id = least(m.firm_id, p_with_firm) and firm_b_id = greatest(m.firm_id, p_with_firm);
  if found and v_conn.status in ('suspended', 'ended', 'review') then
    raise exception 'the connection between your firms is % — no new work can be started with them until it is active', v_conn.status;
  end if;
  v_role := nullif(btrim(coalesce(p_role, '')), '');
  if v_role is not null and v_role not in ('lead_counsel', 'supporting_counsel', 'local_counsel', 'foreign_counsel', 'co_counsel', 'specialist_consultant') then
    raise exception 'a role is lead counsel, supporting counsel, local counsel, foreign counsel, co counsel or specialist consultant';
  end if;
  select coalesce(timezone, 'Africa/Lagos') into v_tz from firms where id = m.firm_id;
  if p_ends_on is not null and p_ends_on < (now() at time zone v_tz)::date then
    raise exception 'an arrangement that ended yesterday shares nothing — give a day in the future, or none';
  end if;

  insert into matter_collaborations (firm_id, matter_id, with_firm_id, kind, role, case_title, suit_number, court_name,
                                     scope_note, share_updates, ends_on, proposed_by)
  values (m.firm_id, p_matter, p_with_firm, p_kind, v_role, m.title, m.suit_number, m.court_name,
          btrim(p_scope_note), coalesce(p_share_updates, false), p_ends_on, auth.uid())
  returning id into v_id;

  select name into v_name from firms where id = m.firm_id;
  for r in select user_id from firm_members where firm_id = p_with_firm and role in ('owner','admin','lawyer') loop
    perform enqueue_notification(r.user_id, p_with_firm, 'collaboration_proposed',
      jsonb_build_object('collaboration_id', v_id, 'kind', p_kind, 'role', v_role, 'from_firm_name', v_name,
                         'case_title', m.title, 'suit_number', m.suit_number));
  end loop;
  perform audit('collaboration.proposed', 'matter_collaboration', v_id, m.firm_id,
                jsonb_build_object('matter_id', p_matter, 'with_firm_id', p_with_firm, 'kind', p_kind, 'role', v_role,
                                   'share_updates', coalesce(p_share_updates, false), 'ends_on', p_ends_on));
  return v_id;
end $$;
revoke execute on function public.propose_collaboration(uuid, uuid, text, text, boolean, date, text) from public, anon;
grant  execute on function public.propose_collaboration(uuid, uuid, text, text, boolean, date, text) to authenticated;

-- collaboration_inbox gains the role, appended. Writes revoked again, as on every re created view.
create or replace view public.collaboration_inbox with (security_invoker = false) as
  select mc.id, mc.kind, mc.case_title, mc.suit_number, mc.court_name, mc.scope_note,
         mc.share_updates, mc.ends_on, mc.proposed_at, mc.accepted_at, mc.declined_at, mc.ended_at,
         mc.firm_id as from_firm_id, f.name as from_firm_name,
         mc.with_firm_id,
         (select count(*) from collaboration_documents cd
           where cd.collaboration_id = mc.id and cd.withdrawn_at is null) as shared_documents,
         mc.role
    from matter_collaborations mc join firms f on f.id = mc.firm_id
   where public.is_firm_member(mc.with_firm_id) or public.matter_row_r(mc.firm_id, mc.matter_id);
revoke all on public.collaboration_inbox from anon;
grant select on public.collaboration_inbox to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.collaboration_inbox from anon, authenticated;

-- A task either firm sets the other, inside a live collaboration. Both sides read it while the
-- arrangement is live, as the notes are read; the assigned firm closes it; the creator cancels it.
create table public.collaboration_tasks (
  id               uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null references public.matter_collaborations(id) on delete cascade,
  firm_id          uuid not null references public.firms(id) on delete cascade,
  assigned_firm_id uuid not null references public.firms(id) on delete cascade,
  title            text not null check (length(btrim(title)) between 2 and 200),
  detail           text check (detail is null or length(detail) <= 2000),
  due_on           date,
  status           text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  closed_at        timestamptz,
  closed_by        uuid references public.profiles(id) on delete set null
);
create index collaboration_tasks_idx on public.collaboration_tasks (collaboration_id, status);
alter table public.collaboration_tasks enable row level security;
create policy collaboration_tasks_select on public.collaboration_tasks for select
  using (exists (select 1 from matter_collaborations mc
                  where mc.id = collaboration_id
                    and (matter_row_r(mc.firm_id, mc.matter_id) or is_collaborating_firm(mc.id))));
revoke insert, update, delete, truncate, references, trigger on public.collaboration_tasks from anon, authenticated;
grant select on public.collaboration_tasks to authenticated;
create trigger collaboration_tasks_audit after insert or update or delete on public.collaboration_tasks
  for each row execute function public.audit_row_change();

create or replace function public.create_collaboration_task(p_collaboration uuid, p_assigned_firm uuid, p_title text, p_detail text default null, p_due_on date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c matter_collaborations%rowtype; v_firm uuid; v_id uuid; r record;
begin
  select * into c from matter_collaborations where id = p_collaboration;
  if not found then raise exception 'not found'; end if;
  if not collaboration_live(p_collaboration) then raise exception 'this arrangement is not live'; end if;
  v_firm := case when matter_row_w(c.firm_id, c.matter_id) then c.firm_id when staff_w(c.with_firm_id) then c.with_firm_id end;
  if v_firm is null then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_assigned_firm not in (c.firm_id, c.with_firm_id) then raise exception 'a task is assigned to one of the two firms on the arrangement'; end if;
  insert into collaboration_tasks (collaboration_id, firm_id, assigned_firm_id, title, detail, due_on, created_by)
  values (p_collaboration, v_firm, p_assigned_firm, btrim(p_title), nullif(btrim(coalesce(p_detail, '')), ''), p_due_on, auth.uid())
  returning id into v_id;
  if p_assigned_firm <> v_firm then
    for r in select user_id from firm_members where firm_id = p_assigned_firm and role in ('owner','admin','lawyer') loop
      perform enqueue_notification(r.user_id, p_assigned_firm, 'collaboration_task_assigned',
        jsonb_build_object('collaboration_id', p_collaboration, 'task_id', v_id, 'title', btrim(p_title), 'due_on', p_due_on,
                           'from_firm_name', (select name from firms where id = v_firm), 'case_title', c.case_title));
    end loop;
  end if;
  perform audit('collaboration.task_created', 'collaboration_tasks', v_id, v_firm, jsonb_build_object('collaboration_id', p_collaboration, 'assigned_firm_id', p_assigned_firm));
  return v_id;
end $$;
revoke execute on function public.create_collaboration_task(uuid, uuid, text, text, date) from public, anon;
grant  execute on function public.create_collaboration_task(uuid, uuid, text, text, date) to authenticated;

create or replace function public.close_collaboration_task(p_id uuid, p_status text default 'done')
returns void language plpgsql security definer set search_path = public as $$
declare t collaboration_tasks%rowtype; c matter_collaborations%rowtype; v_firm uuid;
begin
  select * into t from collaboration_tasks where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  select * into c from matter_collaborations where id = t.collaboration_id;
  if not collaboration_live(c.id) then raise exception 'this arrangement is not live'; end if;
  v_firm := case when matter_row_w(c.firm_id, c.matter_id) then c.firm_id when staff_w(c.with_firm_id) then c.with_firm_id end;
  if v_firm is null then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_status not in ('done', 'cancelled') then raise exception 'a task is closed as done or cancelled'; end if;
  if p_status = 'done' and v_firm <> t.assigned_firm_id then raise exception 'only the firm the task was assigned to can mark it done'; end if;
  if p_status = 'cancelled' and v_firm <> t.firm_id then raise exception 'only the firm that set the task can cancel it'; end if;
  if t.status <> 'open' then return; end if;
  update collaboration_tasks set status = p_status, closed_at = now(), closed_by = auth.uid() where id = p_id;
  perform audit('collaboration.task_' || p_status, 'collaboration_tasks', p_id, v_firm, jsonb_build_object('collaboration_id', t.collaboration_id));
end $$;
revoke execute on function public.close_collaboration_task(uuid, text) from public, anon;
grant  execute on function public.close_collaboration_task(uuid, text) to authenticated;

-- The lead firm's view of its joint matters: every matter of its own with at least one live
-- arrangement, and who is on it in what role. Read under the matter wall.
create view public.joint_matters with (security_invoker = false) as
  select m.id as matter_id, m.firm_id, m.reference, m.title, m.suit_number, m.court_name,
         count(mc.id) as live_collaborations,
         jsonb_agg(jsonb_build_object('collaboration_id', mc.id, 'firm_id', mc.with_firm_id, 'firm_name', f.name,
                                      'kind', mc.kind, 'role', mc.role, 'accepted_at', mc.accepted_at, 'ends_on', mc.ends_on)
                   order by mc.accepted_at) as participants,
         (select count(*) from collaboration_tasks t where t.collaboration_id in (select id from matter_collaborations x where x.matter_id = m.id) and t.status = 'open') as open_tasks
    from matters m
    join matter_collaborations mc on mc.matter_id = m.id and collaboration_live(mc.id)
    join firms f on f.id = mc.with_firm_id
   where m.deleted_at is null and matter_row_r(m.firm_id, m.id)
   group by m.id;
revoke all on public.joint_matters from anon;
grant select on public.joint_matters to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.joint_matters from anon, authenticated;

-- ================================================================ 7. introductions and referral requests
create table public.network_introductions (
  id            uuid primary key default gen_random_uuid(),
  from_firm_id  uuid not null references public.firms(id) on delete cascade,
  to_firm_id    uuid not null references public.firms(id) on delete cascade,
  kind          text not null check (kind in ('introduction', 'referral_request')),
  country_code  text,
  practice_area text,
  -- The brief carries no client confidential information; the form says so, and this is the
  -- firm's statement to that effect.
  brief         text not null check (length(btrim(brief)) between 20 and 2000),
  status        text not null default 'sent' check (status in ('sent', 'accepted', 'declined', 'withdrawn')),
  response      text check (response is null or length(response) <= 2000),
  responded_at  timestamptz,
  responded_by  uuid references public.profiles(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint network_introductions_not_self_chk check (from_firm_id <> to_firm_id)
);
create index network_introductions_to_idx on public.network_introductions (to_firm_id, status);
create index network_introductions_from_idx on public.network_introductions (from_firm_id, status);
alter table public.network_introductions enable row level security;
create policy network_introductions_select on public.network_introductions for select
  using (is_firm_member(from_firm_id) or is_firm_member(to_firm_id));
revoke insert, update, delete, truncate, references, trigger on public.network_introductions from anon, authenticated;
grant select on public.network_introductions to authenticated;
create trigger network_introductions_audit after insert or update or delete on public.network_introductions
  for each row execute function public.audit_row_change();

create or replace function public.request_introduction(p_firm uuid, p_to_firm uuid, p_kind text, p_brief text, p_country text default null, p_practice_area text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_ok boolean;
begin
  if not (staff_w(p_firm) and has_permission(p_firm, 'invite_firms')) then raise exception 'not permitted' using errcode = '42501'; end if;
  if not firm_is_verified(p_firm) then raise exception 'your firm must be verified by Docket before it can approach other firms'; end if;
  if p_kind not in ('introduction', 'referral_request') then raise exception 'an approach is an introduction or a referral request'; end if;
  if p_firm = p_to_firm then raise exception 'a firm does not approach itself'; end if;
  -- Reachable: connected, or findable in the directory and accepting this kind of approach.
  select case when p_kind = 'introduction' then d.accepts_introductions else d.accepts_referrals end into v_ok
    from network_directory d where d.firm_id = p_to_firm;
  if v_ok is null then
    if firms_connected(p_firm, p_to_firm) then v_ok := true;
    else raise exception 'that firm cannot be reached: it is not in the directory and is not connected to you'; end if;
  end if;
  if not v_ok then raise exception 'that firm does not accept this kind of approach'; end if;
  if exists (select 1 from network_introductions where from_firm_id = p_firm and to_firm_id = p_to_firm and status = 'sent') then
    raise exception 'you already have an approach open with that firm — wait for their answer';
  end if;
  if not rate_limit_hit('network_intro', 20, interval '1 day') then raise exception 'too many approaches today — try again tomorrow'; end if;

  insert into network_introductions (from_firm_id, to_firm_id, kind, country_code, practice_area, brief, created_by)
  values (p_firm, p_to_firm, p_kind, nullif(upper(btrim(coalesce(p_country, ''))), ''), nullif(btrim(coalesce(p_practice_area, '')), ''), btrim(p_brief), auth.uid())
  returning id into v_id;
  select name into v_name from firms where id = p_firm;
  perform enqueue_firm_notification(p_to_firm, 'introduction_requested',
    jsonb_build_object('introduction_id', v_id, 'kind', p_kind, 'firm_name', v_name, 'practice_area', p_practice_area));
  perform audit('network.approach_sent', 'network_introductions', v_id, p_firm, jsonb_build_object('to_firm_id', p_to_firm, 'kind', p_kind));
  return v_id;
end $$;
revoke execute on function public.request_introduction(uuid, uuid, text, text, text, text) from public, anon;
grant  execute on function public.request_introduction(uuid, uuid, text, text, text, text) to authenticated;

create or replace function public.respond_introduction(p_id uuid, p_accept boolean, p_response text default null)
returns void language plpgsql security definer set search_path = public as $$
declare i network_introductions%rowtype; v_name text;
begin
  select * into i from network_introductions where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  if not (staff_w(i.to_firm_id) and has_permission(i.to_firm_id, 'invite_firms')) then raise exception 'not permitted' using errcode = '42501'; end if;
  if i.status <> 'sent' then raise exception 'this approach is already %', i.status; end if;
  update network_introductions
     set status = case when p_accept then 'accepted' else 'declined' end, response = nullif(btrim(coalesce(p_response, '')), ''),
         responded_at = now(), responded_by = auth.uid()
   where id = p_id;
  select name into v_name from firms where id = i.to_firm_id;
  perform enqueue_firm_notification(i.from_firm_id, 'introduction_answered',
    jsonb_build_object('introduction_id', p_id, 'kind', i.kind, 'firm_name', v_name, 'accepted', p_accept, 'response', nullif(btrim(coalesce(p_response, '')), '')));
  perform audit(case when p_accept then 'network.approach_accepted' else 'network.approach_declined' end, 'network_introductions', p_id, i.to_firm_id,
                jsonb_build_object('from_firm_id', i.from_firm_id));
end $$;
revoke execute on function public.respond_introduction(uuid, boolean, text) from public, anon;
grant  execute on function public.respond_introduction(uuid, boolean, text) to authenticated;

create or replace function public.withdraw_introduction(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare i network_introductions%rowtype;
begin
  select * into i from network_introductions where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  if not (staff_w(i.from_firm_id) and has_permission(i.from_firm_id, 'invite_firms')) then raise exception 'not permitted' using errcode = '42501'; end if;
  if i.status <> 'sent' then raise exception 'this approach is already %', i.status; end if;
  update network_introductions set status = 'withdrawn', responded_at = now() where id = p_id;
  perform audit('network.approach_withdrawn', 'network_introductions', p_id, i.from_firm_id, '{}');
end $$;
revoke execute on function public.withdraw_introduction(uuid) from public, anon;
grant  execute on function public.withdraw_introduction(uuid) to authenticated;

-- ================================================================ 8. alliances
create table public.firm_alliances (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (length(btrim(name)) between 2 and 120),
  founded_by_firm_id    uuid not null references public.firms(id) on delete cascade,
  practice_areas        text[] not null default '{}',
  jurisdictions         text[] not null default '{}',
  referral_procedure    text check (referral_procedure is null or length(referral_procedure) <= 4000),
  preferences           jsonb not null default '{}',
  status                text not null default 'proposed' check (status in ('proposed', 'active', 'terminated')),
  starts_on             date,
  renews_on             date,
  terminated_at         timestamptz,
  terminated_by_firm_id uuid references public.firms(id) on delete set null,
  termination_reason    text check (termination_reason is null or length(termination_reason) <= 1000),
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now()
);
create table public.alliance_members (
  alliance_id     uuid not null references public.firm_alliances(id) on delete cascade,
  firm_id         uuid not null references public.firms(id) on delete cascade,
  role            text not null default 'member' check (role in ('founder', 'member')),
  status          text not null default 'invited' check (status in ('invited', 'accepted', 'declined', 'left')),
  contact_user_id uuid references public.profiles(id) on delete set null,
  invited_at      timestamptz not null default now(),
  responded_at    timestamptz,
  responded_by    uuid references public.profiles(id) on delete set null,
  primary key (alliance_id, firm_id)
);
create table public.alliance_notes (
  id          uuid primary key default gen_random_uuid(),
  alliance_id uuid not null references public.firm_alliances(id) on delete cascade,
  firm_id     uuid not null references public.firms(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  -- shared: every accepted member firm reads it; internal: the author's firm alone.
  visibility  text not null default 'shared' check (visibility in ('shared', 'internal')),
  body        text not null check (length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index alliance_members_firm_idx on public.alliance_members (firm_id, status);
create index alliance_notes_idx on public.alliance_notes (alliance_id, created_at);

create or replace function public.alliance_member_firm(p_alliance uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from alliance_members am where am.alliance_id = p_alliance and am.status in ('invited', 'accepted') and is_firm_member(am.firm_id))
$$;
create or replace function public.alliance_accepted_firm(p_alliance uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from alliance_members am where am.alliance_id = p_alliance and am.status = 'accepted' and is_firm_member(am.firm_id))
$$;

alter table public.firm_alliances enable row level security;
create policy firm_alliances_select on public.firm_alliances for select using (alliance_member_firm(id));
alter table public.alliance_members enable row level security;
create policy alliance_members_select on public.alliance_members for select using (alliance_member_firm(alliance_id));
alter table public.alliance_notes enable row level security;
create policy alliance_notes_select on public.alliance_notes for select
  using ((visibility = 'internal' and is_firm_member(firm_id)) or (visibility = 'shared' and alliance_accepted_firm(alliance_id)));
revoke insert, update, delete, truncate, references, trigger on public.firm_alliances, public.alliance_members, public.alliance_notes from anon, authenticated;
grant select on public.firm_alliances, public.alliance_members, public.alliance_notes to authenticated;
create trigger firm_alliances_audit after insert or update or delete on public.firm_alliances for each row execute function public.audit_row_change();
create trigger alliance_notes_audit after insert or update or delete on public.alliance_notes for each row execute function public.audit_row_change();

/** Propose a standing relationship to firms you are connected to. The founder is in; the rest are asked. */
create or replace function public.propose_alliance(
  p_firm uuid, p_name text, p_member_firms uuid[], p_practice_areas text[] default '{}', p_jurisdictions text[] default '{}',
  p_referral_procedure text default null, p_preferences jsonb default '{}', p_starts_on date default null, p_renews_on date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; f uuid; v_name text;
begin
  if not (staff_w(p_firm) and has_permission(p_firm, 'invite_firms')) then raise exception 'not permitted' using errcode = '42501'; end if;
  if not firm_is_verified(p_firm) then raise exception 'your firm must be verified by Docket before it can form an alliance'; end if;
  if p_member_firms is null or array_length(p_member_firms, 1) is null then raise exception 'an alliance needs at least one other firm'; end if;
  if array_length(p_member_firms, 1) > 20 then raise exception 'an alliance is at most twenty firms'; end if;
  foreach f in array p_member_firms loop
    if f = p_firm then raise exception 'your own firm is the founder and is already in'; end if;
    if not firms_connected(p_firm, f) then
      raise exception 'you can only bring a firm you are connected to into an alliance (% is not connected to you)', (select name from firms where id = f);
    end if;
  end loop;
  insert into firm_alliances (name, founded_by_firm_id, practice_areas, jurisdictions, referral_procedure, preferences, starts_on, renews_on, created_by)
  values (btrim(p_name), p_firm, coalesce(p_practice_areas, '{}'), coalesce(p_jurisdictions, '{}'), nullif(btrim(coalesce(p_referral_procedure, '')), ''),
          coalesce(p_preferences, '{}'), p_starts_on, p_renews_on, auth.uid())
  returning id into v_id;
  insert into alliance_members (alliance_id, firm_id, role, status, contact_user_id, responded_at, responded_by)
  values (v_id, p_firm, 'founder', 'accepted', auth.uid(), now(), auth.uid());
  select name into v_name from firms where id = p_firm;
  foreach f in array p_member_firms loop
    insert into alliance_members (alliance_id, firm_id) values (v_id, f) on conflict do nothing;
    perform enqueue_firm_notification(f, 'alliance_proposed', jsonb_build_object('alliance_id', v_id, 'name', btrim(p_name), 'firm_name', v_name));
  end loop;
  perform audit('alliance.proposed', 'firm_alliances', v_id, p_firm, jsonb_build_object('members', to_jsonb(p_member_firms)));
  return v_id;
end $$;
revoke execute on function public.propose_alliance(uuid, text, uuid[], text[], text[], text, jsonb, date, date) from public, anon;
grant  execute on function public.propose_alliance(uuid, text, uuid[], text[], text[], text, jsonb, date, date) to authenticated;

/** A firm's answer. Two accepted firms make the alliance active. */
create or replace function public.respond_alliance(p_alliance uuid, p_firm uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare am alliance_members%rowtype; a firm_alliances%rowtype; v_name text; n int;
begin
  if not (staff_w(p_firm) and has_permission(p_firm, 'invite_firms')) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into am from alliance_members where alliance_id = p_alliance and firm_id = p_firm for update;
  if not found then raise exception 'your firm was not asked into this alliance'; end if;
  if am.status <> 'invited' then raise exception 'your firm has already %', am.status; end if;
  select * into a from firm_alliances where id = p_alliance for update;
  if a.status = 'terminated' then raise exception 'this alliance has been terminated'; end if;
  update alliance_members set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now(), responded_by = auth.uid(),
         contact_user_id = case when p_accept then auth.uid() else contact_user_id end
   where alliance_id = p_alliance and firm_id = p_firm;
  select count(*) into n from alliance_members where alliance_id = p_alliance and status = 'accepted';
  if p_accept and n >= 2 and a.status = 'proposed' then
    update firm_alliances set status = 'active', starts_on = coalesce(starts_on, current_date) where id = p_alliance;
  end if;
  select name into v_name from firms where id = p_firm;
  perform enqueue_firm_notification(a.founded_by_firm_id, case when p_accept then 'alliance_accepted' else 'alliance_declined' end,
    jsonb_build_object('alliance_id', p_alliance, 'name', a.name, 'firm_name', v_name));
  perform audit(case when p_accept then 'alliance.accepted' else 'alliance.declined' end, 'firm_alliances', p_alliance, p_firm, '{}');
end $$;
revoke execute on function public.respond_alliance(uuid, uuid, boolean) from public, anon;
grant  execute on function public.respond_alliance(uuid, uuid, boolean) to authenticated;

/** Any accepted member firm may end the alliance for everybody, or leave it alone. */
create or replace function public.leave_or_terminate_alliance(p_alliance uuid, p_firm uuid, p_terminate boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a firm_alliances%rowtype; r record; v_name text;
begin
  if not (admin_w(p_firm) and has_permission(p_firm, 'invite_firms')) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into a from firm_alliances where id = p_alliance for update;
  if not found then raise exception 'not found'; end if;
  if not exists (select 1 from alliance_members where alliance_id = p_alliance and firm_id = p_firm and status = 'accepted') then
    raise exception 'your firm is not a member of this alliance';
  end if;
  if a.status = 'terminated' then return; end if;
  select name into v_name from firms where id = p_firm;
  if p_terminate then
    update firm_alliances set status = 'terminated', terminated_at = now(), terminated_by_firm_id = p_firm,
           termination_reason = nullif(btrim(coalesce(p_reason, '')), '') where id = p_alliance;
    for r in select firm_id from alliance_members where alliance_id = p_alliance and status = 'accepted' and firm_id <> p_firm loop
      perform enqueue_firm_notification(r.firm_id, 'alliance_terminated', jsonb_build_object('alliance_id', p_alliance, 'name', a.name, 'firm_name', v_name));
    end loop;
    perform audit('alliance.terminated', 'firm_alliances', p_alliance, p_firm, jsonb_build_object('reason', p_reason));
  else
    update alliance_members set status = 'left', responded_at = now(), responded_by = auth.uid() where alliance_id = p_alliance and firm_id = p_firm;
    if (select count(*) from alliance_members where alliance_id = p_alliance and status = 'accepted') < 2 then
      update firm_alliances set status = 'terminated', terminated_at = now(), terminated_by_firm_id = p_firm, termination_reason = 'fewer than two firms remained' where id = p_alliance;
    end if;
    perform audit('alliance.left', 'firm_alliances', p_alliance, p_firm, '{}');
  end if;
end $$;
revoke execute on function public.leave_or_terminate_alliance(uuid, uuid, boolean, text) from public, anon;
grant  execute on function public.leave_or_terminate_alliance(uuid, uuid, boolean, text) to authenticated;

create or replace function public.post_alliance_note(p_alliance uuid, p_firm uuid, p_visibility text, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not staff_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  if not exists (select 1 from alliance_members where alliance_id = p_alliance and firm_id = p_firm and status = 'accepted') then
    raise exception 'your firm is not a member of this alliance';
  end if;
  if p_visibility not in ('shared', 'internal') then raise exception 'a note is shared or internal'; end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'say something'; end if;
  insert into alliance_notes (alliance_id, firm_id, author_id, visibility, body) values (p_alliance, p_firm, auth.uid(), p_visibility, btrim(p_body)) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.post_alliance_note(uuid, uuid, text, text) from public, anon;
grant  execute on function public.post_alliance_note(uuid, uuid, text, text) to authenticated;

-- ================================================================ 9. the network dashboard, in one trip
create or replace function public.network_overview(p_firm uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not is_firm_member(p_firm) then '{}'::jsonb else jsonb_build_object(
    'connected',           (select count(*) from firm_connections c where c.status = 'active' and (c.firm_a_id = p_firm or c.firm_b_id = p_firm)),
    'in_review',           (select count(*) from firm_connections c where c.status = 'review' and (c.firm_a_id = p_firm or c.firm_b_id = p_firm)),
    'suspended',           (select count(*) from firm_connections c where c.status = 'suspended' and (c.firm_a_id = p_firm or c.firm_b_id = p_firm)),
    'outgoing_open',       (select count(*) from network_invitations i where i.from_firm_id = p_firm and i.status in ('pending', 'verified')),
    'incoming_to_answer',  (select count(*) from network_invitations i
                             where i.status = 'verified' and exists (select 1 from firm_members fm where fm.firm_id = p_firm and fm.user_id = i.verified_by)),
    'joint_matters',       (select count(*) from joint_matters j where j.firm_id = p_firm),
    'work_from_others',    (select count(*) from matter_collaborations mc where mc.with_firm_id = p_firm and collaboration_live(mc.id)),
    'collaborations_to_answer', (select count(*) from matter_collaborations mc where mc.with_firm_id = p_firm and mc.accepted_at is null and mc.declined_at is null and mc.ended_at is null),
    'open_tasks_for_us',   (select count(*) from collaboration_tasks t join matter_collaborations mc on mc.id = t.collaboration_id where t.assigned_firm_id = p_firm and t.status = 'open' and collaboration_live(mc.id)),
    'approaches_to_answer', (select count(*) from network_introductions i where i.to_firm_id = p_firm and i.status = 'sent'),
    'approaches_open',     (select count(*) from network_introductions i where i.from_firm_id = p_firm and i.status = 'sent'),
    'alliances_active',    (select count(*) from alliance_members am join firm_alliances a on a.id = am.alliance_id where am.firm_id = p_firm and am.status = 'accepted' and a.status = 'active'),
    'alliances_to_answer', (select count(*) from alliance_members am where am.firm_id = p_firm and am.status = 'invited'),
    'profile_published',   exists (select 1 from firm_network_profiles np where np.firm_id = p_firm),
    'verified',            firm_is_verified(p_firm)) end
$$;
revoke execute on function public.network_overview(uuid) from public, anon;
grant  execute on function public.network_overview(uuid) to authenticated;

-- A firm's incoming invitations: those verified by one of its members and not yet answered.
create view public.network_incoming with (security_invoker = false) as
  select i.id, i.from_firm_id, i.from_firm_name, i.from_country, i.from_practice_areas, i.from_representative, i.reason,
         i.to_email, i.verified_at, i.verified_by, fm.firm_id as my_firm_id
    from network_invitations i
    join firm_members fm on fm.user_id = i.verified_by
   where i.status = 'verified' and is_firm_member(fm.firm_id);
revoke all on public.network_incoming from anon;
grant select on public.network_incoming to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.network_incoming from anon, authenticated;
