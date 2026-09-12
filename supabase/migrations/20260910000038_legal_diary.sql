-- The legal diary knows where a date came from, and a deadline is computed, shown and confirmed.
--
-- A court date carried one self-declared word about its origin: 'firm' or 'hearing_notice',
-- chosen by the outcome chip a lawyer pressed. Nothing recorded who entered it, when, or the
-- notice it came from, so a date from the court and a date from a lawyer's memory looked the
-- same. Now every court_events row records who made it and when, may carry the notice it came
-- from (a document on the matter, or a reference such as a cause-list date), and the cause list
-- says whether a court-originated date is EVIDENCED — a chip is a claim, a document is evidence.
--
-- A deadline was a date somebody typed. Now the platform keeps the rules of court it has entered
-- (court_rules, rule_provisions — name, citation, version, the days and how they are counted),
-- and a deadline is a row that names its triggering event and day, the court and jurisdiction it
-- was counted in, the provision and the version of the rule as it read, the calculation day by
-- day (what was skipped and why, what was rolled and why, and what reference data the count
-- relied on — an empty vacation calendar is said, not assumed), the day it falls due, and the
-- lawyer who confirmed it. The database counts; a lawyer decides. A deadline is proposed until
-- an owner, admin or lawyer confirms it, and it is never edited: a change is a new row that
-- supersedes the old, and a deadline that no longer applies is discharged with a note.
--
-- Time under the rules and the court sitting are different questions: is_non_sitting_day() says
-- whether the court sits; is_time_stopped() says whether a vacation stops time
-- (court_vacations.time_runs, recorded since migration 12 and read here for the first time).
-- A provision says which it cares about.
--
-- Deadlines are the firm's work product: staff who can see the matter read them; a client never
-- does. Nothing is seeded — a rule comes from the Rules of Court as the platform enters it, with
-- its citation and version, and the calculation records that it relied on nothing that is not there.

-- ---------------------------------------------------------------- 1. where a court date came from
alter table public.court_events
  add column if not exists created_at         timestamptz,
  add column if not exists created_by         uuid references public.profiles(id) on delete set null,
  add column if not exists source_document_id uuid references public.documents(id) on delete set null,
  add column if not exists source_ref         text check (source_ref is null or length(source_ref) <= 200),
  add column if not exists confirmed_by       uuid references public.profiles(id) on delete set null,
  add column if not exists confirmed_at       timestamptz;
alter table public.court_events alter column created_at set default now();
comment on column public.court_events.created_at is 'When the row was made. Null on rows older than migration 38: not recorded, not guessed.';
comment on column public.court_events.source_document_id is 'The hearing notice or cause-list page this date came from, as a document on the matter. A court-originated date without one is a claim, not evidence.';

create or replace function public.court_events_provenance() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_at := coalesce(new.created_at, now());
  end if;
  if new.source_document_id is not null and not exists (select 1 from documents d where d.id = new.source_document_id and d.matter_id = new.matter_id and d.deleted_at is null) then
    raise exception 'the source document must be a document on this matter';
  end if;
  return new;
end $$;
drop trigger if exists court_events_provenance on public.court_events;
create trigger court_events_provenance before insert or update on public.court_events
  for each row execute function public.court_events_provenance();

-- The diary is audited from here: a date made, moved, vacated, closed or evidenced leaves a line
-- the firm can read. Reminder stamps do not (that is the cron's own bookkeeping).
drop trigger if exists audit_court_events on public.court_events;
create trigger audit_court_events after insert or delete or update of scheduled_at, court_id, court_name, purpose, purpose_kind, source, source_document_id, source_ref, created_by, confirmed_by, confirmed_at, vacated_at, outcome_update_id
  on public.court_events for each row execute function public.audit_row_change();

-- The provenance is the RPC's to write, not the API's. attach_court_event_source() forces
-- confirmed_by = auth.uid(), and beside it court_events carried a whole-row update grant — the
-- door-beside-a-door the firm_members and invoices holes were. So a member could set confirmed_by
-- to a partner, or set source and source_ref by hand and flip firm_cause_list.evidenced to true
-- with no document on file, making the diary say a date was confirmed by somebody who never saw
-- it. The columns a lawyer legitimately edits stay; the evidence does not.
revoke insert, update on public.court_events from anon, authenticated;
grant  insert (id, matter_id, firm_id, scheduled_at, court_id, court_name, courtroom, purpose, purpose_kind) on public.court_events to authenticated;
grant  update (scheduled_at, court_id, court_name, courtroom, purpose, purpose_kind, vacated_at) on public.court_events to authenticated;

-- Attach the evidence: the notice or cause-list page this date came from, and the reference on
-- it. Whoever attaches it confirms the date. Staff who can write the matter (the wall applies).
create or replace function public.attach_court_event_source(p_event uuid, p_document uuid default null, p_ref text default null, p_source text default null)
returns void language plpgsql security definer set search_path = public as $$
declare e court_events%rowtype;
begin
  select * into e from court_events where id = p_event for update;
  if not found or not matter_row_w(e.firm_id, e.matter_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_document is null and nullif(btrim(coalesce(p_ref, '')), '') is null then raise exception 'attach a document, a reference, or both'; end if;
  if p_source is not null and p_source not in ('hearing_notice', 'cause_list') then raise exception 'a source is hearing_notice or cause_list'; end if;
  -- A typed reference is a claim; only a document is evidence. Promoting 'firm' (we entered this
  -- date) to 'hearing_notice' (the court gave it to us) on a note alone made firm_cause_list call
  -- the date evidenced with nothing on file — the opposite of what this migration's header says.
  -- So the promotion needs either an explicit source from the caller or a document to rest on.
  update court_events
     set source_document_id = coalesce(p_document, source_document_id),
         source_ref = coalesce(nullif(btrim(p_ref), ''), source_ref),
         source = coalesce(p_source, case when source = 'firm' and p_document is not null then 'hearing_notice' else source end),
         confirmed_by = auth.uid(), confirmed_at = now()
   where id = p_event;
end $$;
revoke execute on function public.attach_court_event_source(uuid, uuid, text, text) from public, anon;
grant  execute on function public.attach_court_event_source(uuid, uuid, text, text) to authenticated;

create or replace view public.firm_cause_list with (security_invoker = true) as
  select ce.id as court_event_id, ce.firm_id, ce.matter_id, m.reference, coalesce(m.cause_title, m.title) as cause_title,
         m.suit_number, ce.scheduled_at, (ce.scheduled_at at time zone 'Africa/Lagos')::date as on_date,
         ce.court_id, coalesce(c.name, ce.court_name) as court, ce.courtroom, ce.judge, ce.purpose_kind, ce.purpose, ce.source,
         ce.source_document_id, ce.source_ref, ce.created_by, ce.created_at, ce.confirmed_by, ce.confirmed_at,
         -- Evidenced means there is a document on file. A reference somebody typed is a claim about
         -- where the date came from, which is worth keeping and is not the same thing — the
         -- migration's own header says so: a chip is a claim, a document is evidence.
         (ce.source <> 'firm' and ce.source_document_id is not null) as evidenced
  from public.court_events ce
  join public.matters m on m.id = ce.matter_id and m.deleted_at is null
  left join public.courts c on c.id = ce.court_id
  where ce.outcome_update_id is null and ce.vacated_at is null;

-- ---------------------------------------------------------------- 2. the rules, as the platform entered them
create table if not exists public.court_rules (
  id             uuid primary key default gen_random_uuid(),
  level          court_level,                                   -- null: every court
  state_code     text references public.ng_states(code),        -- null: every state
  name           text not null check (length(name) between 2 and 200),
  citation       text check (citation is null or length(citation) <= 300),
  version        text not null check (length(version) between 1 and 60),
  effective_from date not null,
  retired_on     date check (retired_on is null or retired_on >= effective_from),
  note           text check (note is null or length(note) <= 1000),
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
comment on table public.court_rules is 'A set of rules of court as the platform entered it: name, citation, version, when in force. Never seeded; never guessed.';
create table if not exists public.rule_provisions (
  id                uuid primary key default gen_random_uuid(),
  rule_id           uuid not null references public.court_rules(id) on delete cascade,
  key               text not null check (key ~ '^[a-z0-9_]{2,60}$'),
  label             text not null check (length(label) between 2 and 200),
  citation          text check (citation is null or length(citation) <= 300),
  trigger_kind      text not null check (trigger_kind in ('judgment_delivered','ruling_delivered','order_made','service_effected','hearing_held','filing','other')),
  period            int not null check (period between 1 and 3660),
  unit              text not null default 'days' check (unit in ('days','months')),
  count_mode        text not null default 'calendar' check (count_mode in ('calendar','clear','working')),
  excludes_vacation boolean not null default false,
  rolls_forward     boolean not null default true,
  note              text check (note is null or length(note) <= 1000),
  created_at        timestamptz not null default now(),
  unique (rule_id, key)
);
comment on column public.rule_provisions.count_mode is 'calendar: N days from the event; clear: N clear days, the act on the day after; working: N sitting days. months: calendar months.';
comment on column public.rule_provisions.excludes_vacation is 'Days inside a vacation where time does not run (court_vacations.time_runs = false) are not counted.';
comment on column public.rule_provisions.rolls_forward is 'A last day on which the court does not sit rolls to the next day it does.';

alter table public.court_rules enable row level security;
alter table public.rule_provisions enable row level security;
create policy court_rules_select on public.court_rules for select using (true);
create policy rule_provisions_select on public.rule_provisions for select using (true);
create policy court_rules_platform_write_ins on public.court_rules for insert with check (is_platform_admin() and mfa_ok());
create policy court_rules_platform_write_upd on public.court_rules for update using (is_platform_admin() and mfa_ok()) with check (is_platform_admin() and mfa_ok());
create policy court_rules_platform_write_del on public.court_rules for delete using (is_platform_admin() and mfa_ok());
create policy rule_provisions_platform_write_ins on public.rule_provisions for insert with check (is_platform_admin() and mfa_ok());
create policy rule_provisions_platform_write_upd on public.rule_provisions for update using (is_platform_admin() and mfa_ok()) with check (is_platform_admin() and mfa_ok());
create policy rule_provisions_platform_write_del on public.rule_provisions for delete using (is_platform_admin() and mfa_ok());
grant select on public.court_rules, public.rule_provisions to anon, authenticated;
grant insert, update, delete on public.court_rules, public.rule_provisions to authenticated;
revoke truncate, references, trigger on public.court_rules, public.rule_provisions from anon, authenticated;
create trigger audit_court_rules after insert or update or delete on public.court_rules for each row execute function public.audit_row_change();
create trigger audit_rule_provisions after insert or update or delete on public.rule_provisions for each row execute function public.audit_row_change();
create or replace function public.court_rules_stamp() returns trigger language plpgsql set search_path = public as $$
begin if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if; return new; end $$;
create trigger court_rules_stamp before insert on public.court_rules for each row execute function public.court_rules_stamp();

-- The platform reads what the platform wrote: the rules join the reference entities on the
-- allow-list (migration 20, last re-created in 37).
drop policy if exists audit_log_platform_select on public.audit_log;
create policy audit_log_platform_select on public.audit_log for select
  using (public.is_platform_admin() and (
    (entity = 'firm' and action in ('firm.created','firm.status','firm.domain','firm.plan'))
    or entity in ('firms','firm_members')
    or entity in ('domain_request','platform_admins','provider_rates')
    or (entity in ('courts','court_vacations','public_holidays','court_rules','rule_provisions') and firm_id is null)
    or action in ('notification.retried', 'provider_rate.set')
  ));

-- ---------------------------------------------------------------- 3. counting days
-- Whether time under the rules is stopped on a day: a vacation that covers it with time_runs off.
create or replace function public.is_time_stopped(p_date date, p_level public.court_level default null, p_state text default null) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from court_vacations v
                    where p_date between v.starts_on and v.ends_on and not v.time_runs
                      and (v.level is null or v.level = p_level)
                      and (v.state_code is null or v.state_code = p_state)) $$;
grant execute on function public.is_time_stopped(date, public.court_level, text) to anon, authenticated;

-- The count, day by day, with everything it skipped and rolled and what it relied on.
create or replace function public.count_deadline(p_from date, p_period int, p_unit text, p_mode text,
                                                 p_level public.court_level default null, p_state text default null,
                                                 p_excludes_vacation boolean default false, p_rolls_forward boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_day date; v_counted int := 0; v_due date; v_skipped jsonb := '[]'::jsonb; v_rolled jsonb := '[]'::jsonb; v_guard int := 0; v_reason text;
        v_vac int; v_hol int; v_any_vac boolean; v_hol_year boolean;
begin
  if p_from is null then raise exception 'a deadline counts from a day'; end if;
  if p_period is null or p_period < 1 or p_period > 3660 then raise exception 'a period is between 1 and 3660'; end if;
  if p_unit not in ('days', 'months') then raise exception 'the unit is days or months'; end if;
  if p_mode not in ('calendar', 'clear', 'working') then raise exception 'the count is calendar, clear or working'; end if;
  if p_unit = 'months' then
    -- "within N months": calendar months, the same day-of-month or the month's last day. A
    -- vacation does not stretch a period counted in months.
    v_due := (p_from + make_interval(months => p_period))::date;
  else
    v_day := p_from;
    loop
      v_day := v_day + 1; v_guard := v_guard + 1;
      if v_guard > 20000 then raise exception 'the count did not end'; end if;
      v_reason := null;
      if p_mode = 'working' and is_non_sitting_day(v_day, p_level, p_state) then v_reason := 'the court does not sit';
      elsif coalesce(p_excludes_vacation, false) and is_time_stopped(v_day, p_level, p_state) then v_reason := 'time does not run: vacation';
      end if;
      if v_reason is not null then
        v_skipped := v_skipped || jsonb_build_object('day', v_day, 'reason', v_reason);
        continue;
      end if;
      v_counted := v_counted + 1;
      exit when v_counted >= p_period;
    end loop;
    v_due := v_day;
    -- N clear days: neither the day of the event nor the day of the act is counted.
    if p_mode = 'clear' then v_due := v_due + 1; end if;
  end if;
  if coalesce(p_rolls_forward, true) then
    v_guard := 0;
    while is_non_sitting_day(v_due, p_level, p_state) or (coalesce(p_excludes_vacation, false) and is_time_stopped(v_due, p_level, p_state)) loop
      v_rolled := v_rolled || jsonb_build_object('day', v_due, 'reason', case when is_non_sitting_day(v_due, p_level, p_state) then 'the court does not sit' else 'time does not run: vacation' end);
      v_due := v_due + 1; v_guard := v_guard + 1;
      if v_guard > 400 then raise exception 'no sitting day within 400 days of the last day'; end if;
    end loop;
  end if;
  -- What the count relied on. An empty calendar is a fact the reader must see.
  select count(*) into v_vac from court_vacations v where (v.level is null or v.level = p_level) and (v.state_code is null or v.state_code = p_state) and v.ends_on >= p_from and v.starts_on <= v_due;
  select count(*) into v_hol from public_holidays h where h.country = 'NG' and (h.state_code is null or h.state_code = p_state) and coalesce(h.observed_on, h.on_date) between p_from and v_due;
  select exists (select 1 from court_vacations v where (v.level is null or v.level = p_level) and (v.state_code is null or v.state_code = p_state)) into v_any_vac;
  select exists (select 1 from public_holidays h where h.country = 'NG' and extract(year from h.on_date) = extract(year from v_due)) into v_hol_year;
  return jsonb_build_object(
    'from', p_from, 'period', p_period, 'unit', p_unit, 'count_mode', p_mode,
    'excludes_vacation', coalesce(p_excludes_vacation, false), 'rolls_forward', coalesce(p_rolls_forward, true),
    'level', p_level, 'state_code', p_state,
    'due_on', v_due, 'counted_days', v_counted, 'skipped', v_skipped, 'rolled', v_rolled,
    'coverage', jsonb_build_object('vacation_rows_in_range', v_vac, 'holiday_rows_in_range', v_hol,
                                   'any_vacation_calendar', v_any_vac, 'holidays_entered_for_year', v_hol_year));
end $$;
revoke execute on function public.count_deadline(date, int, text, text, public.court_level, text, boolean, boolean) from public, anon;
grant  execute on function public.count_deadline(date, int, text, text, public.court_level, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------- 4. deadlines
create table if not exists public.deadlines (
  id                 uuid primary key default gen_random_uuid(),
  firm_id            uuid not null references public.firms(id) on delete cascade,
  matter_id          uuid not null references public.matters(id) on delete cascade,
  title              text not null check (length(title) between 2 and 200),
  trigger_kind       text not null check (trigger_kind in ('judgment_delivered','ruling_delivered','order_made','service_effected','hearing_held','filing','other')),
  trigger_on         date not null,
  trigger_ref        jsonb not null default '{}'::jsonb,
  court_id           uuid references public.courts(id) on delete set null,
  jurisdiction       jsonb not null default '{}'::jsonb,
  rule_id            uuid references public.court_rules(id) on delete set null,
  provision_id       uuid references public.rule_provisions(id) on delete set null,
  rule_name          text, rule_citation text, rule_version text, provision_label text, provision_citation text,
  calculation        jsonb not null default '{}'::jsonb,
  due_on             date not null,
  status             text not null default 'proposed' check (status in ('proposed','confirmed','discharged','superseded')),
  computed_by        uuid references public.profiles(id) on delete set null,
  computed_at        timestamptz not null default now(),
  confirmed_by       uuid references public.profiles(id) on delete set null,
  confirmed_at       timestamptz,
  discharged_by      uuid references public.profiles(id) on delete set null,
  discharged_at      timestamptz,
  discharge_note     text check (discharge_note is null or length(discharge_note) <= 1000),
  superseded_by      uuid references public.deadlines(id) on delete set null,
  note               text check (note is null or length(note) <= 1000),
  reminders_sent     text[] not null default '{}'
);
comment on table public.deadlines is 'A computed deadline: the triggering event and day, the jurisdiction, the rule as it read, the calculation day by day, the day due, and the lawyer who confirmed it. Firm work product: no client ever reads it. Never edited: superseded or discharged.';
create index if not exists deadlines_firm_due_idx on public.deadlines (firm_id, due_on) where status in ('proposed', 'confirmed');
create index if not exists deadlines_matter_idx on public.deadlines (matter_id);
alter table public.deadlines enable row level security;
create policy deadlines_select on public.deadlines for select using (matter_row_r(firm_id, matter_id));
grant select on public.deadlines to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.deadlines from anon, authenticated;
create trigger deadlines_check_firm before insert or update on public.deadlines for each row execute function public.check_row_firm();

-- The count, written down. p_provision names a rule; without one, p_due_on is the lawyer's own
-- date and the row says so. A new row may supersede an earlier one.
create or replace function public.compute_deadline(p_matter uuid, p_trigger_kind text, p_trigger_on date,
                                                   p_provision uuid default null, p_due_on date default null, p_title text default null,
                                                   p_trigger_ref jsonb default '{}'::jsonb, p_supersedes uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m matters%rowtype; c courts%rowtype; pv rule_provisions%rowtype; r court_rules%rowtype; v_calc jsonb; v_due date; v_id uuid;
        v_jur jsonb; v_title text; v_old deadlines%rowtype;
begin
  select * into m from matters where id = p_matter and deleted_at is null;
  if not found or not matter_row_w(m.firm_id, p_matter) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_trigger_on is null then raise exception 'a deadline counts from the day of its triggering event'; end if;
  if p_trigger_kind not in ('judgment_delivered','ruling_delivered','order_made','service_effected','hearing_held','filing','other') then
    raise exception 'unknown triggering event %', p_trigger_kind;
  end if;
  if m.court_id is not null then select * into c from courts where id = m.court_id; end if;
  v_jur := jsonb_build_object('court_id', m.court_id, 'court_name', coalesce(c.name, m.court_name), 'level', c.level, 'state_code', c.state_code,
                              'division', coalesce(c.division, m.judicial_division));
  if p_provision is not null then
    select * into pv from rule_provisions where id = p_provision;
    if not found then raise exception 'unknown provision'; end if;
    select * into r from court_rules where id = pv.rule_id;
    if pv.trigger_kind <> p_trigger_kind then raise exception 'the provision "%" counts from %, not from %', pv.label, replace(pv.trigger_kind, '_', ' '), replace(p_trigger_kind, '_', ' '); end if;
    if r.effective_from > p_trigger_on or (r.retired_on is not null and r.retired_on <= p_trigger_on) then
      raise exception 'the rules "%" (version %) were not in force on %', r.name, r.version, to_char(p_trigger_on, 'FMDD Mon YYYY');
    end if;
    if r.level is not null and (c.level is null or c.level <> r.level) then
      raise exception 'the rules "%" are for the % and this matter''s court is %', r.name, r.level, coalesce(c.level::text, 'not recorded');
    end if;
    if r.state_code is not null and (c.state_code is null or c.state_code <> r.state_code) then
      raise exception 'the rules "%" are for % and this matter''s court is in %', r.name, r.state_code, coalesce(c.state_code, 'a state not recorded');
    end if;
    v_calc := count_deadline(p_trigger_on, pv.period, pv.unit, pv.count_mode, c.level, c.state_code, pv.excludes_vacation, pv.rolls_forward);
    v_due := (v_calc ->> 'due_on')::date;
    v_title := coalesce(nullif(btrim(coalesce(p_title, '')), ''), pv.label);
  else
    if p_due_on is null then raise exception 'without a rule, give the day the deadline falls'; end if;
    if p_due_on < p_trigger_on then raise exception 'a deadline does not fall before its triggering event'; end if;
    v_due := p_due_on;
    v_calc := jsonb_build_object('count_mode', 'manual', 'from', p_trigger_on, 'due_on', p_due_on, 'entered_by', auth.uid());
    v_title := nullif(btrim(coalesce(p_title, '')), '');
    if v_title is null then raise exception 'a deadline entered without a rule needs a title'; end if;
  end if;
  if p_supersedes is not null then
    select * into v_old from deadlines where id = p_supersedes for update;
    if not found or v_old.matter_id <> p_matter then raise exception 'the deadline to supersede is not on this matter'; end if;
    if v_old.status not in ('proposed', 'confirmed') then raise exception 'that deadline is already %', v_old.status; end if;
  end if;
  insert into deadlines (firm_id, matter_id, title, trigger_kind, trigger_on, trigger_ref, court_id, jurisdiction,
                         rule_id, provision_id, rule_name, rule_citation, rule_version, provision_label, provision_citation,
                         calculation, due_on, computed_by, note)
  values (m.firm_id, p_matter, v_title, p_trigger_kind, p_trigger_on, coalesce(p_trigger_ref, '{}'::jsonb), m.court_id, v_jur,
          r.id, pv.id, r.name, r.citation, r.version, pv.label, pv.citation,
          v_calc, v_due, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  if p_supersedes is not null then
    update deadlines set status = 'superseded', superseded_by = v_id where id = p_supersedes;
  end if;
  perform audit('deadline.computed', 'deadline', v_id, m.firm_id,
                jsonb_build_object('matter_id', p_matter, 'trigger_kind', p_trigger_kind, 'trigger_on', p_trigger_on, 'due_on', v_due,
                                   'provision_id', pv.id, 'rule_version', r.version, 'manual', p_provision is null, 'supersedes', p_supersedes));
  return v_id;
end $$;
revoke execute on function public.compute_deadline(uuid, text, date, uuid, date, text, jsonb, uuid, text) from public, anon;
grant  execute on function public.compute_deadline(uuid, text, date, uuid, date, text, jsonb, uuid, text) to authenticated;

-- A lawyer's decision: only an owner, admin or lawyer of the firm confirms, and once.
create or replace function public.confirm_deadline(p_deadline uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d deadlines%rowtype;
begin
  select * into d from deadlines where id = p_deadline for update;
  if not found or not matter_row_w(d.firm_id, d.matter_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if not exists (select 1 from firm_members fm where fm.firm_id = d.firm_id and fm.user_id = auth.uid() and fm.role in ('owner', 'admin', 'lawyer')) then
    raise exception 'a deadline is confirmed by a lawyer of the firm' using errcode = '42501';
  end if;
  if d.status <> 'proposed' then raise exception 'this deadline is already %', d.status; end if;
  update deadlines set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now() where id = p_deadline;
  perform audit('deadline.confirmed', 'deadline', p_deadline, d.firm_id, jsonb_build_object('matter_id', d.matter_id, 'due_on', d.due_on, 'rule_version', d.rule_version));
end $$;
revoke execute on function public.confirm_deadline(uuid) from public, anon;
grant  execute on function public.confirm_deadline(uuid) to authenticated;

create or replace function public.discharge_deadline(p_deadline uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare d deadlines%rowtype;
begin
  select * into d from deadlines where id = p_deadline for update;
  if not found or not matter_row_w(d.firm_id, d.matter_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if d.status not in ('proposed', 'confirmed') then raise exception 'this deadline is already %', d.status; end if;
  update deadlines set status = 'discharged', discharged_by = auth.uid(), discharged_at = now(), discharge_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_deadline;
  perform audit('deadline.discharged', 'deadline', p_deadline, d.firm_id, jsonb_build_object('matter_id', d.matter_id, 'due_on', d.due_on, 'note', nullif(btrim(coalesce(p_note, '')), '')));
end $$;
revoke execute on function public.discharge_deadline(uuid, text) from public, anon;
grant  execute on function public.discharge_deadline(uuid, text) to authenticated;

-- The firm's deadlines with the matter beside each, for the diary and the matter page.
create or replace view public.firm_deadlines with (security_invoker = true) as
  select d.*, m.reference, coalesce(m.cause_title, m.title) as cause_title, coalesce(c.name, m.court_name) as court
    from public.deadlines d
    join public.matters m on m.id = d.matter_id and m.deleted_at is null
    left join public.courts c on c.id = d.court_id;
grant select on public.firm_deadlines to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.firm_deadlines from anon, authenticated;

-- ---------------------------------------------------------------- 5. reminders, to the matter's lawyers
create or replace function public.enqueue_deadline_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; p record; n int := 0; v_key text; v_past text; v_sent text[]; v_today date := (now() at time zone 'Africa/Lagos')::date; v_days int;
begin
  -- One reminder per deadline per run: the nearest mark that fits, not every mark whose threshold
  -- the deadline has passed. The old test had a lower bound of nothing, so a deadline confirmed on
  -- the day it falls due fired t7, t1 and t0 together — and the firm sent itself an email and an
  -- SMS saying a deadline that expires today is due in a week. Marks the deadline has already gone
  -- past are stamped as sent without a message, so none of them can fire late.
  for r in select * from deadlines where status = 'confirmed' and due_on between v_today and v_today + 7 loop
    v_days := r.due_on - v_today;
    v_key := case when v_days <= 0 then 't0' when v_days = 1 then 't1' else 't7' end;
    -- Everything nearer than the mark that fits is still ahead; everything further is behind us.
    v_sent := r.reminders_sent;
    foreach v_past in array array['t7', 't1', 't0'] loop
      if (case v_past when 't7' then 7 when 't1' then 1 else 0 end) > v_days and not (v_past = any(v_sent)) then
        v_sent := v_sent || v_past::text;
      end if;
    end loop;
    if v_sent <> r.reminders_sent then
      update deadlines set reminders_sent = v_sent where id = r.id;
    end if;
    if not (v_key = any(v_sent)) then
      for p in select user_id from matter_lawyers where matter_id = r.matter_id loop
        perform enqueue_notification(p.user_id, r.firm_id, 'deadline_due_' || v_key,
          jsonb_build_object('deadline_id', r.id, 'matter_id', r.matter_id, 'title', r.title, 'due_on', r.due_on));
      end loop;
      update deadlines set reminders_sent = reminders_sent || v_key::text where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.enqueue_deadline_reminders() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available — skipping schedules';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  perform cron.schedule('docket-deadline-remind', '0 6 * * *', $j$ select public.enqueue_deadline_reminders() $j$);
end $$;
