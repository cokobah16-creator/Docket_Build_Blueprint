-- The Wave 2 review round: five holes found in 29, 31 and 32, closed here. Those three are
-- applied live and are not edited; each fix names the finding it answers.

-- ---------------------------------------------------------------- 1. invitations are behind the wall (29)
-- invites_select and the write policies were firm-wide, so a colleague outside a restricted
-- matter's team could read its invitations — phone, email and the bearer token — and accept one,
-- becoming a party and reading the file from the client side. The matter predicate applies to
-- invitations as to everything else on the matter; and a member of a firm can never accept an
-- invitation into that firm's own matter, whatever the role: the invitation is for the client.
drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites for select using (matter_row_r(firm_id, matter_id));
drop policy if exists invites_write_ins on public.invites;
create policy invites_write_ins on public.invites for insert with check (matter_row_w(firm_id, matter_id));
drop policy if exists invites_write_upd on public.invites;
create policy invites_write_upd on public.invites for update using (matter_row_w(firm_id, matter_id)) with check (matter_row_w(firm_id, matter_id));
drop policy if exists invites_write_del on public.invites;
create policy invites_write_del on public.invites for delete using (matter_row_w(firm_id, matter_id));

create or replace function public.accept_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv invites%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_inv from invites where token = p_token and accepted_by is null and expires_at > now() for update;
  if not found then raise exception 'invite invalid or expired'; end if;
  if exists (select 1 from firm_members fm where fm.firm_id = v_inv.firm_id and fm.user_id = auth.uid()) then
    raise exception 'a member of the firm cannot join its own matter as a party — the invitation is for the client' using errcode = '42501';
  end if;
  if v_inv.matter_id is not null then
    insert into matter_parties (matter_id, firm_id, user_id, role, invited_by)
    values (v_inv.matter_id, v_inv.firm_id, auth.uid(), v_inv.role, v_inv.created_by)
    on conflict (matter_id, user_id) do nothing;
  end if;
  update invites set accepted_by = auth.uid() where id = v_inv.id;
  perform audit('invite.accepted', 'invite', v_inv.id, v_inv.firm_id, jsonb_build_object('matter_id', v_inv.matter_id));
  return jsonb_build_object('firm_id', v_inv.firm_id, 'matter_id', v_inv.matter_id);
end $$;

-- ---------------------------------------------------------------- 2. the last team member cannot leave by update either (29)
-- The guard ran on DELETE only; an UPDATE moving the row to another matter left a restricted
-- matter with no team, which nobody could open.
create or replace function public.guard_matter_team() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.matter_id = old.matter_id then return new; end if;
  if exists (select 1 from matters mt where mt.id = old.matter_id and mt.access = 'team')
     and not exists (select 1 from matter_lawyers ml where ml.matter_id = old.matter_id and ml.user_id <> old.user_id) then
    raise exception 'this is the last member of a restricted matter''s team — set the matter to firm-wide first, or add someone else' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists matter_lawyers_guard_team on public.matter_lawyers;
create trigger matter_lawyers_guard_team before delete or update on public.matter_lawyers
  for each row execute function public.guard_matter_team();

-- ---------------------------------------------------------------- 3. fulfilment is the function's alone (31)
-- The update grant was table-wide, so staff could set fulfilled_document_id and fulfilled_at by
-- hand — to a document from another matter, with no audit line and no notice to whoever asked —
-- or rewrite who asked and when. The API may edit what was asked and withdraw; nothing else.
-- fulfil_document_request() runs as the owner and is not bound by the column grant.
revoke update on public.document_requests from authenticated;
grant update (title, why, due_on, cancelled_at) on public.document_requests to authenticated;
-- and a withdrawal stands: what was asked for is history, withdrawn or answered.
create or replace function public.guard_document_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.cancelled_at is not null and new.cancelled_at is null then
    raise exception 'a withdrawn request stays withdrawn — ask again with a new request';
  end if;
  if old.fulfilled_at is not null and new.cancelled_at is not null then
    raise exception 'an answered request cannot be withdrawn';
  end if;
  return new;
end $$;
drop trigger if exists document_requests_guard on public.document_requests;
create trigger document_requests_guard before update on public.document_requests
  for each row execute function public.guard_document_request();
revoke execute on function public.guard_document_request() from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. the clearance guard fires on every move (32)
-- It fired on insert and on an update of role only; an update of matter_id could carry a client
-- row from a cleared matter onto an unchecked one with the role untouched.
create or replace function public.guard_conflict_clearance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'client'
     and (tg_op = 'INSERT' or new.matter_id <> old.matter_id or new.role <> old.role or new.firm_id <> old.firm_id)
     and (select conflict_checks_required from firms where id = new.firm_id)
     and not conflict_cleared(new.matter_id) then
    raise exception 'this firm requires a cleared conflict check before a client joins a matter';
  end if;
  return new;
end $$;
drop trigger if exists matter_parties_conflict_clearance on public.matter_parties;
create trigger matter_parties_conflict_clearance before insert or update on public.matter_parties
  for each row execute function public.guard_conflict_clearance();

-- ---------------------------------------------------------------- 5. a pre-matter check is bound to the names it searched (32)
-- open_matter() attached any decided, unattached check of the firm. A check cleared for one
-- client then admitted another: change the client after the check, and the clearance travelled.
-- Now the check's searched keys must cover the client's name and company and every name on
-- the other side, or the call refuses and names what was not searched.
create or replace function public.open_matter(
  p_firm uuid, p_title text, p_type matter_type,
  p_client uuid default null, p_cause_title text default null, p_description text default null,
  p_court_id uuid default null, p_suit_number text default null, p_judicial_division text default null,
  p_originating_lawyer uuid default null, p_handling_lawyer uuid default null,
  p_status_key text default 'new_inquiry', p_note_to_client text default null,
  p_conflict_check uuid default null, p_adverse_parties jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text; v_status uuid; v_lead uuid; v_check conflict_checks%rowtype; v_missing text[] := '{}';
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
    -- It must have searched for the people this call admits: the client's name and company, and
    -- every name on the other side. A check cleared for somebody else clears nobody (migration 33).
    if p_client is not null then
      select coalesce(array_agg(k), '{}') into v_missing
        from (select conflict_name_key(x) as k
                from (select full_name from profiles where id = p_client
                      union all select company_name from profiles where id = p_client) t(x)) s
       where k is not null and not (v_check.query -> 'keys') ? k;
    end if;
    if p_adverse_parties is not null and jsonb_typeof(p_adverse_parties) = 'array' then
      select v_missing || coalesce(array_agg(k), '{}') into v_missing
        from (select conflict_name_key(e ->> 'name') as k from jsonb_array_elements(p_adverse_parties) e
               where length(btrim(coalesce(e ->> 'name', ''))) >= 2) s
       where k is not null and not (v_check.query -> 'keys') ? k;
    end if;
    if cardinality(v_missing) > 0 then
      raise exception 'the conflict check did not search for %: run it again', array_to_string(v_missing, ', ');
    end if;
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
