-- Docket — migration 5: partner attribution for profit sharing.
-- From the Klinique master prompt (§10, §14, §22): every matter must carry
-- WHO ORIGINATED the client and WHO IS HANDLING the matter as separate
-- fields, and every payment must be traceable to both, so profit-sharing
-- numbers come out of the database without manual reconciliation.
--
-- Additive only: nothing in migrations 1–4 changes, and the RLS suite is
-- unaffected. Firm-scoped, so it works for every tenant, not just Klinique.

alter table public.matters
  add column originating_lawyer_id uuid references public.profiles,
  add column handling_lawyer_id    uuid references public.profiles;

comment on column public.matters.originating_lawyer_id is
  'The partner/lawyer who brought the client in. Set at matter creation; feeds profit sharing.';
comment on column public.matters.handling_lawyer_id is
  'The partner/lawyer currently responsible for the matter. May differ from the originator.';

-- Backfill: the lead lawyer on a matter is its handler until told otherwise.
update public.matters m
set handling_lawyer_id = ml.user_id
from public.matter_lawyers ml
where ml.matter_id = m.id and ml.is_lead
  and m.handling_lawyer_id is null;

create index matters_originating_lawyer_idx on public.matters (firm_id, originating_lawyer_id);
create index matters_handling_lawyer_idx    on public.matters (firm_id, handling_lawyer_id);

-- ---------------------------------------------------------------------------
-- partner_attribution: one row per succeeded payment, carrying the
-- origination and handling attribution the firm's profit-sharing
-- conversation needs (admin dashboard §22: origination vs execution).
--
-- Matter invoices attribute to the matter's fields; consultation invoices
-- (appointment only, no matter yet) attribute both sides to the consulting
-- lawyer. security_invoker: the caller's own RLS on payments/invoices
-- applies, so clients see only their own rows and staff only their firm's.
-- ---------------------------------------------------------------------------

create view public.partner_attribution with (security_invoker = true) as
select
  p.id            as payment_id,
  i.firm_id,
  i.id            as invoice_id,
  i.number        as invoice_number,
  i.matter_id,
  i.appointment_id,
  p.amount_minor,
  p.currency,
  p.paid_at,
  coalesce(m.originating_lawyer_id, a.lawyer_id) as originating_lawyer_id,
  coalesce(m.handling_lawyer_id,    a.lawyer_id) as handling_lawyer_id
from public.payments p
join public.invoices i on i.id = p.invoice_id
left join public.matters m on m.id = i.matter_id
left join public.appointments a on a.id = i.appointment_id
where p.status = 'succeeded';

grant select on public.partner_attribution to authenticated;
