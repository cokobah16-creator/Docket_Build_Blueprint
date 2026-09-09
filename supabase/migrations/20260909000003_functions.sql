-- Docket slice 0 — migration 3: server-side business flows (blueprint §5.8–§5.13).
-- Clients and staff never write appointments, payments or court updates by
-- hand; they call these SECURITY DEFINER functions, which validate, write,
-- notify and audit in one transaction.

-- ---------------------------------------------------------------------------
-- Internal plumbing: audit trail and the notification outbox
-- ---------------------------------------------------------------------------

create function app.audit(
  p_firm uuid, p_action text, p_entity text, p_entity_id text,
  p_detail jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = public
as $$
  insert into public.audit_log (firm_id, actor_id, action, entity, entity_id, detail)
  values (p_firm, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb));
$$;

-- Queue one notification per requested channel, honouring the user's
-- per-event/channel preferences. dispatch-notifications drains the queue.
create function app.notify(
  p_user uuid, p_firm uuid, p_event text, p_title text, p_body text,
  p_url text default null,
  p_channels public.notification_channel[] default '{in_app}',
  p_scheduled timestamptz default now(),
  p_dedupe text default null,
  p_appointment uuid default null,
  p_matter uuid default null
) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_channel public.notification_channel;
  v_count integer := 0;
  v_inserted uuid;
begin
  foreach v_channel in array p_channels loop
    if exists (
      select 1 from public.notification_preferences
      where user_id = p_user and event = p_event and channel = v_channel and not enabled
    ) then
      continue;
    end if;
    insert into public.notifications
      (firm_id, user_id, channel, event, title, body, url,
       scheduled_for, dedupe_key, appointment_id, matter_id)
    values
      (p_firm, p_user, v_channel, p_event, p_title, p_body, p_url,
       p_scheduled,
       case when p_dedupe is null then null else p_dedupe || ':' || v_channel end,
       p_appointment, p_matter)
    on conflict (dedupe_key) do nothing
    returning id into v_inserted;
    if v_inserted is not null then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

create function app.next_matter_reference(p_firm uuid) returns text
language plpgsql security definer set search_path = public
as $$
declare v_n integer; v_prefix text;
begin
  update public.firms
  set matter_counter = matter_counter + 1
  where id = p_firm
  returning matter_counter, reference_prefix into v_n, v_prefix;
  if v_n is null then raise exception 'unknown firm'; end if;
  return format('%s/%s/%s', v_prefix, to_char(now(), 'YYYY'), lpad(v_n::text, 4, '0'));
end $$;

create function app.next_invoice_number(p_firm uuid) returns text
language plpgsql security definer set search_path = public
as $$
declare v_n integer; v_prefix text;
begin
  update public.firms
  set invoice_counter = invoice_counter + 1
  where id = p_firm
  returning invoice_counter, reference_prefix into v_n, v_prefix;
  if v_n is null then raise exception 'unknown firm'; end if;
  return format('INV-%s-%s', v_prefix, lpad(v_n::text, 6, '0'));
end $$;

create function app.void_unpaid_invoice(p_invoice uuid) returns void
language sql security definer set search_path = public
as $$
  update public.invoices
  set status = 'void', voided_at = now()
  where id = p_invoice and status in ('draft', 'issued', 'overdue');
$$;

create function app.court_outcome_label(p public.court_outcome) returns text
language sql immutable
as $$
  select case p
    when 'hearing_held'       then 'Hearing held'
    when 'adjourned'          then 'Adjourned'
    when 'mention'            then 'Matter mentioned'
    when 'judgment_delivered' then 'Judgment delivered'
    when 'ruling_delivered'   then 'Ruling delivered'
    when 'struck_out'         then 'Struck out'
    when 'settled'            then 'Settled'
    when 'discontinued'       then 'Discontinued'
    else 'Court update'
  end
$$;

-- ---------------------------------------------------------------------------
-- available_slots: the only way the public asks "when can I see a lawyer?"
-- Slots are computed in the lawyer's timezone from weekly rules minus breaks,
-- date exceptions, live appointments and the daily cap, with a 2-hour lead
-- time. Returns UTC instants; render in whatever zone the viewer needs.
-- ---------------------------------------------------------------------------

create function public.available_slots(
  p_firm uuid, p_lawyer uuid, p_service uuid, p_date date
) returns table (slot_starts_at timestamptz, slot_ends_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_tz text;
  v_duration integer;
  v_dow integer;
  v_exc public.availability_exceptions%rowtype;
  v_cap integer;
  v_live integer;
  v_rule record;
  v_break record;
  v_win_start time;
  v_win_end time;
  v_m integer;      -- minutes since local midnight
  v_m_end integer;
  v_ok boolean;
  v_local_start timestamp;
  v_ts_start timestamptz;
  v_ts_end timestamptz;
begin
  select lp.timezone into v_tz
  from public.lawyer_profiles lp
  where lp.id = p_lawyer and lp.firm_id = p_firm and lp.is_bookable;
  if not found then return; end if;

  select s.duration_minutes into v_duration
  from public.services s
  where s.id = p_service and s.firm_id = p_firm and s.is_active;
  if not found then return; end if;

  v_dow := extract(dow from p_date)::integer;

  select * into v_exc
  from public.availability_exceptions e
  where e.lawyer_id = p_lawyer and e.on_date = p_date;
  if v_exc.id is not null and v_exc.is_closed then return; end if;

  select min(r.daily_cap) into v_cap
  from public.availability_rules r
  where r.lawyer_id = p_lawyer and r.weekday = v_dow
    and r.is_active and r.daily_cap is not null;
  if v_cap is not null then
    select count(*) into v_live
    from public.appointments a
    where a.lawyer_id = p_lawyer
      and a.status in ('held', 'confirmed', 'rescheduled')
      and (a.starts_at at time zone v_tz)::date = p_date;
    if v_live >= v_cap then return; end if;
  end if;

  for v_rule in
    select r.start_time, r.end_time, r.slot_minutes, r.breaks
    from public.availability_rules r
    where r.lawyer_id = p_lawyer and r.weekday = v_dow and r.is_active
    order by r.start_time
  loop
    v_win_start := v_rule.start_time;
    v_win_end   := v_rule.end_time;
    if v_exc.id is not null and not v_exc.is_closed then
      if v_exc.start_time is not null then
        v_win_start := greatest(v_win_start, v_exc.start_time);
      end if;
      if v_exc.end_time is not null then
        v_win_end := least(v_win_end, v_exc.end_time);
      end if;
    end if;

    v_m := extract(hour from v_win_start)::integer * 60
         + extract(minute from v_win_start)::integer;
    v_m_end := extract(hour from v_win_end)::integer * 60
             + extract(minute from v_win_end)::integer;

    while v_m + v_duration <= v_m_end loop
      v_ok := true;

      for v_break in
        select (b ->> 'start')::time as b_start, (b ->> 'end')::time as b_end
        from jsonb_array_elements(coalesce(v_rule.breaks, '[]'::jsonb)) b
      loop
        if v_m < (extract(hour from v_break.b_end)::integer * 60
                  + extract(minute from v_break.b_end)::integer)
           and v_m + v_duration > (extract(hour from v_break.b_start)::integer * 60
                                   + extract(minute from v_break.b_start)::integer)
        then
          v_ok := false;
          exit;
        end if;
      end loop;

      if v_ok then
        v_local_start := p_date::timestamp + make_interval(mins => v_m);
        v_ts_start := v_local_start at time zone v_tz;
        v_ts_end := (v_local_start + make_interval(mins => v_duration)) at time zone v_tz;

        if v_ts_start >= now() + interval '2 hours'
           and not exists (
             select 1 from public.appointments a
             where a.lawyer_id = p_lawyer
               and a.status in ('held', 'confirmed', 'rescheduled')
               and tstzrange(a.starts_at, a.ends_at) && tstzrange(v_ts_start, v_ts_end)
           )
        then
          slot_starts_at := v_ts_start;
          slot_ends_at := v_ts_end;
          return next;
        end if;
      end if;

      v_m := v_m + v_rule.slot_minutes;
    end loop;
  end loop;
  return;
end $$;

-- ---------------------------------------------------------------------------
-- book_appointment: validates the slot, creates the 15-minute hold and the
-- issued invoice (VAT from firms.vat_rate), stores the intake answers, and
-- returns what the payment step needs. Clients call this — they never insert
-- appointments or invoices themselves.
-- ---------------------------------------------------------------------------

create function public.book_appointment(
  p_firm uuid,
  p_service uuid,
  p_lawyer uuid,
  p_starts_at timestamptz,
  p_mode public.appointment_mode default 'virtual',
  p_client_tz text default 'Africa/Lagos',
  p_intake jsonb default null,
  p_intake_form uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_client uuid := auth.uid();
  v_service public.services%rowtype;
  v_lawyer public.lawyer_profiles%rowtype;
  v_firm public.firms%rowtype;
  v_appt public.appointments%rowtype;
  v_invoice public.invoices%rowtype;
  v_vat numeric(12,2);
  v_hold timestamptz := now() + interval '15 minutes';
begin
  if v_client is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_firm from public.firms where id = p_firm and is_active;
  if not found then raise exception 'unknown firm'; end if;

  select * into v_service from public.services
  where id = p_service and firm_id = p_firm and is_active;
  if not found then raise exception 'unknown or inactive service'; end if;
  if not (p_mode = any (v_service.modes)) then
    raise exception 'service does not offer mode %', p_mode;
  end if;

  select * into v_lawyer from public.lawyer_profiles
  where id = p_lawyer and firm_id = p_firm and is_bookable;
  if not found then raise exception 'unknown lawyer'; end if;

  if not exists (
    select 1 from public.available_slots(
      p_firm, p_lawyer, p_service,
      (p_starts_at at time zone v_lawyer.timezone)::date
    ) s
    where s.slot_starts_at = p_starts_at
  ) then
    raise exception 'slot is not available' using errcode = 'P0002';
  end if;

  begin
    insert into public.appointments
      (firm_id, client_id, lawyer_id, service_id, status, mode,
       starts_at, ends_at, client_timezone, price, currency, hold_expires_at)
    values
      (p_firm, v_client, p_lawyer, p_service, 'held', p_mode,
       p_starts_at, p_starts_at + make_interval(mins => v_service.duration_minutes),
       p_client_tz, v_service.price, v_service.currency, v_hold)
    returning * into v_appt;
  exception when exclusion_violation then
    raise exception 'slot is not available' using errcode = 'P0002';
  end;

  v_vat := round(v_service.price * v_firm.vat_rate / 100, 2);
  insert into public.invoices
    (firm_id, number, client_id, appointment_id, status, currency,
     subtotal, vat_rate, vat_amount, total, due_at, issued_at)
  values
    (p_firm, app.next_invoice_number(p_firm), v_client, v_appt.id, 'issued',
     v_service.currency, v_service.price, v_firm.vat_rate, v_vat,
     v_service.price + v_vat, v_hold, now())
  returning * into v_invoice;

  insert into public.invoice_items (firm_id, invoice_id, description, quantity, unit_price, amount)
  values (p_firm, v_invoice.id, v_service.name, 1, v_service.price, v_service.price);

  if p_intake is not null then
    insert into public.intake_responses (firm_id, appointment_id, form_id, client_id, answers)
    values (p_firm, v_appt.id, p_intake_form, v_client, p_intake);
  end if;

  perform app.audit(p_firm, 'appointment.held', 'appointment', v_appt.id::text,
    jsonb_build_object('starts_at', v_appt.starts_at, 'service', v_service.slug,
                       'invoice', v_invoice.number));

  return jsonb_build_object(
    'appointment_id', v_appt.id,
    'invoice_id', v_invoice.id,
    'invoice_number', v_invoice.number,
    'amount_due', v_invoice.total,
    'currency', v_invoice.currency,
    'starts_at', v_appt.starts_at,
    'ends_at', v_appt.ends_at,
    'hold_expires_at', v_hold
  );
end $$;

-- ---------------------------------------------------------------------------
-- cancel_appointment: a client cancels their own future appointment; staff
-- (MFA) cancel any live one. Voids the unpaid invoice, cancels queued
-- reminders, tells the other side.
-- ---------------------------------------------------------------------------

create function public.cancel_appointment(
  p_appointment uuid, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_appt public.appointments%rowtype;
  v_by_staff boolean;
begin
  select * into v_appt from public.appointments where id = p_appointment;
  if not found then raise exception 'unknown appointment'; end if;
  if v_appt.status not in ('held', 'confirmed', 'rescheduled') then
    raise exception 'appointment is not cancellable';
  end if;

  v_by_staff := app.is_staff(v_appt.firm_id);
  if v_by_staff then
    if not app.is_mfa() then
      raise exception 'staff writes require an MFA-verified session' using errcode = '42501';
    end if;
  elsif v_appt.client_id = auth.uid() then
    if v_appt.starts_at <= now() then
      raise exception 'appointment has already started';
    end if;
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason,
      hold_expires_at = null
  where id = p_appointment;

  perform app.void_unpaid_invoice(i.id)
  from public.invoices i
  where i.appointment_id = p_appointment;

  update public.notifications
  set status = 'cancelled'
  where appointment_id = p_appointment and status = 'queued';

  if v_by_staff then
    perform app.notify(
      v_appt.client_id, v_appt.firm_id, 'appointment_cancelled',
      'Your appointment was cancelled',
      coalesce(p_reason, 'Please contact the firm or rebook at a convenient time.'),
      '/app/appointments/' || v_appt.id,
      '{in_app,email,sms,push}', now(), null, v_appt.id);
  else
    perform app.notify(
      lp.user_id, v_appt.firm_id, 'appointment_cancelled',
      'A client cancelled an appointment',
      'The appointment on ' ||
        to_char(v_appt.starts_at at time zone lp.timezone, 'DD Mon YYYY, HH24:MI') ||
        ' was cancelled by the client.',
      '/firm/appointments/' || v_appt.id,
      '{in_app}', now(), null, v_appt.id)
    from public.lawyer_profiles lp where lp.id = v_appt.lawyer_id;
  end if;

  perform app.audit(v_appt.firm_id, 'appointment.cancelled', 'appointment',
    v_appt.id::text, jsonb_build_object('reason', p_reason, 'by_staff', v_by_staff));

  return jsonb_build_object('appointment_id', v_appt.id, 'status', 'cancelled');
end $$;

-- ---------------------------------------------------------------------------
-- record_payment: called only by the payment webhooks with the service role.
-- Idempotent on provider_ref. Amounts arrive in MAJOR units (the webhook
-- functions convert from kobo/cents). paid → invoice settles → held
-- appointment confirms → notifications go out.
-- ---------------------------------------------------------------------------

create function public.record_payment(
  p_provider text,
  p_ref text,
  p_invoice_number text,
  p_amount numeric,
  p_currency text,
  p_status text,
  p_raw jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_existing uuid;
  v_invoice public.invoices%rowtype;
  v_appt public.appointments%rowtype;
  v_status public.payment_status;
  v_payment uuid;
begin
  select id into v_existing from public.payments where provider_ref = p_ref;
  if v_existing is not null then
    return jsonb_build_object('duplicate', true, 'payment_id', v_existing);
  end if;

  select * into v_invoice from public.invoices
  where number = p_invoice_number and currency = p_currency
  order by created_at desc limit 1
  for update;
  if not found then
    raise exception 'unknown invoice %', p_invoice_number;
  end if;

  v_status := case
    when lower(p_status) in ('success', 'succeeded', 'paid') then 'paid'
    when lower(p_status) in ('refunded', 'reversed') then 'refunded'
    else 'failed'
  end;

  insert into public.payments
    (firm_id, invoice_id, provider, provider_ref, amount, currency, status, paid_at, raw)
  values
    (v_invoice.firm_id, v_invoice.id, p_provider, p_ref, p_amount, p_currency,
     v_status, case when v_status = 'paid' then now() end, coalesce(p_raw, '{}'::jsonb))
  returning id into v_payment;

  if v_status = 'paid' then
    update public.invoices
    set amount_paid = amount_paid + p_amount,
        status = case when amount_paid + p_amount >= total then 'paid' else status end,
        paid_at = case when amount_paid + p_amount >= total then now() else paid_at end
    where id = v_invoice.id
    returning * into v_invoice;

    if v_invoice.appointment_id is not null and v_invoice.status = 'paid' then
      update public.appointments
      set status = 'confirmed', hold_expires_at = null
      where id = v_invoice.appointment_id and status = 'held'
      returning * into v_appt;

      if v_appt.id is not null then
        perform app.notify(
          v_appt.client_id, v_appt.firm_id, 'appointment_confirmed',
          'Your appointment is confirmed',
          'Payment received. Your consultation on ' ||
            to_char(v_appt.starts_at at time zone v_appt.client_timezone,
                    'DD Mon YYYY, HH24:MI') || ' is confirmed.',
          '/app/appointments/' || v_appt.id,
          '{in_app,email,sms,push}', now(), null, v_appt.id);
        perform app.notify(
          lp.user_id, v_appt.firm_id, 'appointment_confirmed',
          'New confirmed appointment',
          'A consultation was booked and paid for ' ||
            to_char(v_appt.starts_at at time zone lp.timezone, 'DD Mon YYYY, HH24:MI') || '.',
          '/firm/appointments/' || v_appt.id,
          '{in_app}', now(), null, v_appt.id)
        from public.lawyer_profiles lp where lp.id = v_appt.lawyer_id;
      end if;
    end if;
  end if;

  perform app.audit(v_invoice.firm_id, 'payment.recorded', 'payment', v_payment::text,
    jsonb_build_object('provider', p_provider, 'ref', p_ref, 'amount', p_amount,
                       'currency', p_currency, 'status', v_status));

  return jsonb_build_object(
    'duplicate', false,
    'payment_id', v_payment,
    'invoice_status', v_invoice.status,
    'appointment_id', v_invoice.appointment_id
  );
end $$;

-- ---------------------------------------------------------------------------
-- post_court_update: blueprint §5.11 — the 30-second form. Composes the
-- title, posts the client-visible entry (and an internal one), closes
-- today's court event, opens the next, updates the matter, notifies every
-- client party.
-- ---------------------------------------------------------------------------

create function public.post_court_update(
  p_matter uuid,
  p_outcome public.court_outcome,
  p_occurred_at date default current_date,
  p_court text default null,
  p_adjourned_by public.adjourned_instance default null,
  p_next_date timestamptz default null,
  p_next_purpose text default null,
  p_note_to_client text default null,
  p_internal_note text default null,
  p_attachment uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_matter public.matters%rowtype;
  v_firm public.firms%rowtype;
  v_title text;
  v_body text;
  v_update uuid;
  v_party record;
begin
  select * into v_matter from public.matters where id = p_matter;
  if not found then raise exception 'unknown matter'; end if;
  if not app.is_staff(v_matter.firm_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not app.is_mfa() then
    raise exception 'staff writes require an MFA-verified session' using errcode = '42501';
  end if;
  if p_outcome = 'adjourned' and p_adjourned_by is null then
    raise exception 'an adjournment needs "at whose instance"';
  end if;

  select * into v_firm from public.firms where id = v_matter.firm_id;

  v_title := app.court_outcome_label(p_outcome) || ' — ' ||
             to_char(p_occurred_at, 'DD Mon YYYY');
  if p_outcome = 'adjourned' then
    v_title := v_title || ' (at the instance of the ' || p_adjourned_by || ')';
  end if;

  v_body := coalesce(p_note_to_client, '');
  if p_next_date is not null then
    v_body := v_body || case when v_body = '' then '' else E'\n\n' end ||
      'Next date: ' ||
      to_char(p_next_date at time zone v_firm.timezone, 'DD Mon YYYY, HH24:MI') ||
      coalesce(' — ' || p_next_purpose, '');
  end if;

  insert into public.updates
    (firm_id, matter_id, author_id, visibility, kind, title, body, document_id, occurred_at)
  values
    (v_matter.firm_id, p_matter, auth.uid(), 'client', 'court_update',
     v_title, nullif(v_body, ''), p_attachment,
     (p_occurred_at::timestamp at time zone v_firm.timezone))
  returning id into v_update;

  if p_internal_note is not null then
    insert into public.updates
      (firm_id, matter_id, author_id, visibility, kind, title, body, occurred_at)
    values
      (v_matter.firm_id, p_matter, auth.uid(), 'internal', 'court_update',
       'Internal — ' || v_title, p_internal_note,
       (p_occurred_at::timestamp at time zone v_firm.timezone));
  end if;

  -- Close the sitting this update reports on (if it was diarised).
  update public.court_events
  set outcome = p_outcome, adjourned_by = p_adjourned_by, outcome_update_id = v_update
  where matter_id = p_matter
    and outcome_update_id is null
    and (scheduled_at at time zone v_firm.timezone)::date = p_occurred_at;

  -- Diarise the next one.
  if p_next_date is not null then
    insert into public.court_events (firm_id, matter_id, scheduled_at, court, purpose, created_by)
    values (v_matter.firm_id, p_matter, p_next_date,
            coalesce(p_court, v_matter.court), p_next_purpose, auth.uid());
  end if;

  update public.matters
  set court = coalesce(p_court, court),
      next_action = case
        when p_next_date is not null then
          coalesce(p_next_purpose, 'Next court date') || ' on ' ||
          to_char(p_next_date at time zone v_firm.timezone, 'DD Mon YYYY')
        else next_action
      end
  where id = p_matter;

  for v_party in
    select mp.user_id from public.matter_parties mp
    where mp.matter_id = p_matter and mp.role = 'client'
  loop
    perform app.notify(
      v_party.user_id, v_matter.firm_id, 'court_update',
      'Update on your matter ' || v_matter.reference,
      coalesce(p_note_to_client, v_title),
      '/app/matters/' || p_matter,
      '{in_app,email,sms,push}', now(), null, null, p_matter);
  end loop;

  perform app.audit(v_matter.firm_id, 'court_update.posted', 'update', v_update::text,
    jsonb_build_object('matter', v_matter.reference, 'outcome', p_outcome,
                       'next_date', p_next_date));

  return v_update;
end $$;

-- ---------------------------------------------------------------------------
-- save_consultation_notes: client-visible summary + internal notes, timeline
-- echo to the client, optional completion.
-- ---------------------------------------------------------------------------

create function public.save_consultation_notes(
  p_appointment uuid,
  p_summary text,
  p_advice text default null,
  p_follow_up text default null,
  p_internal text default null,
  p_mark_completed boolean default true
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_appt public.appointments%rowtype;
  v_notes uuid;
begin
  select * into v_appt from public.appointments where id = p_appointment;
  if not found then raise exception 'unknown appointment'; end if;
  if not app.is_staff(v_appt.firm_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not app.is_mfa() then
    raise exception 'staff writes require an MFA-verified session' using errcode = '42501';
  end if;

  insert into public.consultation_notes
    (firm_id, appointment_id, summary, advice, follow_up, author_id)
  values
    (v_appt.firm_id, p_appointment, p_summary, p_advice, p_follow_up, auth.uid())
  on conflict (appointment_id) do update
    set summary = excluded.summary,
        advice = excluded.advice,
        follow_up = excluded.follow_up,
        author_id = excluded.author_id,
        updated_at = now()
  returning id into v_notes;

  if p_internal is not null then
    insert into public.consultation_internal_notes (firm_id, appointment_id, body, author_id)
    values (v_appt.firm_id, p_appointment, p_internal, auth.uid());
  end if;

  if p_mark_completed and v_appt.status in ('confirmed', 'rescheduled') then
    update public.appointments set status = 'completed' where id = p_appointment;
  end if;

  perform app.notify(
    v_appt.client_id, v_appt.firm_id, 'consultation_summary',
    'Your consultation summary is ready',
    'Your lawyer has written up your consultation. Open the appointment to read it.',
    '/app/appointments/' || p_appointment,
    '{in_app,email}', now(), null, p_appointment);

  perform app.audit(v_appt.firm_id, 'consultation.notes_saved', 'appointment',
    p_appointment::text, jsonb_build_object('completed', p_mark_completed));

  return v_notes;
end $$;

-- ---------------------------------------------------------------------------
-- accept_invite: a signed-in client redeems an invite token and becomes a
-- party to the matter it points at.
-- ---------------------------------------------------------------------------

create function public.accept_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_invite public.invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_invite from public.invites
  where token = p_token and status = 'pending' and expires_at > now()
  for update;
  if not found then
    raise exception 'invite is invalid or has expired' using errcode = 'P0002';
  end if;

  insert into public.profiles (id) values (auth.uid())
  on conflict (id) do nothing;

  if v_invite.matter_id is not null then
    insert into public.matter_parties (firm_id, matter_id, user_id, role, added_by)
    values (v_invite.firm_id, v_invite.matter_id, auth.uid(), v_invite.role, v_invite.invited_by)
    on conflict (matter_id, user_id) do nothing;
  end if;

  update public.invites
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_invite.id;

  if v_invite.invited_by is not null then
    perform app.notify(
      v_invite.invited_by, v_invite.firm_id, 'invite_accepted',
      'Invite accepted',
      'The client you invited has joined the matter.',
      case when v_invite.matter_id is null then null
           else '/firm/matters/' || v_invite.matter_id end,
      '{in_app}', now(), null, null, v_invite.matter_id);
  end if;

  perform app.audit(v_invite.firm_id, 'invite.accepted', 'invite', v_invite.id::text,
    jsonb_build_object('matter', v_invite.matter_id));

  return jsonb_build_object('firm_id', v_invite.firm_id, 'matter_id', v_invite.matter_id);
end $$;

-- ---------------------------------------------------------------------------
-- Scheduled jobs (pg_cron, migration 4)
-- ---------------------------------------------------------------------------

-- Every minute: expire 15-minute booking holds, void their invoices, offer
-- the client a rebook.
create function public.release_expired_holds() returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_appt public.appointments%rowtype;
  v_count integer := 0;
begin
  for v_appt in
    select * from public.appointments
    where status = 'held' and hold_expires_at < now()
    for update skip locked
  loop
    update public.appointments
    set status = 'cancelled', cancelled_at = now(),
        cancel_reason = 'hold_expired', hold_expires_at = null
    where id = v_appt.id;

    perform app.void_unpaid_invoice(i.id)
    from public.invoices i where i.appointment_id = v_appt.id;

    perform app.notify(
      v_appt.client_id, v_appt.firm_id, 'hold_expired',
      'Your booking hold expired',
      'Payment did not arrive in time, so the slot was released. You can book again.',
      '/book', '{in_app,email}', now(), null, v_appt.id);

    perform app.audit(v_appt.firm_id, 'appointment.hold_expired', 'appointment',
      v_appt.id::text, '{}'::jsonb);

    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Every few minutes: make sure every upcoming confirmed appointment has its
-- 24h / 1h / 10m / now reminders queued (dedupe_key keeps this idempotent).
create function public.enqueue_appointment_reminders() returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_appt record;
  v_offset record;
  v_when timestamptz;
  v_count integer := 0;
begin
  for v_appt in
    select a.*, lp.user_id as lawyer_user_id, lp.timezone as lawyer_tz
    from public.appointments a
    join public.lawyer_profiles lp on lp.id = a.lawyer_id
    where a.status in ('confirmed', 'rescheduled')
      and a.starts_at between now() and now() + interval '25 hours'
  loop
    for v_offset in
      select * from (values
        ('24h', interval '24 hours', 'Your appointment is tomorrow'),
        ('1h',  interval '1 hour',   'Your appointment is in an hour'),
        ('10m', interval '10 minutes', 'Your appointment starts in 10 minutes'),
        ('now', interval '0',        'Your appointment is starting')
      ) as o(label, off, title)
    loop
      v_when := v_appt.starts_at - v_offset.off;
      if v_when < now() - interval '5 minutes' then continue; end if;

      v_count := v_count + app.notify(
        v_appt.client_id, v_appt.firm_id, 'appointment_reminder',
        v_offset.title,
        'Consultation on ' ||
          to_char(v_appt.starts_at at time zone v_appt.client_timezone,
                  'DD Mon YYYY, HH24:MI') || ' (' || v_appt.client_timezone || ').',
        '/app/appointments/' || v_appt.id,
        '{in_app,email,sms,push}', v_when,
        'appt:' || v_appt.id || ':' || v_offset.label, v_appt.id);

      v_count := v_count + app.notify(
        v_appt.lawyer_user_id, v_appt.firm_id, 'appointment_reminder',
        v_offset.title,
        'Consultation on ' ||
          to_char(v_appt.starts_at at time zone v_appt.lawyer_tz,
                  'DD Mon YYYY, HH24:MI') || ' (' || v_appt.lawyer_tz || ').',
        '/firm/appointments/' || v_appt.id,
        '{in_app,push}', v_when,
        'appt:' || v_appt.id || ':lawyer:' || v_offset.label, v_appt.id);
    end loop;
  end loop;
  return v_count;
end $$;

-- Daily-ish: remind client parties of tomorrow's court dates.
create function public.enqueue_court_reminders() returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_event record;
  v_party record;
  v_count integer := 0;
begin
  for v_event in
    select ce.*, m.reference, f.timezone as firm_tz
    from public.court_events ce
    join public.matters m on m.id = ce.matter_id
    join public.firms f on f.id = ce.firm_id
    where ce.scheduled_at between now() and now() + interval '25 hours'
  loop
    for v_party in
      select mp.user_id from public.matter_parties mp
      where mp.matter_id = v_event.matter_id and mp.role = 'client'
    loop
      v_count := v_count + app.notify(
        v_party.user_id, v_event.firm_id, 'court_reminder',
        'Court date tomorrow — ' || v_event.reference,
        coalesce(v_event.purpose || ' at ', '') || coalesce(v_event.court, 'court') ||
          ' on ' || to_char(v_event.scheduled_at at time zone v_event.firm_tz,
                            'DD Mon YYYY, HH24:MI') || '.',
        '/app/matters/' || v_event.matter_id,
        '{in_app,email,sms,push}',
        greatest(v_event.scheduled_at - interval '24 hours', now()),
        'court:' || v_event.id || ':' || v_party.user_id, null, v_event.matter_id);
    end loop;
  end loop;
  return v_count;
end $$;

create function public.mark_overdue_invoices() returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  with flipped as (
    update public.invoices
    set status = 'overdue'
    where status = 'issued' and due_at is not null and due_at < now()
      and appointment_id is null -- consult invoices die with the hold instead
    returning id
  )
  select count(*) into v_count from flipped;
  return v_count;
end $$;

-- Daily digest to every lawyer/admin: sittings that happened with no update
-- posted. This is the accountability loop that keeps clients informed.
create function public.digest_sittings_without_update() returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_firm record;
  v_member record;
  v_count integer := 0;
begin
  for v_firm in
    select ce.firm_id, count(*) as missing
    from public.court_events ce
    where ce.outcome_update_id is null
      and ce.scheduled_at < now() - interval '2 hours'
      and ce.scheduled_at > now() - interval '30 days'
    group by ce.firm_id
  loop
    for v_member in
      select fm.user_id from public.firm_members fm
      where fm.firm_id = v_firm.firm_id and fm.is_active
        and fm.role in ('owner', 'admin', 'lawyer')
    loop
      v_count := v_count + app.notify(
        v_member.user_id, v_firm.firm_id, 'sittings_without_update',
        v_firm.missing || ' sitting(s) still need a court update',
        'Post the outcome so the client hears it from you first.',
        '/firm', '{in_app}', now(),
        'sittings-digest:' || v_firm.firm_id || ':' || current_date || ':' || v_member.user_id);
    end loop;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Execution grants. Functions default to PUBLIC-executable; lock down the
-- ones that must only ever run under the service role or cron.
-- ---------------------------------------------------------------------------

revoke execute on function public.record_payment(text, text, text, numeric, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.release_expired_holds() from public, anon, authenticated;
revoke execute on function public.enqueue_appointment_reminders() from public, anon, authenticated;
revoke execute on function public.enqueue_court_reminders() from public, anon, authenticated;
revoke execute on function public.mark_overdue_invoices() from public, anon, authenticated;
revoke execute on function public.digest_sittings_without_update() from public, anon, authenticated;

grant execute on function public.record_payment(text, text, text, numeric, text, text, jsonb)
  to service_role;
grant execute on function public.release_expired_holds() to service_role;
grant execute on function public.enqueue_appointment_reminders() to service_role;
grant execute on function public.enqueue_court_reminders() to service_role;
grant execute on function public.mark_overdue_invoices() to service_role;
grant execute on function public.digest_sittings_without_update() to service_role;

-- Booking is for signed-in clients; slot browsing is public.
revoke execute on function public.book_appointment(uuid, uuid, uuid, timestamptz, public.appointment_mode, text, jsonb, uuid)
  from public, anon;
grant execute on function public.book_appointment(uuid, uuid, uuid, timestamptz, public.appointment_mode, text, jsonb, uuid)
  to authenticated, service_role;
