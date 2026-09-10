-- Docket — migration 6: expose firms.policies through firm_public.
-- The public site and the client consent gate need the policy TEXT and
-- VERSIONS (terms, privacy, cancellation, disclaimer) — all of it public-
-- facing content by definition — while the firms table itself stays
-- member-only. Recreate the anon-safe projection with the policies column.

drop view if exists public.firm_public;

create view public.firm_public with (security_invoker = false) as
  select id, slug, name, brand, policies, custom_domain, timezone, default_currency
  from public.firms;

grant select on public.firm_public to anon, authenticated;
