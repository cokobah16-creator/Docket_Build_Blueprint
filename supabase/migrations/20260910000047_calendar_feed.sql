-- The first connector: a lawyer's Docket diary, in the calendar they already use.
--
-- The assessment's #20 asks for calendar, email and document connectors, and says the thing that
-- governs all three: "one connector at a time; define the system of record per field before syncing
-- anything two-way." This migration builds the one connector that needs no third party at all and
-- raises no system-of-record question, because nothing flows back. The two-way ones are DESIGNED
-- rather than built, in docs/CONNECTORS_DESIGN.md, which is the order the plan asks for.
--
-- WHY A SUBSCRIBED FEED RATHER THAN AN OAUTH INTEGRATION. A Google or Microsoft calendar connector
-- needs an OAuth application, a client secret, a consent screen, refresh-token storage and a
-- decision about what happens when somebody edits the copy in their own calendar. An ICS feed needs
-- a URL. Every calendar on a lawyer's phone subscribes to one, it refreshes itself, it works for
-- Google, Outlook, Apple and anything else without Docket registering with any of them, and because
-- it is READ ONLY there is nothing to reconcile. It is the smaller thing that works today, rather
-- than the larger thing that would need credentials nobody has yet.
--
-- WHAT A FEED URL IS. A bearer credential that will end up in a phone's settings, in a calendar
-- provider's fetchers, and quite possibly in somebody's browser history. So:
--
--  · It is per person, not per firm, and it carries only that person's own diary.
--  · The wall is applied to THEM, by name. A feed cannot show a court date on a matter restricted
--    to a team they are not on, and the test is written out here rather than borrowed from
--    can_see_matter(), because there is no auth.uid() when a calendar app fetches a URL.
--  · Client names are OFF by default. A feed leaks to whoever holds the URL, and "R v Adebayo,
--    10am" on a stolen phone says more than a firm may wish. The reference and the court are
--    enough to work from; the name is a deliberate choice, made once, per feed.
--  · It is hashed like an API key, revocable, and shown once. Rotating it is issuing another.
--  · Nothing privileged is in it: a reference, a court, a purpose, a time. No note, no document,
--    no message, no amount.

create table public.calendar_feeds (
  id                   uuid primary key default gen_random_uuid(),
  firm_id              uuid not null references public.firms(id) on delete cascade,
  -- Whose diary. A feed is one person's and cannot be pointed at another's.
  user_id              uuid not null references public.profiles(id) on delete cascade,
  token_hash           text not null unique,
  -- Off unless the person deliberately turns it on. See the header.
  include_client_names boolean not null default false,
  created_at           timestamptz not null default now(),
  last_used_at         timestamptz,
  revoked_at           timestamptz,
  revoked_by           uuid references public.profiles(id) on delete set null
);
-- One live feed per person per firm: a second one is a rotation, so the first is revoked first.
create unique index calendar_feeds_live_idx on public.calendar_feeds (firm_id, user_id) where revoked_at is null;
alter table public.calendar_feeds enable row level security;
-- The person themselves, and the firm's owners and admins — who should be able to see that a feed
-- exists and end it, without being able to read it.
create policy calendar_feeds_select on public.calendar_feeds for select
  using (user_id = (select auth.uid()) or admin_w(firm_id));
revoke insert, update, delete on public.calendar_feeds from anon, authenticated;
create trigger calendar_feeds_audit after insert or update or delete on public.calendar_feeds
  for each row execute function public.audit_row_change();

comment on table public.calendar_feeds is
  'A per-person subscribed calendar URL. Hashed like an API key, shown once, revocable. Read only: nothing a calendar app does can change anything in Docket.';

-- ---------------------------------------------------------------- issuing and ending
create or replace function public.issue_calendar_feed(p_firm uuid, p_include_client_names boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_token text; v_id uuid;
begin
  -- A member with a second factor, for their own diary. Nobody issues a feed for anybody else:
  -- there is no user parameter, deliberately.
  if not staff_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  -- Rotating: the old URL stops working the moment the new one is made, which is what a person
  -- who has lost a phone expects.
  update calendar_feeds set revoked_at = now(), revoked_by = auth.uid()
   where firm_id = p_firm and user_id = auth.uid() and revoked_at is null;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into calendar_feeds (firm_id, user_id, token_hash, include_client_names)
  values (p_firm, auth.uid(), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
          coalesce(p_include_client_names, false))
  returning id into v_id;

  perform audit('calendar_feed.issued', 'calendar_feed', v_id, p_firm,
                jsonb_build_object('include_client_names', coalesce(p_include_client_names, false)));
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;
revoke execute on function public.issue_calendar_feed(uuid, boolean) from public, anon;
grant  execute on function public.issue_calendar_feed(uuid, boolean) to authenticated;

create or replace function public.revoke_calendar_feed(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare f calendar_feeds%rowtype;
begin
  select * into f from calendar_feeds where id = p_id for update;
  if not found then return; end if;
  -- Their own, or an administrator ending a departed colleague's.
  if not (f.user_id = auth.uid() or admin_w(f.firm_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if f.revoked_at is not null then return; end if;
  update calendar_feeds set revoked_at = now(), revoked_by = auth.uid() where id = p_id;
  perform audit('calendar_feed.revoked', 'calendar_feed', p_id, f.firm_id,
                jsonb_build_object('user_id', f.user_id, 'by_self', f.user_id = auth.uid()));
end $$;
revoke execute on function public.revoke_calendar_feed(uuid) from public, anon;
grant  execute on function public.revoke_calendar_feed(uuid) to authenticated;

-- ---------------------------------------------------------------- what the feed contains
/**
 * The diary behind one feed token. Service role only: the Edge Function that serves the URL calls
 * it, and there is no firm or user parameter — the token decides both.
 *
 * The wall is applied to the FEED'S OWNER by name. can_see_matter() asks about auth.uid(), and
 * there is no session when a calendar app fetches a URL, so the same test is written out here
 * against f.user_id. If migration 29's rule ever changes, this is the second place that has to
 * change with it — said out loud because a wall that holds in one place and not another is not a
 * wall, and the suite asserts this one directly.
 */
create or replace function public.calendar_feed_events(p_token text, p_from timestamptz default null, p_to timestamptz default null)
returns table (uid text, kind text, starts_at timestamptz, ends_at timestamptz, day date,
               summary text, description text, location text, status text)
language plpgsql security definer set search_path = public as $$
declare f calendar_feeds%rowtype; v_from timestamptz; v_to timestamptz;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'unauthorized' using errcode = '42501'; end if;
  select * into f from calendar_feeds
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and revoked_at is null;
  if not found then raise exception 'unauthorized' using errcode = '42501'; end if;
  -- A member who has left the firm keeps no diary: the feed follows the membership, not the token.
  if not exists (select 1 from firm_members m where m.firm_id = f.firm_id and m.user_id = f.user_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not exists (select 1 from firms fm where fm.id = f.firm_id and fm.status = 'active') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not rate_limit_hit('calendar_feed', 120, interval '1 hour', left(f.id::text, 100)) then
    raise exception 'too many requests' using errcode = '53400';
  end if;
  update calendar_feeds set last_used_at = now() where id = f.id;

  -- A window, so a diary does not grow without bound in somebody's calendar.
  v_from := coalesce(p_from, now() - interval '90 days');
  v_to   := coalesce(p_to,   now() + interval '365 days');

  return query
  -- Court sittings on matters this person may see.
  select 'court-' || ce.id::text || '@docket',
         'court'::text,
         ce.scheduled_at,
         ce.scheduled_at + interval '1 hour',
         null::date,
         coalesce(nullif(btrim(ce.purpose), ''), 'Court sitting') || ': ' || m.reference,
         concat_ws(' · ',
                   case when f.include_client_names then m.title end,
                   nullif(m.suit_number, ''),
                   nullif(ce.judge, '')),
         coalesce(nullif(ce.court_name, ''), m.court_name),
         case when ce.vacated_at is not null then 'CANCELLED' else 'CONFIRMED' end
    from court_events ce join matters m on m.id = ce.matter_id
   where ce.firm_id = f.firm_id
     and ce.scheduled_at between v_from and v_to
     and m.deleted_at is null
     -- The wall, applied to the feed's owner rather than to a session.
     and (m.access = 'firm'
          or exists (select 1 from matter_lawyers ml where ml.matter_id = m.id and ml.user_id = f.user_id))

  union all
  -- Their own consultations. Somebody else's diary is not theirs, so lawyer_id decides.
  select 'appt-' || a.id::text || '@docket',
         'appointment'::text,
         a.starts_at,
         a.ends_at,
         null::date,
         'Consultation' || case when f.include_client_names
                                then ': ' || coalesce(p.full_name, p.company_name, 'a client')
                                else ' ' || a.reference end,
         concat_ws(' · ', a.mode::text, s.name),
         case when a.mode = 'virtual' then 'Online' else nullif(a.mode::text, '') end,
         case when a.status in ('cancelled', 'no_show') then 'CANCELLED'
              when a.status = 'confirmed' then 'CONFIRMED' else 'TENTATIVE' end
    from appointments a
    left join profiles p on p.id = a.client_id
    left join services s on s.id = a.service_id
   where a.firm_id = f.firm_id and a.lawyer_id = f.user_id
     and a.starts_at between v_from and v_to

  union all
  -- Deadlines the firm has confirmed, as all-day entries on the day they fall. A DATE is a day.
  select 'deadline-' || d.id::text || '@docket',
         'deadline'::text,
         null::timestamptz,
         null::timestamptz,
         d.due_on,
         d.title || ': ' || m2.reference,
         concat_ws(' · ', case when f.include_client_names then m2.title end, nullif(d.rule_name, '')),
         null::text,
         'CONFIRMED'::text
    from deadlines d join matters m2 on m2.id = d.matter_id
   where d.firm_id = f.firm_id
     and d.status = 'confirmed'
     and d.due_on between (v_from at time zone 'UTC')::date and (v_to at time zone 'UTC')::date
     and m2.deleted_at is null
     and (m2.access = 'firm'
          or exists (select 1 from matter_lawyers ml2 where ml2.matter_id = m2.id and ml2.user_id = f.user_id));
end $$;
revoke execute on function public.calendar_feed_events(text, timestamptz, timestamptz) from public, anon, authenticated;

/** What a person sees of their own feed on screen: that it exists, never the token. */
create or replace function public.calendar_feed_status(p_firm uuid)
returns table (id uuid, include_client_names boolean, created_at timestamptz, last_used_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.include_client_names, c.created_at, c.last_used_at
    from calendar_feeds c
   where c.firm_id = p_firm and c.user_id = auth.uid() and c.revoked_at is null
$$;
revoke execute on function public.calendar_feed_status(uuid) from public, anon;
grant  execute on function public.calendar_feed_status(uuid) to authenticated;
