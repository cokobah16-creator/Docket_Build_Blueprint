-- Docket — migration 10 (slice 3): client portal support.
--
-- 1) profiles.quiet_hours_start/end: push, SMS and email are held until quiet hours end
--    (imminent appointment reminders are never held; in-app rows are always immediate).
-- 2) document_versions insert → documents.current_version_id (clients can add versions to
--    their own client-visible documents but have no UPDATE policy on documents).
-- 3) Realtime: updates, messages, notifications and invoices join the publication (RLS applies).

alter table public.profiles
  add column if not exists quiet_hours_start time,
  add column if not exists quiet_hours_end   time;

create or replace function public.enqueue_notification(p_user uuid, p_firm uuid, p_event text, p_payload jsonb, p_send_after timestamptz default now())
returns void language plpgsql security definer set search_path = public as $$
declare v_pref channel; v_email text; v_ch channel; v_channels channel[];
        v_qs time; v_qe time; v_tz text; v_local time; v_quiet bool := false; v_deferred timestamptz;
begin
  select preferred_channel, email, quiet_hours_start, quiet_hours_end, coalesce(timezone, 'Africa/Lagos')
    into v_pref, v_email, v_qs, v_qe, v_tz from profiles where id = p_user;

  if v_qs is not null and v_qe is not null and v_qs <> v_qe
     and p_event not in ('appointment_reminder_10m', 'appointment_reminder_now') then
    v_local := (p_send_after at time zone v_tz)::time;
    if v_qs < v_qe then v_quiet := v_local >= v_qs and v_local < v_qe;
    else                v_quiet := v_local >= v_qs or  v_local < v_qe; end if;
    if v_quiet then
      v_deferred := ((p_send_after at time zone v_tz)::date + v_qe) at time zone v_tz;
      if v_deferred <= p_send_after then v_deferred := v_deferred + interval '1 day'; end if;
    end if;
  end if;

  v_channels := array['in_app'::channel, 'push'::channel];
  if v_pref not in ('in_app','push') then v_channels := v_channels || v_pref; end if;
  if v_email is not null and v_pref <> 'email' then v_channels := v_channels || 'email'::channel; end if;
  foreach v_ch in array v_channels loop
    if not exists (select 1 from notification_preferences np
                   where np.user_id = p_user and np.event = p_event and np.channel = v_ch and not np.enabled) then
      insert into notifications (user_id, firm_id, channel, event, payload, status, send_after, sent_at)
      values (p_user, p_firm, v_ch, p_event, p_payload,
              case when v_ch = 'in_app' then 'sent' else 'queued' end,
              case when v_ch <> 'in_app' and v_quiet then v_deferred else p_send_after end,
              case when v_ch = 'in_app' then now() end);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- current version pointer
create or replace function public.document_version_set_current() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update documents set current_version_id = new.id where id = new.document_id;
  return new;
end $$;
drop trigger if exists document_versions_set_current on public.document_versions;
create trigger document_versions_set_current after insert on public.document_versions
  for each row execute function public.document_version_set_current();

-- ---------------------------------------------------------------- realtime
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not present — skipping (plain Postgres)';
    return;
  end if;
  foreach t in array array['updates', 'messages', 'notifications', 'invoices'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
