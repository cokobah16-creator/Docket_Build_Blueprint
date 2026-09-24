-- Deployment bridge for the client matter projection.
--
-- Migration 51 correctly moves the client portal to portal_matters so private staff fields on
-- matters are never exposed through the REST table. Migrations, however, reach the hosted database
-- before the new frontend reaches main. The currently deployed frontend still reads the safe
-- column list from public.matters; removing client row access in that window makes every client's
-- matter list disappear.
--
-- Keep the legacy row policy for this ONE release while the branch code has already switched every
-- client read to portal_matters. The next migration, after this frontend is on main, must remove the
-- is_matter_party branch again. This bridge intentionally changes no write permission.
drop policy if exists matters_select on public.matters;
create policy matters_select on public.matters for select using (
  public.matter_row_r(firm_id, id)
  or public.is_matter_party(id)
);

comment on policy matters_select on public.matters is
  'TRANSITIONAL: keeps the pre-portal deployed frontend readable while Docket rolls clients onto portal_matters. Remove client is_matter_party access in the next post-deploy migration.';
