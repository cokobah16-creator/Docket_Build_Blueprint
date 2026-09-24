-- Exact invoice-register aggregates without loading the whole register into the browser.
--
-- The console deliberately caps list rows for performance. Counts and fee totals must not inherit
-- that cap: a firm with 401 invoices cannot have the oldest one silently disappear from "All",
-- "Overdue", or the billed amount. This function aggregates the complete RLS-authorised register
-- in Postgres and returns one row per filter/currency; the screen may still page/cap display rows.

create or replace function public.invoice_register_summary(p_firm uuid)
returns table (
  view_key text,
  currency public.currency,
  invoice_count bigint,
  billed_minor bigint,
  outstanding_minor bigint
)
language sql stable security definer set search_path = public as $$
  with allowed as (
    select f.id, coalesce(f.timezone, 'Africa/Lagos') as timezone
      from public.firms f
     where f.id = p_firm
       and public.is_firm_member(f.id)
  ),
  base as (
    select i.*,
           (i.status in ('issued','partially_paid','overdue')
             and greatest(i.total_minor - i.paid_minor, 0) > 0) as owing,
           (i.status in ('issued','partially_paid','overdue')
             and greatest(i.total_minor - i.paid_minor, 0) > 0
             and (
               i.status = 'overdue'
               or (i.due_at is not null
                   and i.due_at < (now() at time zone a.timezone)::date)
             )) as overdue_now
      from public.invoices i
      join allowed a on a.id = i.firm_id
  ),
  bucketed as (
    select b.*, v.view_key
      from base b
      cross join lateral (
        values
          ('all'::text, true),
          ('outstanding'::text, b.owing),
          ('overdue'::text, b.overdue_now),
          ('draft'::text, b.status = 'draft'),
          ('paid'::text, b.status = 'paid')
      ) as v(view_key, include_row)
     where v.include_row
  )
  select b.view_key,
         b.currency,
         count(*)::bigint as invoice_count,
         coalesce(sum(b.total_minor), 0)::bigint as billed_minor,
         coalesce(sum(case when b.owing then greatest(b.total_minor - b.paid_minor, 0) else 0 end), 0)::bigint
           as outstanding_minor
    from bucketed b
   group by b.view_key, b.currency
   order by b.view_key, b.currency
$$;

revoke execute on function public.invoice_register_summary(uuid) from public, anon;
grant execute on function public.invoice_register_summary(uuid) to authenticated;

comment on function public.invoice_register_summary(uuid) is
  'Exact full-register invoice counts and per-currency totals for the staff invoice filters. Display row limits must never be used as financial aggregates.';
