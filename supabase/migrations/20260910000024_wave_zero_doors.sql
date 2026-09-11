-- Wave 0: doors with nothing behind them, a notification a client could resend at the firm's
-- expense, push attempted for people who never subscribed, and a column that would only ever
-- have held a lie.
--
-- Four changes, each small, each found by the audit migration 22 asked for: for every table a
-- guarded function writes, is the table also open to a direct call?

-- ================================================================ 1. dead grants
-- These roles hold INSERT, UPDATE or DELETE on tables that have no policy for that command. RLS
-- makes such a write match zero rows and return success — fails closed, but silently, and a later
-- permissive policy (or a default-privileges grant) reopens the door without anyone deciding to.
-- Migration 22 said the REVOKE is the load-bearing half. Nothing in the app makes any of these
-- writes: documents are retired by setting deleted_at, a consent is recorded once, a message is a
-- record, a profile is removed with the auth user.
revoke update, delete on public.consent_records    from anon, authenticated;
revoke update, delete on public.document_versions  from anon, authenticated;
revoke delete         on public.documents          from anon, authenticated;
revoke insert, delete on public.firms              from anon, authenticated;
revoke update, delete on public.intake_responses   from anon, authenticated;
revoke delete         on public.messages           from anon, authenticated;
revoke delete         on public.profiles           from anon, authenticated;

-- ================================================================ 2. a notification is the firm's record, not the client's draft
-- notifications_update (20260909000002_rls.sql) is `user_id = auth.uid()` with no column named.
-- It exists so a person can mark their own in-app notification read. It also lets them
--     PATCH /rest/v1/notifications?id=eq.<id>  {"status":"queued"}
-- on an SMS the firm already paid to send, and the dispatcher sends it again. Every notification
-- is theirs to re-queue, as often as they like; the SMS bill is the firm's.
--
-- The policy stays — it is what marking read needs. The column rule goes underneath it, and it is
-- deliberately NOT security definer: current_user inside it is whoever is actually writing.
-- The API roles may change read_at and nothing else. The dispatcher writes as service_role, and
-- retry_notification() is a definer function owned by postgres; both pass untouched, which is the
-- point — those two are the only legitimate writers of status.
create or replace function public.notifications_api_read_only() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') and (
       new.id         is distinct from old.id
    or new.user_id    is distinct from old.user_id
    or new.firm_id    is distinct from old.firm_id
    or new.channel    is distinct from old.channel
    or new.event      is distinct from old.event
    or new.payload    is distinct from old.payload
    or new.status     is distinct from old.status
    or new.send_after is distinct from old.send_after
    or new.sent_at    is distinct from old.sent_at
    or new.error      is distinct from old.error
    or new.created_at is distinct from old.created_at
    or new.attempts   is distinct from old.attempts) then
    raise exception 'only read_at may be changed on a notification' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists notifications_api_read_only on public.notifications;
create trigger notifications_api_read_only
  before update on public.notifications
  for each row execute function public.notifications_api_read_only();

revoke execute on function public.notifications_api_read_only() from public, anon, authenticated;

-- ================================================================ 3. push only where there is something to push to
-- enqueue_notification() began every fan-out with array['in_app','push'] and appended the
-- preferred channel after. So a person who chose SMS and never installed the app still got a push
-- row for every event, which the dispatcher then failed for want of a subscription — and failures
-- are what the platform health screen counts. Push is now queued only for a person who has a push
-- subscription: subscribing IS the opt-in, and notification_preferences still switches it off per
-- event. The preferred channel, the in-app copy and the email copy behave as before.
--
-- WhatsApp was offered on the profile screen as "coming later" and the dispatcher marked every
-- such row skipped, so a person who chose it received nothing, silently. The option is gone from
-- the screen; anyone who had chosen it is moved to SMS — the same phone number, and a channel that
-- actually delivers — and the function treats a stray 'whatsapp' the same way so the enum value
-- can never again select nothing.
update public.profiles set preferred_channel = 'sms' where preferred_channel = 'whatsapp';

create or replace function public.enqueue_notification(p_user uuid, p_firm uuid, p_event text, p_payload jsonb, p_send_after timestamptz default now())
returns void language plpgsql security definer set search_path = public as $$
declare v_pref channel; v_email text; v_ch channel; v_channels channel[];
        v_qs time; v_qe time; v_tz text; v_local time; v_quiet bool := false; v_deferred timestamptz;
begin
  select preferred_channel, email, quiet_hours_start, quiet_hours_end, coalesce(timezone, 'Africa/Lagos')
    into v_pref, v_email, v_qs, v_qe, v_tz from profiles where id = p_user;
  if v_pref = 'whatsapp' then v_pref := 'sms'; end if;

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

  v_channels := array['in_app'::channel];
  if exists (select 1 from push_subscriptions ps where ps.user_id = p_user) then
    v_channels := v_channels || 'push'::channel;
  end if;
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

-- ================================================================ 4. audit_log.ip: a null beats a lie
-- Never populated: audit() does not set it and nothing else writes the table. It could not be
-- populated honestly either — Postgres cannot see a request's address, and any authenticated
-- caller can set x-forwarded-for on a PostgREST call, so the column would hold whatever the
-- caller chose, in a table people read as forensic. Dropped rather than filled.
alter table public.audit_log drop column if exists ip;

comment on function public.notifications_api_read_only() is
  'A person may mark their own notification read and change nothing else. The dispatcher (service_role) and retry_notification() (definer) pass; the API roles do not.';
