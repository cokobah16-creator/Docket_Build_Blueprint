-- Docket v0.2 — business functions, triggers and job functions
-- Server-side flows live here so the frontend never decides anything that matters.

-- ---------------------------------------------------------------- audit
create or replace function public.audit(p_action text, p_entity text, p_entity_id uuid, p_firm uuid, p_meta jsonb default '{}')
returns void language sql security definer set search_path = public as
$$ insert into audit_log (firm_id, actor_id, action, entity, entity_id, meta)
   values (p_firm, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_meta, '{}')) $$;

create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
        v_meta jsonb := '{}';
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(key, value), '{}') into v_meta
    from jsonb_each(to_jsonb(new)) where to_jsonb(old) -> key is distinct from value;
    v_meta := jsonb_build_object('changed', v_meta - 'raw');
  end if;
  insert into audit_log (firm_id, actor_id, action, entity, entity_id, meta)
  values ((v_row ->> 'firm_id')::uuid, auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name,
          (v_row ->> 'id')::uuid, v_meta);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['firms','firm_members','services','appointments','matters','matter_parties',
                           'updates','documents','document_versions','invoices','payments','consent_records'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- reference numbering
create or replace function public.next_reference(p_firm uuid, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare v_year int := extract(year from now())::int; v_val int; v_prefix text;
begin
  insert into firm_counters (firm_id, kind, year, value) values (p_firm, p_kind, v_year, 1)
  on conflict (firm_id, kind, year) do update set value = firm_counters.value + 1
  returning value into v_val;
  select reference_prefix into v_prefix from firms where id = p_firm;
  return case p_kind
    when 'appointment' then format('%s-%s-%s', v_prefix, v_year, lpad(v_val::text, 6, '0'))
    when 'matter'      then format('%s-M-%s-%s', v_prefix, v_year, lpad(v_val::text, 6, '0'))
    when 'invoice'     then format('%s-INV-%s-%s', v_prefix, v_year, lpad(v_val::text, 6, '0'))
    else                    format('%s-%s-%s-%s', v_prefix, upper(p_kind), v_year, lpad(v_val::text, 6, '0'))
  end;
end $$;

-- ---------------------------------------------------------------- profile bootstrap from Supabase Auth
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, phone, full_name)
  values (new.id, new.email, new.phone, coalesce(new.raw_user_meta_data ->> 'full_name', null))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- notifications
-- Fan out one event to the user's channels: in-app always, push always, the preferred channel,
-- and email when known. Anything the user disabled in notification_preferences is skipped.
create or replace function public.enqueue_notification(p_user uuid, p_firm uuid, p_event text, p_payload jsonb, p_send_after timestamptz default now())
returns void language plpgsql security definer set search_path = public as $$
declare v_pref channel; v_email text; v_ch channel; v_channels channel[];
begin
  select preferred_channel, email into v_pref, v_email from profiles where id = p_user;
  v_channels := array['in_app'::channel, 'push'::channel];
  if v_pref not in ('in_app','push') then v_channels := v_channels || v_pref; end if;
  if v_email is not null and v_pref <> 'email' then v_channels := v_channels || 'email'::channel; end if;
  foreach v_ch in array v_channels loop
    if not exists (select 1 from notification_preferences np
                   where np.user_id = p_user and np.event = p_event and np.channel = v_ch and not np.enabled) then
      insert into notifications (user_id, firm_id, channel, event, payload, status, send_after, sent_at)
      values (p_user, p_firm, v_ch, p_event, p_payload,
              case when v_ch = 'in_app' then 'sent' else 'queued' end, p_send_after,
              case when v_ch = 'in_app' then now() end);
    end if;
  end loop;
end $$;

-- client-visible timeline entries notify every client-side party on the matter
create or replace function public.notify_matter_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.visibility = 'client' then
    for r in select user_id from matter_parties where matter_id = new.matter_id and role in ('client','contact') loop
      perform enqueue_notification(r.user_id, new.firm_id, 'matter_update',
        jsonb_build_object('matter_id', new.matter_id, 'update_id', new.id, 'kind', new.kind, 'title', new.title));
    end loop;
  end if;
  return new;
end $$;
create trigger updates_notify after insert on updates for each row execute function public.notify_matter_update();

-- appointment status changes notify the client (confirmations are sent by record_payment / book_appointment)
create or replace function public.notify_appointment_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('cancelled','rescheduled','completed') then
    perform enqueue_notification(new.client_id, new.firm_id, 'appointment_' || new.status,
      jsonb_build_object('appointment_id', new.id, 'reference', new.reference, 'starts_at', new.starts_at));
  end if;
  return new;
end $$;
create trigger appointments_notify after update of status on appointments
  for each row execute function public.notify_appointment_status();

-- new message notifies the other side
create or replace function public.notify_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_sender_is_staff bool;
begin
  v_sender_is_staff := exists (select 1 from firm_members where firm_id = new.firm_id and user_id = new.sender_id);
  if v_sender_is_staff then
    if new.matter_id is not null then
      for r in select user_id from matter_parties where matter_id = new.matter_id and role in ('client','contact') loop
        perform enqueue_notification(r.user_id, new.firm_id, 'new_message', jsonb_build_object('message_id', new.id, 'matter_id', new.matter_id));
      end loop;
    elsif new.appointment_id is not null then
      for r in select client_id as user_id from appointments where id = new.appointment_id loop
        perform enqueue_notification(r.user_id, new.firm_id, 'new_message', jsonb_build_object('message_id', new.id, 'appointment_id', new.appointment_id));
      end loop;
    end if;
  else
    for r in select user_id from matter_lawyers where matter_id = new.matter_id
             union select lawyer_id from appointments where id = new.appointment_id and lawyer_id is not null loop
      perform enqueue_notification(r.user_id, new.firm_id, 'new_message', jsonb_build_object('message_id', new.id, 'matter_id', new.matter_id, 'appointment_id', new.appointment_id));
    end loop;
  end if;
  return new;
end $$;
create trigger messages_notify after insert on messages for each row execute function public.notify_message();

-- ---------------------------------------------------------------- booking engine
-- Slots for one lawyer on one date, computed in the lawyer's timezone from availability rules,
-- minus exceptions, breaks, existing live appointments, and the daily cap. Callable by anon for the wizard.
create or replace function public.available_slots(p_firm uuid, p_lawyer uuid, p_service uuid, p_date date)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_tz text; v_dur int; r record; v_start timestamptz; v_end timestamptz;
        v_day_start timestamptz; v_day_end timestamptz; v_count int;
begin
  select coalesce(p.timezone, f.timezone) into v_tz from firms f left join profiles p on p.id = p_lawyer where f.id = p_firm;
  select duration_min into v_dur from services where id = p_service and firm_id = p_firm and is_active;
  if v_tz is null or v_dur is null then return; end if;
  if exists (select 1 from availability_exceptions e
             where e.lawyer_id = p_lawyer and e.on_date = p_date and not e.is_available and e.start_time is null) then
    return;
  end if;
  v_day_start := (p_date::timestamp) at time zone v_tz;
  v_day_end   := ((p_date + 1)::timestamp) at time zone v_tz;
  select count(*) into v_count from appointments ap
   where ap.lawyer_id = p_lawyer and ap.status in ('pending','awaiting_payment','confirmed','rescheduled')
     and ap.starts_at >= v_day_start and ap.starts_at < v_day_end;

  for r in select * from availability_rules a
           where a.firm_id = p_firm and a.lawyer_id = p_lawyer and a.weekday = extract(dow from p_date)::int
           order by a.start_time loop
    exit when v_count >= r.max_per_day;
    v_start := (p_date + r.start_time) at time zone v_tz;
    while v_start + make_interval(mins => v_dur) <= (p_date + r.end_time) at time zone v_tz loop
      v_end := v_start + make_interval(mins => v_dur);
      if  v_start >= now() + interval '2 hours'                                         -- minimum lead time
      and not (r.break_start is not null and r.break_end is not null
               and tstzrange(v_start, v_end) && tstzrange((p_date + r.break_start) at time zone v_tz,
                                                            (p_date + r.break_end)   at time zone v_tz))
      and not exists (select 1 from availability_exceptions e
                      where e.lawyer_id = p_lawyer and e.on_date = p_date and not e.is_available
                        and e.start_time is not null
                        and tstzrange(v_start, v_end) && tstzrange((p_date + e.start_time) at time zone v_tz,
                                                                    (p_date + e.end_time)   at time zone v_tz))
      and not exists (select 1 from appointments ap
                      where ap.lawyer_id = p_lawyer and ap.status in ('pending','awaiting_payment','confirmed','rescheduled')
                        and tstzrange(ap.starts_at, ap.ends_at) && tstzrange(v_start, v_end))
      then
        starts_at := v_start; ends_at := v_end; return next;
      end if;
      v_start := v_start + make_interval(mins => r.slot_min);
    end loop;
  end loop;
end $$;

-- Book: validates the slot, creates the appointment (held 15 minutes when prepayment is required),
-- issues the invoice with VAT, stores the intake answers, and returns what the payment step needs.
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
  select * into v_svc  from services where id = p_service and firm_id = p_firm and is_active;
  if not found then raise exception 'service unavailable'; end if;
  if p_mode = 'virtual' and not v_svc.virtual_available then raise exception 'service not available virtually'; end if;
  select * into v_firm from firms where id = p_firm;
  select coalesce(p.timezone, v_firm.timezone) into v_tz from profiles p where p.id = p_lawyer;
  v_tz := coalesce(v_tz, v_firm.timezone);

  if not exists (select 1 from available_slots(p_firm, p_lawyer, p_service, (p_starts_at at time zone v_tz)::date) s
                 where s.starts_at = p_starts_at) then
    raise exception 'slot unavailable';
  end if;

  v_ends   := p_starts_at + make_interval(mins => v_svc.duration_min);
  v_ref    := next_reference(p_firm, 'appointment');
  v_status := case when v_svc.requires_prepayment and v_svc.price_minor > 0 then 'awaiting_payment' else 'confirmed' end;

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
  end if;

  return jsonb_build_object('appointment_id', v_appt, 'reference', v_ref, 'status', v_status,
                            'invoice_id', v_inv, 'invoice_number', v_inv_no,
                            'amount_minor', v_total, 'currency', v_svc.currency,
                            'hold_expires_at', case when v_status = 'awaiting_payment' then now() + interval '15 minutes' end);
end $$;

-- Cancel: the client may cancel their own future appointment; staff may cancel any in their firm.
create or replace function public.cancel_appointment(p_appointment uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_appt appointments%rowtype;
begin
  select * into v_appt from appointments where id = p_appointment for update;
  if not found then raise exception 'appointment not found'; end if;
  if not (v_appt.client_id = auth.uid() or staff_w(v_appt.firm_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_appt.status in ('completed','cancelled','no_show') then raise exception 'appointment already %', v_appt.status; end if;
  if v_appt.client_id = auth.uid() and v_appt.starts_at < now() then raise exception 'appointment already started'; end if;
  update appointments set status = 'cancelled', hold_expires_at = null, cancellation_reason = p_reason where id = p_appointment;
  update invoices set status = 'cancelled' where id = v_appt.invoice_id and status in ('draft','issued');
  perform audit('appointment.cancelled', 'appointment', p_appointment, v_appt.firm_id, jsonb_build_object('reason', p_reason));
end $$;

-- ---------------------------------------------------------------- payments (called by webhook Edge Functions with the service role)
create or replace function public.record_payment(
  p_provider text, p_provider_ref text, p_invoice_number text,
  p_amount_minor bigint, p_currency currency, p_status payment_status, p_raw jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype; v_pay uuid; v_appt appointments%rowtype;
begin
  select * into v_inv from invoices where number = p_invoice_number for update;
  if not found then raise exception 'unknown invoice %', p_invoice_number; end if;

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
      update appointments set status = 'confirmed', hold_expires_at = null
       where id = v_inv.appointment_id and status in ('pending','awaiting_payment')
       returning * into v_appt;
      if v_appt.id is not null then
        perform enqueue_notification(v_appt.client_id, v_appt.firm_id, 'appointment_confirmed',
          jsonb_build_object('appointment_id', v_appt.id, 'reference', v_appt.reference, 'starts_at', v_appt.starts_at));
      end if;
    end if;
    perform enqueue_notification(v_inv.client_id, v_inv.firm_id, 'payment_confirmed',
      jsonb_build_object('invoice_number', v_inv.number, 'amount_minor', p_amount_minor, 'currency', p_currency));
  end if;

  perform audit('payment.' || p_status, 'payment', v_pay, v_inv.firm_id,
                jsonb_build_object('provider', p_provider, 'ref', p_provider_ref, 'amount_minor', p_amount_minor));
  return jsonb_build_object('payment_id', v_pay, 'invoice_status', v_inv.status, 'appointment_id', v_inv.appointment_id);
end $$;

-- ---------------------------------------------------------------- the court-update form (the retention engine)
create or replace function public.post_court_update(
  p_matter uuid, p_outcome text, p_occurred_at timestamptz default now(), p_court_name text default null,
  p_adjourned_at_instance_of text default null, p_next_date timestamptz default null, p_next_purpose text default null,
  p_note_to_client text default null, p_internal_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_m matters%rowtype; v_tz text; v_title text; v_update uuid; v_next_txt text;
begin
  select * into v_m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  if not staff_w(v_m.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_outcome not in ('hearing_held','adjourned','ruling_delivered','judgment_delivered','struck_out','stood_down','mention','court_did_not_sit') then
    raise exception 'unknown outcome %', p_outcome;
  end if;
  select coalesce(p.timezone, f.timezone) into v_tz from firms f left join profiles p on p.id = auth.uid() where f.id = v_m.firm_id;
  v_next_txt := case when p_next_date is not null
                     then to_char(p_next_date at time zone v_tz, 'FMDD Mon YYYY')
                          || coalesce(' for ' || p_next_purpose, '') end;

  v_title := case p_outcome
    when 'hearing_held'       then 'Hearing held'
    when 'adjourned'          then 'Adjourned' || coalesce(' at the instance of ' || p_adjourned_at_instance_of, '')
                                   || coalesce(' to ' || v_next_txt, '')
    when 'ruling_delivered'   then 'Ruling delivered'
    when 'judgment_delivered' then 'Judgment delivered'
    when 'struck_out'         then 'Matter struck out'
    when 'stood_down'         then 'Matter stood down'
    when 'mention'            then 'Matter came up for mention'
    when 'court_did_not_sit'  then 'Court did not sit'
  end;
  if p_outcome <> 'adjourned' and v_next_txt is not null then
    v_title := v_title || ' — next date ' || v_next_txt;
  end if;

  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
  values (p_matter, v_m.firm_id, 'court_sitting', 'client', v_title, p_note_to_client,
          jsonb_build_object('outcome', p_outcome, 'court_name', coalesce(p_court_name, v_m.court_name),
                             'adjourned_at_instance_of', p_adjourned_at_instance_of,
                             'next_date', p_next_date, 'next_purpose', p_next_purpose),
          p_occurred_at, auth.uid())
  returning id into v_update;

  if p_internal_note is not null and length(trim(p_internal_note)) > 0 then
    insert into updates (matter_id, firm_id, kind, visibility, title, body, occurred_at, posted_by)
    values (p_matter, v_m.firm_id, 'note', 'internal', 'Internal note — ' || v_title, p_internal_note, p_occurred_at, auth.uid());
  end if;

  -- close the court event this sitting answers, then open the next one
  update court_events set outcome_update_id = v_update
   where matter_id = p_matter and outcome_update_id is null
     and (scheduled_at at time zone v_tz)::date = (p_occurred_at at time zone v_tz)::date;

  if p_next_date is not null then
    insert into court_events (matter_id, firm_id, scheduled_at, court_name, purpose)
    values (p_matter, v_m.firm_id, p_next_date, coalesce(p_court_name, v_m.court_name), p_next_purpose);
    update matters set next_event_at = p_next_date, next_event_note = p_next_purpose,
                       court_name = coalesce(p_court_name, court_name) where id = p_matter;
  else
    update matters set next_event_at = null, next_event_note = null where id = p_matter;
  end if;

  return v_update;
end $$;

-- ---------------------------------------------------------------- consultation notes
-- Client-visible summary and internal notes are stored apart; the summary is echoed to the matter timeline.
create or replace function public.save_consultation_notes(
  p_appointment uuid, p_client_summary text, p_advice_given text default null,
  p_follow_up text default null, p_internal_notes text default null, p_mark_completed bool default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_appt appointments%rowtype; v_note uuid;
begin
  select * into v_appt from appointments where id = p_appointment;
  if not found then raise exception 'appointment not found'; end if;
  if not staff_w(v_appt.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;

  insert into consultation_notes (firm_id, appointment_id, matter_id, lawyer_id, client_summary, advice_given, follow_up)
  values (v_appt.firm_id, p_appointment, v_appt.matter_id, auth.uid(), p_client_summary, p_advice_given, p_follow_up)
  on conflict (appointment_id) do update
    set client_summary = excluded.client_summary, advice_given = excluded.advice_given,
        follow_up = excluded.follow_up, updated_at = now()
  returning id into v_note;

  if p_internal_notes is not null then
    insert into consultation_internal_notes (firm_id, appointment_id, body)
    values (v_appt.firm_id, p_appointment, p_internal_notes)
    on conflict (appointment_id) do update set body = excluded.body, updated_at = now();
  end if;

  if v_appt.matter_id is not null then
    insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
    values (v_appt.matter_id, v_appt.firm_id, 'consultation', 'client', 'Consultation completed',
            concat_ws(E'\n\n', p_client_summary, nullif('Advice: ' || p_advice_given, 'Advice: '),
                      nullif('Follow-up: ' || p_follow_up, 'Follow-up: ')),
            jsonb_build_object('appointment_id', p_appointment), v_appt.starts_at, auth.uid());
  end if;

  if p_mark_completed and v_appt.status in ('confirmed','rescheduled') then
    update appointments set status = 'completed' where id = p_appointment;
  end if;

  perform audit('consultation_notes.saved', 'appointment', p_appointment, v_appt.firm_id, '{}');
  return v_note;
end $$;

-- ---------------------------------------------------------------- invites
create or replace function public.accept_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv invites%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_inv from invites where token = p_token and accepted_by is null and expires_at > now() for update;
  if not found then raise exception 'invite invalid or expired'; end if;
  if v_inv.matter_id is not null then
    insert into matter_parties (matter_id, firm_id, user_id, role, invited_by)
    values (v_inv.matter_id, v_inv.firm_id, auth.uid(), v_inv.role, v_inv.created_by)
    on conflict (matter_id, user_id) do nothing;
  end if;
  update invites set accepted_by = auth.uid() where id = v_inv.id;
  perform audit('invite.accepted', 'invite', v_inv.id, v_inv.firm_id, jsonb_build_object('matter_id', v_inv.matter_id));
  return jsonb_build_object('firm_id', v_inv.firm_id, 'matter_id', v_inv.matter_id);
end $$;

-- ---------------------------------------------------------------- scheduled-job functions (wired to pg_cron in the next migration)
create or replace function public.release_expired_holds() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with released as (
    update appointments set status = 'cancelled', cancellation_reason = 'payment_timeout', hold_expires_at = null
     where status = 'awaiting_payment' and hold_expires_at < now()
    returning id, invoice_id),
  voided as (
    update invoices i set status = 'cancelled' from released r
     where i.id = r.invoice_id and i.status in ('draft','issued')
    returning i.id)
  select count(*) into n from released;
  return n;
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
  return n;
end $$;

create or replace function public.enqueue_court_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; p record; n int := 0; v_key text; v_win interval;
begin
  for r in select * from court_events where outcome_update_id is null and scheduled_at between now() and now() + interval '4 days' loop
    foreach v_key in array array['t3','t1'] loop
      v_win := case v_key when 't3' then interval '3 days' else interval '1 day' end;
      if not (v_key = any(r.reminders_sent)) and r.scheduled_at - now() <= v_win then
        for p in select user_id from matter_parties where matter_id = r.matter_id and role in ('client','contact')
                 union select user_id from matter_lawyers where matter_id = r.matter_id loop
          perform enqueue_notification(p.user_id, r.firm_id, 'court_date_' || v_key,
            jsonb_build_object('matter_id', r.matter_id, 'scheduled_at', r.scheduled_at, 'purpose', r.purpose, 'court_name', r.court_name));
        end loop;
        update court_events set reminders_sent = reminders_sent || v_key where id = r.id;
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;

create or replace function public.mark_overdue_invoices() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update invoices set status = 'overdue' where status in ('issued','partially_paid') and due_at < current_date and appointment_id is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- lawyers get a morning digest of court sittings that happened without an update being posted
create or replace function public.digest_sittings_without_update() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select ce.id, ce.firm_id, ce.matter_id, ce.scheduled_at, ml.user_id
             from court_events ce join matter_lawyers ml on ml.matter_id = ce.matter_id
            where ce.outcome_update_id is null and ce.scheduled_at < now() - interval '6 hours'
              and ce.scheduled_at > now() - interval '7 days' loop
    perform enqueue_notification(r.user_id, r.firm_id, 'sitting_without_update',
      jsonb_build_object('matter_id', r.matter_id, 'scheduled_at', r.scheduled_at, 'court_event_id', r.id));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- execute grants
-- internal functions: service role and jobs only
revoke execute on function public.audit(text,text,uuid,uuid,jsonb) from public, anon, authenticated;
revoke execute on function public.next_reference(uuid,text) from public, anon, authenticated;
revoke execute on function public.enqueue_notification(uuid,uuid,text,jsonb,timestamptz) from public, anon, authenticated;
revoke execute on function public.record_payment(text,text,text,bigint,currency,payment_status,jsonb) from public, anon, authenticated;
revoke execute on function public.release_expired_holds() from public, anon, authenticated;
revoke execute on function public.enqueue_appointment_reminders() from public, anon, authenticated;
revoke execute on function public.enqueue_court_reminders() from public, anon, authenticated;
revoke execute on function public.mark_overdue_invoices() from public, anon, authenticated;
revoke execute on function public.digest_sittings_without_update() from public, anon, authenticated;
-- user-facing functions
grant execute on function public.available_slots(uuid,uuid,uuid,date) to anon, authenticated;
grant execute on function public.book_appointment(uuid,uuid,uuid,timestamptz,appointment_mode,text,jsonb,uuid) to authenticated;
grant execute on function public.cancel_appointment(uuid,text) to authenticated;
grant execute on function public.post_court_update(uuid,text,timestamptz,text,text,timestamptz,text,text,text) to authenticated;
grant execute on function public.save_consultation_notes(uuid,text,text,text,text,bool) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
