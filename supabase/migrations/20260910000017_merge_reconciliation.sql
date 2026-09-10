-- Docket — migration 17: reconcile the platform branch (10–16) with the slice branch (9–10).
--
-- Migration 12 re-created available_slots(firm, lawyer, service, date) beside migration 9's
-- five-parameter version (…, p_ignore) — two overloads, and `available_slots(uuid,uuid,uuid,date)`
-- became "not unique" for every caller (book_appointment, the booking wizard over PostgREST, the
-- reschedule re-check). One function again: the platform branch's active-firm check plus the
-- slice branch's p_ignore. Four-argument calls bind the default.

drop function if exists public.available_slots(uuid, uuid, uuid, date);
drop function if exists public.available_slots(uuid, uuid, uuid, date, uuid);
create function public.available_slots(p_firm uuid, p_lawyer uuid, p_service uuid, p_date date, p_ignore uuid default null)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_tz text; v_dur int; r record; v_start timestamptz; v_end timestamptz;
        v_day_start timestamptz; v_day_end timestamptz; v_count int;
begin
  select coalesce(p.timezone, f.timezone) into v_tz
    from firms f left join profiles p on p.id = p_lawyer where f.id = p_firm and f.status = 'active';
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
revoke all on function public.available_slots(uuid, uuid, uuid, date, uuid) from public;
grant execute on function public.available_slots(uuid, uuid, uuid, date, uuid) to anon, authenticated;
