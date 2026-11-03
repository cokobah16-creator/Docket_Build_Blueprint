-- Docket — who issued an invoice, for the client's own copy of it
-- (docs/LEGAL_READINESS_CHECKLIST.md, item 16, steps 8 and 9).
--
-- A VAT invoice carries the supplier's TIN. A firm's TIN lives on firms, which a client cannot
-- read, and firm_public leaves it out on purpose (migration 51): it is not for every visitor to a
-- firm's site. So the client's invoice PDF and invoice page had no way to print it, and a firm
-- that charged VAT handed its clients VAT invoices without its TIN.
--
-- invoice_issuer() answers for one invoice, to whoever may read that invoice and to nobody else:
-- the test is can_access_invoice() (migration 44), which invoice_items_select and payments_select
-- call and whose predicate invoices_select carries inline. It returns the firm's name, its
-- registered name and its RC/BN, and its TIN only when the invoice charges VAT: an invoice without
-- VAT has no reason to show it. A missing invoice is refused in the same words as one the caller
-- may not read, so an id cannot be probed.
--
-- It reads the firm whatever the firm's status. firm_public hides a firm that is not active, but a
-- client of a suspended firm still holds that firm's invoices and receipts, and who issued them has
-- not changed: the invoice page and PDF name the firm from here when firm_public has no row for it.
--
-- The answer is the firm as it stands today, not a copy taken when the invoice was issued: a firm
-- that changes its registered name or its TIN changes them on its earlier invoices too.

create or replace function public.invoice_issuer(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not can_access_invoice(p_invoice) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'name',       nullif(btrim(f.name), ''),
           'legal_name', nullif(btrim(f.legal_name), ''),
           'rc_number',  nullif(btrim(f.rc_number), ''),
           'tin',        case when i.vat_minor > 0 then nullif(btrim(f.tin), '') end)
    into v
    from invoices i
    join firms f on f.id = i.firm_id
   where i.id = p_invoice;
  return v;
end $$;

revoke execute on function public.invoice_issuer(uuid) from public, anon;
grant execute on function public.invoice_issuer(uuid) to authenticated;

comment on function public.invoice_issuer(uuid) is
  'Who issued an invoice: the firm''s name, legal name and RC/BN, and its TIN only when the invoice charges VAT. '
  'Answers only a caller whom can_access_invoice() lets read the invoice; anyone else, and a missing invoice, gets 42501.';
