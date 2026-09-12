-- The invoice is the RPC's to write, and nobody else's — before a ledger is built on top of it.
--
-- Wave 0 found this class in firm_members and the plan drew the general rule out of it: for every
-- guarded RPC, check that the table it guards is not also directly writable. `invoices` is the
-- last money table where that check fails. create_invoice(), issue_invoice(), cancel_invoice()
-- and record_payment() read as authoritative — a draft can only be issued once, a part-paid
-- invoice cannot be cancelled, a payment is idempotent on its provider reference, and a charge
-- that settled to the wrong subaccount pays nothing — and beside them sits
-- `invoices_write_upd ... using (matter_row_w(firm_id, matter_id))`, whole-row. So any member of
-- the firm with a second factor and access to the matter can PATCH `paid_minor` to the total, or
-- `status` to 'paid', or `currency` to another one, or `client_id` to somebody else, and DELETE
-- an unpaid invoice outright. audit_row_change() records it; nothing refuses it.
--
-- Nothing in Docket does this. Every write to invoices and invoice_items in `app/` and `src/`, on
-- this branch and on the deployed main, is a `.select()`; the four RPCs are the only writers. So
-- the grant is dead surface, and `payments`, `notifications` and `firm_members` are the precedent
-- for what to do with dead surface: revoke it.
--
-- This matters now rather than later because the client-money ledger designed in
-- docs/CLIENT_MONEY_DESIGN.md derives balances from these rows. A ledger over a table whose
-- balance column any member can edit is not a ledger, and retrofitting the door after the
-- balances exist is the expensive order to do it in.
--
-- Ordering: safe either side. The deployed front end never writes these tables, so nothing it
-- does stops working; and the RPCs are SECURITY DEFINER, so they are unaffected by the grant.

-- The doors, and only the doors.
revoke insert, update, delete on public.invoices from authenticated;
revoke insert, update, delete on public.invoice_items from authenticated;
revoke all on public.invoices from anon;
revoke all on public.invoice_items from anon;
grant select on public.invoices to authenticated;
grant select on public.invoice_items to authenticated;

-- The policies go with the grants. A policy with no grant behind it is a sentence nobody reads,
-- and leaving them would suggest a write path that does not exist.
drop policy if exists invoices_write_ins on public.invoices;
drop policy if exists invoices_write_upd on public.invoices;
drop policy if exists invoices_write_del on public.invoices;
drop policy if exists invoice_items_write_ins on public.invoice_items;
drop policy if exists invoice_items_write_upd on public.invoice_items;
drop policy if exists invoice_items_write_del on public.invoice_items;

comment on table public.invoices is
  'Written only by create_invoice(), issue_invoice(), cancel_invoice() and record_payment(). The API roles hold select and nothing else (migration 42): paid_minor, status and currency are what the money did, not what a member typed.';
comment on table public.invoice_items is
  'Written only by create_invoice(). The API roles hold select and nothing else (migration 42).';
