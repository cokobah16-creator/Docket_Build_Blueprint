-- Matter walls: a firm may restrict a matter to its team, and the restriction is the database's.
--
-- Inside a firm every SELECT policy on matter content bottomed out in is_firm_member(firm_id), and
-- lawyer and staff had identical rights. That is a product stance — every partner sees the whole
-- firm — and it stays the default. This migration adds the opt-in: a firm switches walls on
-- (firms.matter_walls), and a member of a matter's team sets that matter to access = 'team'. From
-- then on the matter and everything hanging off it — documents and their bytes, updates,
-- messages and receipts, tasks, court events, parties, court numbers, counsel, process served,
-- invoices — is readable and writable only by the team (matter_lawyers). Owners and admins are not
-- exempt: a wall that partners can walk through is not a wall. The client on the matter sees what
-- they always saw.
--
-- ONE FUNCTION. can_see_matter(m) is logically identical to is_firm_member(firm_id) for every row
-- that exists today (access = 'firm' short-circuits), which is why every existing check keeps
-- passing. Two wrappers carry it into policies whose matter_id may be null — an appointment
-- thread, a firm-level task — where the firm-wide test still applies.
--
-- BOTH DOORS. A policy edit alone would leave the SECURITY DEFINER functions open: they bypass
-- RLS and looked a matter up by id, guarding only staff_w(firm). Each one that takes a matter is
-- re-created below from its current definition with can_see_matter() in its guard. The storage
-- policies call can_access_document(), so the wall reaches the object bytes through the same edit.
--
-- THE SWITCH IS HONEST BOTH WAYS. access = 'team' is refused while the firm's walls are off, and
-- switching walls off is refused while any matter is still 'team' — open them first, one by one,
-- so nobody's file is quietly opened to the whole firm by a checkbox.

-- ================================================================ 1. the switch and the flag
alter table public.firms add column matter_walls boolean not null default false;
comment on column public.firms.matter_walls is 'Opt-in: may this firm restrict a matter to its team? Off: every matter is pooled, as the default stance. Refused to switch off while any matter is still restricted.';

alter table public.matters add column access text not null default 'firm' check (access in ('firm', 'team'));
comment on column public.matters.access is 'firm: every member of the firm (the default). team: only matter_lawyers, owners and admins included — a wall partners can walk through is not a wall.';

create index if not exists matter_lawyers_user_idx on public.matter_lawyers (user_id, matter_id);

-- ================================================================ 2. the predicate
create or replace function public.can_see_matter(m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matters mt
     where mt.id = m
       and is_firm_member(mt.firm_id)
       and (mt.access = 'firm'
            or exists (select 1 from matter_lawyers ml where ml.matter_id = mt.id and ml.user_id = auth.uid())))
$$;
-- A row that may or may not hang off a matter: the wall when it does, the firm-wide test when not.
create or replace function public.matter_row_r(f uuid, m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when m is null then is_firm_member(f) else can_see_matter(m) end
$$;
create or replace function public.matter_row_w(f uuid, m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select staff_w(f) and (m is null or can_see_matter(m))
$$;
revoke execute on function public.can_see_matter(uuid) from public;
revoke execute on function public.matter_row_r(uuid, uuid) from public;
revoke execute on function public.matter_row_w(uuid, uuid) from public;
grant execute on function public.can_see_matter(uuid), public.matter_row_r(uuid, uuid), public.matter_row_w(uuid, uuid) to anon, authenticated;

-- ================================================================ 3. the guards
-- Restricting a matter needs the firm's switch on, and the person restricting it must already be
-- on its team — otherwise a lawyer could wall a file and lock themselves out of it. A matter is
-- opened firm-wide and restricted afterwards, once its team is set; the console does both in
-- that order. (An AFTER trigger cannot put the caller on the team for them: the row-level check
-- on the update runs first and would refuse it.)
create or replace function public.guard_matter_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.access = 'team' and (tg_op = 'INSERT' or old.access <> 'team') then
    if tg_op = 'INSERT' then
      raise exception 'a matter is opened firm-wide; set its team, then restrict it' using errcode = '42501';
    end if;
    if not exists (select 1 from firms f where f.id = new.firm_id and f.matter_walls) then
      raise exception 'this firm has not switched on matter walls — an owner or admin does that under Settings' using errcode = '42501';
    end if;
    if auth.uid() is not null and not exists (select 1 from matter_lawyers ml where ml.matter_id = new.id and ml.user_id = auth.uid()) then
      raise exception 'put yourself on the matter''s team before restricting it — a wall you are outside of would lock you out' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists matters_guard_access on public.matters;
create trigger matters_guard_access before insert or update of access on public.matters
  for each row execute function public.guard_matter_access();

-- The last person inside a wall cannot leave it: nobody could open the file again.
create or replace function public.guard_matter_team() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from matters mt where mt.id = old.matter_id and mt.access = 'team')
     and not exists (select 1 from matter_lawyers ml where ml.matter_id = old.matter_id and ml.user_id <> old.user_id) then
    raise exception 'this is the last member of a restricted matter''s team — set the matter to firm-wide first, or add someone else' using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists matter_lawyers_guard_team on public.matter_lawyers;
create trigger matter_lawyers_guard_team before delete on public.matter_lawyers
  for each row execute function public.guard_matter_team();

-- Walls cannot be switched off over restricted matters.
create or replace function public.guard_firm_walls() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.matter_walls and not new.matter_walls
     and exists (select 1 from matters mt where mt.firm_id = new.id and mt.access = 'team' and mt.deleted_at is null) then
    raise exception 'some matters are still restricted to their teams — open them first, one by one' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists firms_guard_walls on public.firms;
create trigger firms_guard_walls before update of matter_walls on public.firms
  for each row execute function public.guard_firm_walls();

revoke execute on function public.guard_matter_access() from public, anon, authenticated;
revoke execute on function public.guard_matter_team()   from public, anon, authenticated;
revoke execute on function public.guard_firm_walls()    from public, anon, authenticated;

-- ================================================================ 4. the policies
-- matters. The wall is written out inline here rather than through can_see_matter(id): that
-- function reads the matters row, and a stable function sees the statement's starting snapshot,
-- in which a row being INSERTed ... RETURNING does not yet exist — so every insert-and-return of
-- a matter would be refused as "not visible". Evaluated on the row itself, it is the same test.
drop policy matters_select on public.matters;
create policy matters_select on public.matters for select
  using ((is_firm_member(firm_id)
          and (access = 'firm' or exists (select 1 from public.matter_lawyers ml where ml.matter_id = matters.id and ml.user_id = (select auth.uid()))))
         or (deleted_at is null and is_matter_party(id)));
-- The write policies are inlined for the same reason; USING reads the row as it is, WITH CHECK
-- the row as it will be, so restricting a matter requires being on its team already.
drop policy matters_write_upd on public.matters;
create policy matters_write_upd on public.matters for update
  using (staff_w(firm_id) and (access = 'firm' or exists (select 1 from public.matter_lawyers ml where ml.matter_id = matters.id and ml.user_id = (select auth.uid()))))
  with check (staff_w(firm_id) and (access = 'firm' or exists (select 1 from public.matter_lawyers ml where ml.matter_id = matters.id and ml.user_id = (select auth.uid()))));
drop policy matters_write_del on public.matters;
create policy matters_write_del on public.matters for delete
  using (staff_w(firm_id) and (access = 'firm' or exists (select 1 from public.matter_lawyers ml where ml.matter_id = matters.id and ml.user_id = (select auth.uid()))));

-- documents: the three helpers reach the rows, the versions and — through the storage policies — the bytes
CREATE OR REPLACE FUNCTION public.can_access_document(d uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (
       select 1 from documents doc
       where doc.id = d
         and ( public.matter_row_r(doc.firm_id, doc.matter_id)
            or (doc.client_visible and doc.deleted_at is null
                and (public.is_matter_party(doc.matter_id) or public.is_appointment_client(doc.appointment_id))) ) ) $function$;
CREATE OR REPLACE FUNCTION public.can_access_document_version(v uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (
       select 1 from document_versions dv join documents doc on doc.id = dv.document_id
       where dv.id = v
         and ( public.matter_row_r(doc.firm_id, doc.matter_id)
            or (doc.client_visible and doc.deleted_at is null
                and (public.is_matter_party(doc.matter_id) or public.is_appointment_client(doc.appointment_id)))
            or exists (select 1 from process_service ps where ps.document_version_id = dv.id and public.is_served_firm(ps.id)) ) ) $function$;
CREATE OR REPLACE FUNCTION public.can_upload_document(d uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (
       select 1 from documents doc
       where doc.id = d and doc.deleted_at is null
         and ( public.matter_row_w(doc.firm_id, doc.matter_id)
            or (doc.client_visible
                and (public.is_matter_party(doc.matter_id) or public.is_appointment_client(doc.appointment_id))) ) ) $function$;

drop policy documents_staff_insert on public.documents;
create policy documents_staff_insert on public.documents for insert
  with check (matter_row_w(firm_id, matter_id) and uploaded_by = (select auth.uid()));
drop policy documents_staff_modify on public.documents;
create policy documents_staff_modify on public.documents for update using (matter_row_w(firm_id, matter_id)) with check (matter_row_w(firm_id, matter_id));

-- updates (the client's own select policy is untouched)
drop policy updates_staff_select on public.updates;
create policy updates_staff_select on public.updates for select using (matter_row_r(firm_id, matter_id));
drop policy updates_insert on public.updates;
create policy updates_insert on public.updates for insert
  with check (matter_row_w(firm_id, matter_id) and posted_by = (select auth.uid()));
drop policy updates_modify on public.updates;
create policy updates_modify on public.updates for update
  using (((posted_by = (select auth.uid()) and staff_w(firm_id)) or admin_w(firm_id)) and can_see_matter(matter_id))
  with check (((posted_by = (select auth.uid()) and staff_w(firm_id)) or admin_w(firm_id)) and can_see_matter(matter_id));
drop policy updates_delete on public.updates;
create policy updates_delete on public.updates for delete using (admin_w(firm_id) and can_see_matter(matter_id));

-- messages and receipts (appointment threads have no matter and keep the firm-wide test)
drop policy messages_select on public.messages;
create policy messages_select on public.messages for select
  using (matter_row_r(firm_id, matter_id) or is_matter_party(matter_id) or is_appointment_client(appointment_id));
drop policy messages_insert on public.messages;
create policy messages_insert on public.messages for insert
  with check (sender_id = (select auth.uid()) and (matter_row_w(firm_id, matter_id) or is_matter_party(matter_id) or is_appointment_client(appointment_id)));
drop policy messages_mark_read on public.messages;
create policy messages_mark_read on public.messages for update
  using (matter_row_r(firm_id, matter_id) or is_matter_party(matter_id) or is_appointment_client(appointment_id))
  with check (matter_row_r(firm_id, matter_id) or is_matter_party(matter_id) or is_appointment_client(appointment_id));
drop policy message_reads_select on public.message_reads;
create policy message_reads_select on public.message_reads for select
  using (user_id = (select auth.uid())
         or exists (select 1 from public.messages m where m.id = message_id and matter_row_r(m.firm_id, m.matter_id)));

-- tasks (a firm-level task has no matter and stays pooled)
drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select using (matter_row_r(firm_id, matter_id));
drop policy tasks_write_ins on public.tasks;
create policy tasks_write_ins on public.tasks for insert with check (matter_row_w(firm_id, matter_id));
drop policy tasks_write_upd on public.tasks;
create policy tasks_write_upd on public.tasks for update using (matter_row_w(firm_id, matter_id)) with check (matter_row_w(firm_id, matter_id));
drop policy tasks_write_del on public.tasks;
create policy tasks_write_del on public.tasks for delete using (matter_row_w(firm_id, matter_id));

-- court events
drop policy court_events_select on public.court_events;
create policy court_events_select on public.court_events for select using (matter_row_r(firm_id, matter_id) or is_matter_party(matter_id));
drop policy court_events_write_ins on public.court_events;
create policy court_events_write_ins on public.court_events for insert with check (matter_row_w(firm_id, matter_id));
drop policy court_events_write_upd on public.court_events;
create policy court_events_write_upd on public.court_events for update using (matter_row_w(firm_id, matter_id)) with check (matter_row_w(firm_id, matter_id));
drop policy court_events_write_del on public.court_events;
create policy court_events_write_del on public.court_events for delete using (matter_row_w(firm_id, matter_id));

-- parties, court numbers, team, counsel
drop policy matter_parties_select on public.matter_parties;
create policy matter_parties_select on public.matter_parties for select using (user_id = (select auth.uid()) or matter_row_r(firm_id, matter_id));
drop policy matter_parties_write_ins on public.matter_parties;
create policy matter_parties_write_ins on public.matter_parties for insert with check (matter_row_w(firm_id, matter_id));
drop policy matter_parties_write_upd on public.matter_parties;
create policy matter_parties_write_upd on public.matter_parties for update using (matter_row_w(firm_id, matter_id)) with check (matter_row_w(firm_id, matter_id));
drop policy matter_parties_write_del on public.matter_parties;
create policy matter_parties_write_del on public.matter_parties for delete using (matter_row_w(firm_id, matter_id));

drop policy matter_court_numbers_select on public.matter_court_numbers;
create policy matter_court_numbers_select on public.matter_court_numbers for select using (matter_row_r(firm_id, matter_id) or is_matter_party(matter_id));
drop policy matter_court_numbers_write_ins on public.matter_court_numbers;
create policy matter_court_numbers_write_ins on public.matter_court_numbers for insert with check (matter_row_w(firm_id, matter_id));
drop policy matter_court_numbers_write_upd on public.matter_court_numbers;
create policy matter_court_numbers_write_upd on public.matter_court_numbers for update using (matter_row_w(firm_id, matter_id)) with check (matter_row_w(firm_id, matter_id));
drop policy matter_court_numbers_write_del on public.matter_court_numbers;
create policy matter_court_numbers_write_del on public.matter_court_numbers for delete using (matter_row_w(firm_id, matter_id));

drop policy matter_lawyers_select on public.matter_lawyers;
create policy matter_lawyers_select on public.matter_lawyers for select using (matter_row_r(firm_id, matter_id) or is_matter_party(matter_id));
drop policy matter_lawyers_write_ins on public.matter_lawyers;
create policy matter_lawyers_write_ins on public.matter_lawyers for insert with check (matter_row_w(firm_id, matter_id));
drop policy matter_lawyers_write_upd on public.matter_lawyers;
create policy matter_lawyers_write_upd on public.matter_lawyers for update using (matter_row_w(firm_id, matter_id)) with check (matter_row_w(firm_id, matter_id));
drop policy matter_lawyers_write_del on public.matter_lawyers;
create policy matter_lawyers_write_del on public.matter_lawyers for delete using (matter_row_w(firm_id, matter_id));

drop policy matter_counsel_select on public.matter_counsel;
create policy matter_counsel_select on public.matter_counsel for select using (matter_row_r(firm_id, matter_id));
drop policy matter_counsel_insert on public.matter_counsel;
create policy matter_counsel_insert on public.matter_counsel for insert with check (matter_row_w(firm_id, matter_id) and created_by = (select auth.uid()));
drop policy matter_counsel_modify on public.matter_counsel;
create policy matter_counsel_modify on public.matter_counsel for update using (matter_row_w(firm_id, matter_id)) with check (matter_row_w(firm_id, matter_id));
drop policy matter_counsel_delete on public.matter_counsel;
create policy matter_counsel_delete on public.matter_counsel for delete using (matter_row_w(firm_id, matter_id));

-- process served (the served firm's read path is service_inbox, untouched)
drop policy process_service_select on public.process_service;
create policy process_service_select on public.process_service for select using (matter_row_r(firm_id, matter_id));
drop policy process_service_modify on public.process_service;
create policy process_service_modify on public.process_service for update using (matter_row_w(firm_id, matter_id)) with check (matter_row_w(firm_id, matter_id));

-- invoices and their lines
drop policy invoices_select on public.invoices;
create policy invoices_select on public.invoices for select
  using (matter_row_r(firm_id, matter_id) or (client_id = (select auth.uid()) and status <> 'draft'::invoice_status));
drop policy invoices_write_ins on public.invoices;
create policy invoices_write_ins on public.invoices for insert with check (matter_row_w(firm_id, matter_id));
drop policy invoices_write_upd on public.invoices;
create policy invoices_write_upd on public.invoices for update using (matter_row_w(firm_id, matter_id)) with check (matter_row_w(firm_id, matter_id));
drop policy invoices_write_del on public.invoices;
create policy invoices_write_del on public.invoices for delete using (matter_row_w(firm_id, matter_id));
drop policy invoice_items_write_ins on public.invoice_items;
create policy invoice_items_write_ins on public.invoice_items for insert
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and matter_row_w(i.firm_id, i.matter_id)));
drop policy invoice_items_write_upd on public.invoice_items;
create policy invoice_items_write_upd on public.invoice_items for update
  using (exists (select 1 from public.invoices i where i.id = invoice_id and matter_row_w(i.firm_id, i.matter_id)))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and matter_row_w(i.firm_id, i.matter_id)));
drop policy invoice_items_write_del on public.invoice_items;
create policy invoice_items_write_del on public.invoice_items for delete
  using (exists (select 1 from public.invoices i where i.id = invoice_id and matter_row_w(i.firm_id, i.matter_id)));

-- ================================================================ 5. the other door: the definer functions
-- Each re-created from its current definition with can_see_matter() in the guard. create or
-- replace keeps every grant.
CREATE OR REPLACE FUNCTION public.post_court_update(p_matter uuid, p_outcome text, p_occurred_at timestamp with time zone DEFAULT now(), p_court_name text DEFAULT NULL::text, p_adjourned_at_instance_of text DEFAULT NULL::text, p_next_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_next_purpose text DEFAULT NULL::text, p_note_to_client text DEFAULT NULL::text, p_internal_note text DEFAULT NULL::text, p_court_id uuid DEFAULT NULL::uuid, p_judicial_division text DEFAULT NULL::text, p_allow_non_sitting boolean DEFAULT false, p_judge text DEFAULT NULL::text, p_courtroom text DEFAULT NULL::text, p_purpose_kind text DEFAULT NULL::text, p_meaning text DEFAULT NULL::text, p_next_step text DEFAULT NULL::text, p_client_action text DEFAULT NULL::text, p_action_required boolean DEFAULT NULL::boolean, p_next_update_by date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_m matters%rowtype; v_tz text := 'Africa/Lagos'; v_title text; v_update uuid; v_next_txt text; v_court courts%rowtype; v_court_name text;
begin
  select * into v_m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  if not (staff_w(v_m.firm_id) and can_see_matter(v_m.id)) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_outcome not in ('hearing_held','adjourned','ruling_delivered','judgment_delivered','struck_out','stood_down','mention',
                       'court_did_not_sit','hearing_notice','adjourned_sine_die') then
    raise exception 'unknown outcome %', p_outcome;
  end if;
  if p_outcome = 'hearing_notice' and p_next_date is null then raise exception 'a hearing notice fixes a date'; end if;
  -- The structured client update: a stated "nothing needed" and a stated action are different
  -- facts, and neither may contradict the other. Unstated (null) is allowed and is shown as such.
  if p_action_required is true and nullif(trim(p_client_action), '') is null then
    raise exception 'say what the client must do, or mark that nothing is needed from them';
  end if;
  if p_action_required is false and nullif(trim(p_client_action), '') is not null then
    raise exception 'nothing is needed from the client, so leave what they must do empty';
  end if;

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

  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by,
                       meaning, next_step, client_action, action_required, next_update_by)
  values (p_matter, v_m.firm_id, 'court_sitting', 'client', v_title, p_note_to_client,
          jsonb_build_object('outcome', p_outcome, 'court_name', v_court_name, 'court_id', v_court.id,
                             'adjourned_at_instance_of', p_adjourned_at_instance_of,
                             'next_date', p_next_date, 'next_purpose', p_next_purpose, 'judge', p_judge, 'courtroom', p_courtroom),
          p_occurred_at, auth.uid(),
          nullif(trim(p_meaning), ''), nullif(trim(p_next_step), ''), nullif(trim(p_client_action), ''), p_action_required, p_next_update_by)
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
end $function$;
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
CREATE OR REPLACE FUNCTION public.serve_process(p_matter uuid, p_counsel uuid, p_document uuid, p_process_title text, p_method service_method, p_served_at timestamp with time zone DEFAULT now(), p_note text DEFAULT NULL::text, p_is_originating boolean DEFAULT false, p_substituted_by_order boolean DEFAULT false, p_authority_document uuid DEFAULT NULL::uuid, p_served_on_name text DEFAULT NULL::text, p_served_on_capacity text DEFAULT NULL::text, p_served_at_address text DEFAULT NULL::text, p_server_name text DEFAULT NULL::text, p_outside_issuing_state boolean DEFAULT false, p_deemed_served_on date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_m matters%rowtype; v_c matter_counsel%rowtype; v_d documents%rowtype; v_ver document_versions%rowtype;
        v_id uuid; v_firm firms%rowtype; v_to text; v_when timestamptz; v_target firms%rowtype; v_served_firm uuid;
        v_scn text;
begin
  select * into v_m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  if not (staff_w(v_m.firm_id) and can_see_matter(v_m.id)) then raise exception 'not permitted' using errcode = '42501'; end if;
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
end $function$;
CREATE OR REPLACE FUNCTION public.vacate_court_event(p_event uuid, p_reason text, p_new_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_new_purpose text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_e court_events%rowtype; v_new uuid; v_m matters%rowtype; v_court courts%rowtype; v_title text;
begin
  select * into v_e from court_events where id = p_event for update;
  if not found then raise exception 'court event not found'; end if;
  if not (staff_w(v_e.firm_id) and can_see_matter(v_e.matter_id)) then raise exception 'not permitted' using errcode = '42501'; end if;
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
end $function$;
CREATE OR REPLACE FUNCTION public.create_invoice(p_firm uuid, p_client uuid, p_items jsonb, p_matter uuid DEFAULT NULL::uuid, p_currency currency DEFAULT NULL::currency, p_due_on date DEFAULT NULL::date, p_issue boolean DEFAULT false, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_firm firms%rowtype; v_cur currency; v_item jsonb; v_sub bigint := 0; v_vat bigint := 0;
        v_total bigint; v_no text; v_id uuid; v_qty numeric; v_unit bigint; v_n int := 0;
begin
  select * into v_firm from firms where id = p_firm;
  if not found then raise exception 'firm not found'; end if;
  if not (staff_w(p_firm) and (p_matter is null or can_see_matter(p_matter))) then raise exception 'not permitted' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'an invoice needs at least one item';
  end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'too many items'; end if;
  if not exists (select 1 from profiles where id = p_client) then raise exception 'client account not found'; end if;
  if p_matter is not null then
    if not exists (select 1 from matters where id = p_matter and firm_id = p_firm and deleted_at is null) then
      raise exception 'matter not found in this firm';
    end if;
    -- Issuing files a client-visible fee entry on the matter, so the person billed has to be
    -- on it: otherwise the matter's parties read another client's invoice, and the client
    -- billed is sent to a file they cannot open.
    if not exists (select 1 from matter_parties mp where mp.matter_id = p_matter and mp.user_id = p_client) then
      raise exception 'the client billed must be a party to that matter — invite them to it first, or raise the invoice without a matter';
    end if;
  end if;
  v_cur := coalesce(p_currency, v_firm.default_currency);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty  := coalesce((v_item ->> 'quantity')::numeric, 1);
    v_unit := (v_item ->> 'unit_minor')::bigint;
    if v_unit is null or v_unit < 0 then raise exception 'each item needs a unit amount of zero or more'; end if;
    if v_qty <= 0 then raise exception 'each item needs a quantity above zero'; end if;
    if length(trim(coalesce(v_item ->> 'description', ''))) = 0 then raise exception 'each item needs a description'; end if;
    v_sub := v_sub + round(v_unit * v_qty);
    v_n := v_n + 1;
  end loop;
  if v_sub <= 0 then raise exception 'an invoice must come to more than zero'; end if;

  v_vat   := round(v_sub * coalesce(v_firm.vat_rate, 0) / 100.0);
  v_total := v_sub + v_vat;
  v_no    := next_reference(p_firm, 'invoice');

  insert into invoices (firm_id, number, client_id, matter_id, currency, subtotal_minor, vat_minor, total_minor,
                        status, issued_at, due_at)
  values (p_firm, v_no, p_client, p_matter, v_cur, v_sub, v_vat, v_total,
          case when p_issue then 'issued'::invoice_status else 'draft'::invoice_status end,
          case when p_issue then now() end, p_due_on)
  returning id into v_id;

  insert into invoice_items (invoice_id, description, quantity, unit_minor)
  select v_id, trim(i ->> 'description'), coalesce((i ->> 'quantity')::numeric, 1), (i ->> 'unit_minor')::bigint
  from jsonb_array_elements(p_items) i;

  if p_issue then
    perform enqueue_notification(p_client, p_firm, 'invoice_issued',
      jsonb_build_object('invoice_id', v_id, 'invoice_number', v_no, 'amount_minor', v_total,
                         'currency', v_cur, 'due_at', p_due_on, 'matter_id', p_matter, 'note', p_note));
    if p_matter is not null then
      insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
      values (p_matter, p_firm, 'fee', 'client', format('Invoice %s issued', v_no), p_note,
              jsonb_build_object('invoice_id', v_id, 'amount_minor', v_total, 'currency', v_cur), now(), auth.uid());
    end if;
  end if;

  perform audit('invoice.created', 'invoice', v_id, p_firm,
                jsonb_build_object('number', v_no, 'total_minor', v_total, 'currency', v_cur, 'items', v_n, 'issued', p_issue));
  return jsonb_build_object('invoice_id', v_id, 'number', v_no, 'subtotal_minor', v_sub,
                            'vat_minor', v_vat, 'total_minor', v_total, 'currency', v_cur,
                            'status', case when p_issue then 'issued' else 'draft' end);
end $function$;
CREATE OR REPLACE FUNCTION public.mark_thread_read(p_matter uuid DEFAULT NULL::uuid, p_appointment uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_firm uuid; v_member bool; n integer := 0;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_matter is null and p_appointment is null then return 0; end if;

  if p_matter is not null then
    select firm_id into v_firm from matters where id = p_matter and deleted_at is null;
    if v_firm is null or not (can_see_matter(p_matter) or is_matter_party(p_matter)) then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  else
    select firm_id into v_firm from appointments where id = p_appointment;
    if v_firm is null or not (is_firm_member(v_firm) or is_appointment_client(p_appointment)) then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  end if;
  v_member := is_firm_member(v_firm);

  insert into message_reads (message_id, user_id)
  select m.id, v_uid
    from messages m
   where m.firm_id = v_firm
     and ((p_matter is not null and m.matter_id = p_matter) or (p_appointment is not null and m.appointment_id = p_appointment))
     and m.reads_tracked
     and m.sender_id is distinct from v_uid
     and exists (select 1 from firm_members fm where fm.firm_id = m.firm_id and fm.user_id = m.sender_id) <> v_member
  on conflict do nothing;
  get diagnostics n = row_count;

  update messages m
     set read_at = now()
   where m.firm_id = v_firm
     and ((p_matter is not null and m.matter_id = p_matter) or (p_appointment is not null and m.appointment_id = p_appointment))
     and m.read_at is null
     and m.sender_id is distinct from v_uid
     and exists (select 1 from firm_members fm where fm.firm_id = m.firm_id and fm.user_id = m.sender_id) <> v_member;

  return n;
end $function$;
CREATE OR REPLACE FUNCTION public.link_service_to_matter(p_service uuid, p_matter uuid, p_response_due_on date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s process_service%rowtype; v_m matters%rowtype;
begin
  select * into v_s from process_service where id = p_service for update;
  if not found then raise exception 'service record not found'; end if;
  if v_s.served_firm_id is null or not (staff_w(v_s.served_firm_id) and can_see_matter(p_matter)) then raise exception 'not permitted' using errcode = '42501'; end if;
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
end $function$;

comment on function public.can_see_matter(uuid) is
  'The wall. Identical to is_firm_member(firm_id) while matters.access = ''firm''; only matter_lawyers when ''team''. Every matter-content policy and every matter-scoped definer function asks it.';
