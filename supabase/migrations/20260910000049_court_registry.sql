-- The court-registry pilot: a court's own registry saying, in its own hand, when a suit is listed.
--
-- The assessment's #22 asks for a court-registry connection and the plan says how to start: "pick
-- ONE narrow workflow — verified cause-list/date updates — and start with authorised structured
-- import plus human verification if there is no API. Model registry permissions separately from
-- firm roles." Migration 38 put the provenance columns on the diary for exactly this day. This is
-- that workflow, and only that workflow.
--
-- WHAT A REGISTRY IS HERE. A principal that is not a firm. It has its own table, its own members,
-- its own roles (registrar, clerk), its own console, and NO standing in any firm: no firm policy
-- asks a registry helper, and a registry member with no firm_members row reads zero rows of
-- matters, firms, court_events, documents or profiles beyond their own. The suite asserts that
-- rather than assuming it.
--
-- THE ONE WORKFLOW. A registry stages a cause list (a CSV, or one row at a time), a registrar
-- publishes it, and each firm whose matter carries that suit number at that court sees the notice
-- on its Sittings screen and DECIDES: confirm it into the diary, or say it is not theirs. Nothing
-- reaches a firm's diary until a lawyer on the matter confirms it. A registry that made an error
-- withdraws the notice; the firm is told, and the date stays in the diary until the lawyer acts,
-- because a registry withdrawing a notice is not a court vacating a date.
--
-- Only listings. A vacated-and-refixed date arrives as the next listing, and the lawyer refixes
-- with the flow the product already has, giving a reason the client reads. Filing-status
-- acknowledgement, e-filing and an API pull are NOT here; docs/COURT_REGISTRY_PILOT.md says why.
--
-- THE DISCLOSURE BOUNDARY, IN BOTH DIRECTIONS, IS THE WHOLE DESIGN:
--
--  · The registry learns nothing about any firm. Its tables carry no firm_id, by construction.
--    It cannot read decisions, court_events, matters or firms. Publishing a notice tells it
--    nothing about whether anybody had that suit — the same answer comes back either way.
--  · A firm learns only the court's notices about suits it already has. Never the rest of the
--    cause list, never a draft, never that another firm holds the same suit (opposing counsel are
--    both on Docket often enough for that to matter).
--  · Inside a firm the wall holds: matching goes through can_see_matter(), so a colleague outside
--    a restricted matter's team does not see the notice for it.
--
-- A DATE IS A DAY. A cause list names a day and, usually, a time; listed_on is a DATE and is never
-- shifted. The diary's instant is built only when a lawyer confirms, in the court's own zone —
-- every Nigerian court sits in Africa/Lagos, and that is said here rather than assumed elsewhere.

-- ================================================================ 1. a registry is not a firm
create type public.registry_role as enum ('registrar', 'clerk');

create table public.registries (
  id            uuid primary key default gen_random_uuid(),
  -- The court whose registry this is. Platform-wide courts only: a firm's private court entry
  -- (courts.firm_id set) is that firm's own note, not a registry anybody could speak for.
  court_id      uuid not null unique references public.courts(id),
  name          text not null check (length(name) between 2 and 200),
  status        text not null default 'active' check (status in ('active', 'suspended')),
  contact_name  text check (contact_name is null or length(contact_name) <= 200),
  contact_email text check (contact_email is null or length(contact_email) <= 320),
  note          text check (note is null or length(note) <= 2000),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
comment on table public.registries is
  'A court registry as a principal in its own right. Not a firm: nothing here confers anything in any firm. Created by the platform only when a real registry has agreed to the pilot.';

create or replace function public.registry_court_is_platform() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from courts c where c.id = new.court_id and c.firm_id is null and c.is_active) then
    raise exception 'a registry must be attached to an active platform-wide court';
  end if;
  return new;
end $$;
create trigger registries_court_check before insert or update of court_id on public.registries
  for each row execute function public.registry_court_is_platform();

create table public.registry_members (
  registry_id uuid not null references public.registries(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        public.registry_role not null,
  added_by    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (registry_id, user_id)
);
comment on table public.registry_members is
  'Who acts for a registry, and as what. A registrar publishes and withdraws; a clerk stages. Neither is a firm role and neither reaches any firm''s data.';

-- The four helpers, shaped like the firm's. Nothing about a firm is consulted.
create or replace function public.is_registry_member(r uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from registry_members where registry_id = r and user_id = auth.uid()) $$;
create or replace function public.has_registry_role(r uuid, roles public.registry_role[]) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from registry_members where registry_id = r and user_id = auth.uid() and role = any(roles)) $$;
create or replace function public.registry_active(r uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from registries where id = r and status = 'active') $$;
-- Any member, with a second factor, at a registry that is not suspended.
create or replace function public.registry_w(r uuid) returns bool
  language sql stable set search_path = public as
  $$ select public.is_registry_member(r) and public.mfa_ok() and public.registry_active(r) $$;
-- A registrar, with a second factor, at a registry that is not suspended.
create or replace function public.registrar_w(r uuid) returns bool
  language sql stable set search_path = public as
  $$ select public.has_registry_role(r, array['registrar']::public.registry_role[]) and public.mfa_ok() and public.registry_active(r) $$;
revoke execute on function public.is_registry_member(uuid), public.has_registry_role(uuid, public.registry_role[]),
       public.registry_active(uuid), public.registry_w(uuid), public.registrar_w(uuid) from public, anon;
grant  execute on function public.is_registry_member(uuid), public.has_registry_role(uuid, public.registry_role[]),
       public.registry_active(uuid), public.registry_w(uuid), public.registrar_w(uuid) to authenticated;

-- A registry's members may see each other's names, and the platform may see a registry member's
-- name — and nobody else's: the platform's read of profiles stays exactly as narrow as it was.
-- Re-created with two arms added to migration 2's four; nothing about a firm changes.
create or replace function public.can_see_profile(p uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select p = auth.uid()
         or exists (select 1 from firm_members me join firm_members other on other.firm_id = me.firm_id
                    where me.user_id = auth.uid() and other.user_id = p)
         or exists (select 1 from firm_members me join appointments a on a.firm_id = me.firm_id
                    where me.user_id = auth.uid() and a.client_id = p)
         or exists (select 1 from firm_members me join matter_parties mp on mp.firm_id = me.firm_id
                    where me.user_id = auth.uid() and mp.user_id = p)
         or exists (select 1 from registry_members me join registry_members other on other.registry_id = me.registry_id
                    where me.user_id = auth.uid() and other.user_id = p)
         or (is_platform_admin() and exists (select 1 from registry_members rm where rm.user_id = p)) $$;

alter table public.registries enable row level security;
alter table public.registry_members enable row level security;
create policy registries_select on public.registries for select
  using (is_registry_member(id) or is_platform_admin());
-- Their own row, their colleagues' rows, and the platform's view of all of them. A firm member
-- who is not a registry member sees nothing here at all.
create policy registry_members_select on public.registry_members for select
  using (user_id = (select auth.uid()) or is_registry_member(registry_id) or is_platform_admin());
revoke insert, update, delete on public.registries, public.registry_members from anon, authenticated;
grant select on public.registries, public.registry_members to authenticated;
create trigger registries_audit after insert or update or delete on public.registries
  for each row execute function public.audit_row_change();
-- A registry's own audit lines are readable by its members: audit() writes them with no firm, so
-- without this arm nobody could ever read what a registry did. The entity id or the meta names
-- the registry; the platform's existing arm is unchanged.
create policy audit_log_registry_select on public.audit_log for select
  using ((entity = 'registry' and is_registry_member(entity_id))
         or (entity in ('registry_notice', 'registry_notice_batch') and is_registry_member(nullif(meta ->> 'registry_id', '')::uuid)));
create trigger registry_members_audit after insert or update or delete on public.registry_members
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------- the platform onboards a registry
/** The platform creates a registry only when a real registry has agreed to the pilot. */
create or replace function public.create_registry(p_court uuid, p_name text, p_contact_name text default null,
                                                  p_contact_email text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (is_platform_admin() and mfa_ok()) then raise exception 'not permitted' using errcode = '42501'; end if;
  insert into registries (court_id, name, contact_name, contact_email, note, created_by)
  values (p_court, btrim(p_name), nullif(btrim(p_contact_name), ''), nullif(lower(btrim(p_contact_email)), ''), nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  perform audit('registry.created', 'registry', v_id, null, jsonb_build_object('court_id', p_court, 'name', btrim(p_name)));
  return v_id;
end $$;
revoke execute on function public.create_registry(uuid, text, text, text, text) from public, anon;
grant  execute on function public.create_registry(uuid, text, text, text, text) to authenticated;

create or replace function public.set_registry_status(p_registry uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_platform_admin() and mfa_ok()) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_status not in ('active', 'suspended') then raise exception 'a registry is active or suspended'; end if;
  update registries set status = p_status where id = p_registry;
  if not found then raise exception 'registry not found'; end if;
  perform audit('registry.status', 'registry', p_registry, null, jsonb_build_object('status', p_status, 'note', p_note));
end $$;
revoke execute on function public.set_registry_status(uuid, text, text) from public, anon;
grant  execute on function public.set_registry_status(uuid, text, text) to authenticated;

/**
 * Add a person to a registry by the email they signed up with. THE PLATFORM ONLY. A registrar
 * cannot: looking a person up by email is an account-existence oracle, and a registry is an
 * outside body — the platform vets who joins a pilot, and the person must already hold a Docket
 * account, which is said on the screen rather than discovered. A registrar can remove a member.
 *
 * There is no last-registrar guard on purpose. A registry with no registrar cannot publish, which
 * is safe, and the platform repairs it; a guard would only stop the platform from removing the
 * one registrar who has left.
 */
create or replace function public.add_registry_member(p_registry uuid, p_email text, p_role public.registry_role)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not (is_platform_admin() and mfa_ok()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select id into v_user from profiles where lower(email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'no Docket account uses that email — the person signs up first, then is added';
  end if;
  insert into registry_members (registry_id, user_id, role, added_by)
  values (p_registry, v_user, p_role, auth.uid())
  on conflict (registry_id, user_id) do update set role = excluded.role;
  perform audit('registry.member_set', 'registry', p_registry, null, jsonb_build_object('user_id', v_user, 'role', p_role));
  return v_user;
end $$;
revoke execute on function public.add_registry_member(uuid, text, public.registry_role) from public, anon;
grant  execute on function public.add_registry_member(uuid, text, public.registry_role) to authenticated;

create or replace function public.remove_registry_member(p_registry uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ((is_platform_admin() and mfa_ok()) or registrar_w(p_registry)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  delete from registry_members where registry_id = p_registry and user_id = p_user;
  perform audit('registry.member_removed', 'registry', p_registry, null, jsonb_build_object('user_id', p_user));
end $$;
revoke execute on function public.remove_registry_member(uuid, uuid) from public, anon;
grant  execute on function public.remove_registry_member(uuid, uuid) to authenticated;

-- ================================================================ 2. the cause list, as the registry writes it
create table public.registry_notice_batches (
  id           uuid primary key default gen_random_uuid(),
  registry_id  uuid not null references public.registries(id) on delete cascade,
  -- What the registry was working from: "Cause list of 14 Sep 2026, page 3".
  source_note  text check (source_note is null or length(source_note) <= 300),
  rows_staged  int not null default 0,
  staged_by    uuid references public.profiles(id) on delete set null,
  staged_at    timestamptz not null default now(),
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz
);

create table public.registry_notices (
  id               uuid primary key default gen_random_uuid(),
  registry_id      uuid not null references public.registries(id) on delete cascade,
  -- Denormalised from the registry and held equal by trigger: the match to a firm's matter is on
  -- (court, suit number), and a suit number means nothing without its court.
  court_id         uuid not null references public.courts(id),
  batch_id         uuid references public.registry_notice_batches(id) on delete set null,
  suit_number      text not null check (length(suit_number) between 3 and 60),
  suit_number_norm text generated always as (upper(regexp_replace(suit_number, '\s', '', 'g'))) stored,
  -- A suit number that is only spaces would normalise to '' and match every matter at the court
  -- that has no suit number yet — at every firm. So the normalised form must be a number too.
  constraint registry_notices_suit_norm_chk check (length(regexp_replace(suit_number, '\s', '', 'g')) between 3 and 60),
  cause_title      text check (cause_title is null or length(cause_title) <= 300),
  listed_on        date not null,
  listed_time      time,
  judge            text check (judge is null or length(judge) <= 200),
  courtroom        text check (courtroom is null or length(courtroom) <= 100),
  purpose_kind     text check (purpose_kind is null or purpose_kind in ('mention','hearing','cmc','pre_trial','motion','ruling','judgment','arraignment','trial','other')),
  purpose          text check (purpose is null or length(purpose) <= 300),
  status           text not null default 'draft' check (status in ('draft', 'published', 'withdrawn')),
  published_at     timestamptz,
  published_by     uuid references public.profiles(id) on delete set null,
  withdrawn_at     timestamptz,
  withdrawn_by     uuid references public.profiles(id) on delete set null,
  withdrawn_reason text check (withdrawn_reason is null or length(withdrawn_reason) <= 500),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
-- NO firm_id, NO matter_id. A notice is the court's statement about a suit; who holds the suit is
-- not the registry's to know, and a column for it would be the first hole.
create index registry_notices_match_idx on public.registry_notices (court_id, suit_number_norm) where status <> 'draft';
create index registry_notices_registry_idx on public.registry_notices (registry_id, status, listed_on);
comment on table public.registry_notices is
  'A cause-list listing as the registry published it. Carries no firm and no matter, by design. Drafts are the registry''s alone; published and withdrawn notices are visible to a firm only where it already holds that suit at that court.';

create or replace function public.registry_notice_court() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select court_id into new.court_id from registries where id = new.registry_id;
  return new;
end $$;
create trigger registry_notices_court before insert or update of registry_id on public.registry_notices
  for each row execute function public.registry_notice_court();

/**
 * Does this notice concern a matter the caller may see? SECURITY DEFINER because the RLS policy
 * below needs a fact about matters the caller may not otherwise read — and the answer is only
 * ever about the CALLER's own matters, through can_see_matter(), which applies the firm
 * membership and the wall. A suit number matches by its court and its normalised form, on the
 * matter itself or on any current number in matter_court_numbers.
 */
create or replace function public.notice_concerns_caller(p_court uuid, p_suit_norm text) returns bool
language sql stable security definer set search_path = public as $$
  select p_suit_norm <> '' and (exists (
    select 1 from matters m
     where m.deleted_at is null and m.court_id = p_court and m.suit_number_norm = p_suit_norm
       and can_see_matter(m.id))
  or exists (
    select 1 from matter_court_numbers cn join matters m on m.id = cn.matter_id
     where m.deleted_at is null and cn.is_current and cn.court_id = p_court
       and upper(regexp_replace(cn.number, '\s', '', 'g')) = p_suit_norm
       and can_see_matter(m.id)))
$$;
revoke execute on function public.notice_concerns_caller(uuid, text) from public, anon;
grant  execute on function public.notice_concerns_caller(uuid, text) to authenticated;

alter table public.registry_notice_batches enable row level security;
alter table public.registry_notices enable row level security;
create policy registry_notice_batches_select on public.registry_notice_batches for select
  using (is_registry_member(registry_id));
-- registry_notices_select is created in section 3, after registry_notice_decisions exists: the
-- policy reads that table.
revoke insert, update, delete on public.registry_notice_batches, public.registry_notices from anon, authenticated;
grant select on public.registry_notice_batches, public.registry_notices to authenticated;
create trigger registry_notices_audit after insert or update of status, withdrawn_reason or delete on public.registry_notices
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------- staging
/**
 * Stage a cause list. Any member of the registry with a second factor. Each row is checked on its
 * own: the good ones become drafts in one batch, the bad ones come back with the reason and are
 * not stored. Nothing is published here.
 *
 * A purpose the list does not recognise is NOT a bad row: it is staged as 'other' with the words
 * kept, because a registry's own vocabulary is not Docket's to refuse.
 */
create or replace function public.stage_registry_notices(p_registry uuid, p_rows jsonb, p_source_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_batch uuid; v_row jsonb; v_n int := 0; v_staged int := 0; v_rejected jsonb := '[]'::jsonb;
        v_suit text; v_day date; v_time time; v_kind text; v_purpose text; v_reason text; v_court uuid;
begin
  if not registry_w(p_registry) then raise exception 'not permitted' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'nothing to stage'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'at most 500 rows in one batch'; end if;
  if not rate_limit_hit('registry_stage', 30, interval '1 hour', p_registry::text) then
    raise exception 'too many batches staged in the last hour' using errcode = '53400';
  end if;
  select court_id into v_court from registries where id = p_registry;

  insert into registry_notice_batches (registry_id, source_note, staged_by)
  values (p_registry, nullif(btrim(p_source_note), ''), auth.uid()) returning id into v_batch;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_n := v_n + 1; v_reason := null;
    v_suit := nullif(btrim(coalesce(v_row ->> 'suit_number', '')), '');
    if v_suit is null then v_reason := 'no suit number';
    elsif length(v_suit) > 60 or length(regexp_replace(v_suit, '\s', '', 'g')) < 3 then v_reason := 'the suit number is not between 3 and 60 characters';
    end if;
    begin
      v_day := (v_row ->> 'listed_on')::date;
    exception when others then v_day := null; end;
    if v_reason is null and v_day is null then v_reason := 'the day is not a date (YYYY-MM-DD)'; end if;
    v_time := null;
    if v_reason is null and nullif(btrim(coalesce(v_row ->> 'listed_time', '')), '') is not null then
      begin
        v_time := (v_row ->> 'listed_time')::time;
      exception when others then v_reason := 'the time is not a time (HH:MM)'; end;
    end if;
    v_kind := nullif(lower(btrim(coalesce(v_row ->> 'purpose_kind', ''))), '');
    v_purpose := nullif(btrim(coalesce(v_row ->> 'purpose', '')), '');
    if v_kind is not null and v_kind not in ('mention','hearing','cmc','pre_trial','motion','ruling','judgment','arraignment','trial','other') then
      -- The registry's words are kept as the purpose, exactly as written; the kind is 'other'.
      v_purpose := coalesce(v_purpose, btrim(v_row ->> 'purpose_kind')); v_kind := 'other';
    end if;

    if v_reason is not null then
      v_rejected := v_rejected || jsonb_build_object('row', v_n, 'suit_number', v_suit, 'reason', v_reason);
      continue;
    end if;
    insert into registry_notices (registry_id, court_id, batch_id, suit_number, cause_title, listed_on, listed_time,
                                  judge, courtroom, purpose_kind, purpose, created_by)
    values (p_registry, v_court, v_batch, v_suit, left(nullif(btrim(coalesce(v_row ->> 'cause_title', '')), ''), 300), v_day, v_time,
            left(nullif(btrim(coalesce(v_row ->> 'judge', '')), ''), 200), left(nullif(btrim(coalesce(v_row ->> 'courtroom', '')), ''), 100),
            v_kind, left(v_purpose, 300), auth.uid());
    v_staged := v_staged + 1;
  end loop;

  update registry_notice_batches set rows_staged = v_staged where id = v_batch;
  perform audit('registry.batch_staged', 'registry_notice_batch', v_batch, null,
                jsonb_build_object('registry_id', p_registry, 'staged', v_staged, 'rejected', jsonb_array_length(v_rejected)));
  return jsonb_build_object('batch_id', v_batch, 'staged', v_staged, 'rejected', v_rejected);
end $$;
revoke execute on function public.stage_registry_notices(uuid, jsonb, text) from public, anon;
grant  execute on function public.stage_registry_notices(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------- publishing, and who is told
/**
 * Tell every lawyer on every matter at every firm that holds this suit at this court. Runs as
 * definer across firms — and writes only INTO firms' queues. Nothing about who was told comes
 * back to the registry: the function returns nothing, and a notice that matched nobody is
 * indistinguishable from one that matched everybody.
 */
create or replace function public.registry_notice_fanout(p_notice uuid, p_event text) returns void
language plpgsql security definer set search_path = public as $$
declare n registry_notices%rowtype; v_court text; m record; u record; v_told int;
begin
  select * into n from registry_notices where id = p_notice;
  if not found then return; end if;
  if n.suit_number_norm = '' then return; end if;
  select name into v_court from courts where id = n.court_id;
  for m in
    select distinct x.id, x.firm_id, x.handling_lawyer_id from (
      select mt.id, mt.firm_id, mt.handling_lawyer_id from matters mt
       where mt.deleted_at is null and mt.court_id = n.court_id and mt.suit_number_norm = n.suit_number_norm
      union
      select mt.id, mt.firm_id, mt.handling_lawyer_id from matter_court_numbers cn join matters mt on mt.id = cn.matter_id
       where mt.deleted_at is null and cn.is_current and cn.court_id = n.court_id
         and upper(regexp_replace(cn.number, '\s', '', 'g')) = n.suit_number_norm) x
  loop
    v_told := 0;
    for u in select ml.user_id from matter_lawyers ml where ml.matter_id = m.id loop
      perform enqueue_notification(u.user_id, m.firm_id, p_event,
        jsonb_build_object('notice_id', n.id, 'matter_id', m.id, 'suit_number', n.suit_number, 'listed_on', n.listed_on,
                           'purpose', coalesce(n.purpose, n.purpose_kind), 'court_name', v_court));
      v_told := v_told + 1;
    end loop;
    -- A matter with nobody on its team: the handling lawyer, else the firm's owners and admins,
    -- so a listing never lands on a matter and tells no one.
    if v_told = 0 then
      if m.handling_lawyer_id is not null then
        perform enqueue_notification(m.handling_lawyer_id, m.firm_id, p_event,
          jsonb_build_object('notice_id', n.id, 'matter_id', m.id, 'suit_number', n.suit_number, 'listed_on', n.listed_on,
                             'purpose', coalesce(n.purpose, n.purpose_kind), 'court_name', v_court));
      else
        for u in select fm.user_id from firm_members fm where fm.firm_id = m.firm_id and fm.role in ('owner', 'admin') loop
          perform enqueue_notification(u.user_id, m.firm_id, p_event,
            jsonb_build_object('notice_id', n.id, 'matter_id', m.id, 'suit_number', n.suit_number, 'listed_on', n.listed_on,
                               'purpose', coalesce(n.purpose, n.purpose_kind), 'court_name', v_court));
        end loop;
      end if;
    end if;
  end loop;
end $$;
revoke execute on function public.registry_notice_fanout(uuid, text) from public, anon, authenticated;

/** Publish a whole batch. A registrar. Drafts only; anything already published is left alone. */
create or replace function public.publish_registry_batch(p_batch uuid) returns int
language plpgsql security definer set search_path = public as $$
declare b registry_notice_batches%rowtype; r record; v_n int := 0;
begin
  select * into b from registry_notice_batches where id = p_batch for update;
  if not found or not registrar_w(b.registry_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  for r in select id from registry_notices where batch_id = p_batch and status = 'draft' order by created_at loop
    update registry_notices set status = 'published', published_at = now(), published_by = auth.uid() where id = r.id;
    perform registry_notice_fanout(r.id, 'registry_notice_received');
    v_n := v_n + 1;
  end loop;
  update registry_notice_batches set published_at = now(), published_by = auth.uid() where id = p_batch;
  perform audit('registry.batch_published', 'registry_notice_batch', p_batch, null,
                jsonb_build_object('registry_id', b.registry_id, 'published', v_n));
  return v_n;
end $$;
revoke execute on function public.publish_registry_batch(uuid) from public, anon;
grant  execute on function public.publish_registry_batch(uuid) to authenticated;

/** Publish one draft. A registrar. */
create or replace function public.publish_registry_notice(p_notice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n registry_notices%rowtype;
begin
  select * into n from registry_notices where id = p_notice for update;
  if not found or not registrar_w(n.registry_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if n.status <> 'draft' then raise exception 'only a draft can be published'; end if;
  update registry_notices set status = 'published', published_at = now(), published_by = auth.uid() where id = p_notice;
  perform registry_notice_fanout(p_notice, 'registry_notice_received');
  perform audit('registry.notice_published', 'registry_notice', p_notice, null, jsonb_build_object('registry_id', n.registry_id));
end $$;
revoke execute on function public.publish_registry_notice(uuid) from public, anon;
grant  execute on function public.publish_registry_notice(uuid) to authenticated;

/** Delete a draft that should not have been staged. A member. Published notices are withdrawn, never deleted. */
create or replace function public.discard_registry_draft(p_notice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n registry_notices%rowtype;
begin
  select * into n from registry_notices where id = p_notice for update;
  if not found or not registry_w(n.registry_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if n.status <> 'draft' then raise exception 'only a draft can be discarded — a published notice is withdrawn'; end if;
  delete from registry_notices where id = p_notice;
end $$;
revoke execute on function public.discard_registry_draft(uuid) from public, anon;
grant  execute on function public.discard_registry_draft(uuid) to authenticated;

/**
 * The registry corrects itself. A registrar. The notice stays, marked withdrawn with the reason.
 * Every lawyer who CONFIRMED it into a diary is told — and the date is NOT vacated, because a
 * registry withdrawing a notice is not a court vacating a sitting; the lawyer decides, with the
 * flow the product already has.
 */
create or replace function public.withdraw_registry_notice(p_notice uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare n registry_notices%rowtype; d record; v_court text;
begin
  select * into n from registry_notices where id = p_notice for update;
  if not found or not registrar_w(n.registry_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if n.status <> 'published' then raise exception 'only a published notice can be withdrawn'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why the notice is withdrawn'; end if;
  update registry_notices set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = auth.uid(),
         withdrawn_reason = left(btrim(p_reason), 500) where id = p_notice;
  select name into v_court from courts where id = n.court_id;
  for d in select dc.decided_by, dc.firm_id, dc.matter_id, dc.court_event_id from registry_notice_decisions dc
            where dc.notice_id = p_notice and dc.decision = 'confirmed' loop
    if d.court_event_id is not null then
      update court_events set registry_withdrawn_at = now() where id = d.court_event_id and registry_notice_id = p_notice;
      -- On the file, for the firm, not for the client: the lawyer decides what to tell them.
      insert into updates (matter_id, firm_id, kind, visibility, title, body, occurred_at, posted_by)
      values (d.matter_id, d.firm_id, 'court_sitting', 'internal',
              format('The registry has withdrawn its notice listing %s on %s', n.suit_number, to_char(n.listed_on, 'FMDD Mon YYYY')),
              left(btrim(p_reason), 500) || ' — the date is still in the diary; check with the registry and vacate it if it no longer stands.',
              now(), null);
    end if;
    perform enqueue_notification(d.decided_by, d.firm_id, 'registry_notice_withdrawn',
      jsonb_build_object('notice_id', n.id, 'matter_id', d.matter_id, 'court_event_id', d.court_event_id,
                         'suit_number', n.suit_number, 'listed_on', n.listed_on, 'court_name', v_court, 'reason', left(btrim(p_reason), 500)));
  end loop;
  perform audit('registry.notice_withdrawn', 'registry_notice', p_notice, null,
                jsonb_build_object('registry_id', n.registry_id, 'reason', left(btrim(p_reason), 500)));
end $$;
revoke execute on function public.withdraw_registry_notice(uuid, text) from public, anon;
grant  execute on function public.withdraw_registry_notice(uuid, text) to authenticated;

-- ================================================================ 3. the diary receives a court-originated date
-- 'registry' joins the sources a court date can have. It is written only by confirm_registry_notice()
-- below: the column grants on court_events (migration 38) do not include `source` or the new
-- column, and attach_court_event_source() still accepts only hearing_notice and cause_list.
alter table public.court_events drop constraint court_events_source_check;
alter table public.court_events add constraint court_events_source_check
  check (source in ('firm', 'hearing_notice', 'cause_list', 'registry'));
alter table public.court_events add column registry_notice_id uuid references public.registry_notices(id) on delete set null;
-- Stamped by withdraw_registry_notice() on every sitting confirmed from the withdrawn notice, so
-- every reader of court_events — the cause list, the client's court dates, the calendar feed —
-- can say so without having to read registry_notices at all.
alter table public.court_events add column registry_withdrawn_at timestamptz;
comment on column public.court_events.registry_notice_id is
  'The registry notice a lawyer confirmed this date from. A date with one is evidenced by the court''s own statement rather than by a document on file.';
comment on column public.court_events.registry_withdrawn_at is
  'When the registry withdrew the notice this date came from. The date is NOT vacated by that: a registry withdrawing a notice is not a court vacating a sitting, and the lawyer decides.';

-- A registry-sourced date a lawyer MOVES or RE-COURTS by hand stops being the registry's. The
-- column grants let staff update scheduled_at and court_id (migration 38), and without this the
-- diary would keep saying "listed by the court registry" of a date the court never listed. The
-- confirm function sets a transaction-local flag so its own attach path is not downgraded.
create or replace function public.court_events_registry_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.source = 'registry' and coalesce(current_setting('docket.registry_confirm', true), '') <> '1'
     and (new.scheduled_at <> old.scheduled_at or new.court_id is distinct from old.court_id) then
    new.source := 'firm';
    new.registry_notice_id := null;
    new.registry_withdrawn_at := null;
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.source_ref := left('Moved by the firm; was ' || coalesce(old.source_ref, 'a registry notice'), 200);
  end if;
  return new;
end $$;
create trigger court_events_registry_guard before update of scheduled_at, court_id on public.court_events
  for each row execute function public.court_events_registry_guard();

-- attach_court_event_source() (migration 38) may still attach the hearing-notice PDF to a
-- registry-sourced date — a document is welcome evidence — but may not relabel the registry's
-- provenance as a typed source. Re-created with that one refusal added.
create or replace function public.attach_court_event_source(p_event uuid, p_document uuid default null, p_ref text default null, p_source text default null)
returns void language plpgsql security definer set search_path = public as $$
declare e court_events%rowtype;
begin
  select * into e from court_events where id = p_event for update;
  if not found or not matter_row_w(e.firm_id, e.matter_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_document is null and nullif(btrim(coalesce(p_ref, '')), '') is null then raise exception 'attach a document, a reference, or both'; end if;
  if p_source is not null and p_source not in ('hearing_notice', 'cause_list') then raise exception 'a source is hearing_notice or cause_list'; end if;
  if e.source = 'registry' and p_source is not null then
    raise exception 'this date came from the court registry; its provenance is the registry''s and is not relabelled by hand';
  end if;
  update court_events
     set source_document_id = coalesce(p_document, source_document_id),
         source_ref = coalesce(nullif(btrim(p_ref), ''), source_ref),
         source = case when source = 'registry' then 'registry'
                       else coalesce(p_source, case when source = 'firm' and p_document is not null then 'hearing_notice' else source end) end,
         confirmed_by = auth.uid(), confirmed_at = now()
   where id = p_event;
end $$;

drop trigger if exists audit_court_events on public.court_events;
create trigger audit_court_events after insert or delete or update of scheduled_at, court_id, court_name, purpose, purpose_kind, source,
  source_document_id, source_ref, registry_notice_id, registry_withdrawn_at, created_by, confirmed_by, confirmed_at, vacated_at, outcome_update_id
  on public.court_events for each row execute function public.audit_row_change();

-- The cause list says where a date came from, and whether the registry has since withdrawn it.
-- security_invoker, as before: the join to registry_notices runs under the caller's own RLS.
create or replace view public.firm_cause_list with (security_invoker = true) as
  select ce.id as court_event_id, ce.firm_id, ce.matter_id, m.reference, coalesce(m.cause_title, m.title) as cause_title,
         m.suit_number, ce.scheduled_at, (ce.scheduled_at at time zone 'Africa/Lagos')::date as on_date,
         ce.court_id, coalesce(c.name, ce.court_name) as court, ce.courtroom, ce.judge, ce.purpose_kind, ce.purpose, ce.source,
         ce.source_document_id, ce.source_ref, ce.created_by, ce.created_at, ce.confirmed_by, ce.confirmed_at,
         -- A document on file, or the registry's own notice: either is evidence. A reference
         -- somebody typed is a claim about where the date came from, and is not.
         (ce.source <> 'firm' and (ce.source_document_id is not null or ce.registry_notice_id is not null)) as evidenced,
         ce.registry_notice_id,
         (ce.registry_withdrawn_at is not null) as registry_withdrawn
  from public.court_events ce
  join public.matters m on m.id = ce.matter_id and m.deleted_at is null
  left join public.courts c on c.id = ce.court_id
  where ce.outcome_update_id is null and ce.vacated_at is null;

-- ---------------------------------------------------------------- what the firm decided
create table public.registry_notice_decisions (
  id             uuid primary key default gen_random_uuid(),
  notice_id      uuid not null references public.registry_notices(id) on delete cascade,
  firm_id        uuid not null references public.firms(id) on delete cascade,
  matter_id      uuid not null references public.matters(id) on delete cascade,
  decision       text not null check (decision in ('confirmed', 'rejected')),
  court_event_id uuid references public.court_events(id) on delete set null,
  reason         text check (reason is null or length(reason) <= 500),
  -- The listed day falls inside a court vacation window: a vacation judge's sitting, said rather than refused.
  in_vacation    boolean not null default false,
  -- The diary already had this day from a hearing notice and the notice was attached to it rather
  -- than duplicated: the court agreed with the firm. Recorded as a fact, not inferred from timing.
  attached       boolean not null default false,
  decided_by     uuid not null references public.profiles(id) on delete cascade,
  decided_at     timestamptz not null default now(),
  unique (notice_id, matter_id)
);
comment on table public.registry_notice_decisions is
  'What a firm did with a registry notice, per matter. Readable by the firm''s members who may see the matter; never by the registry — there is no registry arm in the policy, so who confirmed what never leaves the firm.';
alter table public.registry_notice_decisions enable row level security;
create policy registry_notice_decisions_select on public.registry_notice_decisions for select
  using (matter_row_r(firm_id, matter_id));
revoke insert, update, delete on public.registry_notice_decisions from anon, authenticated;
grant select on public.registry_notice_decisions to authenticated;
create trigger registry_notice_decisions_check_firm before insert or update on public.registry_notice_decisions
  for each row execute function public.check_row_firm();
create trigger registry_notice_decisions_audit after insert or update or delete on public.registry_notice_decisions
  for each row execute function public.audit_row_change();

-- A firm reads a notice that concerns a matter it may see — and, once it has decided one, keeps
-- reading it whatever later happens to the suit number on the matter, through its own decision
-- row (registry_notice_decisions carries the wall in its own policy). Correcting a typo must not
-- make a firm's record of what it decided disappear.
create policy registry_notices_select on public.registry_notices for select
  using (is_registry_member(registry_id)
         or (status in ('published', 'withdrawn')
             and (notice_concerns_caller(court_id, suit_number_norm)
                  or exists (select 1 from registry_notice_decisions d
                              where d.notice_id = registry_notices.id and matter_row_r(d.firm_id, d.matter_id)))));

/** Is this day inside a vacation window for this court? Distinct from time stopping and from the court not sitting. */
create or replace function public.is_court_vacation_day(p_date date, p_level public.court_level, p_state text) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from court_vacations v
                    where p_date between v.starts_on and v.ends_on
                      and (v.level is null or v.level = p_level)
                      and (v.state_code is null or v.state_code = p_state)) $$;
revoke execute on function public.is_court_vacation_day(date, public.court_level, text) from public, anon;
grant  execute on function public.is_court_vacation_day(date, public.court_level, text) to authenticated;

/**
 * A lawyer on the matter confirms the registry's listing into the diary.
 *
 * The notice must be published; the matter must match it (the same test the policy makes, for
 * THIS matter); nobody at this firm has decided it yet. A Saturday, Sunday or public holiday is
 * refused — a court that lists one has made an error and the lawyer should ask the registry, not
 * diarise it. A day inside a vacation window is ALLOWED and recorded, because a vacation judge's
 * sitting is a real sitting; vacate_court_event() refuses those, and this function deliberately
 * does not copy that.
 *
 * Three outcomes, chosen by what the diary already holds for this matter:
 *   · the same day is already in the diary (a lawyer diarised it from a hearing notice) — the
 *     existing sitting is ATTACHED to the notice rather than duplicated: provenance becomes the
 *     registry's, and what the notice knows that the diary did not (judge, courtroom, purpose)
 *     is filled in where the diary was blank;
 *   · a different open sitting is in the diary and p_vacate_existing is true — the old one is
 *     vacated with the reason given, refixed to the new, and the client is told, exactly as
 *     vacate_court_event() does it;
 *   · otherwise a new sitting is made.
 * Every path writes the decision, the client-visible timeline entry and the audit line.
 */
create or replace function public.confirm_registry_notice(p_notice uuid, p_matter uuid, p_time time default null,
                                                          p_vacate_existing boolean default false, p_vacate_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare n registry_notices%rowtype; m matters%rowtype; c courts%rowtype; b registry_notice_batches%rowtype;
        v_at timestamptz; v_day date; v_existing court_events%rowtype; v_event uuid; v_in_vacation boolean;
        v_matches boolean; v_ref text; v_title text; v_body text; v_next court_events%rowtype; v_attached boolean := false;
begin
  select * into n from registry_notices where id = p_notice;
  if not found then raise exception 'notice not found'; end if;
  select * into m from matters where id = p_matter and deleted_at is null for update;
  if not found or not matter_row_w(m.firm_id, m.id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if n.status = 'draft' then raise exception 'notice not found'; end if;   -- a draft is the registry's alone
  if n.status = 'withdrawn' then raise exception 'the registry has withdrawn this notice; it cannot be confirmed'; end if;

  -- The matter must actually carry this suit at this court. The screen only offers matches, but
  -- the rule is here.
  select (m.court_id = n.court_id and m.suit_number_norm = n.suit_number_norm)
      or exists (select 1 from matter_court_numbers cn where cn.matter_id = m.id and cn.is_current and cn.court_id = n.court_id
                  and upper(regexp_replace(cn.number, '\s', '', 'g')) = n.suit_number_norm)
    into v_matches;
  if not v_matches then raise exception 'this matter does not carry suit % at that court', n.suit_number; end if;
  -- A confirmation whose sitting was later deleted by hand is not a decision that stands: the
  -- stranded row is cleared so the notice can be decided again.
  delete from registry_notice_decisions d where d.notice_id = p_notice and d.matter_id = p_matter and d.decision = 'confirmed' and d.court_event_id is null;
  if exists (select 1 from registry_notice_decisions d where d.notice_id = p_notice and d.matter_id = p_matter) then
    raise exception 'this notice has already been decided for this matter';
  end if;

  select * into c from courts where id = n.court_id;
  v_day := n.listed_on;
  if extract(isodow from v_day) >= 6 or is_public_holiday(v_day) then
    raise exception 'the registry has listed % — a %; ask the registry before diarising it',
      to_char(v_day, 'FMDD Mon YYYY'), case when extract(isodow from v_day) >= 6 then 'weekend' else 'public holiday' end;
  end if;
  v_in_vacation := is_court_vacation_day(v_day, c.level, c.state_code);
  -- The court's own wall clock, in the court's own zone. All Nigerian courts sit in Africa/Lagos.
  v_at := ((v_day + coalesce(p_time, n.listed_time, time '09:00'))::timestamp) at time zone 'Africa/Lagos';
  select * into b from registry_notice_batches where id = n.batch_id;
  v_ref := 'Registry notice ' || left(n.id::text, 8) || coalesce(' · ' || b.source_note, '');

  -- What the diary already holds for this matter.
  select * into v_existing from court_events ce
   where ce.matter_id = m.id and ce.vacated_at is null and ce.outcome_update_id is null
   order by ce.scheduled_at limit 1;

  if found and (v_existing.scheduled_at at time zone 'Africa/Lagos')::date = v_day
     and (v_existing.court_id is null or v_existing.court_id = n.court_id) then
    -- The court agrees with the diary. Attach, do not duplicate. The flag tells
    -- court_events_registry_guard() this one update is the confirm itself, and is cleared at once
    -- so nothing later in the same transaction inherits it.
    perform set_config('docket.registry_confirm', '1', true);
    update court_events
       set source = 'registry', registry_notice_id = n.id, source_ref = v_ref, registry_withdrawn_at = null,
           confirmed_by = auth.uid(), confirmed_at = now(),
           court_id = coalesce(court_id, n.court_id), court_name = coalesce(court_name, c.name),
           judge = coalesce(judge, n.judge), courtroom = coalesce(courtroom, n.courtroom),
           purpose_kind = coalesce(purpose_kind, n.purpose_kind), purpose = coalesce(purpose, n.purpose)
     where id = v_existing.id;
    perform set_config('docket.registry_confirm', '', true);
    v_event := v_existing.id;
    v_attached := true;
    v_title := format('The registry has listed this matter for %s', to_char(v_day, 'FMDD Mon YYYY'));
    v_body := format('%s confirms the sitting already in the diary%s.', coalesce(c.name, 'The court registry'),
                     case when n.purpose is not null then ' for ' || n.purpose when n.purpose_kind is not null then ' for ' || replace(n.purpose_kind, '_', ' ') else '' end);
  else
    if found and p_vacate_existing then
      if length(btrim(coalesce(p_vacate_reason, ''))) < 3 then raise exception 'say why the earlier date is vacated — the client reads it'; end if;
    end if;
    insert into court_events (matter_id, firm_id, scheduled_at, court_id, court_name, courtroom, judge, purpose, purpose_kind,
                              source, registry_notice_id, source_ref, confirmed_by, confirmed_at)
    values (m.id, m.firm_id, v_at, n.court_id, c.name, n.courtroom, n.judge, n.purpose, n.purpose_kind,
            'registry', n.id, v_ref, auth.uid(), now())
    returning id into v_event;
    if found and p_vacate_existing then
      update court_events set vacated_at = now(), vacated_reason = left(btrim(p_vacate_reason), 500), refixed_to = v_event
       where id = v_existing.id;
      v_title := format('Date of %s vacated — the registry has listed %s',
                        to_char(v_existing.scheduled_at at time zone 'Africa/Lagos', 'FMDD Mon YYYY'), to_char(v_day, 'FMDD Mon YYYY'));
      v_body := left(btrim(p_vacate_reason), 500);
    else
      v_title := format('The registry has listed this matter for %s', to_char(v_day, 'FMDD Mon YYYY'));
      v_body := format('%s has listed the suit%s. Your lawyer has confirmed the date into the diary.', coalesce(c.name, 'The court registry'),
                       case when n.purpose is not null then ' for ' || n.purpose when n.purpose_kind is not null then ' for ' || replace(n.purpose_kind, '_', ' ') else '' end);
    end if;
    -- The matter's next date is the NEAREST open sitting, which may still be an earlier one the
    -- lawyer kept: a later listing does not overwrite a nearer date.
    select * into v_next from court_events ce
     where ce.matter_id = m.id and ce.vacated_at is null and ce.outcome_update_id is null and ce.scheduled_at >= now()
     order by ce.scheduled_at limit 1;
    update matters set next_event_at = coalesce(v_next.scheduled_at, v_at),
                       next_event_note = coalesce(v_next.purpose, coalesce(n.purpose, replace(n.purpose_kind, '_', ' '))),
                       awaiting_date = false
     where id = m.id;
  end if;

  insert into registry_notice_decisions (notice_id, firm_id, matter_id, decision, court_event_id, in_vacation, attached, decided_by)
  values (n.id, m.firm_id, m.id, 'confirmed', v_event, v_in_vacation, v_attached, auth.uid());

  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
  values (m.id, m.firm_id, 'court_sitting', 'client', v_title, v_body,
          jsonb_build_object('outcome', 'listed', 'court_event_id', v_event, 'next_date', v_at,
                             'next_purpose', coalesce(n.purpose, n.purpose_kind), 'court_name', c.name,
                             'source', 'registry', 'registry_notice_id', n.id, 'in_vacation', v_in_vacation),
          now(), auth.uid());
  perform audit('registry_notice.confirmed', 'court_event', v_event, m.firm_id,
                jsonb_build_object('notice_id', n.id, 'matter_id', m.id, 'in_vacation', v_in_vacation,
                                   'vacated', case when p_vacate_existing and v_existing.id is not null and v_existing.id <> v_event then v_existing.id end));
  return v_event;
end $$;
revoke execute on function public.confirm_registry_notice(uuid, uuid, time, boolean, text) from public, anon;
grant  execute on function public.confirm_registry_notice(uuid, uuid, time, boolean, text) to authenticated;

/** Not ours, or already handled: the firm says so, with a reason, and the notice stops asking. */
create or replace function public.reject_registry_notice(p_notice uuid, p_matter uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare n registry_notices%rowtype; m matters%rowtype;
begin
  select * into n from registry_notices where id = p_notice;
  if not found or n.status = 'draft' then raise exception 'notice not found'; end if;
  select * into m from matters where id = p_matter and deleted_at is null;
  if not found or not matter_row_w(m.firm_id, m.id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why — it is kept on the record'; end if;
  delete from registry_notice_decisions d where d.notice_id = p_notice and d.matter_id = p_matter and d.decision = 'confirmed' and d.court_event_id is null;
  if exists (select 1 from registry_notice_decisions d where d.notice_id = p_notice and d.matter_id = p_matter) then
    raise exception 'this notice has already been decided for this matter';
  end if;
  insert into registry_notice_decisions (notice_id, firm_id, matter_id, decision, reason, decided_by)
  values (n.id, m.firm_id, m.id, 'rejected', left(btrim(p_reason), 500), auth.uid());
  perform audit('registry_notice.rejected', 'registry_notice', n.id, m.firm_id,
                jsonb_build_object('matter_id', m.id, 'reason', left(btrim(p_reason), 500)));
end $$;
revoke execute on function public.reject_registry_notice(uuid, uuid, text) from public, anon;
grant  execute on function public.reject_registry_notice(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------- what the pilot is measured by
/**
 * Counts, for the platform, per registry: what was published and withdrawn, and how the firms
 * concerned decided. Counts and nothing else — no firm is named, no matter, no suit — which is the
 * platform's usual level of sight (lifecycle and health, never content). A registry cannot call
 * it: how the firms decided is theirs, and this is the one place it is aggregated.
 */
create or replace function public.registry_pilot_health()
returns table (registry_id uuid, registry_name text, court_name text, status text,
               notices_published bigint, notices_withdrawn bigint, drafts bigint,
               decisions_confirmed bigint, decisions_rejected bigint, attached_to_existing bigint,
               first_published_at timestamptz, last_published_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.name, c.name, r.status,
         (select count(*) from registry_notices n where n.registry_id = r.id and n.status = 'published'),
         (select count(*) from registry_notices n where n.registry_id = r.id and n.status = 'withdrawn'),
         (select count(*) from registry_notices n where n.registry_id = r.id and n.status = 'draft'),
         (select count(*) from registry_notice_decisions d join registry_notices n on n.id = d.notice_id where n.registry_id = r.id and d.decision = 'confirmed'),
         (select count(*) from registry_notice_decisions d join registry_notices n on n.id = d.notice_id where n.registry_id = r.id and d.decision = 'rejected'),
         -- The court agreed with a diary that already had the date: the number that says whether the
         -- registry is ahead of the firms or behind them.
         (select count(*) from registry_notice_decisions d join registry_notices n on n.id = d.notice_id
          where n.registry_id = r.id and d.decision = 'confirmed' and d.attached),
         (select min(n.published_at) from registry_notices n where n.registry_id = r.id),
         (select max(n.published_at) from registry_notices n where n.registry_id = r.id)
    from registries r join courts c on c.id = r.court_id
   where is_platform_admin()
   order by r.created_at
$$;
revoke execute on function public.registry_pilot_health() from public, anon;
grant  execute on function public.registry_pilot_health() to authenticated;

-- ---------------------------------------------------------------- what the Sittings screen reads
/**
 * One row per (notice, matter the caller may see), with the firm's decision if any and what the
 * diary already holds for that matter. security_invoker: registry_notices and matters both carry
 * their own RLS, so a colleague outside a walled matter's team gets no row, and no firm ever gets
 * a notice for a suit it does not hold.
 */
create or replace view public.firm_registry_notices with (security_invoker = true) as
  with hits as (
    select n.id as notice_id, m.id as matter_id, m.firm_id
      from public.registry_notices n
      join public.matters m on m.deleted_at is null and m.court_id = n.court_id and m.suit_number_norm = n.suit_number_norm
     where n.status in ('published', 'withdrawn')
    union
    select n.id, m.id, m.firm_id
      from public.registry_notices n
      join public.matter_court_numbers cn on cn.is_current and cn.court_id = n.court_id
                                          and upper(regexp_replace(cn.number, '\s', '', 'g')) = n.suit_number_norm
      join public.matters m on m.id = cn.matter_id and m.deleted_at is null
     where n.status in ('published', 'withdrawn')
    union
    -- Decided once, listed for ever, whatever later happens to the suit number on the matter.
    select d.notice_id, d.matter_id, d.firm_id from public.registry_notice_decisions d)
  select h.notice_id, h.matter_id, h.firm_id, m.reference, coalesce(m.cause_title, m.title) as cause_title,
         n.registry_id, r.name as registry_name, n.court_id, c.name as court_name,
         n.suit_number, n.cause_title as registry_cause_title, n.listed_on, n.listed_time, n.judge, n.courtroom,
         n.purpose_kind, n.purpose, n.status, n.published_at, n.withdrawn_at, n.withdrawn_reason,
         d.id as decision_id, d.decision, d.court_event_id, d.reason as decision_reason, d.in_vacation, d.decided_by, d.decided_at,
         ex.id as existing_event_id, ex.scheduled_at as existing_scheduled_at,
         is_court_vacation_day(n.listed_on, c.level, c.state_code) as listed_in_vacation,
         (extract(isodow from n.listed_on) >= 6 or is_public_holiday(n.listed_on)) as listed_on_non_sitting_day
    from hits h
    join public.registry_notices n on n.id = h.notice_id
    join public.registries r on r.id = n.registry_id
    join public.courts c on c.id = n.court_id
    join public.matters m on m.id = h.matter_id
    left join public.registry_notice_decisions d on d.notice_id = h.notice_id and d.matter_id = h.matter_id
    left join lateral (select ce.id, ce.scheduled_at from public.court_events ce
                        where ce.matter_id = h.matter_id and ce.vacated_at is null and ce.outcome_update_id is null
                        order by ce.scheduled_at limit 1) ex on true;
grant select on public.firm_registry_notices to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.firm_registry_notices from anon, authenticated;

-- The registry's members read `registries` through registries_select, and the view above joins
-- `registries` for its name — under the FIRM member's session. registries_select admits members
-- and the platform only, so the join would drop every row for a lawyer. A firm may know the name
-- of any registry whose notice it can read: that is the point of the notice. The subquery runs
-- under registry_notices' own policy, so "can read" is decided there and only there.
create policy registries_select_named on public.registries for select
  using (exists (select 1 from registry_notices n where n.registry_id = registries.id and n.status in ('published', 'withdrawn')));
