-- Practice workflow packs: a firm's stages and the work each stage starts, as versioned data.
--
-- Every firm got one status list — fifteen litigation stages hard-coded in seed_firm_defaults() —
-- whatever it practises, and a task was a row somebody typed. Now a PACK is a platform row:
-- the stages (key, label, colour, order, terminal, the next action the stage suggests) and the
-- task templates each stage starts (title, due offset, who), for the matter types it fits.
-- A pack version is immutable: publishing changes is a new version. A firm INSTALLS a version:
-- statuses it does not have are added, statuses it already has are recognised and left exactly
-- as they read — a pack never rewrites a live matter's stage or the label a client sees — and
-- the firm's ledger says which version it is on. Upgrading is installing again: adds only.
--
-- A stage change is now one act: set_matter_status() moves the matter, posts a status_change
-- entry the client reads, closes or reopens the file when the stage is terminal, materialises
-- the stage's task templates once (a template key is unique per matter, so setting a stage twice
-- never doubles the checklist), and offers the stage's next action where the slot is empty.
-- open_matter() refuses an unknown status key instead of opening the matter with none.
--
-- Docket ships two packs as its defaults, labelled as such: litigation (the fifteen stages every
-- firm already has, so an existing firm is recognised as on it) and conveyancing (for property
-- matters). They are suggestions of practice, editable and supersedable; nothing about the law
-- is claimed by them. matter_statuses and tasks are audited from here.

-- ---------------------------------------------------------------- 1. the catalogue and the ledger
create table if not exists public.workflow_packs (
  key           text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  version       int  not null check (version >= 1),
  name          text not null check (length(name) between 2 and 120),
  matter_types  matter_type[],                       -- null: every type
  definition    jsonb not null,
  note          text check (note is null or length(note) <= 1000),
  published_by  uuid references public.profiles(id) on delete set null,
  published_at  timestamptz not null default now(),
  primary key (key, version)
);
comment on table public.workflow_packs is 'A practice workflow pack, versioned and immutable: stages and the task templates each stage starts. Published by the platform; installed by firms.';
alter table public.workflow_packs enable row level security;
create policy workflow_packs_select on public.workflow_packs for select using (auth.uid() is not null);
grant select on public.workflow_packs to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.workflow_packs from anon, authenticated;

create table if not exists public.firm_workflow_packs (
  firm_id           uuid not null references public.firms(id) on delete cascade,
  pack_key          text not null,
  installed_version int  not null,
  installed_at      timestamptz not null default now(),
  installed_by      uuid references public.profiles(id) on delete set null,
  primary key (firm_id, pack_key),
  foreign key (pack_key, installed_version) references public.workflow_packs(key, version)
);
alter table public.firm_workflow_packs enable row level security;
create policy firm_workflow_packs_select on public.firm_workflow_packs for select using (is_firm_member(firm_id));
grant select on public.firm_workflow_packs to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.firm_workflow_packs from anon, authenticated;

alter table public.matter_statuses
  add column if not exists pack_key            text,
  add column if not exists pack_version        int,
  add column if not exists matter_types        matter_type[],        -- null: every type
  add column if not exists default_next_action text check (default_next_action is null or length(default_next_action) <= 500);
comment on column public.matter_statuses.matter_types is 'The matter types this stage is offered for. Null — every row that existed before migration 39 — means every type.';

alter table public.tasks
  add column if not exists template_key text,
  add column if not exists pack_key     text,
  add column if not exists status_key   text;
create unique index if not exists tasks_template_once_idx on public.tasks (matter_id, template_key) where template_key is not null;
comment on column public.tasks.template_key is 'The pack template this task came from; unique per matter, so a stage set twice never doubles the checklist.';

-- Both are audited from here. Reminder: the firm audit screen lists what is.
drop trigger if exists audit_matter_statuses on public.matter_statuses;
create trigger audit_matter_statuses after insert or update or delete on public.matter_statuses for each row execute function public.audit_row_change();
drop trigger if exists audit_tasks on public.tasks;
create trigger audit_tasks after insert or update or delete on public.tasks for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------- 2. what a pack must look like
create or replace function public.workflow_pack_definition_check(p jsonb) returns void
language plpgsql immutable set search_path = public as $$
declare s jsonb; t jsonb; v_keys text[] := '{}'; v_tkeys text[] := '{}'; k text;
begin
  if p is null or jsonb_typeof(p -> 'statuses') <> 'array' or jsonb_array_length(p -> 'statuses') = 0 then
    raise exception 'a pack has at least one stage under "statuses"';
  end if;
  for s in select * from jsonb_array_elements(p -> 'statuses') loop
    k := s ->> 'key';
    if k is null or k !~ '^[a-z0-9_]{2,60}$' then raise exception 'a stage key is lower-case letters, digits and underscores (got "%")', coalesce(k, ''); end if;
    if k = any(v_keys) then raise exception 'stage key "%" appears twice', k; end if;
    v_keys := v_keys || k;
    if length(coalesce(s ->> 'label', '')) < 2 or length(s ->> 'label') > 80 then raise exception 'stage "%" needs a label of 2 to 80 characters', k; end if;
    if s ? 'sort' and jsonb_typeof(s -> 'sort') <> 'number' then raise exception 'stage "%": sort is a number', k; end if;
    if s ? 'is_terminal' and jsonb_typeof(s -> 'is_terminal') <> 'boolean' then raise exception 'stage "%": is_terminal is true or false', k; end if;
    if s ? 'next_action' and length(coalesce(s ->> 'next_action', '')) > 500 then raise exception 'stage "%": next_action is at most 500 characters', k; end if;
    if s ? 'colour' and length(coalesce(s ->> 'colour', '')) > 20 then raise exception 'stage "%": colour is a short colour name', k; end if;
  end loop;
  if p ? 'task_templates' then
    if jsonb_typeof(p -> 'task_templates') <> 'array' then raise exception '"task_templates" is a list'; end if;
    for t in select * from jsonb_array_elements(p -> 'task_templates') loop
      k := t ->> 'key';
      if k is null or k !~ '^[a-z0-9_]{2,60}$' then raise exception 'a template key is lower-case letters, digits and underscores (got "%")', coalesce(k, ''); end if;
      if k = any(v_tkeys) then raise exception 'template key "%" appears twice', k; end if;
      v_tkeys := v_tkeys || k;
      if length(coalesce(t ->> 'title', '')) < 2 or length(t ->> 'title') > 200 then raise exception 'template "%" needs a title of 2 to 200 characters', k; end if;
      if not ((t ->> 'on_status_key') = any(v_keys)) then raise exception 'template "%" starts on stage "%", which the pack does not have', k, coalesce(t ->> 'on_status_key', ''); end if;
      if t ? 'due_offset_days' and (jsonb_typeof(t -> 'due_offset_days') <> 'number' or (t ->> 'due_offset_days')::numeric < 0 or (t ->> 'due_offset_days')::numeric > 365) then
        raise exception 'template "%": due_offset_days is 0 to 365', k;
      end if;
      if t ? 'assignee' and (t ->> 'assignee') not in ('lead', 'none') then raise exception 'template "%": assignee is lead or none', k; end if;
    end loop;
  end if;
end $$;
revoke execute on function public.workflow_pack_definition_check(jsonb) from public, anon, authenticated;

create or replace function public.publish_workflow_pack(p_key text, p_name text, p_matter_types matter_type[], p_definition jsonb, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_version int;
begin
  if not (is_platform_admin() and mfa_ok()) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_key is null or p_key !~ '^[a-z0-9_]{2,40}$' then raise exception 'a pack key is lower-case letters, digits and underscores'; end if;
  perform workflow_pack_definition_check(p_definition);
  select coalesce(max(version), 0) + 1 into v_version from workflow_packs where key = p_key;
  insert into workflow_packs (key, version, name, matter_types, definition, note, published_by)
  values (p_key, v_version, btrim(p_name), p_matter_types, p_definition, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  perform audit('workflow_pack.published', 'workflow_packs', null, null, jsonb_build_object('key', p_key, 'version', v_version, 'name', btrim(p_name), 'matter_types', p_matter_types));
  return v_version;
end $$;
revoke execute on function public.publish_workflow_pack(text, text, matter_type[], jsonb, text) from public, anon;
grant  execute on function public.publish_workflow_pack(text, text, matter_type[], jsonb, text) to authenticated;

-- The platform reads what it published (the allow-list of migration 20, last re-created in 38).
drop policy if exists audit_log_platform_select on public.audit_log;
create policy audit_log_platform_select on public.audit_log for select
  using (public.is_platform_admin() and (
    (entity = 'firm' and action in ('firm.created','firm.status','firm.domain','firm.plan'))
    or entity in ('firms','firm_members')
    or entity in ('domain_request','platform_admins','provider_rates','workflow_packs')
    or (entity in ('courts','court_vacations','public_holidays','court_rules','rule_provisions') and firm_id is null)
    or action in ('notification.retried', 'provider_rate.set')
  ));

-- ---------------------------------------------------------------- 3. installing: adds, recognises, never rewrites
create or replace function public.install_workflow_pack(p_firm uuid, p_key text, p_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pk workflow_packs%rowtype; v_installed int; v_added int := 0; v_recognised int := 0; v_other int := 0; v_rows int; s jsonb;
begin
  if not admin_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_version is null then
    select * into pk from workflow_packs where key = p_key order by version desc limit 1;
  else
    select * into pk from workflow_packs where key = p_key and version = p_version;
  end if;
  if not found then raise exception 'no such pack%', case when p_version is null then '' else ' version' end; end if;
  select installed_version into v_installed from firm_workflow_packs where firm_id = p_firm and pack_key = p_key;
  if v_installed is not null and v_installed > pk.version then raise exception 'this firm is already on version % of "%"', v_installed, pk.name; end if;
  for s in select * from jsonb_array_elements(pk.definition -> 'statuses') loop
    if exists (select 1 from matter_statuses ms where ms.firm_id = p_firm and ms.key = s ->> 'key') then
      -- Recognised: the stage the firm already has keeps its label, colour, order and reach.
      update matter_statuses set pack_key = p_key, pack_version = pk.version,
             default_next_action = coalesce(default_next_action, nullif(s ->> 'next_action', ''))
       where firm_id = p_firm and key = s ->> 'key' and (pack_key is null or pack_key = p_key);
      -- What was actually stamped, not what was looked at. A stage already claimed by another
      -- pack is left exactly as it is — which is right — but counting it as recognised told the
      -- administrator this install had touched rows it had not.
      get diagnostics v_rows = row_count;
      if v_rows > 0 then v_recognised := v_recognised + 1; else v_other := v_other + 1; end if;
    else
      -- A stage's reach is the stage's own, not the pack's. Conveyancing is a property pack, but
      -- its own note says "completed" and "closed" are shared with every other pack — and writing
      -- the pack's {property} onto them would leave set_matter_status() refusing to complete or
      -- close any litigation matter at that firm, for ever. A stage may carry `matter_types`:
      -- absent means the pack's list, and [] means every type.
      insert into matter_statuses (firm_id, key, label, colour, sort, is_terminal, pack_key, pack_version, matter_types, default_next_action)
      values (p_firm, s ->> 'key', s ->> 'label', nullif(s ->> 'colour', ''), coalesce((s ->> 'sort')::int, 0), coalesce((s ->> 'is_terminal')::boolean, false),
              p_key, pk.version,
              case when s ? 'matter_types'
                   then nullif(array(select jsonb_array_elements_text(s -> 'matter_types'))::matter_type[], '{}'::matter_type[])
                   else pk.matter_types end,
              nullif(s ->> 'next_action', ''));
      v_added := v_added + 1;
    end if;
  end loop;
  insert into firm_workflow_packs (firm_id, pack_key, installed_version, installed_by) values (p_firm, p_key, pk.version, auth.uid())
  on conflict (firm_id, pack_key) do update set installed_version = excluded.installed_version, installed_at = now(), installed_by = excluded.installed_by;
  perform audit('workflow_pack.installed', 'firm_workflow_packs', null, p_firm,
                jsonb_build_object('key', p_key, 'version', pk.version, 'from_version', v_installed, 'statuses_added', v_added, 'statuses_recognised', v_recognised, 'statuses_of_another_pack', v_other));
  return jsonb_build_object('key', p_key, 'version', pk.version, 'statuses_added', v_added, 'statuses_recognised', v_recognised, 'statuses_of_another_pack', v_other);
end $$;
revoke execute on function public.install_workflow_pack(uuid, text, int) from public, anon;
grant  execute on function public.install_workflow_pack(uuid, text, int) to authenticated;

-- ---------------------------------------------------------------- 4. a stage change is one act
-- The templates the firm's installed packs start on this stage, for this matter's type, each once.
create or replace function public.materialise_stage_tasks(p_matter uuid, p_status_key text) returns int
language plpgsql security definer set search_path = public as $$
declare m matters%rowtype; f firms%rowtype; pk record; t jsonb; n int := 0; v_lead uuid; v_today date; v_tz text; v_due timestamptz; v_ins int;
begin
  select * into m from matters where id = p_matter;
  if not found then return 0; end if;
  select * into f from firms where id = m.firm_id;
  v_tz := coalesce(f.timezone, 'Africa/Lagos');
  v_today := (now() at time zone v_tz)::date;
  select user_id into v_lead from matter_lawyers where matter_id = p_matter and is_lead limit 1;
  v_lead := coalesce(v_lead, m.handling_lawyer_id);
  for pk in select w.* from firm_workflow_packs fw join workflow_packs w on w.key = fw.pack_key and w.version = fw.installed_version
             where fw.firm_id = m.firm_id and (w.matter_types is null or m.type = any(w.matter_types)) loop
    for t in select * from jsonb_array_elements(coalesce(pk.definition -> 'task_templates', '[]'::jsonb)) x where x ->> 'on_status_key' = p_status_key loop
      -- Due at five in the afternoon, firm time, the offset in calendar days from today.
      v_due := case when t ? 'due_offset_days' then ((v_today + (t ->> 'due_offset_days')::int) + time '17:00') at time zone v_tz end;
      insert into tasks (firm_id, matter_id, assignee_id, title, due_at, status, template_key, pack_key, status_key)
      values (m.firm_id, p_matter, case when coalesce(t ->> 'assignee', 'none') = 'lead' then v_lead end, t ->> 'title', v_due, 'open', t ->> 'key', pk.key, p_status_key)
      on conflict (matter_id, template_key) where template_key is not null do nothing;
      get diagnostics v_ins = row_count;
      n := n + v_ins;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.materialise_stage_tasks(uuid, text) from public, anon, authenticated;

create or replace function public.set_matter_status(p_matter uuid, p_status_key text, p_note_to_client text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matters%rowtype; s matter_statuses%rowtype; v_prev matter_statuses%rowtype; v_tasks int; v_next boolean := false; v_tz text;
begin
  select * into m from matters where id = p_matter and deleted_at is null;
  if not found or not matter_row_w(m.firm_id, p_matter) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into s from matter_statuses where firm_id = m.firm_id and key = p_status_key;
  if not found then raise exception 'unknown status "%" — use one of the firm''s status keys', p_status_key; end if;
  if s.matter_types is not null and not (m.type = any(s.matter_types)) then
    raise exception 'the stage "%" is for % matters, and this is a % matter', s.label, array_to_string(s.matter_types, ', '), m.type;
  end if;
  if m.status_id is not null then select * into v_prev from matter_statuses where id = m.status_id; end if;
  select coalesce(timezone, 'Africa/Lagos') into v_tz from firms where id = m.firm_id;
  update matters
     set status_id = s.id,
         closed_at = case when s.is_terminal then coalesce(closed_at, (now() at time zone v_tz)::date)
                          when v_prev.is_terminal then null else closed_at end,
         next_action = case when nullif(btrim(coalesce(next_action, '')), '') is null and s.default_next_action is not null then s.default_next_action else next_action end
   where id = p_matter;
  v_next := (nullif(btrim(coalesce(m.next_action, '')), '') is null and s.default_next_action is not null);
  if m.status_id is distinct from s.id then
    insert into updates (matter_id, firm_id, kind, visibility, title, body, occurred_at, posted_by, payload)
    values (p_matter, m.firm_id, 'status_change', 'client', 'Status: ' || s.label, nullif(btrim(coalesce(p_note_to_client, '')), ''), now(), auth.uid(),
            jsonb_build_object('status_key', s.key, 'status_id', s.id, 'from_status_key', v_prev.key));
  end if;
  v_tasks := materialise_stage_tasks(p_matter, s.key);
  perform audit('matter.status_changed', 'matter', p_matter, m.firm_id,
                jsonb_build_object('from', v_prev.key, 'to', s.key, 'tasks_created', v_tasks, 'next_action_set', v_next, 'closed', s.is_terminal));
  return jsonb_build_object('status_id', s.id, 'tasks_created', v_tasks, 'next_action_set', v_next, 'closed', s.is_terminal);
end $$;
revoke execute on function public.set_matter_status(uuid, text, text) from public, anon;
grant  execute on function public.set_matter_status(uuid, text, text) to authenticated;

-- open_matter (migration 33) refused nothing about the status: an unknown key opened the matter
-- with none. Now, for a firm that has stages, it refuses, checks the stage fits the type, and
-- starts the stage's work.
create or replace function public.open_matter(
  p_firm uuid, p_title text, p_type matter_type,
  p_client uuid default null, p_cause_title text default null, p_description text default null,
  p_court_id uuid default null, p_suit_number text default null, p_judicial_division text default null,
  p_originating_lawyer uuid default null, p_handling_lawyer uuid default null,
  p_status_key text default 'new_inquiry', p_note_to_client text default null,
  p_conflict_check uuid default null, p_adverse_parties jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text; v_status matter_statuses%rowtype; v_lead uuid; v_check conflict_checks%rowtype; v_missing text[] := '{}'; v_tasks int := 0;
begin
  if not staff_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  if length(trim(coalesce(p_title, ''))) < 2 then raise exception 'matter title is required'; end if;
  if p_client is not null and not exists (select 1 from profiles where id = p_client) then raise exception 'client account not found'; end if;
  if p_client is not null and exists (select 1 from firm_members where firm_id = p_firm and user_id = p_client) then
    raise exception 'a member of the firm cannot be its client on a matter';
  end if;
  -- The signature's default, 'new_inquiry', means the firm's ENTRY stage: that key where the firm
  -- has it, else its first open stage that fits the type, else none (a firm with no stages yet
  -- opens the matter without one, as before). Any other key the firm does not have is refused.
  if p_status_key is not null then
    select * into v_status from matter_statuses where firm_id = p_firm and key = p_status_key;
    if not found and p_status_key = 'new_inquiry' then
      select * into v_status from matter_statuses
       where firm_id = p_firm and not is_terminal and (matter_types is null or p_type = any(matter_types))
       order by sort, key limit 1;
    elsif not found then
      raise exception 'unknown status "%" — use one of the firm''s status keys', p_status_key;
    end if;
    if v_status.matter_types is not null and not (p_type = any(v_status.matter_types)) then
      raise exception 'the stage "%" is for % matters, and this is a % matter', v_status.label, array_to_string(v_status.matter_types, ', '), p_type;
    end if;
  end if;
  v_lead := coalesce(p_handling_lawyer, auth.uid());
  if not exists (select 1 from firm_members where firm_id = p_firm and user_id = v_lead) then raise exception 'handling lawyer is not a member of the firm'; end if;
  if p_originating_lawyer is not null and not exists (select 1 from firm_members where firm_id = p_firm and user_id = p_originating_lawyer) then
    raise exception 'originating lawyer is not a member of the firm';
  end if;

  v_ref := next_reference(p_firm, 'matter');
  insert into matters (firm_id, reference, title, cause_title, type, status_id, description, court_id, suit_number, judicial_division,
                       originating_lawyer_id, handling_lawyer_id, created_by, next_action)
  values (p_firm, v_ref, trim(p_title), nullif(trim(coalesce(p_cause_title, '')), ''), p_type, v_status.id, p_description, p_court_id,
          nullif(trim(coalesce(p_suit_number, '')), ''), p_judicial_division, coalesce(p_originating_lawyer, v_lead), v_lead, auth.uid(), v_status.default_next_action)
  returning id into v_id;
  insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values (v_id, p_firm, v_lead, true);
  if p_adverse_parties is not null and jsonb_typeof(p_adverse_parties) = 'array' then
    insert into matter_adverse_parties (firm_id, matter_id, name, kind, aliases, created_by)
    select p_firm, v_id, btrim(e ->> 'name'),
           case when e ->> 'kind' = 'organisation' then 'organisation' else 'person' end,
           coalesce((select array_agg(btrim(a)) from jsonb_array_elements_text(coalesce(e -> 'aliases', '[]'::jsonb)) a where btrim(a) <> ''), '{}'),
           auth.uid()
      from jsonb_array_elements(p_adverse_parties) e
     where length(btrim(coalesce(e ->> 'name', ''))) >= 2;
  end if;
  if p_conflict_check is not null then
    select * into v_check from conflict_checks where id = p_conflict_check;
    if not found or v_check.firm_id <> p_firm then raise exception 'conflict check not found'; end if;
    if v_check.matter_id is not null then raise exception 'that conflict check belongs to another matter'; end if;
    if v_check.outcome is null then raise exception 'decide the conflict check before opening the matter on it'; end if;
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
  if v_status.id is not null then v_tasks := materialise_stage_tasks(v_id, v_status.key); end if;
  perform audit('matter.opened', 'matter', v_id, p_firm, jsonb_build_object('reference', v_ref, 'type', p_type, 'status_key', v_status.key, 'client', p_client, 'tasks_created', v_tasks));
  return jsonb_build_object('matter_id', v_id, 'reference', v_ref, 'tasks_created', v_tasks);
end $$;

-- ---------------------------------------------------------------- 5. Docket's two default packs, as data
insert into public.workflow_packs (key, version, name, matter_types, note, definition) values
('litigation', 1, 'Litigation', null, 'Docket''s default: the fifteen stages every firm starts with, and the work a stage starts. A firm already on these stages is recognised, not rewritten.',
 $j${"statuses": [
   {"key": "new_inquiry", "label": "New Inquiry", "colour": "slate", "sort": 10, "next_action": "Take instructions and open the file"},
   {"key": "consultation_scheduled", "label": "Consultation Scheduled", "colour": "blue", "sort": 20},
   {"key": "consultation_completed", "label": "Consultation Completed", "colour": "blue", "sort": 30, "next_action": "Send the client the advice and the fee note"},
   {"key": "awaiting_documents", "label": "Awaiting Documents", "colour": "amber", "sort": 40, "next_action": "Chase the client for the documents asked for"},
   {"key": "under_review", "label": "Under Review", "colour": "indigo", "sort": 50},
   {"key": "in_progress", "label": "In Progress", "colour": "green", "sort": 60},
   {"key": "filed", "label": "Filed in Court", "colour": "green", "sort": 65, "next_action": "Serve the process and diarise the return date"},
   {"key": "hearing", "label": "Hearing Ongoing", "colour": "green", "sort": 66},
   {"key": "judgment_reserved", "label": "Judgment Reserved", "colour": "indigo", "sort": 67, "next_action": "Diarise the judgment date and tell the client"},
   {"key": "judgment_delivered", "label": "Judgment Delivered", "colour": "indigo", "sort": 68, "next_action": "Obtain the certified true copy and advise the client on appeal within time"},
   {"key": "appeal", "label": "On Appeal", "colour": "indigo", "sort": 69},
   {"key": "awaiting_client", "label": "Awaiting Client", "colour": "amber", "sort": 70},
   {"key": "awaiting_third_party", "label": "Awaiting Third Party", "colour": "amber", "sort": 80},
   {"key": "completed", "label": "Completed", "colour": "gray", "sort": 90, "is_terminal": true},
   {"key": "closed", "label": "Closed", "colour": "gray", "sort": 100, "is_terminal": true}
 ],
 "task_templates": [
   {"key": "open_file_note", "title": "Record the instructions on the file and confirm the fee arrangement", "on_status_key": "new_inquiry", "due_offset_days": 2, "assignee": "lead"},
   {"key": "serve_process", "title": "Serve the originating process and file the affidavit of service", "on_status_key": "filed", "due_offset_days": 7, "assignee": "lead"},
   {"key": "diarise_return_date", "title": "Diarise the return date and tell the client", "on_status_key": "filed", "due_offset_days": 1},
   {"key": "witness_statements", "title": "Finalise witness statements on oath and the list of exhibits", "on_status_key": "hearing", "due_offset_days": 14, "assignee": "lead"},
   {"key": "ctc_judgment", "title": "Apply for the certified true copy of the judgment", "on_status_key": "judgment_delivered", "due_offset_days": 3, "assignee": "lead"},
   {"key": "appeal_advice", "title": "Advise the client in writing on appeal, and count the deadline on the Deadlines tab", "on_status_key": "judgment_delivered", "due_offset_days": 5, "assignee": "lead"},
   {"key": "notice_of_appeal", "title": "File the notice of appeal within time and diarise the record", "on_status_key": "appeal", "due_offset_days": 7, "assignee": "lead"},
   {"key": "close_file", "title": "Render the final account, return the client's documents and archive the file", "on_status_key": "completed", "due_offset_days": 14}
 ]}$j$::jsonb),
('conveyancing', 1, 'Conveyancing', array['property']::matter_type[], 'Docket''s default for property matters: from instructions to the registered title. Stages are offered only on property matters; "completed" and "closed" are shared with every other pack.',
 $j${"statuses": [
   {"key": "instructions_received", "label": "Instructions Received", "colour": "slate", "sort": 10, "next_action": "Obtain the vendor's title documents and the survey plan"},
   {"key": "title_search", "label": "Title Search", "colour": "blue", "sort": 20, "next_action": "Conduct the search at the Lands Registry and report to the client"},
   {"key": "contract_of_sale", "label": "Contract of Sale", "colour": "indigo", "sort": 30, "next_action": "Settle the contract of sale and the deposit"},
   {"key": "deed_executed", "label": "Deed Executed", "colour": "green", "sort": 40, "next_action": "Have the deed of assignment executed by both parties"},
   {"key": "governors_consent", "label": "Governor's Consent", "colour": "amber", "sort": 50, "next_action": "Lodge the application for consent and pay the fees"},
   {"key": "stamping", "label": "Stamping", "colour": "amber", "sort": 60, "next_action": "Stamp the deed at the Stamp Duties office"},
   {"key": "registration", "label": "Registration", "colour": "green", "sort": 70, "next_action": "Register the deed and collect the registered title"},
   {"key": "completed", "label": "Completed", "colour": "gray", "sort": 90, "is_terminal": true, "matter_types": []},
   {"key": "closed", "label": "Closed", "colour": "gray", "sort": 100, "is_terminal": true, "matter_types": []}
 ],
 "task_templates": [
   {"key": "collect_title_docs", "title": "Collect the vendor's title documents, survey plan and identification", "on_status_key": "instructions_received", "due_offset_days": 3, "assignee": "lead"},
   {"key": "registry_search", "title": "Conduct the search at the Lands Registry", "on_status_key": "title_search", "due_offset_days": 5, "assignee": "lead"},
   {"key": "search_report", "title": "Write the search report and advise the client on the root of title", "on_status_key": "title_search", "due_offset_days": 7, "assignee": "lead"},
   {"key": "draft_contract", "title": "Draft the contract of sale and agree the deposit terms", "on_status_key": "contract_of_sale", "due_offset_days": 5, "assignee": "lead"},
   {"key": "deed_execution", "title": "Prepare the deed of assignment for execution by both parties", "on_status_key": "deed_executed", "due_offset_days": 5, "assignee": "lead"},
   {"key": "consent_application", "title": "Lodge the application for Governor's consent with the deed and supporting documents", "on_status_key": "governors_consent", "due_offset_days": 7, "assignee": "lead"},
   {"key": "consent_fees", "title": "Pay the consent, charting and endorsement fees and keep the receipts on the file", "on_status_key": "governors_consent", "due_offset_days": 7},
   {"key": "stamp_deed", "title": "Present the deed for stamping and keep the stamped copy", "on_status_key": "stamping", "due_offset_days": 5},
   {"key": "register_deed", "title": "Register the deed at the Lands Registry", "on_status_key": "registration", "due_offset_days": 10, "assignee": "lead"},
   {"key": "deliver_title", "title": "Deliver the registered title to the client and render the final account", "on_status_key": "registration", "due_offset_days": 14, "assignee": "lead"}
 ]}$j$::jsonb)
on conflict (key, version) do nothing;
do $$ begin perform public.workflow_pack_definition_check(definition) from public.workflow_packs; end $$;
