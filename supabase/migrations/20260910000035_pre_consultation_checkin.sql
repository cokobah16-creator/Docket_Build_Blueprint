-- Before a consultation: ask only for what is still missing, show the firm whether it is in,
-- and — if the firm wants — hold the booking until it is.
--
-- A booking today is confirmed the moment it is made (or paid). Some firms want to see the
-- client's answers, their documents, their acceptance of the terms and a clean conflict check
-- before a lawyer's hour is committed. That is an opt-in switch, firms.checkin_before_confirm:
-- with it on, a booking is HELD (the existing 'pending' status, which nothing wrote until now),
-- and the firm confirms it once appointment_ready() says everything required is in. The
-- database refuses the confirmation otherwise, whoever asks. With the switch off nothing
-- changes: paid means confirmed, free means confirmed, as before.
--
-- Readiness is COMPUTED from real rows — the invoice, the latest intake answers against the
-- form's required questions, open document requests on the consultation, consent records
-- against the firm's current policy versions, and (only where the firm requires clearance
-- before a client joins a matter) a cleared conflict check on the consultation. Nothing is
-- stored as "done". Document requests and conflict checks learn an appointment_id so the
-- machinery built for matters serves a consultation without a matter being opened: a booking
-- creates no lawyer-client relationship, and this migration keeps it that way.
--
-- What a client is told about the firm's conflict check is only that the firm has checks to
-- finish. Never the outcome, never the matches.

-- ---------------------------------------------------------------- 1. the switch
alter table public.firms add column checkin_before_confirm boolean not null default false;
comment on column public.firms.checkin_before_confirm is
  'Opt-in: hold a booking (status pending) until the firm confirms it, and refuse the confirmation until everything appointment_ready() requires is in. Off: paid or free means confirmed.';

-- ---------------------------------------------------------------- 2. document requests reach a consultation
alter table public.document_requests alter column matter_id drop not null;
alter table public.document_requests add column appointment_id uuid references public.appointments(id) on delete cascade;
alter table public.document_requests add constraint document_requests_scope_chk check (matter_id is not null or appointment_id is not null);
create index document_requests_appointment_open_idx on public.document_requests (appointment_id) where appointment_id is not null and fulfilled_at is null and cancelled_at is null;
drop policy if exists document_requests_select on public.document_requests;
create policy document_requests_select on public.document_requests for select
  using (matter_row_r(firm_id, matter_id) or is_matter_party(matter_id) or is_appointment_client(appointment_id));
drop policy if exists document_requests_insert on public.document_requests;
create policy document_requests_insert on public.document_requests for insert
  with check (matter_row_w(firm_id, matter_id) and requested_by = (select auth.uid()));
drop trigger if exists document_requests_check_firm on public.document_requests;
create trigger document_requests_check_firm before insert or update on public.document_requests
  for each row execute function public.check_row_firm();

create or replace function public.fulfil_document_request(p_request uuid, p_document uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_r document_requests%rowtype; v_d documents%rowtype; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_r from document_requests where id = p_request;
  if not found or not (matter_row_r(v_r.firm_id, v_r.matter_id) or is_matter_party(v_r.matter_id) or is_appointment_client(v_r.appointment_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_r.cancelled_at is not null then raise exception 'this request was withdrawn'; end if;
  if v_r.fulfilled_at is not null then raise exception 'this request has already been answered'; end if;
  select * into v_d from documents where id = p_document and deleted_at is null;
  if not found or not ((v_r.matter_id is not null and v_d.matter_id = v_r.matter_id)
                    or (v_r.appointment_id is not null and v_d.appointment_id = v_r.appointment_id)) then
    raise exception 'that document is not on this %', case when v_r.matter_id is not null then 'matter' else 'consultation' end;
  end if;
  update document_requests set fulfilled_document_id = v_d.id, fulfilled_at = now() where id = v_r.id;
  perform audit('document_request.fulfilled', 'document_requests', v_r.id, v_r.firm_id,
                jsonb_build_object('document_id', v_d.id, 'title', v_r.title, 'matter_id', v_r.matter_id));
  if v_r.requested_by is not null and v_r.requested_by <> v_uid then
    perform enqueue_notification(v_r.requested_by, v_r.firm_id, 'document_received',
      jsonb_build_object('request_id', v_r.id, 'matter_id', v_r.matter_id, 'appointment_id', v_r.appointment_id, 'title', v_r.title, 'document_id', v_d.id, 'name', v_d.name));
  end if;
end $$;

create or replace function public.notify_document_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select user_id from matter_parties where new.matter_id is not null and matter_id = new.matter_id and role in ('client', 'contact')
           union select client_id from appointments where new.appointment_id is not null and id = new.appointment_id loop
    perform enqueue_notification(r.user_id, new.firm_id, 'document_requested',
      jsonb_build_object('request_id', new.id, 'matter_id', new.matter_id, 'appointment_id', new.appointment_id, 'title', new.title, 'due_on', new.due_on));
  end loop;
  return new;
end $$;

-- ---------------------------------------------------------------- 3. conflict checks reach a consultation
alter table public.conflict_checks add column appointment_id uuid references public.appointments(id) on delete set null;
create index conflict_checks_appointment_idx on public.conflict_checks (appointment_id, reviewed_at desc) where appointment_id is not null;
drop function public.run_conflict_check(uuid, uuid, text[]);
create or replace function public.run_conflict_check(p_firm uuid, p_matter uuid default null, p_names text[] default null, p_appointment uuid default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_names text[]; v_matches jsonb; v_id uuid; v_n int;
begin
  if not staff_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_matter is not null and (
       not exists (select 1 from matters where id = p_matter and firm_id = p_firm and deleted_at is null)
       or not can_see_matter(p_matter)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- A consultation (migration 35): the check is for the person who booked it.
  if p_appointment is not null and not exists (select 1 from appointments a where a.id = p_appointment and a.firm_id = p_firm) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select array_agg(distinct k order by k) into v_names from (
    select conflict_name_key(n) as k from unnest(coalesce(p_names, '{}'::text[])) n
    union all select conflict_name_key(p.full_name)    from appointments a join profiles p on p.id = a.client_id where p_appointment is not null and a.id = p_appointment
    union all select conflict_name_key(p.company_name) from appointments a join profiles p on p.id = a.client_id where p_appointment is not null and a.id = p_appointment
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

  insert into conflict_checks (firm_id, matter_id, appointment_id, query, matches, created_by)
  values (p_firm, p_matter, p_appointment, jsonb_build_object('names', to_jsonb(coalesce(p_names, '{}'::text[])), 'keys', to_jsonb(v_names)), v_matches, auth.uid())
  returning id into v_id;
  perform audit('conflict_check.run', 'conflict_check', v_id, p_firm,
                jsonb_build_object('matter_id', p_matter, 'appointment_id', p_appointment, 'keys', v_names, 'matches', v_n));
  return jsonb_build_object('check_id', v_id, 'keys', to_jsonb(v_names), 'matches', v_matches, 'match_count', v_n);
end $$;
revoke execute on function public.run_conflict_check(uuid, uuid, text[], uuid) from public, anon;
grant  execute on function public.run_conflict_check(uuid, uuid, text[], uuid) to authenticated;

create or replace function public.conflict_cleared_for_appointment(p_appointment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select outcome in ('clear', 'waived') from conflict_checks
                    where appointment_id = p_appointment and outcome is not null
                    order by reviewed_at desc limit 1), false)
$$;
revoke execute on function public.conflict_cleared_for_appointment(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. readiness, computed
-- The items and whether each is in. No caller check: the callers below do that, and the trigger
-- runs it for the payment webhook, which has no caller at all.
create or replace function public.appointment_checkin(p_appointment uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a appointments%rowtype; f firms%rowtype; v_items jsonb := '[]'::jsonb; v_ready bool := true;
        v_inv invoices%rowtype; v_form intake_forms%rowtype; v_answers jsonb; v_missing jsonb; v_open jsonb; v_terms text; v_privacy text;
        v_consent_ok bool; v_conflict_ok bool; v_paid bool; v_required int;
begin
  select * into a from appointments where id = p_appointment;
  if not found then raise exception 'appointment not found'; end if;
  select * into f from firms where id = a.firm_id;

  -- 1. payment
  if a.invoice_id is not null then
    select * into v_inv from invoices where id = a.invoice_id;
    v_paid := v_inv.status = 'paid' or v_inv.total_minor = 0;
    v_items := v_items || jsonb_build_object('kind', 'payment', 'label', 'Pay the consultation fee', 'satisfied', v_paid,
                 'detail', case when v_paid then 'Paid.' else format('Invoice %s is %s.', v_inv.number, replace(v_inv.status::text, '_', ' ')) end,
                 'ref', v_inv.id);
    v_ready := v_ready and v_paid;
  end if;

  -- 2. the form's required questions, against the latest answers. A question shown only on a
  --    condition (show_if) is not counted: whether it applies is the browser's rule, not this one's.
  select ir.answers into v_answers from intake_responses ir where ir.appointment_id = a.id order by ir.created_at desc limit 1;
  select fm.* into v_form from intake_forms fm
   where fm.id = (select ir.form_id from intake_responses ir where ir.appointment_id = a.id order by ir.created_at desc limit 1);
  if v_form.id is null then
    select fm.* into v_form from intake_forms fm where fm.firm_id = a.firm_id and fm.is_active and fm.service_id = a.service_id limit 1;
  end if;
  if v_form.id is null then
    select fm.* into v_form from intake_forms fm where fm.firm_id = a.firm_id and fm.is_active and fm.service_id is null limit 1;
  end if;
  if v_form.id is not null and jsonb_typeof(v_form.schema -> 'questions') = 'array' then
    select coalesce(jsonb_agg(jsonb_build_object('key', q ->> 'key', 'label', q ->> 'label')), '[]'::jsonb), count(*) into v_missing, v_required
      from jsonb_array_elements(v_form.schema -> 'questions') q
     where (q ->> 'required')::bool is true and coalesce(q ->> 'type', 'text') <> 'file' and q -> 'show_if' is null
       and length(btrim(coalesce(v_answers ->> (q ->> 'key'), ''))) = 0;
    if v_required > 0 then
      v_items := v_items || jsonb_build_object('kind', 'intake', 'label', 'Answer the questions your firm asks before a consultation', 'satisfied', false,
                   'detail', format('%s still unanswered.', v_required), 'missing', v_missing, 'ref', v_form.id);
      v_ready := false;
    else
      v_items := v_items || jsonb_build_object('kind', 'intake', 'label', 'Answer the questions your firm asks before a consultation', 'satisfied', true, 'detail', 'Answered.', 'missing', '[]'::jsonb, 'ref', v_form.id);
    end if;
  end if;

  -- 3. documents the firm asked for on this consultation
  select coalesce(jsonb_agg(jsonb_build_object('id', dr.id, 'title', dr.title, 'due_on', dr.due_on) order by dr.requested_at), '[]'::jsonb) into v_open
    from document_requests dr where dr.appointment_id = a.id and dr.fulfilled_at is null and dr.cancelled_at is null;
  if jsonb_array_length(v_open) > 0 then
    v_items := v_items || jsonb_build_object('kind', 'documents', 'label', 'Send the documents your firm asked for', 'satisfied', false,
                 'detail', format('%s still to send.', jsonb_array_length(v_open)), 'open', v_open);
    v_ready := false;
  elsif exists (select 1 from document_requests dr where dr.appointment_id = a.id) then
    v_items := v_items || jsonb_build_object('kind', 'documents', 'label', 'Send the documents your firm asked for', 'satisfied', true, 'detail', 'All sent.', 'open', '[]'::jsonb);
  end if;

  -- 4. the firm's terms and privacy notice, at their current versions
  if firm_policies_published(a.firm_id) then
    v_terms := f.policies -> 'terms' ->> 'version'; v_privacy := f.policies -> 'privacy' ->> 'version';
    v_consent_ok := exists (select 1 from consent_records c where c.user_id = a.client_id and c.firm_id = a.firm_id and c.kind = 'terms' and c.version = v_terms)
                and exists (select 1 from consent_records c where c.user_id = a.client_id and c.firm_id = a.firm_id and c.kind = 'privacy' and c.version = v_privacy);
    v_items := v_items || jsonb_build_object('kind', 'consent', 'label', 'Accept the firm''s terms and privacy notice', 'satisfied', v_consent_ok,
                 'detail', case when v_consent_ok then 'Accepted.' else 'Not yet accepted in the app.' end);
    v_ready := v_ready and v_consent_ok;
  end if;

  -- 5. the firm's own check, only where the firm requires clearance before a client is taken on
  if f.conflict_checks_required then
    v_conflict_ok := conflict_cleared_for_appointment(a.id);
    v_items := v_items || jsonb_build_object('kind', 'conflict', 'label', 'The firm''s own checks', 'satisfied', v_conflict_ok,
                 'detail', case when v_conflict_ok then 'Cleared.' else 'A conflict check on this consultation has not been cleared.' end);
    v_ready := v_ready and v_conflict_ok;
  end if;

  return jsonb_build_object('appointment_id', a.id, 'status', a.status, 'held', a.status = 'pending',
                            'checkin_required', f.checkin_before_confirm, 'ready', v_ready, 'items', v_items);
end $$;
revoke execute on function public.appointment_checkin(uuid) from public, anon, authenticated;

-- What the API may ask. The client of the consultation sees every item but the conflict one
-- reduced to its label and state; the firm sees it all.
create or replace function public.appointment_readiness(p_appointment uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a appointments%rowtype; v jsonb; v_uid uuid := auth.uid();
begin
  select * into a from appointments where id = p_appointment;
  if not found then raise exception 'not permitted' using errcode = '42501'; end if;
  if not (a.client_id = v_uid or is_firm_member(a.firm_id)) then raise exception 'not permitted' using errcode = '42501'; end if;
  v := appointment_checkin(p_appointment);
  if not is_firm_member(a.firm_id) then
    v := v || jsonb_build_object('items', (
      select coalesce(jsonb_agg(case when i ->> 'kind' = 'conflict'
                                     then jsonb_build_object('kind', 'conflict', 'label', 'The firm''s own checks', 'satisfied', (i ->> 'satisfied')::bool,
                                                             'detail', case when (i ->> 'satisfied')::bool then 'Done.' else 'The firm is finishing its own checks; nothing is needed from you.' end)
                                     else i end order by ord), '[]'::jsonb)
        from jsonb_array_elements(v -> 'items') with ordinality as t(i, ord)));
  end if;
  return v;
end $$;
revoke execute on function public.appointment_readiness(uuid) from public, anon;
grant  execute on function public.appointment_readiness(uuid) to authenticated;

-- ---------------------------------------------------------------- 5. the client answers what is still missing
-- Answers are insert-once (migration 24) and stay so: a new row carries the old answers plus the
-- new ones, and the latest row is the one that counts.
create or replace function public.amend_intake_response(p_appointment uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a appointments%rowtype; v_prev intake_responses%rowtype; v_form uuid; v_id uuid;
begin
  select * into a from appointments where id = p_appointment;
  if not found or a.client_id is distinct from auth.uid() then raise exception 'not permitted' using errcode = '42501'; end if;
  if a.status not in ('pending', 'awaiting_payment', 'confirmed', 'rescheduled') then raise exception 'this consultation is %', a.status; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'answers must be an object'; end if;
  select * into v_prev from intake_responses where appointment_id = a.id order by created_at desc limit 1;
  v_form := v_prev.form_id;
  if v_form is null then
    select id into v_form from intake_forms where firm_id = a.firm_id and is_active and service_id = a.service_id limit 1;
  end if;
  if v_form is null then
    select id into v_form from intake_forms where firm_id = a.firm_id and is_active and service_id is null limit 1;
  end if;
  -- clock_timestamp(), not now(): an amendment made in the same transaction as the booking (a
  -- test, a script) must still sort after it, because "latest row wins" is the rule.
  insert into intake_responses (form_id, firm_id, appointment_id, client_id, answers, created_at)
  values (v_form, a.firm_id, a.id, a.client_id, coalesce(v_prev.answers, '{}'::jsonb) || p_answers, clock_timestamp())
  returning id into v_id;
  perform audit('intake.amended', 'appointment', a.id, a.firm_id, jsonb_build_object('response_id', v_id, 'keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p_answers) k)));
  return jsonb_build_object('response_id', v_id, 'readiness', appointment_checkin(a.id));
end $$;
revoke execute on function public.amend_intake_response(uuid, jsonb) from public, anon;
grant  execute on function public.amend_intake_response(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- 6. the firm confirms a held booking
create or replace function public.confirm_appointment(p_appointment uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a appointments%rowtype; v jsonb;
begin
  select * into a from appointments where id = p_appointment;
  if not found or not staff_w(a.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if a.status <> 'pending' then raise exception 'this consultation is %, not held', a.status; end if;
  v := appointment_checkin(a.id);
  if (v ->> 'checkin_required')::bool and not (v ->> 'ready')::bool then
    raise exception 'not ready: %', (select string_agg(i ->> 'label', '; ') from jsonb_array_elements(v -> 'items') i where not (i ->> 'satisfied')::bool);
  end if;
  update appointments set status = 'confirmed', hold_expires_at = null where id = a.id;
  perform audit('appointment.confirmed', 'appointment', a.id, a.firm_id, jsonb_build_object('reference', a.reference, 'ready', v -> 'ready'));
  perform enqueue_notification(a.client_id, a.firm_id, 'appointment_confirmed',
    jsonb_build_object('appointment_id', a.id, 'reference', a.reference, 'starts_at', a.starts_at));
  return jsonb_build_object('appointment_id', a.id, 'status', 'confirmed');
end $$;
revoke execute on function public.confirm_appointment(uuid) from public, anon;
grant  execute on function public.confirm_appointment(uuid) to authenticated;

-- The rule, whoever writes: with the switch on, a row does not become confirmed until it is
-- ready. Staff UPDATE on appointments is whole-row, so a direct PATCH meets the same trigger.
create or replace function public.guard_appointment_confirm() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed'
     and (select checkin_before_confirm from firms where id = new.firm_id) then
    v := appointment_checkin(new.id);
    if not (v ->> 'ready')::bool then
      raise exception 'this firm confirms a consultation only once what it asked for is in — %',
        (select string_agg(i ->> 'label', '; ') from jsonb_array_elements(v -> 'items') i where not (i ->> 'satisfied')::bool);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists appointments_guard_confirm on public.appointments;
create trigger appointments_guard_confirm before update of status on public.appointments
  for each row execute function public.guard_appointment_confirm();
revoke execute on function public.guard_appointment_confirm() from public, anon, authenticated;

-- ---------------------------------------------------------------- 7. booking, payment, reminders and release learn the hold
create or replace function public.book_appointment(
  p_firm uuid, p_service uuid, p_lawyer uuid, p_starts_at timestamptz,
  p_mode appointment_mode default 'virtual', p_client_timezone text default 'Africa/Lagos',
  p_intake jsonb default null, p_intake_form uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid := auth.uid(); v_svc services%rowtype; v_firm firms%rowtype; v_tz text;
        v_ends timestamptz; v_ref text; v_appt uuid; v_inv uuid; v_inv_no text;
        v_vat bigint := 0; v_total bigint := 0; v_status appointment_status;
begin
  if v_client is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  -- Ten an hour per person. This is the rule; the check in the server action is the front door.
  if not rate_limit_hit('booking', 10, interval '1 hour') then
    raise exception 'That is more than 10 attempts in an hour. Wait a moment and try again.'
      using errcode = '54000';
  end if;

  select * into v_firm from firms where id = p_firm;
  if not found or v_firm.status <> 'active' then raise exception 'this firm is not taking bookings'; end if;
  if not firm_policies_published(p_firm) then raise exception 'this firm has not published its terms and privacy notice yet'; end if;
  select * into v_svc  from services where id = p_service and firm_id = p_firm and is_active;
  if not found then raise exception 'service unavailable'; end if;
  if p_mode = 'virtual' and not v_svc.virtual_available then raise exception 'service not available virtually'; end if;
  if v_svc.requires_prepayment and v_svc.price_minor > 0 and v_firm.paystack_subaccount is null then
    raise exception 'this firm is not yet set up to receive payments';
  end if;
  select coalesce(p.timezone, v_firm.timezone) into v_tz from profiles p where p.id = p_lawyer;
  v_tz := coalesce(v_tz, v_firm.timezone);

  if not exists (select 1 from available_slots(p_firm, p_lawyer, p_service, (p_starts_at at time zone v_tz)::date) s
                 where s.starts_at = p_starts_at) then
    raise exception 'slot unavailable';
  end if;

  v_ends   := p_starts_at + make_interval(mins => v_svc.duration_min);
  v_ref    := next_reference(p_firm, 'appointment');
  -- With the firm's check-in switch on (migration 35) a free booking is held, not confirmed:
  -- the firm confirms it once what it asked for is in. A paid one is held after payment.
  v_status := case when v_svc.requires_prepayment and v_svc.price_minor > 0 then 'awaiting_payment'
                   when v_firm.checkin_before_confirm then 'pending' else 'confirmed' end;

  begin
    insert into appointments (firm_id, reference, client_id, lawyer_id, service_id, mode, status, starts_at, ends_at,
                              client_timezone, fee_minor, currency, hold_expires_at)
    values (p_firm, v_ref, v_client, p_lawyer, p_service, p_mode, v_status, p_starts_at, v_ends,
            p_client_timezone, v_svc.price_minor, v_svc.currency,
            case when v_status = 'awaiting_payment' then now() + interval '15 minutes' end)
    returning id into v_appt;
  exception when exclusion_violation then
    raise exception 'slot unavailable';
  end;

  if v_svc.price_minor > 0 then
    v_vat   := round(v_svc.price_minor * coalesce(v_firm.vat_rate, 0) / 100.0);
    v_total := v_svc.price_minor + v_vat;
    v_inv_no := next_reference(p_firm, 'invoice');
    insert into invoices (firm_id, number, client_id, appointment_id, currency, subtotal_minor, vat_minor, total_minor,
                          status, issued_at, due_at)
    values (p_firm, v_inv_no, v_client, v_appt, v_svc.currency, v_svc.price_minor, v_vat, v_total,
            'issued', now(), current_date)
    returning id into v_inv;
    insert into invoice_items (invoice_id, description, quantity, unit_minor)
    values (v_inv, format('%s (%s min)', v_svc.name, v_svc.duration_min), 1, v_svc.price_minor);
    update appointments set invoice_id = v_inv where id = v_appt;
  end if;

  if p_intake is not null then
    insert into intake_responses (form_id, firm_id, appointment_id, client_id, answers)
    values (p_intake_form, p_firm, v_appt, v_client, p_intake);
  end if;

  if v_status = 'confirmed' then
    perform enqueue_notification(v_client, p_firm, 'appointment_confirmed',
      jsonb_build_object('appointment_id', v_appt, 'reference', v_ref, 'starts_at', p_starts_at));
  elsif v_status = 'pending' then
    perform enqueue_notification(v_client, p_firm, 'appointment_held',
      jsonb_build_object('appointment_id', v_appt, 'reference', v_ref, 'starts_at', p_starts_at));
  end if;

  return jsonb_build_object('appointment_id', v_appt, 'reference', v_ref, 'status', v_status,
                            'invoice_id', v_inv, 'invoice_number', v_inv_no,
                            'amount_minor', v_total, 'currency', v_svc.currency,
                            'paystack_subaccount', v_firm.paystack_subaccount,
                            'hold_expires_at', case when v_status = 'awaiting_payment' then now() + interval '15 minutes' end);
end $$;

create or replace function public.record_payment(
  p_provider text, p_provider_ref text, p_invoice_number text,
  p_amount_minor bigint, p_currency currency, p_status payment_status, p_raw jsonb default '{}',
  p_subaccount text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype; v_pay uuid; v_appt appointments%rowtype; v_expected text;
begin
  select * into v_inv from invoices where number = p_invoice_number for update;
  if not found then raise exception 'unknown invoice %', p_invoice_number; end if;
  select paystack_subaccount into v_expected from firms where id = v_inv.firm_id;

  -- money that did not settle to the firm's own subaccount confirms nothing: it is recorded as a
  -- failed payment carrying the mismatch, the firm is told, and the webhook is acknowledged
  if p_status = 'succeeded' and (v_expected is null or p_subaccount is distinct from v_expected) then
    insert into payments (invoice_id, provider, provider_ref, status, amount_minor, currency, paid_at, raw)
    values (v_inv.id, p_provider, p_provider_ref, 'failed', p_amount_minor, p_currency, null,
            coalesce(p_raw, '{}') || jsonb_build_object('settlement_mismatch', true, 'reported_subaccount', p_subaccount, 'expected_subaccount', v_expected))
    on conflict (provider_ref) do nothing
    returning id into v_pay;
    if v_pay is null then return jsonb_build_object('duplicate', true, 'invoice_status', v_inv.status); end if;
    perform audit('payment.settlement_mismatch', 'payment', v_pay, v_inv.firm_id,
                  jsonb_build_object('provider', p_provider, 'ref', p_provider_ref, 'amount_minor', p_amount_minor,
                                     'reported_subaccount', p_subaccount, 'expected_subaccount', v_expected));
    perform enqueue_firm_notification(v_inv.firm_id, 'settlement_mismatch',
      jsonb_build_object('invoice_number', v_inv.number, 'amount_minor', p_amount_minor, 'currency', p_currency,
                         'reported_subaccount', p_subaccount, 'provider_ref', p_provider_ref));
    return jsonb_build_object('payment_id', v_pay, 'settlement_mismatch', true, 'invoice_status', v_inv.status, 'appointment_id', v_inv.appointment_id);
  end if;

  insert into payments (invoice_id, provider, provider_ref, status, amount_minor, currency, paid_at, raw)
  values (v_inv.id, p_provider, p_provider_ref, p_status, p_amount_minor, p_currency,
          case when p_status = 'succeeded' then now() end, p_raw)
  on conflict (provider_ref) do nothing
  returning id into v_pay;
  if v_pay is null then
    return jsonb_build_object('duplicate', true, 'invoice_status', v_inv.status);
  end if;

  if p_status = 'succeeded' then
    if p_currency <> v_inv.currency then raise exception 'currency mismatch on invoice %', p_invoice_number; end if;
    update invoices
       set paid_minor = paid_minor + p_amount_minor,
           status = case when paid_minor + p_amount_minor >= total_minor then 'paid'::invoice_status
                         else 'partially_paid'::invoice_status end
     where id = v_inv.id
     returning * into v_inv;

    if v_inv.status = 'paid' and v_inv.appointment_id is not null then
      -- Paid. With the firm's check-in switch on (migration 35) the booking is held for the firm
      -- to confirm once what it asked for is in; otherwise paid means confirmed, as before.
      update appointments a set status = case when f.checkin_before_confirm then 'pending'::appointment_status else 'confirmed'::appointment_status end,
                                hold_expires_at = null
        from firms f
       where a.id = v_inv.appointment_id and f.id = a.firm_id and a.status in ('pending','awaiting_payment')
       returning a.* into v_appt;
      if v_appt.id is not null then
        perform enqueue_notification(v_appt.client_id, v_appt.firm_id,
          case when v_appt.status = 'confirmed' then 'appointment_confirmed' else 'appointment_held' end,
          jsonb_build_object('appointment_id', v_appt.id, 'reference', v_appt.reference, 'starts_at', v_appt.starts_at));
      end if;
    end if;
    perform enqueue_notification(v_inv.client_id, v_inv.firm_id, 'payment_confirmed',
      jsonb_build_object('invoice_number', v_inv.number, 'amount_minor', p_amount_minor, 'currency', p_currency));
  end if;

  perform audit('payment.' || p_status, 'payment', v_pay, v_inv.firm_id,
                jsonb_build_object('provider', p_provider, 'ref', p_provider_ref, 'amount_minor', p_amount_minor, 'subaccount', p_subaccount));
  return jsonb_build_object('payment_id', v_pay, 'invoice_status', v_inv.status, 'appointment_id', v_inv.appointment_id);
end $$;

create or replace function public.enqueue_appointment_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_key text; v_win interval;
begin
  for r in select * from appointments where status in ('confirmed','rescheduled') and starts_at between now() and now() + interval '25 hours' loop
    foreach v_key in array array['24h','1h','10m','now'] loop
      v_win := case v_key when '24h' then interval '24 hours' when '1h' then interval '1 hour'
                          when '10m' then interval '10 minutes' else interval '0' end;
      if not (v_key = any(r.reminders_sent)) and r.starts_at - now() <= v_win then
        perform enqueue_notification(r.client_id, r.firm_id, 'appointment_reminder_' || v_key,
          jsonb_build_object('appointment_id', r.id, 'reference', r.reference, 'starts_at', r.starts_at));
        if r.lawyer_id is not null and v_key in ('1h','10m') then
          perform enqueue_notification(r.lawyer_id, r.firm_id, 'appointment_reminder_' || v_key,
            jsonb_build_object('appointment_id', r.id, 'reference', r.reference, 'starts_at', r.starts_at));
        end if;
        update appointments set reminders_sent = reminders_sent || v_key where id = r.id;
        n := n + 1;
      end if;
    end loop;
  end loop;
  -- A held booking (migration 35): the client is told once, two days out, what is still
  -- outstanding, and the lawyer once, a day out, that it is theirs to confirm.
  for r in select * from appointments where status = 'pending' and starts_at between now() and now() + interval '49 hours' loop
    if not ('checkin' = any(r.reminders_sent)) and r.starts_at - now() <= interval '48 hours' then
      perform enqueue_notification(r.client_id, r.firm_id, 'appointment_checkin_due',
        jsonb_build_object('appointment_id', r.id, 'reference', r.reference, 'starts_at', r.starts_at));
      update appointments set reminders_sent = reminders_sent || 'checkin'::text where id = r.id;
      n := n + 1;
    end if;
    if r.lawyer_id is not null and not ('unconfirmed' = any(r.reminders_sent)) and r.starts_at - now() <= interval '24 hours' then
      perform enqueue_notification(r.lawyer_id, r.firm_id, 'appointment_awaiting_confirmation',
        jsonb_build_object('appointment_id', r.id, 'reference', r.reference, 'starts_at', r.starts_at));
      update appointments set reminders_sent = reminders_sent || 'unconfirmed'::text where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.release_expired_holds() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with released as (
    -- A payment hold that ran out, or a held booking (migration 35) nobody confirmed by the time
    -- it was due. A paid invoice on the second kind is left as it is: the firm refunds by hand.
    update appointments set status = 'cancelled',
                            cancellation_reason = case when status = 'awaiting_payment' then 'payment_timeout' else 'not_confirmed' end,
                            hold_expires_at = null
     where (status = 'awaiting_payment' and hold_expires_at < now())
        or (status = 'pending' and starts_at < now())
    returning id, invoice_id),
  voided as (
    update invoices i set status = 'cancelled' from released r
     where i.id = r.invoice_id and i.status in ('draft','issued')
    returning i.id)
  select count(*) into n from released;
  return n;
end $$;
