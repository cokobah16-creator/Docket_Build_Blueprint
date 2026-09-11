-- Who has read a message, and who owes the reply.
--
-- messages.read_at is one column per message. MessagesThread marked it on mount, so the first
-- staff member to glance at a thread marked every client message on that matter read, for the
-- whole firm, for good — and that column is exactly what firm_overview counted as "unread". The
-- number on Today therefore meant "nobody has opened this tab yet", which is not what anyone
-- reading it thought it meant. It is also the mechanism behind the assessment's #4: a secretary
-- reading a message must not imply the lawyer has acted on it.
--
-- Three things, kept apart because they are different facts:
--   · a RECEIPT: this person read this message — message_reads, one row per reader;
--   · the OTHER SIDE HAS SEEN IT: messages.read_at keeps this one honest meaning, set on the
--     first read from across the firm/client line, which is what a client's " · Read" shows;
--   · WHO OWES THE REPLY: derived, never stored — a thread whose latest message came from
--     outside the firm is waiting on the firm. firm_threads computes it; nothing keeps it in sync.
--
-- NO RECEIPTS ARE INVENTED FOR THE PAST. The old column records that a message was read, never by
-- whom, so it cannot be turned into per-person receipts without making them up. Every message
-- that exists today gets reads_tracked = false and keeps counting by read_at; every message from
-- now on is tracked per reader. Old threads do not light up as unread for everyone.

-- ================================================================ 1. receipts
create table public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index message_reads_user_idx on public.message_reads (user_id, message_id);

alter table public.message_reads enable row level security;
-- Staff see who in their firm has read a message on their firm's threads. A client sees only their
-- own receipts: "read by 4 of 7 partners" is noise to a client and potentially discoverable in a
-- dispute; what the client gets is the one derived fact on the message itself, read_at.
create policy message_reads_select on public.message_reads for select
  using (user_id = (select auth.uid())
         or exists (select 1 from public.messages m where m.id = message_id and public.is_firm_member(m.firm_id)));
-- Written only by mark_thread_read() below. The default privileges would have handed these roles
-- every command; suite 80 fails on a write grant with no policy behind it, so be explicit.
revoke all on public.message_reads from anon;
revoke insert, update, delete on public.message_reads from authenticated;
grant select on public.message_reads to authenticated;

-- ================================================================ 2. old rows keep their meaning
alter table public.messages add column reads_tracked boolean not null default false;
alter table public.messages alter column reads_tracked set default true;
comment on column public.messages.reads_tracked is
  'False for every message that predates per-reader receipts: those count as unread by read_at, firm-wide, as they always did. True from migration 25 on: unread is per reader, from message_reads.';

-- reads_tracked is fixed at insert like the rest of the message; only read_at may change.
create or replace function public.messages_immutable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.id             is distinct from old.id
  or new.firm_id        is distinct from old.firm_id
  or new.matter_id      is distinct from old.matter_id
  or new.appointment_id is distinct from old.appointment_id
  or new.sender_id      is distinct from old.sender_id
  or new.body           is distinct from old.body
  or new.attachments    is distinct from old.attachments
  or new.created_at     is distinct from old.created_at
  or new.reads_tracked  is distinct from old.reads_tracked then
    raise exception 'a message cannot be altered once it is sent — only its read state may change'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- ================================================================ 3. the one door: mark_thread_read()
-- The caller must be able to read the thread by the same test messages_select applies. Then: a
-- receipt for every tracked message from the other side they have not already read, and read_at
-- on every message from the other side that nobody across the line has read yet — tracked or not,
-- because that column's meaning does not change. Returns how many receipts were new.
create or replace function public.mark_thread_read(p_matter uuid default null, p_appointment uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_firm uuid; v_member bool; n integer := 0;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_matter is null and p_appointment is null then return 0; end if;

  if p_matter is not null then
    select firm_id into v_firm from matters where id = p_matter and deleted_at is null;
    if v_firm is null or not (is_firm_member(v_firm) or is_matter_party(p_matter)) then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  else
    select firm_id into v_firm from appointments where id = p_appointment;
    if v_firm is null or not (is_firm_member(v_firm) or is_appointment_client(p_appointment)) then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  end if;
  v_member := is_firm_member(v_firm);

  insert into message_reads (message_id, user_id)
  select m.id, v_uid
    from messages m
   where m.firm_id = v_firm
     and ((p_matter is not null and m.matter_id = p_matter) or (p_appointment is not null and m.appointment_id = p_appointment))
     and m.reads_tracked
     and m.sender_id is distinct from v_uid
     and exists (select 1 from firm_members fm where fm.firm_id = m.firm_id and fm.user_id = m.sender_id) <> v_member
  on conflict do nothing;
  get diagnostics n = row_count;

  update messages m
     set read_at = now()
   where m.firm_id = v_firm
     and ((p_matter is not null and m.matter_id = p_matter) or (p_appointment is not null and m.appointment_id = p_appointment))
     and m.read_at is null
     and m.sender_id is distinct from v_uid
     and exists (select 1 from firm_members fm where fm.firm_id = m.firm_id and fm.user_id = m.sender_id) <> v_member;

  return n;
end $$;

revoke execute on function public.mark_thread_read(uuid, uuid) from public, anon;
grant  execute on function public.mark_thread_read(uuid, uuid) to authenticated;

-- Whether a message's sender is on the firm's side of the line. This has to be a definer
-- function, not an inline subquery: firm_threads is security_invoker, so a subquery on
-- firm_members there runs under the CALLER's RLS — and a client cannot see firm_members at all
-- (firm_members_select is is_firm_member(firm_id)), so "is the sender a member" would read false
-- for every client, and every one of a firm's messages would look like it came from a client.
-- The function is owned by postgres and bypasses that, answering the same for staff and client.
create or replace function public.msg_from_firm(p_firm uuid, p_sender uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from firm_members fm where fm.firm_id = p_firm and fm.user_id = p_sender);
$$;
revoke execute on function public.msg_from_firm(uuid, uuid) from public, anon;
grant  execute on function public.msg_from_firm(uuid, uuid) to authenticated;

-- ================================================================ 4. the thread, as a fact: who spoke last, what I have not read
-- security_invoker: the caller sees exactly the threads messages_select lets them see, and every
-- later wall on matters reaches this view for free.
create view public.firm_threads with (security_invoker = true) as
  with last as (
    select distinct on (firm_id, matter_id, appointment_id)
           firm_id, matter_id, appointment_id,
           id as last_message_id, sender_id as last_sender_id, created_at as last_message_at
      from public.messages
     order by firm_id, matter_id, appointment_id, created_at desc, id desc)
  select l.firm_id, l.matter_id, l.appointment_id, l.last_message_id, l.last_message_at,
         -- The firm spoke last. Its inverse is "the firm owes the reply".
         public.msg_from_firm(l.firm_id, l.last_sender_id) as last_from_firm,
         -- Messages from across the line that the CALLER has not read: by receipt when tracked,
         -- by read_at when not. Side-aware, so a client counts the firm's messages and a member
         -- counts the client's.
         (select count(*) from public.messages m
           where m.firm_id = l.firm_id
             and m.matter_id is not distinct from l.matter_id
             and m.appointment_id is not distinct from l.appointment_id
             and m.sender_id is distinct from auth.uid()
             and public.msg_from_firm(m.firm_id, m.sender_id) <> public.is_firm_member(m.firm_id)
             and case when m.reads_tracked
                      then not exists (select 1 from public.message_reads r where r.message_id = m.id and r.user_id = auth.uid())
                      else m.read_at is null end) as unread_for_me
    from last l;
grant select on public.firm_threads to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.firm_threads from anon, authenticated;

-- ================================================================ 5. firm_overview counts per viewer, and counts the work
-- The definition is migration 19's, verbatim, with the unread count taken from firm_threads and
-- one column added at the end. Two numbers where there was one: unread_messages is now what the
-- viewer has not read, and threads_awaiting_reply is what the firm owes, whoever has read it.
create or replace view public.firm_overview with (security_invoker = true) as
  select f.id as firm_id, f.name, f.status,
         (select count(*) from public.matters m where m.firm_id = f.id and m.deleted_at is null and m.closed_at is null) as open_matters,
         (select count(*) from public.appointments a where a.firm_id = f.id and a.status in ('confirmed','rescheduled') and a.starts_at >= now()) as upcoming_appointments,
         (select count(*) from public.court_events ce join public.matters m2 on m2.id = ce.matter_id and m2.deleted_at is null
           where ce.firm_id = f.id and ce.outcome_update_id is null and ce.vacated_at is null
             and ce.scheduled_at between now() and now() + interval '30 days') as court_dates_30d,
         (select count(*) from public.firm_sittings_due s where s.firm_id = f.id) as sittings_due,
         -- Minor units of one currency cannot be added to minor units of another, so each is
         -- kept apart: {"NGN": 22575000, "USD": 50000}. A firm that bills in one currency
         -- gets a one-key object, and a firm owed nothing gets an empty one.
         (select coalesce(jsonb_object_agg(x.currency, x.minor), '{}'::jsonb)
            from (select i.currency::text as currency, sum(i.total_minor - i.paid_minor) as minor
                    from public.invoices i
                   where i.firm_id = f.id and i.status in ('issued','partially_paid','overdue')
                   group by i.currency
                  having sum(i.total_minor - i.paid_minor) <> 0) x) as outstanding_by_currency,
         (select coalesce(jsonb_object_agg(y.currency, y.minor), '{}'::jsonb)
            from (select i2.currency::text as currency, sum(p.amount_minor) as minor
                    from public.payments p join public.invoices i2 on i2.id = p.invoice_id
                   where i2.firm_id = f.id and p.status = 'succeeded' and p.paid_at >= date_trunc('month', now())
                   group by i2.currency
                  having sum(p.amount_minor) <> 0) y) as collected_this_month_by_currency,
         -- Per viewer, since migration 25: what THIS member has not read, from the client side of
         -- every thread. Colleagues see different numbers, which is what "unread" means.
         (select coalesce(sum(t.unread_for_me), 0)::bigint from public.firm_threads t where t.firm_id = f.id) as unread_messages,
         (select count(*) from public.tasks t where t.firm_id = f.id and t.status = 'open' and t.due_at < now()) as overdue_tasks,
         -- Only what nobody has looked at yet, so the number can come back down.
         (select count(*) from public.documents d where d.firm_id = f.id and d.deleted_at is null
             and d.category = 'client_upload' and d.reviewed_at is null and not exists (
               select 1 from public.firm_members fm2 where fm2.user_id = d.uploaded_by and fm2.firm_id = f.id)) as client_uploads,
         (select count(*) from public.process_service ps where ps.served_firm_id = f.id and ps.revoked_at is null and ps.acknowledged_at is null) as service_to_acknowledge,
         -- Shared, not per viewer: the threads whose latest message came from outside the firm.
         -- This is the number that means work is waiting, whoever has or has not read it.
         (select count(*) from public.firm_threads t2 where t2.firm_id = f.id and not t2.last_from_firm) as threads_awaiting_reply
  from public.firms f
  where public.is_firm_member(f.id);
