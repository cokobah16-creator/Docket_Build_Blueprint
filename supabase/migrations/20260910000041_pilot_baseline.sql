-- The baseline: what the firm's own rows say, on a dated record nobody can edit.
--
-- The assessment's twenty-fifth recommendation is one sentence — record the baseline before
-- claiming any saving — and it is the whole of this migration. Docket has had an instrument
-- since slice 5 (a PostHog funnel) and no measurement: the funnel is optional, its key may be
-- unset, two of its five steps are never emitted at all, and a client who signs in by phone —
-- the ordinary Nigerian path — is never joined to their anonymous visits. None of that can carry
-- a claim about how a firm's work changed. So the baseline is computed from the rows, by the
-- database, and PostHog stays what it is: a funnel, not evidence.
--
-- Three rules shape it.
--
-- First, only what the rows prove. Every number here is derived from a table Docket writes in
-- the ordinary course of the work, and each one that rests on an inference says so in its own
-- words: `caveats` is part of the answer, not a footnote somewhere else. Where the rows cannot
-- tell attended from unrecorded, there is an `unrecorded` bucket rather than a guess — an
-- in-person consultation whose notes were never saved stays 'confirmed' for ever, and folding
-- those into either "attended" or "missed" would be inventing the firm's attendance rate.
--
-- Second, a baseline is a record, not a screen. firm_overview is a live count: read it twice and
-- it says two things, and nothing later can say what it said in September. So a baseline is an
-- append-only row — the window, the metrics as computed, who took it and when — with no update
-- and no delete granted to anybody. A number that could be edited afterwards is not a baseline.
--
-- Third, what the firm says about life before Docket is a claim, never a measurement. "Four
-- hours a week chasing court dates" is not something Docket can compute and never will be, and
-- writing it into the same object as the computed figures would launder an estimate into a fact.
-- It is stored beside them, in `stated`, with who said it and when, and the screens keep the two
-- apart in words.
--
-- Ordering: additive. Nothing the deployed front end reads changes; the table, the functions and
-- the index are new.

-- ---------------------------------------------------------------- 1. the metrics, computed
-- Windows are instants (timestamptz), so "in the window" is unambiguous wherever the reader is.
-- Anything judged as a calendar day — an overdue next action — is judged in the firm's own
-- timezone, because a DATE is a day and not an instant.
create or replace function public.firm_metrics(p_firm uuid, p_from timestamptz, p_to timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f firms%rowtype;
  v_caveats text[] := array[]::text[];
  v_bookings jsonb; v_attendance jsonb; v_to_matter jsonb; v_sittings jsonb;
  v_replies jsonb; v_requests jsonb; v_collection jsonb; v_work jsonb; v_clients jsonb;
  v_booked int; v_paid_n int; v_pay_hours numeric;
  v_completed int; v_no_show int; v_unrecorded int; v_upcoming int; v_past int;
  v_consults int; v_became int; v_matter_days numeric;
  v_sat int; v_with_outcome int; v_within_day int; v_update_hours numeric;
  v_threads int; v_answered int; v_reply_hours numeric; v_waiting int; v_oldest_wait numeric;
  v_req int; v_fulfilled int; v_req_hours numeric;
  v_overdue int; v_active int;
begin
  if not is_firm_member(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into f from firms where id = p_firm;
  if not found then raise exception 'firm not found'; end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'give a window: from, then to'; end if;

  -- 1. bookings made in the window, and how long a paid one took to pay.
  select count(*) into v_booked from appointments a where a.firm_id = p_firm and a.created_at >= p_from and a.created_at < p_to;
  select count(*), percentile_cont(0.5) within group (order by extract(epoch from (pm.paid_at - a.created_at)) / 3600.0)
    into v_paid_n, v_pay_hours
    from appointments a
    join invoices i on i.id = a.invoice_id
    join payments pm on pm.invoice_id = i.id and pm.status = 'succeeded'
   where a.firm_id = p_firm and a.created_at >= p_from and a.created_at < p_to and pm.paid_at is not null;
  v_bookings := jsonb_build_object('made', v_booked, 'paid', v_paid_n,
                                   'median_hours_to_pay', round(coalesce(v_pay_hours, 0)::numeric, 2));

  -- 2. attendance, on consultations whose time has passed within the window. 'unrecorded' is a
  --    bucket of its own: Docket marks a consultation completed when the notes are saved, so one
  --    held in chambers and never written up is still 'confirmed' and is neither attended nor missed.
  select count(*) filter (where a.status = 'completed'),
         count(*) filter (where a.status = 'no_show'),
         count(*) filter (where a.status in ('confirmed', 'rescheduled')),
         count(*)
    into v_completed, v_no_show, v_unrecorded, v_past
    from appointments a
   where a.firm_id = p_firm and a.ends_at >= p_from and a.ends_at < least(p_to, now())
     and a.status not in ('cancelled', 'awaiting_payment', 'pending');
  select count(*) into v_upcoming from appointments a
   where a.firm_id = p_firm and a.status in ('confirmed', 'rescheduled') and a.starts_at >= now();
  v_attendance := jsonb_build_object('past', v_past, 'attended', v_completed, 'missed', v_no_show,
                                     'unrecorded', v_unrecorded, 'upcoming_now', v_upcoming);
  if v_unrecorded > 0 then
    v_caveats := array_append(v_caveats, format('%s consultation(s) whose time has passed are neither marked completed nor a no-show: Docket records attendance when the notes are saved, so these are counted as unrecorded and are in no attendance rate.', v_unrecorded));
  end if;

  -- 3. consultation to matter. There is no column joining the two — an appointment never carries
  --    a matter — so this is the firm's own client having a matter opened after the consultation,
  --    which is an inference and is labelled as one wherever it is shown.
  select count(*) into v_consults from appointments a
   where a.firm_id = p_firm and a.ends_at >= p_from and a.ends_at < least(p_to, now()) and a.status = 'completed';
  select count(*), percentile_cont(0.5) within group (order by extract(epoch from (m.created_at - a.ends_at)) / 86400.0)
    into v_became, v_matter_days
    from appointments a
   cross join lateral (
     select m.created_at from matters m
      join matter_parties mp on mp.matter_id = m.id and mp.role = 'client' and mp.user_id = a.client_id
     where m.firm_id = p_firm and m.deleted_at is null and m.created_at >= a.ends_at and m.created_at < a.ends_at + interval '60 days'
     order by m.created_at limit 1) m
   where a.firm_id = p_firm and a.ends_at >= p_from and a.ends_at < least(p_to, now()) and a.status = 'completed';
  v_to_matter := jsonb_build_object('consultations', v_consults, 'followed_by_a_matter', v_became,
                                    'median_days', round(coalesce(v_matter_days, 0)::numeric, 2), 'within_days', 60);
  if v_consults > 0 then
    v_caveats := array_append(v_caveats, 'A consultation is not joined to a matter by any column: "followed by a matter" means the same client had a matter opened at this firm within sixty days. It is an inference, not a record.');
  end if;

  -- 4. sittings: a court date that came and went, and whether the client heard about it.
  select count(*), count(*) filter (where ce.outcome_update_id is not null),
         count(*) filter (where u.created_at is not null and u.created_at <= ce.scheduled_at + interval '24 hours'),
         percentile_cont(0.5) within group (order by extract(epoch from (u.created_at - ce.scheduled_at)) / 3600.0)
    into v_sat, v_with_outcome, v_within_day, v_update_hours
    from court_events ce
    left join updates u on u.id = ce.outcome_update_id
   where ce.firm_id = p_firm and ce.vacated_at is null
     and ce.scheduled_at >= p_from and ce.scheduled_at < least(p_to, now());
  v_sittings := jsonb_build_object('sat', v_sat, 'with_an_update', v_with_outcome,
                                   'updated_within_24h', v_within_day,
                                   'median_hours_to_update', round(coalesce(v_update_hours, 0)::numeric, 2));

  -- 5. how long the firm takes to answer. A thread owes a reply when its latest message came
  --    from somebody who is not a member of the firm — the same rule firm_threads uses.
  with client_msgs as (
    select m.id, m.matter_id, m.appointment_id, m.created_at,
           coalesce(m.matter_id::text, m.appointment_id::text) as thread
      from messages m
     where m.firm_id = p_firm and m.created_at >= p_from and m.created_at < p_to
       and not exists (select 1 from firm_members fm where fm.firm_id = p_firm and fm.user_id = m.sender_id)
  ), answered as (
    select c.thread, c.created_at,
           (select min(r.created_at) from messages r
             where r.firm_id = p_firm and coalesce(r.matter_id::text, r.appointment_id::text) = c.thread
               and r.created_at > c.created_at
               and exists (select 1 from firm_members fm where fm.firm_id = p_firm and fm.user_id = r.sender_id)) as replied_at
      from client_msgs c
  )
  select count(*), count(*) filter (where replied_at is not null),
         percentile_cont(0.5) within group (order by extract(epoch from (replied_at - created_at)) / 3600.0) filter (where replied_at is not null),
         count(*) filter (where replied_at is null),
         max(extract(epoch from (now() - created_at)) / 3600.0) filter (where replied_at is null)
    into v_threads, v_answered, v_reply_hours, v_waiting, v_oldest_wait
    from answered;
  v_replies := jsonb_build_object('messages_from_clients', v_threads, 'answered', v_answered,
                                  'median_hours_to_first_reply', round(coalesce(v_reply_hours, 0)::numeric, 2),
                                  'still_unanswered', v_waiting, 'oldest_unanswered_hours', round(coalesce(v_oldest_wait, 0)::numeric, 2));

  -- 6. what the firm asked clients for, and how long it took to arrive.
  select count(*), count(*) filter (where dr.fulfilled_at is not null),
         percentile_cont(0.5) within group (order by extract(epoch from (dr.fulfilled_at - dr.requested_at)) / 3600.0)
    into v_req, v_fulfilled, v_req_hours
    from document_requests dr
   where dr.firm_id = p_firm and dr.requested_at >= p_from and dr.requested_at < p_to and dr.cancelled_at is null;
  v_requests := jsonb_build_object('asked', v_req, 'answered', v_fulfilled,
                                   'median_hours_to_answer', round(coalesce(v_req_hours, 0)::numeric, 2));

  -- 7. money. Per currency, always: minor units of one currency cannot be added to another's.
  v_collection := jsonb_build_object(
    'invoiced', coalesce((select jsonb_object_agg(x.currency, x.minor) from (
        select i.currency::text as currency, sum(i.total_minor) as minor from invoices i
         where i.firm_id = p_firm and i.issued_at >= p_from and i.issued_at < p_to and i.status <> 'draft'
         group by i.currency) x), '{}'::jsonb),
    'collected', coalesce((select jsonb_object_agg(x.currency, x.minor) from (
        select i.currency::text as currency, sum(pm.amount_minor) as minor
          from payments pm join invoices i on i.id = pm.invoice_id
         where i.firm_id = p_firm and pm.status = 'succeeded' and pm.paid_at >= p_from and pm.paid_at < p_to
         group by i.currency) x), '{}'::jsonb),
    'median_days_to_collect', coalesce((select round(percentile_cont(0.5) within group (
          order by extract(epoch from (pm.paid_at - i.issued_at)) / 86400.0)::numeric, 2)
        from payments pm join invoices i on i.id = pm.invoice_id
       where i.firm_id = p_firm and pm.status = 'succeeded' and pm.paid_at >= p_from and pm.paid_at < p_to and i.issued_at is not null), 0));

  -- 8. the work itself, as it stands now — not a window, and said so on the screen.
  select count(*) into v_overdue from matters m
   where m.firm_id = p_firm and m.deleted_at is null and m.closed_at is null
     and m.next_action_due is not null
     and m.next_action_due < (now() at time zone coalesce(f.timezone, 'Africa/Lagos'))::date;
  v_work := jsonb_build_object(
    'open_matters', (select count(*) from matters m where m.firm_id = p_firm and m.deleted_at is null and m.closed_at is null),
    'matters_opened_in_window', (select count(*) from matters m where m.firm_id = p_firm and m.deleted_at is null and m.created_at >= p_from and m.created_at < p_to),
    'next_actions_overdue_now', v_overdue,
    'client_updates_posted', (select count(*) from updates u where u.firm_id = p_firm and u.visibility = 'client' and u.created_at >= p_from and u.created_at < p_to));

  -- 9. clients who actually used the app in the window. Docket keeps no login record a firm may
  --    read, so this counts people who did something the rows can see — read a thread, opened a
  --    document, read a notification, sent a message. Someone who only looked at a page is not here.
  select count(distinct u) into v_active from (
    select mr.user_id as u from message_reads mr join messages m on m.id = mr.message_id
      where m.firm_id = p_firm and mr.read_at >= p_from and mr.read_at < p_to
    union select dr.user_id from document_reads dr where dr.firm_id = p_firm and dr.at >= p_from and dr.at < p_to
    union select n.user_id from notifications n where n.firm_id = p_firm and n.read_at >= p_from and n.read_at < p_to
    union select m.sender_id from messages m where m.firm_id = p_firm and m.created_at >= p_from and m.created_at < p_to
  ) acts
  where u is not null and not exists (select 1 from firm_members fm where fm.firm_id = p_firm and fm.user_id = u);
  v_clients := jsonb_build_object('active_in_window', v_active);
  v_caveats := array_append(v_caveats, 'Active clients counts people who read a message or a document, read a notification, or sent a message in the window. Docket keeps no record of a client merely opening a page, so this is a floor, not a total.');
  v_caveats := array_append(v_caveats, 'Every figure here is computed from this firm''s own rows at the moment it was asked for. The PostHog funnel is not part of it: its key is optional, two of its five steps are never emitted, and a client who signs in by phone is never joined to their earlier visits.');

  return jsonb_build_object(
    'firm_id', p_firm, 'window_from', p_from, 'window_to', p_to, 'computed_at', now(),
    'bookings', v_bookings, 'attendance', v_attendance, 'consultation_to_matter', v_to_matter,
    'sittings', v_sittings, 'replies', v_replies, 'document_requests', v_requests,
    'money', v_collection, 'work', v_work, 'clients', v_clients,
    'caveats', to_jsonb(v_caveats));
end $$;
revoke execute on function public.firm_metrics(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function public.firm_metrics(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------- 2. the record
-- Append-only, like audit_log and for the same reason: a baseline that can be edited afterwards
-- is not a baseline. No update and no delete is granted to anybody, and the only writer is the
-- function below.
create table public.firm_baselines (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms(id) on delete cascade,
  taken_at    timestamptz not null default now(),
  window_from timestamptz not null,
  window_to   timestamptz not null,
  metrics     jsonb not null,
  -- What the firm says about how the work went before Docket. Never computed, never mixed with
  -- the metrics: a claim with a name and a date against it.
  stated      jsonb not null default '{}'::jsonb,
  note        text,
  taken_by    uuid references public.profiles(id),
  constraint firm_baselines_window_chk check (window_to > window_from)
);
alter table public.firm_baselines enable row level security;
create index firm_baselines_firm_idx on public.firm_baselines (firm_id, taken_at desc);
revoke all on public.firm_baselines from anon;
revoke insert, update, delete on public.firm_baselines from authenticated;
grant select on public.firm_baselines to authenticated;
create policy firm_baselines_select on public.firm_baselines for select using (is_firm_member(firm_id));
create trigger audit_firm_baselines after insert or update or delete on public.firm_baselines
  for each row execute function public.audit_row_change();

comment on table public.firm_baselines is
  'A dated, append-only record of what the firm''s rows said over one window. Written only by record_firm_baseline(); never updated, never deleted.';
comment on column public.firm_baselines.stated is
  'What the firm states about the work before Docket — a claim with who and when, not a measurement. Kept apart from metrics on purpose.';

create or replace function public.record_firm_baseline(p_firm uuid, p_from timestamptz, p_to timestamptz default now(),
                                                       p_note text default null, p_stated jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_metrics jsonb; k text;
begin
  if not admin_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_stated is not null and jsonb_typeof(p_stated) <> 'object' then raise exception 'what the firm states is an object of short answers'; end if;
  for k in select key from jsonb_object_keys(coalesce(p_stated, '{}'::jsonb)) key loop
    if jsonb_typeof(p_stated -> k) <> 'string' or length(p_stated ->> k) > 500 then
      raise exception 'a stated figure is text of at most 500 characters (%)', k;
    end if;
  end loop;
  v_metrics := firm_metrics(p_firm, p_from, p_to);
  insert into firm_baselines (firm_id, window_from, window_to, metrics, stated, note, taken_by)
  values (p_firm, p_from, p_to, v_metrics, coalesce(p_stated, '{}'::jsonb), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  perform audit('baseline.recorded', 'firm', p_firm, p_firm,
                jsonb_build_object('baseline_id', v_id, 'window_from', p_from, 'window_to', p_to,
                                   'stated_keys', (select coalesce(jsonb_agg(k2), '[]'::jsonb) from jsonb_object_keys(coalesce(p_stated, '{}'::jsonb)) k2)));
  return v_id;
end $$;
revoke execute on function public.record_firm_baseline(uuid, timestamptz, timestamptz, text, jsonb) from public, anon;
grant  execute on function public.record_firm_baseline(uuid, timestamptz, timestamptz, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- 3. reading the log by what happened
-- audit_log has an index on (firm_id, at desc) only, so counting one kind of action over a firm's
-- history scans the lot. Additive, and it costs nothing until something asks.
create index if not exists audit_log_firm_action_idx on public.audit_log (firm_id, action, at desc);

-- The platform's own allow-list gains the new entity, so a baseline shows on the platform audit
-- screen as the operational event it is (migrations 37, 38, 39 do the same for theirs).
drop policy if exists audit_log_platform_select on public.audit_log;
create policy audit_log_platform_select on public.audit_log for select
  using (is_platform_admin() and entity in ('firm', 'firm_member', 'domain_request', 'platform_admin', 'notification',
                                            'provider_rates', 'workflow_packs', 'court_rules', 'rule_provisions'));
