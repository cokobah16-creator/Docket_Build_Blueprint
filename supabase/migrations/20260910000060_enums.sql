-- Docket, migration 60: enum values the global workspace needs, and nothing else.
--
-- A new enum value cannot be used in the transaction that adds it: a `language sql` body or a
-- policy that names it fails at creation with "unsafe use of new value". So this file adds values
-- and does nothing with them. Migrations 61 and 62 use them, from their own transactions.
--
-- currency: the jurisdiction registry (61) names a currency per country, and a firm registering
-- under one of them needs a default currency the invoices table can hold. The enum is widened
-- rather than replaced because invoices, payments, services and firms all carry it; a text
-- column with a check would be a second statement of the same list. Paystack settles NGN and,
-- where a firm's Paystack account has it enabled, other currencies (decision 0002); whether a
-- currency can actually be CHARGED is still the provider's answer at checkout, not this list's.
--
-- firm_role: two tiers the gates can refuse. `readonly` is a member who may read what the firm
-- shares with its staff and write nothing at all. `external` is somebody from outside the firm,
-- given the console for the matters they are put on and nothing else: no firm wide read, no
-- write. Both are refused by staff_w() from migration 62 on, and `external` is walled to its
-- matter teams by can_see_matter() from the same migration.

alter type public.currency add value if not exists 'GBP';
alter type public.currency add value if not exists 'EUR';
alter type public.currency add value if not exists 'CAD';
alter type public.currency add value if not exists 'AUD';
alter type public.currency add value if not exists 'GHS';
alter type public.currency add value if not exists 'KES';
alter type public.currency add value if not exists 'ZAR';

alter type public.firm_role add value if not exists 'readonly';
alter type public.firm_role add value if not exists 'external';
