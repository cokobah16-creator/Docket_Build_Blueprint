-- The next action on a matter becomes a work item: it gets an owner and a due day.
--
-- matters.next_action has been free text since migration 1 — "file the written address" — with
-- nobody named to do it and no day it is due by, and nothing queried it. It was shown on the
-- matter, on the list, and to the client, and could never be late, never be somebody's, and never
-- appear in a queue. The assessment's #3 asks for a matter chart whose spine is "current stage,
-- verified deadlines, next required action"; this is the field that spine hangs on.
--
-- The due day is a DATE. A deadline is a calendar day — "by the 30th" — and the project's rule is
-- that a DATE column is a calendar day and is never shifted through a timezone. firm_overview
-- judges "overdue" against today in the firm's timezone for the same reason.
alter table public.matters
  add column next_action_owner_id uuid references public.profiles(id) on delete set null,
  add column next_action_due      date;

comment on column public.matters.next_action_owner_id is 'Who the next action is on. A firm member; the console offers only staff.';
comment on column public.matters.next_action_due is 'The calendar day the next action is due by. A date, never an instant.';

-- The queue reads live matters with a next action, by due day.
create index matters_next_action_due_idx on public.matters (firm_id, next_action_due)
  where deleted_at is null and closed_at is null and next_action is not null;

-- firm_overview: the definition is migration 25's, verbatim, with one column added at the end.
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
         (select count(*) from public.firm_threads t2 where t2.firm_id = f.id and not t2.last_from_firm) as threads_awaiting_reply,
         -- A next action with a due day that has passed, on a live matter. A calendar day, so
         -- "passed" is judged against today in the firm's timezone, not against an instant.
         (select count(*) from public.matters nm
           where nm.firm_id = f.id and nm.deleted_at is null and nm.closed_at is null
             and nm.next_action is not null
             and nm.next_action_due < (now() at time zone coalesce(f.timezone, 'Africa/Lagos'))::date) as next_actions_overdue
  from public.firms f
  where public.is_firm_member(f.id);
