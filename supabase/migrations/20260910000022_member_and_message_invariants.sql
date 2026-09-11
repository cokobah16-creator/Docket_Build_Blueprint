-- Two invariants that were stated in comments and enforced nowhere.
--
-- Both were found by review of the slice-5 branch and BOTH ARE LIVE TODAY — neither arrived with
-- migration 20 or 21, and neither waits on a front-end release. They are in one file because they
-- are the same mistake twice: a rule written into a function or a comment while the table it
-- protects stayed open to any caller holding the anon key.
--
-- The project's own rule is that the database is the authorization layer. A SECURITY DEFINER
-- function only counts as that rule when it is the ONLY door.

-- ================================================================ 1. members: shut the other door
-- Migration 20 §3 wrote this down and then relied on the console not to walk through it:
--
--     firm_members has no trigger, and firm_members_write lets an admin promote themselves to
--     owner, delete the last owner, or delete their own membership. None of those is something
--     the invite path allows, so the console must not offer them — but an app-layer check is not
--     the rule. These two functions are the rule.
--
-- The principle is right and the conclusion is inverted. firm_members_write (migration 2, split
-- into _ins/_upd/_del by migration 21) is `using (admin_w(firm_id))`, which asks WHO is calling and
-- never WHICH ROW or WHICH ROLE. admin_w() is true throughout, and firm_id does not change, so
-- USING and WITH CHECK both pass. An admin with the MFA session the console already issues them
-- can, against PostgREST directly:
--
--   PATCH  /rest/v1/firm_members?firm_id=eq.<f>&user_id=eq.<self>   {"role":"owner"}
--     — promoting themselves, which set_member_role() refuses twice over.
--   DELETE /rest/v1/firm_members?firm_id=eq.<f>&user_id=eq.<last owner>
--     — stranding the firm at zero owners. UNRECOVERABLE in-app: set_member_role() requires the
--       caller to BE an owner before it will appoint one, so nobody left can appoint anybody.
--       It also skips remove_member()'s cleanup, so the removed lawyer keeps a lawyer_public
--       listing and bookable slots.
--   POST   /rest/v1/firm_members  {"role":"owner", ...}
--     — minting an owner with no invitation, bypassing check_staff_invite_role()'s "only an owner
--       may invite an owner" and the identity-provider email check in accept_staff_invite().
--
-- The fix is the one migration 1 already used for payments, consultation_sessions and
-- notifications (20260909000001_schema.sql:505-507): take the privilege away. Four functions write
-- this table — create_firm, accept_staff_invite, set_member_role, remove_member — all SECURITY
-- DEFINER and owned by postgres, and the table is not FORCE ROW LEVEL SECURITY, so every one of
-- them keeps working with no grant at all. The app never writes it directly.
--
-- BOTH halves are needed. The REVOKE is load-bearing: with the policies merely dropped, an UPDATE
-- or DELETE with no permissive policy matches zero rows and returns success, which fails closed but
-- SILENTLY, and a later default-privileges grant would reopen it. Dropping the policies is the
-- belt: the table stays shut even if the privilege is handed back by accident.
revoke insert, update, delete on public.firm_members from anon, authenticated;

drop policy if exists firm_members_write_ins on public.firm_members;
drop policy if exists firm_members_write_upd on public.firm_members;
drop policy if exists firm_members_write_del on public.firm_members;

-- ---------------- the last owner, for the door that is still open ----------------
-- Revoking grants does nothing to a SECURITY DEFINER function, and one of them can still strand a
-- firm: accept_staff_invite() ends in
--     on conflict (firm_id, user_id) do update set role = excluded.role
-- (20260910000014_review_round_two.sql:99-100). So an owner/admin invites the LAST OWNER's own
-- email as a 'lawyer'; when that owner accepts, the upsert silently demotes them — never passing
-- through set_member_role(), whose last-owner guard is the only place that rule lived.
--
-- A trigger is the right instrument here precisely because it fires inside the definer functions
-- too. set_member_role() and remove_member() keep their own guards; this is the floor under all of
-- them. INSERT is deliberately not covered: create_firm() inserts the first owner into a firm that
-- has none, and that must keep working.
create or replace function public.guard_last_owner() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_other_owners int;
begin
  -- Only a change that REMOVES an owner can strand a firm. Everything else passes untouched.
  if tg_op = 'UPDATE' and (old.role <> 'owner' or new.role = 'owner') then return new; end if;
  if tg_op = 'DELETE' and old.role <> 'owner' then return old; end if;

  select count(*) into v_other_owners
    from firm_members
   where firm_id = old.firm_id and role = 'owner' and user_id <> old.user_id;

  if v_other_owners = 0 then
    raise exception 'this is the firm''s last owner — appoint another owner first'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists firm_members_last_owner on public.firm_members;
create trigger firm_members_last_owner
  before update or delete on public.firm_members
  for each row execute function public.guard_last_owner();

-- ================================================================ 2. messages cannot be rewritten
-- messages_mark_read (20260909000002_rls.sql:179-181) is a bare FOR UPDATE policy:
--
--     using      (is_firm_member(firm_id) or is_matter_party(matter_id) or is_appointment_client(...))
--     with check (is_firm_member(firm_id) or is_matter_party(matter_id) or is_appointment_client(...))
--
-- It names no column, and the only trigger on messages is `after insert` (notify_message). So any
-- participant in a thread — INCLUDING THE CLIENT — can
--     PATCH /rest/v1/messages?id=eq.<id>  {"body":"...","sender_id":"..."}
-- and rewrite what the firm said, or who said it. check_row_firm() guards firm_id and nothing else.
--
-- Docket's messages are correspondence between a law firm and its client and may end up in
-- evidence. The policy is kept — it is what lets a reader mark a message read, and it will carry
-- the per-recipient read work later — and the column rule is enforced underneath it, where a
-- direct PostgREST call cannot skip it.
create or replace function public.messages_immutable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.id             is distinct from old.id
  or new.firm_id        is distinct from old.firm_id
  or new.matter_id      is distinct from old.matter_id
  or new.appointment_id is distinct from old.appointment_id
  or new.sender_id      is distinct from old.sender_id
  or new.body           is distinct from old.body
  or new.attachments    is distinct from old.attachments
  or new.created_at     is distinct from old.created_at then
    raise exception 'a message cannot be altered once it is sent — only its read state may change'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists messages_immutable on public.messages;
create trigger messages_immutable
  before update on public.messages
  for each row execute function public.messages_immutable();

-- Trigger functions have no business on the API surface, per migration 21 §3. Triggers themselves
-- run as the table owner and do not consult EXECUTE grants, so this costs nothing.
revoke execute on function public.guard_last_owner()   from public, anon, authenticated;
revoke execute on function public.messages_immutable() from public, anon, authenticated;

comment on function public.guard_last_owner() is
  'Refuses any update or delete that would leave a firm with no owner. Fires inside the SECURITY '
  'DEFINER writers too, which is the point: accept_staff_invite() upserts a role and would '
  'otherwise demote the last owner without passing set_member_role().';

comment on function public.messages_immutable() is
  'A sent message is a record. Only read state may change; body, attachments, sender and the '
  'thread it belongs to are fixed at insert.';
