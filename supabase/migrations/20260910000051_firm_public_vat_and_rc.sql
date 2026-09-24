-- firm_public carries the firm's VAT rate and its RC/BN number.
--
-- THE PRICE A CLIENT SAW WAS NOT THE PRICE THEY PAID. book_appointment() (migration 35) adds the
-- firm's VAT to a priced consultation and raises the invoice for the total, and Paystack charges
-- that total. The booking wizard could only show the pre-VAT price_minor, on every service card,
-- in its one "Fee" row and on the "Confirm and pay" button, because the one firm row the public
-- site may read had no vat_rate. A firm charging 7.5% asked its client to confirm ₦50,000 and
-- then charged ₦53,750. With vat_rate here, the site works the total out the way the database
-- does (src/lib/money.ts, vatMinor) and shows Fee, VAT and Total before the client confirms.
--
-- rc_number is the firm's CAC registration number, which the CAC's own register already makes
-- public. It is added in the same change so the public site can state the firm's registration
-- (legal readiness item 16) without a second re-creation of this view. tin is NOT added: the tax
-- number belongs on an invoice where VAT applies, read by that invoice's client, never by an
-- anonymous visitor.
--
-- WHAT DOES NOT CHANGE. The columns of migration 13 keep their names, order and meaning; the two
-- new ones are appended, which is the only change CREATE OR REPLACE VIEW allows and the only one
-- the deployed front end cannot notice. The view stays a definer view (security_invoker = false)
-- over ACTIVE firms only, readable by anon and authenticated. Migration 14's note applies to
-- every re-created view: a view gets insert/update/delete from Supabase's default privileges and
-- the view owner bypasses RLS, so write access is revoked again here, in the same file.

create or replace view public.firm_public with (security_invoker = false) as
  select id, slug, name, legal_name, brand, policies, custom_domain, timezone, default_currency,
         (verified_at is not null) as verified,
         vat_rate, rc_number
  from public.firms
  where status = 'active';

grant select on public.firm_public to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.firm_public from anon, authenticated;
