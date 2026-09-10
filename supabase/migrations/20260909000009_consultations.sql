-- Docket — migration 9 (slice 2): rescheduling, no-show, and the dispatcher schedule.
--
-- 1) available_slots gains p_ignore so a reschedule can re-validate a slot without the
--    appointment being moved blocking itself (same signature otherwise; anon may still call it).
-- 2) reschedule_appointment(): staff-only, MFA session; re-validates through the booking engine,
--    moves the appointment, resets reminders, notifies the client, audits.
-- 3) mark_no_show(): staff-only, after the start time.
-- 4) pg_cron + pg_net: call the dispatch-notifications Edge Function every minute with the shared
--    secret held in Vault (names: dispatch_url, cron_secret). No-op on plain Postgres.

drop function if exists public.available_slots(uuid, uuid, uuid, date);
create or replace function public.available_slots(p_firm uuid, p_lawyer uuid, p_service uuid, p_date date, p_ignore uuid default null)
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
     and ap.id is distinct from p_ignore
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
                        and ap.id is distinct from p_ignore
                        and tstzrange(ap.starts_at, ap.ends_at) && tstzrange(v_start, v_end))
      then
        starts_at := v_start; ends_at := v_end; return next;
      end if;
      v_start := v_start + make_interval(mins => r.slot_min);
    end loop;
  end loop;
end $$;
grant execute on function public.available_slots(uuid, uuid, uuid, date, uuid) to anon, authenticated;

-- ---------------------------------------------------------------- reschedule (staff)
create or replace function public.reschedule_appointment(p_appointment uuid, p_starts_at timestamptz, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_appt appointments%rowtype; v_dur interval; v_tz text; v_ok bool; v_old appointment_status;
begin
  select * into v_appt from appointments where id = p_appointment for update;
  if not found then raise exception 'appointment not found'; end if;
  if not staff_w(v_appt.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_appt.status not in ('confirmed','rescheduled') then
    raise exception 'only confirmed appointments can be rescheduled (this one is %)', v_appt.status;
  end if;
  if p_starts_at <= now() then raise exception 'the new time must be in the future'; end if;

  select coalesce(p.timezone, f.timezone) into v_tz
    from firms f left join profiles p on p.id = v_appt.lawyer_id where f.id = v_appt.firm_id;
  select exists (
    select 1 from available_slots(v_appt.firm_id, v_appt.lawyer_id, v_appt.service_id,
                                  (p_starts_at at time zone v_tz)::date, v_appt.id) s
    where s.starts_at = p_starts_at) into v_ok;
  if not v_ok then raise exception 'that time is not available'; end if;

  v_dur := v_appt.ends_at - v_appt.starts_at;
  v_old := v_appt.status;
  update appointments
     set starts_at = p_starts_at, ends_at = p_starts_at + v_dur, status = 'rescheduled', reminders_sent = '{}'
   where id = p_appointment;
  -- the status trigger notifies on confirmed → rescheduled; a second move needs an explicit notification
  if v_old = 'rescheduled' then
    perform enqueue_notification(v_appt.client_id, v_appt.firm_id, 'appointment_rescheduled',
      jsonb_build_object('appointment_id', p_appointment, 'reference', v_appt.reference, 'starts_at', p_starts_at));
  end if;
  perform audit('appointment.rescheduled', 'appointment', p_appointment, v_appt.firm_id,
                jsonb_build_object('from', v_appt.starts_at, 'to', p_starts_at, 'reason', p_reason));
  return jsonb_build_object('appointment_id', p_appointment, 'starts_at', p_starts_at,
                            'ends_at', p_starts_at + v_dur, 'status', 'rescheduled');
end $$;
revoke execute on function public.reschedule_appointment(uuid, timestamptz, text) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------- no-show (staff)
create or replace function public.mark_no_show(p_appointment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_appt appointments%rowtype;
begin
  select * into v_appt from appointments where id = p_appointment for update;
  if not found then raise exception 'appointment not found'; end if;
  if not staff_w(v_appt.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_appt.status not in ('confirmed','rescheduled') then raise exception 'appointment is %', v_appt.status; end if;
  if v_appt.starts_at > now() then raise exception 'the appointment has not started yet'; end if;
  update appointments set status = 'no_show' where id = p_appointment;
  perform audit('appointment.no_show', 'appointment', p_appointment, v_appt.firm_id, '{}');
end $$;
revoke execute on function public.mark_no_show(uuid) from public, anon;
grant execute on function public.mark_no_show(uuid) to authenticated;

-- ---------------------------------------------------------------- dispatcher schedule (Supabase only)
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or to_regclass('vault.secrets') is null then
    raise notice 'pg_cron / pg_net / vault not available — schedule dispatch-notifications by hand';
    return;
  end if;
  execute 'create extension if not exists pg_net';
  if exists (select 1 from cron.job where jobname = 'docket-dispatch-notifications') then
    perform cron.unschedule('docket-dispatch-notifications');
  end if;
  -- URL and shared secret live in Vault (vault.create_secret(value, name)); the job is a no-op until both exist.
  perform cron.schedule('docket-dispatch-notifications', '* * * * *', $j$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_url'),
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      body    := '{}'::jsonb,
      timeout_milliseconds := 20000)
    where (select count(*) from vault.decrypted_secrets where name in ('dispatch_url', 'cron_secret')) = 2
  $j$);
end $$;
