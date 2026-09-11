-- The booking limit moves inside book_appointment(), where a direct caller cannot skip it.
--
-- src/lib/rate-limit.ts allows ten bookings an hour per person, and src/lib/actions/booking.ts asks
-- before it calls this function. But book_appointment() is granted to `authenticated`, and every
-- signed-in client holds the anon key the browser uses — so anyone can POST /rest/v1/rpc/book_appointment
-- in a loop and never meet that check. Each call that finds a free slot takes it: a fifteen-minute
-- hold with an issued invoice behind it. Nothing in the database bounded how many holds one account
-- could create, so a single client could empty a lawyer's diary for the afternoon, and
-- release_expired_holds() would hand it back a quarter of an hour later, ready to be emptied again.
--
-- The other app-layer limits do not have this shape, which is why only this one moves:
--   checkout   — the server action is the only door, because starting a Paystack transaction
--                needs the secret key that never leaves the server;
--   firm_start — create_firm() already refuses a fourth firm per account (migration 9);
--   invite     — accept_staff_invite() / accept_invite() consume a single-use token.
-- Those limits slow a person down; the database already bounds what they can do. Booking was the
-- one where the app-layer limit was the ONLY bound, and an app-layer limit is not a rule.
--
-- The body is migration 15's, verbatim, with one check added directly after the sign-in check and
-- before the first lookup — so it runs before available_slots(), which is the expensive part. The
-- same rate_limit_hit() bucket the server action uses, so the two agree on the count; keyed on
-- auth.uid() inside that function, where it cannot be forged.
--
-- What is counted is bookings that GO THROUGH. A call this function refuses later — no such
-- service, slot taken, firm not active — raises, and the raise unwinds the whole call, the
-- rate_limits increment with it. So a client fumbling the wizard is never locked out for fumbling;
-- ten holds an hour is the ceiling, and a refused call creates no hold. That is the exposure, and
-- that is what is bounded. The sentence matches tooFast('booking') so the screen reads the same
-- whichever layer refused.
--
-- create or replace keeps the function's existing grants and ownership; nothing about who may call
-- it changes here.
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
                            'paystack_subaccount', v_firm.paystack_subaccount,
                            'hold_expires_at', case when v_status = 'awaiting_payment' then now() + interval '15 minutes' end);
end $$;
