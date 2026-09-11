-- Conflict checks over the firm's own register.
--
-- conflict_checks has existed since migration 1 with no constraints, no index, no created_at and
-- nothing referencing it. A conflict search over an empty set is theatre: matter_parties.user_id
-- is a platform user and an opposing party almost never is, so there was nothing to check
-- against. This migration gives each matter an adverse-party register, shapes conflict_checks
-- into a record a lawyer decides, and adds the one door that runs a search — within this firm's
-- own register only, never another firm's, and never deciding for the lawyer.
--
-- Decision #4 (the assessment's #7): warn on open, block on the client link, opt-in per firm.
-- firms.conflict_checks_required off (the default): a check can be run and recorded on any
-- matter and nothing is refused. On: a client cannot be joined to a matter — by open_matter(),
-- by invitation, by direct insert — until the latest decided check on it is clear or waived.
--
-- The wall (migration 29) and the register: a search covers every matter of the firm, restricted
-- ones included, because a conflict on a walled matter is still a conflict. What it reveals of a
-- restricted matter is only that a match exists there and who leads it — not the matter.

-- pg_trgm for the 'similar' strength. Supabase keeps extensions in their own schema.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    execute 'create extension if not exists pg_trgm with schema extensions';
  else
    execute 'create extension if not exists pg_trgm';
  end if;
end $$;

-- ---------------------------------------------------------------- 1. the switch
alter table public.firms add column conflict_checks_required boolean not null default false;
comment on column public.firms.conflict_checks_required is
  'Opt-in: must the latest decided conflict check on a matter be clear or waived before a client is joined to it? Off: checks are advisory.';

-- ---------------------------------------------------------------- 2. the other side
create table public.matter_adverse_parties (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms(id) on delete cascade,
  matter_id   uuid not null references public.matters(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 2 and 200),
  aliases     text[] not null default '{}',
  kind        text not null default 'person' check (kind in ('person', 'organisation')),
  relation    text not null default 'adverse' check (relation in ('adverse', 'co_party', 'witness', 'related')),
  note        text check (note is null or length(note) <= 2000),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index matter_adverse_parties_matter_idx on public.matter_adverse_parties (matter_id);
create index matter_adverse_parties_firm_idx on public.matter_adverse_parties (firm_id, lower(name));
alter table public.matter_adverse_parties enable row level security;
-- Firm work product: no client policy, ever.
create policy matter_adverse_parties_select on public.matter_adverse_parties for select using (matter_row_r(firm_id, matter_id));
create policy matter_adverse_parties_insert on public.matter_adverse_parties for insert with check (matter_row_w(firm_id, matter_id));
create policy matter_adverse_parties_update on public.matter_adverse_parties for update using (matter_row_w(firm_id, matter_id)) with check (matter_row_w(firm_id, matter_id));
create policy matter_adverse_parties_delete on public.matter_adverse_parties for delete using (matter_row_w(firm_id, matter_id));
revoke all on public.matter_adverse_parties from anon;
grant select, insert, update, delete on public.matter_adverse_parties to authenticated;
create trigger matter_adverse_parties_check_firm before insert or update on public.matter_adverse_parties
  for each row execute function public.check_row_firm();
comment on table public.matter_adverse_parties is
  'The other side and anyone else a conflict check must know about, per matter, with aliases. Firm work product: never visible to a client.';

-- ---------------------------------------------------------------- 3. conflict_checks, shaped
alter table public.conflict_checks
  add column created_by    uuid references public.profiles(id) on delete set null,
  add column created_at    timestamptz not null default now(),
  add column decision_note text,
  alter column query   set default '{}'::jsonb,
  alter column matches set default '[]'::jsonb;
update public.conflict_checks set query = coalesce(query, '{}'::jsonb), matches = coalesce(matches, '[]'::jsonb);
alter table public.conflict_checks
  alter column query   set not null,
  alter column matches set not null,
  add constraint conflict_checks_outcome_chk     check (outcome is null or outcome in ('clear', 'conflict', 'waived')),
  add constraint conflict_checks_decided_chk     check ((outcome is null) = (reviewed_at is null)),
  add constraint conflict_checks_waiver_note_chk check (outcome is distinct from 'waived' or length(btrim(coalesce(decision_note, ''))) >= 2),
  add constraint conflict_checks_note_len_chk    check (decision_note is null or length(decision_note) <= 2000);
create index conflict_checks_matter_idx on public.conflict_checks (matter_id, reviewed_at desc);
create index conflict_checks_firm_idx on public.conflict_checks (firm_id, created_at desc);

-- Read by staff who can see the matter (firm-wide while unattached); written only through the
-- two functions below. A check is a record: never edited or deleted through the API.
drop policy if exists conflict_checks_select    on public.conflict_checks;
drop policy if exists conflict_checks_write     on public.conflict_checks;
drop policy if exists conflict_checks_write_ins on public.conflict_checks;
drop policy if exists conflict_checks_write_upd on public.conflict_checks;
drop policy if exists conflict_checks_write_del on public.conflict_checks;
create policy conflict_checks_select on public.conflict_checks for select using (matter_row_r(firm_id, matter_id));
revoke all on public.conflict_checks from anon;
revoke insert, update, delete on public.conflict_checks from authenticated;
create trigger conflict_checks_check_firm before insert or update on public.conflict_checks
  for each row execute function public.check_row_firm();
comment on table public.conflict_checks is
  'One row per search run through run_conflict_check(): what was looked for, what matched, and the lawyer''s decision through decide_conflict_check(). Never edited or deleted.';

-- ---------------------------------------------------------------- 4. matching
-- Lower-case, letters and digits only, one space between words. Immutable, so the comparison is
-- the same in the register and in the query.
create or replace function public.conflict_name_key(p text) returns text
language sql immutable strict set search_path = public as
$$ select nullif(btrim(regexp_replace(regexp_replace(lower(p), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')), '') $$;

-- exact: the same key. contains: one key is a whole run of words inside the other. similar:
-- trigram similarity of at least 0.5. Keys under four characters match only exactly, so "ltd"
-- does not light up every company on the books. Null means no match.
create or replace function public.conflict_match_strength(a text, b text) returns text
language sql immutable set search_path = public, extensions as $$
  select case
    when a is null or b is null then null
    when a = b then 'exact'
    when length(a) < 4 or length(b) < 4 then null
    when position(' ' || b || ' ' in ' ' || a || ' ') > 0 or position(' ' || a || ' ' in ' ' || b || ' ') > 0 then 'contains'
    when similarity(a, b) >= 0.5 then 'similar'
  end
$$;

-- ---------------------------------------------------------------- 5. the doors
-- Search this firm's register for the names given plus everyone the matter itself names, record
-- the result as a conflict_checks row, and return it. The register: clients on the firm's matters
-- (their profile name and company), the adverse-party register with aliases, the free-text
-- opposing_party, and cause titles (which can only contain a name). The matter being checked is
-- excluded — its own client on its own file is not a conflict. Closed matters count; deleted
-- ones do not. A restricted matter the caller cannot see is reported without its identity.
create or replace function public.run_conflict_check(p_firm uuid, p_matter uuid default null, p_names text[] default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_names text[]; v_matches jsonb; v_id uuid; v_n int;
begin
  if not staff_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_matter is not null and (
       not exists (select 1 from matters where id = p_matter and firm_id = p_firm and deleted_at is null)
       or not can_see_matter(p_matter)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select array_agg(distinct k order by k) into v_names from (
    select conflict_name_key(n) as k from unnest(coalesce(p_names, '{}'::text[])) n
    union all select conflict_name_key(p.full_name)    from matter_parties mp join profiles p on p.id = mp.user_id where p_matter is not null and mp.matter_id = p_matter
    union all select conflict_name_key(p.company_name) from matter_parties mp join profiles p on p.id = mp.user_id where p_matter is not null and mp.matter_id = p_matter
    union all select conflict_name_key(ap.name)        from matter_adverse_parties ap where p_matter is not null and ap.matter_id = p_matter
    union all select conflict_name_key(al)             from matter_adverse_parties ap, unnest(ap.aliases) al where p_matter is not null and ap.matter_id = p_matter
    union all select conflict_name_key(m.opposing_party) from matters m where p_matter is not null and m.id = p_matter
  ) s where k is not null;
  if v_names is null or cardinality(v_names) = 0 then raise exception 'nothing to check: give at least one name'; end if;

  with register as (
    select 'client'::text as kind, p.full_name as name, mp.matter_id
      from matter_parties mp join profiles p on p.id = mp.user_id
     where mp.firm_id = p_firm and mp.role = 'client' and p.full_name is not null
    union all
    select 'client', p.company_name, mp.matter_id
      from matter_parties mp join profiles p on p.id = mp.user_id
     where mp.firm_id = p_firm and mp.role = 'client' and p.company_name is not null
    union all select 'adverse', ap.name, ap.matter_id from matter_adverse_parties ap where ap.firm_id = p_firm
    union all select 'adverse', al, ap.matter_id from matter_adverse_parties ap, unnest(ap.aliases) al where ap.firm_id = p_firm
    union all select 'opposing_party', m.opposing_party, m.id from matters m where m.firm_id = p_firm and m.opposing_party is not null
    union all select 'cause_title', m.cause_title, m.id from matters m where m.firm_id = p_firm and m.cause_title is not null
  ), hits as (
    select distinct on (r.kind, r.name, r.matter_id, q.k)
           r.kind, r.name, r.matter_id, q.k as searched, conflict_match_strength(q.k, conflict_name_key(r.name)) as strength
      from register r
      join matters m on m.id = r.matter_id and m.deleted_at is null
      cross join unnest(v_names) as q(k)
     where (p_matter is null or r.matter_id <> p_matter)
       and conflict_match_strength(q.k, conflict_name_key(r.name)) is not null
       and (r.kind <> 'cause_title' or conflict_match_strength(q.k, conflict_name_key(r.name)) = 'contains')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', h.kind, 'name', h.name, 'searched', h.searched, 'strength', h.strength,
           'restricted', not can_see_matter(h.matter_id),
           'matter_id',        case when can_see_matter(h.matter_id) then h.matter_id end,
           'matter_reference', case when can_see_matter(h.matter_id) then m.reference end,
           'matter_title',     case when can_see_matter(h.matter_id) then m.title end,
           'lead_lawyer_id',   (select ml.user_id from matter_lawyers ml where ml.matter_id = h.matter_id and ml.is_lead limit 1)
         ) order by case h.strength when 'exact' then 0 when 'contains' then 1 else 2 end, h.name, m.reference), '[]'::jsonb),
         count(*)
    into v_matches, v_n
    from hits h join matters m on m.id = h.matter_id;

  insert into conflict_checks (firm_id, matter_id, query, matches, created_by)
  values (p_firm, p_matter, jsonb_build_object('names', to_jsonb(coalesce(p_names, '{}'::text[])), 'keys', to_jsonb(v_names)), v_matches, auth.uid())
  returning id into v_id;
  perform audit('conflict_check.run', 'conflict_check', v_id, p_firm,
                jsonb_build_object('matter_id', p_matter, 'keys', v_names, 'matches', v_n));
  return jsonb_build_object('check_id', v_id, 'keys', to_jsonb(v_names), 'matches', v_matches, 'match_count', v_n);
end $$;
revoke execute on function public.run_conflict_check(uuid, uuid, text[]) from public, anon;
grant  execute on function public.run_conflict_check(uuid, uuid, text[]) to authenticated;

-- The lawyer's decision. Once: a changed mind is a new check. A waiver says why.
create or replace function public.decide_conflict_check(p_check uuid, p_outcome text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v conflict_checks%rowtype;
begin
  select * into v from conflict_checks where id = p_check;
  if not found or not staff_w(v.firm_id) or (v.matter_id is not null and not can_see_matter(v.matter_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_outcome not in ('clear', 'conflict', 'waived') then raise exception 'the outcome is clear, conflict or waived'; end if;
  if v.outcome is not null then raise exception 'this check has already been decided — run a new one'; end if;
  if p_outcome = 'waived' and length(btrim(coalesce(p_note, ''))) < 2 then raise exception 'a waiver records why: give the note'; end if;
  update conflict_checks
     set outcome = p_outcome, decision_note = nullif(btrim(p_note), ''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_check;
  perform audit('conflict_check.decided', 'conflict_check', p_check, v.firm_id,
                jsonb_build_object('matter_id', v.matter_id, 'outcome', p_outcome, 'matches', jsonb_array_length(v.matches)));
end $$;
revoke execute on function public.decide_conflict_check(uuid, text, text) from public, anon;
grant  execute on function public.decide_conflict_check(uuid, text, text) to authenticated;

-- Cleared: the latest decided check on the matter is clear or waived. No check, or a later
-- check that found a conflict, is not cleared.
create or replace function public.conflict_cleared(p_matter uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select outcome in ('clear', 'waived') from conflict_checks
                    where matter_id = p_matter and outcome is not null
                    order by reviewed_at desc limit 1), false)
$$;
revoke execute on function public.conflict_cleared(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 6. the block
-- Every door a client comes through ends in a matter_parties row, so the rule lives there.
create or replace function public.guard_conflict_clearance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'client'
     and (select conflict_checks_required from firms where id = new.firm_id)
     and not conflict_cleared(new.matter_id) then
    raise exception 'this firm requires a cleared conflict check before a client joins a matter';
  end if;
  return new;
end $$;
create trigger matter_parties_conflict_clearance before insert or update of role on public.matter_parties
  for each row execute function public.guard_conflict_clearance();

-- The invitation is refused at the moment it is created, not when the client accepts it: the
-- client should never be the one told the firm skipped a step.
CREATE OR REPLACE FUNCTION public.invite_matter_party(p_matter uuid, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_role party_role DEFAULT 'client'::party_role, p_expires_days integer DEFAULT 14)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_m matters%rowtype; v_id uuid; v_token text; v_existing uuid;
begin
  select * into v_m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  if not (staff_w(v_m.firm_id) and can_see_matter(v_m.id)) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_role not in ('client','contact') then raise exception 'only a client or a contact can be invited to a matter'; end if;
  if p_role = 'client' and (select conflict_checks_required from firms where id = v_m.firm_id) and not conflict_cleared(v_m.id) then
    raise exception 'this firm requires a cleared conflict check before a client is invited to a matter';
  end if;
  if coalesce(trim(p_phone), '') = '' and coalesce(trim(p_email), '') = '' then
    raise exception 'give a phone number or an email address to send the invitation to';
  end if;
  if p_expires_days < 1 or p_expires_days > 60 then raise exception 'an invitation lasts between 1 and 60 days'; end if;

  -- already a party? (matched on the profile behind the phone/email)
  select mp.user_id into v_existing
    from matter_parties mp join profiles p on p.id = mp.user_id
   where mp.matter_id = p_matter
     and ((p_phone is not null and p.phone = trim(p_phone))
       or (p_email is not null and lower(p.email) = lower(trim(p_email))));
  if v_existing is not null then raise exception 'that person is already on this matter'; end if;

  insert into invites (firm_id, matter_id, phone, email, role, created_by, expires_at)
  values (v_m.firm_id, p_matter, nullif(trim(p_phone), ''), nullif(lower(trim(p_email)), ''), p_role, auth.uid(),
          now() + make_interval(days => p_expires_days))
  returning id, token into v_id, v_token;

  perform audit('invite.created', 'invite', v_id, v_m.firm_id,
                jsonb_build_object('matter_id', p_matter, 'role', p_role, 'phone', p_phone, 'email', p_email));
  return jsonb_build_object('invite_id', v_id, 'token', v_token, 'matter_id', p_matter,
                            'matter_reference', v_m.reference, 'matter_title', v_m.title,
                            'firm_id', v_m.firm_id, 'role', p_role,
                            'expires_at', now() + make_interval(days => p_expires_days));
end $function$;

-- ---------------------------------------------------------------- 7. open_matter learns the other side and the check
-- Two trailing defaulted parameters. The old signature is dropped so every caller — the deployed
-- front end included, which passes named arguments — resolves to exactly one function (the
-- post_court_update precedent, migration 27). A check run before the matter existed
-- (p_matter null) is attached to the new matter; the clearance guard then sees it when the
-- client is linked in the same call.
drop function public.open_matter(uuid,text,matter_type,uuid,text,text,uuid,text,text,uuid,uuid,text,text);
create or replace function public.open_matter(
  p_firm uuid, p_title text, p_type matter_type,
  p_client uuid default null, p_cause_title text default null, p_description text default null,
  p_court_id uuid default null, p_suit_number text default null, p_judicial_division text default null,
  p_originating_lawyer uuid default null, p_handling_lawyer uuid default null,
  p_status_key text default 'new_inquiry', p_note_to_client text default null,
  p_conflict_check uuid default null, p_adverse_parties jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text; v_status uuid; v_lead uuid; v_check conflict_checks%rowtype;
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
  -- The other side, as the firm knows it at the outset: the register a later check searches.
  if p_adverse_parties is not null and jsonb_typeof(p_adverse_parties) = 'array' then
    insert into matter_adverse_parties (firm_id, matter_id, name, kind, aliases, created_by)
    select p_firm, v_id, btrim(e ->> 'name'),
           case when e ->> 'kind' = 'organisation' then 'organisation' else 'person' end,
           coalesce((select array_agg(btrim(a)) from jsonb_array_elements_text(coalesce(e -> 'aliases', '[]'::jsonb)) a where btrim(a) <> ''), '{}'),
           auth.uid()
      from jsonb_array_elements(p_adverse_parties) e
     where length(btrim(coalesce(e ->> 'name', ''))) >= 2;
  end if;
  -- A check run before the matter existed is attached to it now, so the clearance guard on the
  -- client link below can find it. It must be this firm's, decided, and not another matter's.
  if p_conflict_check is not null then
    select * into v_check from conflict_checks where id = p_conflict_check;
    if not found or v_check.firm_id <> p_firm then raise exception 'conflict check not found'; end if;
    if v_check.matter_id is not null then raise exception 'that conflict check belongs to another matter'; end if;
    if v_check.outcome is null then raise exception 'decide the conflict check before opening the matter on it'; end if;
    update conflict_checks set matter_id = v_id where id = p_conflict_check;
  end if;
  if p_suit_number is not null and length(trim(p_suit_number)) > 0 then
    insert into matter_court_numbers (firm_id, matter_id, court_id, number, kind) values (p_firm, v_id, p_court_id, trim(p_suit_number), 'suit');
  end if;
  if p_client is not null then
    insert into matter_parties (matter_id, firm_id, user_id, role, invited_by) values (v_id, p_firm, p_client, 'client', auth.uid());
    insert into updates (matter_id, firm_id, kind, visibility, title, body, occurred_at, posted_by)
    values (v_id, p_firm, 'milestone', 'client', 'Matter opened: ' || trim(p_title),
            coalesce(p_note_to_client, 'Your matter has been opened. Updates on every court sitting and filing will appear here.'), now(), auth.uid());
  end if;
  perform audit('matter.opened', 'matter', v_id, p_firm, jsonb_build_object('reference', v_ref, 'client', p_client, 'court_id', p_court_id, 'conflict_check', p_conflict_check));
  return jsonb_build_object('matter_id', v_id, 'reference', v_ref);
end $$;
revoke execute on function public.open_matter(uuid,text,matter_type,uuid,text,text,uuid,text,text,uuid,uuid,text,text,uuid,jsonb) from public, anon;
grant  execute on function public.open_matter(uuid,text,matter_type,uuid,text,text,uuid,text,text,uuid,uuid,text,text,uuid,jsonb) to authenticated;
