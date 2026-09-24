-- Correct the rollout bridge without the stable matter_row_r() helper.
--
-- A SELECT policy also governs INSERT ... RETURNING. matter_row_r(firm_id, id) ultimately reads
-- the matters table through can_see_matter(id); a STABLE function sees the statement-start
-- snapshot, where the row being inserted does not exist yet. That makes a permitted insert fail
-- only because RETURNING cannot see its own new row. Migration 29 intentionally inlined this
-- predicate for exactly that reason. Keep the temporary client branch, but restore the inlined
-- staff predicate until the post-deploy hardening removes client access entirely.

drop policy if exists matters_select on public.matters;
create policy matters_select on public.matters for select using (
  (
    public.is_firm_member(firm_id)
    and (
      access = 'firm'
      or exists (
        select 1
          from public.matter_lawyers ml
         where ml.matter_id = matters.id
           and ml.user_id = (select auth.uid())
      )
    )
  )
  or (deleted_at is null and public.is_matter_party(id))
);

comment on policy matters_select on public.matters is
  'TRANSITIONAL rollout bridge, inlined so INSERT ... RETURNING works. Remove the client is_matter_party branch after the portal_matters frontend is deployed.';
