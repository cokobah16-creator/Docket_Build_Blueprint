-- Docket, migration 62: titles, custom roles and granular permissions, and two tiers that cannot write.
--
-- A firm had four roles and one question the gates could ask: is this person a member, and is
-- the member an owner or admin. Everybody else was a lawyer or staff with identical rights. The
-- master prompt asks for thirteen titles, granular permissions a firm can set per person, roles
-- a firm defines for itself, and two kinds of member who may look but never touch. This migration
-- adds all of that WITHOUT moving the gates: the four tiers stay the security tiers every policy
-- and function already understands, and the new layer narrows what a tier may do rather than
-- widening it.
--
-- THREE LAYERS, RESOLVED IN ONE PLACE. member_permissions(firm, user) answers with a list:
--   · an owner holds every permission, always. Nothing below can narrow an owner, because a firm
--     whose owner has been locked out of its own settings has nobody left to fix it;
--   · a per member grant or denial (firm_member_permissions) is the final word on one permission;
--   · otherwise a custom role's list (firm_custom_roles), where the member holds one;
--   · otherwise the tier's defaults (role_default_permissions).
-- has_permission(firm, permission) is that list asked about the caller, and it is what the trigger
-- guards below ask.
--
-- ENFORCED BY TRIGGERS ON THE TABLES, NOT BY RE WRITING THE FUNCTIONS. Every protected table gets
-- a BEFORE trigger that fires for a firm member and refuses when they lack the permission. A
-- direct PostgREST write and an RPC meet the same rule, because the RPC inserts into the same
-- table. A client, a platform admin and the service role are not members and pass untouched. The
-- existing policies and doors are unchanged, so the 1,499 checks before this file still describe
-- the product.
--
-- TWO TIERS THAT CANNOT WRITE. `readonly` reads what the firm shares with its staff and writes
-- nothing: staff_w() is false for it, so every write policy and every staff door refuses.
-- `external` is somebody from outside given the console for the matters they are put on:
-- can_see_matter() admits them only through matter_lawyers, so a firm wide matter they are not on
-- is absent for them, and so is everything that hangs off it. Neither tier writes anything; a
-- collaborator from another firm who needs to work a file is Docket Network's job, not a role.
--
-- A TITLE IS A LABEL. Managing Partner, Associate, Paralegal and the rest are words on a card and
-- in a signature block, carried on the membership and on the invitation that created it. A title
-- decides nothing; the tier, the custom role and the grants decide.

-- ================================================================ 1. the tiers that cannot write
create or replace function public.staff_w(f uuid) returns boolean
language sql stable set search_path = public as $$
  select public.is_firm_member(f) and public.mfa_ok() and public.firm_not_suspended(f)
     and not public.has_firm_role(f, array['readonly', 'external']::firm_role[])
$$;

-- external reaches a matter only through its team. The same predicate, inlined, on the three
-- matters policies migration 29 wrote, because they do not call can_see_matter() themselves.
create or replace function public.can_see_matter(m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matters mt
     where mt.id = m
       and is_firm_member(mt.firm_id)
       and ((mt.access = 'firm' and not has_firm_role(mt.firm_id, array['external']::firm_role[]))
            or exists (select 1 from matter_lawyers ml where ml.matter_id = mt.id and ml.user_id = auth.uid())))
$$;

drop policy if exists matters_select on public.matters;
create policy matters_select on public.matters for select using (
  (is_firm_member(firm_id)
     and ((access = 'firm' and not has_firm_role(firm_id, array['external']::firm_role[]))
          or exists (select 1 from matter_lawyers ml where ml.matter_id = matters.id and ml.user_id = (select auth.uid()))))
  or (deleted_at is null and is_matter_party(id)));

-- ================================================================ 2. the permissions, named once
create or replace function public.permission_keys() returns text[]
language sql immutable set search_path = public as $$
  select array['view_matters', 'create_matters', 'edit_matters', 'assign_lawyers', 'view_financials',
               'create_invoices', 'approve_payments', 'manage_clients', 'manage_team', 'manage_documents',
               'invite_firms', 'manage_integrations', 'access_reports', 'manage_settings', 'use_ai']
$$;

create or replace function public.role_default_permissions(r firm_role) returns text[]
language sql immutable set search_path = public as $$
  select case r
    when 'owner'    then public.permission_keys()
    when 'admin'    then public.permission_keys()
    when 'lawyer'   then array['view_matters', 'create_matters', 'edit_matters', 'assign_lawyers', 'view_financials',
                               'create_invoices', 'manage_clients', 'manage_documents', 'invite_firms', 'access_reports', 'use_ai']
    when 'staff'    then array['view_matters', 'create_matters', 'edit_matters', 'assign_lawyers',
                               'create_invoices', 'manage_clients', 'manage_documents', 'use_ai']
    when 'readonly' then array['view_matters', 'view_financials', 'access_reports']
    when 'external' then array['view_matters']
    else array[]::text[]
  end
$$;

-- ================================================================ 3. titles, custom roles, grants
alter table public.firm_members
  add column title text check (title is null or length(btrim(title)) between 2 and 80),
  add column custom_role_key text;
alter table public.staff_invites
  add column title text check (title is null or length(btrim(title)) between 2 and 80);
comment on column public.firm_members.title is
  'A label: Managing Partner, Associate, Paralegal, or whatever the firm calls the job. Decides nothing.';

create table public.firm_custom_roles (
  id          uuid not null default gen_random_uuid() unique,
  firm_id     uuid not null references public.firms(id) on delete cascade,
  key         text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label       text not null check (length(btrim(label)) between 2 and 80),
  -- The tier the gates see. Never owner: an owner is not a role a firm hands out by list.
  base_role   firm_role not null check (base_role <> 'owner'),
  permissions text[] not null default '{}',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (firm_id, key)
);
comment on table public.firm_custom_roles is
  'A role the firm defined: a tier plus the permissions it carries. A member holding one is judged by its list instead of the tier''s defaults; a per member grant still wins.';
alter table public.firm_custom_roles enable row level security;
create policy firm_custom_roles_select on public.firm_custom_roles for select using (is_firm_member(firm_id));
revoke insert, update, delete, truncate, references, trigger on public.firm_custom_roles from anon, authenticated;
grant select on public.firm_custom_roles to authenticated;
create trigger firm_custom_roles_audit after insert or update or delete on public.firm_custom_roles
  for each row execute function public.audit_row_change();

alter table public.firm_members
  add constraint firm_members_custom_role_fk
  foreign key (firm_id, custom_role_key) references public.firm_custom_roles(firm_id, key)
  on delete set null (custom_role_key);

create table public.firm_member_permissions (
  firm_id    uuid not null,
  user_id    uuid not null,
  permission text not null check (permission = any (public.permission_keys())),
  granted    boolean not null,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (firm_id, user_id, permission),
  foreign key (firm_id, user_id) references public.firm_members(firm_id, user_id) on delete cascade
);
comment on table public.firm_member_permissions is
  'A grant (true) or a denial (false) of one permission for one member. The final word, above a custom role and above the tier. Never written for an owner.';
alter table public.firm_member_permissions enable row level security;
create policy firm_member_permissions_select on public.firm_member_permissions for select using (is_firm_member(firm_id));
revoke insert, update, delete, truncate, references, trigger on public.firm_member_permissions from anon, authenticated;
grant select on public.firm_member_permissions to authenticated;
create trigger firm_member_permissions_audit after insert or update or delete on public.firm_member_permissions
  for each row execute function public.audit_row_change();

-- ================================================================ 4. the resolution
/**
 * What one member may do at one firm, as a sorted list. Empty for a non member, and empty for
 * anybody asking about a firm they are not a member of: a colleague's permissions are readable by
 * colleagues (the grant rows are), nobody else's.
 */
create or replace function public.member_permissions(p_firm uuid, p_user uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case when not is_firm_member(p_firm) then '{}'::text[] else coalesce((
    select case
             when fm.role = 'owner' then permission_keys()
             else (select coalesce(array_agg(k order by k), '{}'::text[])
                     from unnest(permission_keys()) k
                    where coalesce(
                      (select fmp.granted from firm_member_permissions fmp
                        where fmp.firm_id = fm.firm_id and fmp.user_id = fm.user_id and fmp.permission = k),
                      case when cr.key is not null then k = any (cr.permissions)
                           else k = any (role_default_permissions(fm.role)) end))
           end
      from firm_members fm
      left join firm_custom_roles cr on cr.firm_id = fm.firm_id and cr.key = fm.custom_role_key
     where fm.firm_id = p_firm and fm.user_id = p_user), '{}'::text[]) end
$$;
revoke execute on function public.member_permissions(uuid, uuid) from public, anon;
grant  execute on function public.member_permissions(uuid, uuid) to authenticated;

/** The caller's own answer, the shape the console reads once per request. */
create or replace function public.my_permissions(p_firm uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select member_permissions(p_firm, auth.uid())
$$;
revoke execute on function public.my_permissions(uuid) from public, anon;
grant  execute on function public.my_permissions(uuid) to authenticated;

/** The gate the triggers ask. A predicate: never refuses, answers false. */
create or replace function public.has_permission(f uuid, p text) returns boolean
language sql stable security definer set search_path = public as $$
  select p = any (member_permissions(f, auth.uid()))
$$;

-- ================================================================ 5. the guards
/**
 * One trigger function, told which permission by its argument. It fires for a member of the row's
 * firm and nobody else: a client uploading a document, a platform admin changing a status and the
 * service role recording a payment are not members and pass. The firm is the row's firm_id, or
 * its id on the firms table itself.
 */
create or replace function public.guard_member_permission() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
        v_firm uuid; v_perm text := tg_argv[0];
begin
  v_firm := case when tg_table_name = 'firms' then (v_row ->> 'id')::uuid else (v_row ->> 'firm_id')::uuid end;
  if auth.uid() is not null and v_firm is not null and is_firm_member(v_firm) and not has_permission(v_firm, v_perm) then
    raise exception 'not permitted: this needs the "%" permission at this firm, which your account does not hold',
      replace(v_perm, '_', ' ') using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public.guard_member_permission() from public, anon, authenticated;

create trigger matters_permission_ins before insert on public.matters
  for each row execute function public.guard_member_permission('create_matters');
create trigger matters_permission_upd before update on public.matters
  for each row execute function public.guard_member_permission('edit_matters');
create trigger matter_lawyers_permission before insert or delete on public.matter_lawyers
  for each row execute function public.guard_member_permission('assign_lawyers');
create trigger invoices_permission_ins before insert on public.invoices
  for each row execute function public.guard_member_permission('create_invoices');
create trigger documents_permission_ins before insert on public.documents
  for each row execute function public.guard_member_permission('manage_documents');
create trigger matter_collaborations_permission_ins before insert on public.matter_collaborations
  for each row execute function public.guard_member_permission('invite_firms');
create trigger staff_invites_permission_ins before insert on public.staff_invites
  for each row execute function public.guard_member_permission('manage_team');
create trigger firms_permission_upd before update on public.firms
  for each row execute function public.guard_member_permission('manage_settings');

-- ================================================================ 6. the doors
/** A member's title: their own, with a verified session; anybody's, by an owner or admin who manages the team. */
create or replace function public.set_member_title(p_firm uuid, p_user uuid, p_title text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_title text := nullif(btrim(coalesce(p_title, '')), ''); v_old text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_user = auth.uid() then
    if not staff_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  elsif not (admin_w(p_firm) and has_permission(p_firm, 'manage_team')) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select title into v_old from firm_members where firm_id = p_firm and user_id = p_user for update;
  if not found then raise exception 'that person is not a member of this firm'; end if;
  if v_old is not distinct from v_title then return; end if;
  update firm_members set title = v_title where firm_id = p_firm and user_id = p_user;
  perform audit('firm_members.title', 'firm_members', p_user, p_firm, jsonb_build_object('from', v_old, 'to', v_title));
end $$;
revoke execute on function public.set_member_title(uuid, uuid, text) from public, anon;
grant  execute on function public.set_member_title(uuid, uuid, text) to authenticated;

/** Put a member on a custom role, or take them off one (null). Owners and admins who manage the team. */
create or replace function public.set_member_custom_role(p_firm uuid, p_user uuid, p_key text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_key text := nullif(btrim(coalesce(p_key, '')), ''); v_role firm_role; v_old text;
begin
  if not (admin_w(p_firm) and has_permission(p_firm, 'manage_team')) then raise exception 'not permitted' using errcode = '42501'; end if;
  select role, custom_role_key into v_role, v_old from firm_members where firm_id = p_firm and user_id = p_user for update;
  if not found then raise exception 'that person is not a member of this firm'; end if;
  if v_role = 'owner' and v_key is not null then raise exception 'an owner holds every permission; a custom role cannot narrow it'; end if;
  if v_key is not null and not exists (select 1 from firm_custom_roles where firm_id = p_firm and key = v_key) then
    raise exception 'this firm has no custom role called %', v_key;
  end if;
  if v_old is not distinct from v_key then return; end if;
  update firm_members set custom_role_key = v_key where firm_id = p_firm and user_id = p_user;
  perform audit('firm_members.custom_role', 'firm_members', p_user, p_firm, jsonb_build_object('from', v_old, 'to', v_key));
end $$;
revoke execute on function public.set_member_custom_role(uuid, uuid, text) from public, anon;
grant  execute on function public.set_member_custom_role(uuid, uuid, text) to authenticated;

/**
 * Grant, deny or clear permissions for one member: {"create_matters": false, "use_ai": true,
 * "view_financials": null}. Owners and admins who manage the team; never on yourself, never on an
 * owner. Returns what the member may do afterwards.
 */
create or replace function public.set_member_permissions(p_firm uuid, p_user uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; v_role firm_role; n_set int := 0; n_cleared int := 0; n int;
begin
  if not (admin_w(p_firm) and has_permission(p_firm, 'manage_team')) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own permissions — ask another owner or administrator'; end if;
  select role into v_role from firm_members where firm_id = p_firm and user_id = p_user for update;
  if not found then raise exception 'that person is not a member of this firm'; end if;
  if v_role = 'owner' then raise exception 'an owner holds every permission; stand them down from owner first'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'changes must be an object of permission: true, false or null';
  end if;

  for k, v in select * from jsonb_each(p_changes) loop
    if not (k = any (permission_keys())) then raise exception 'unknown permission %', k; end if;
    if jsonb_typeof(v) = 'null' then
      delete from firm_member_permissions where firm_id = p_firm and user_id = p_user and permission = k;
      get diagnostics n = row_count; n_cleared := n_cleared + n;
    elsif jsonb_typeof(v) = 'boolean' then
      insert into firm_member_permissions (firm_id, user_id, permission, granted, granted_by)
      values (p_firm, p_user, k, (v)::boolean, auth.uid())
      on conflict (firm_id, user_id, permission) do update
        set granted = excluded.granted, granted_by = excluded.granted_by, created_at = now();
      n_set := n_set + 1;
    else
      raise exception 'permission % must be true, false or null', k;
    end if;
  end loop;

  perform audit('firm_members.permissions', 'firm_members', p_user, p_firm,
                jsonb_build_object('changes', p_changes, 'set', n_set, 'cleared', n_cleared));
  return jsonb_build_object('set', n_set, 'cleared', n_cleared, 'permissions', to_jsonb(member_permissions(p_firm, p_user)));
end $$;
revoke execute on function public.set_member_permissions(uuid, uuid, jsonb) from public, anon;
grant  execute on function public.set_member_permissions(uuid, uuid, jsonb) to authenticated;

/** Define or redefine a custom role. Owners and admins who manage the team. */
create or replace function public.upsert_custom_role(p_firm uuid, p_key text, p_label text, p_base_role firm_role, p_permissions text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text := lower(btrim(coalesce(p_key, ''))); v_new bool; p text; v_id uuid;
begin
  if not (admin_w(p_firm) and has_permission(p_firm, 'manage_team')) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_key !~ '^[a-z][a-z0-9_]{1,39}$' then raise exception 'a role key is lowercase letters, digits and underscores, starting with a letter'; end if;
  if p_base_role = 'owner' then raise exception 'owner is not a role a firm hands out by list — appoint an owner with set_member_role()'; end if;
  foreach p in array coalesce(p_permissions, '{}') loop
    if not (p = any (permission_keys())) then raise exception 'unknown permission %', p; end if;
  end loop;
  v_new := not exists (select 1 from firm_custom_roles where firm_id = p_firm and key = v_key);
  insert into firm_custom_roles (firm_id, key, label, base_role, permissions, created_by)
  values (p_firm, v_key, btrim(p_label), p_base_role,
          (select coalesce(array_agg(distinct x order by x), '{}'::text[]) from unnest(coalesce(p_permissions, '{}')) x), auth.uid())
  on conflict (firm_id, key) do update
    set label = excluded.label, base_role = excluded.base_role, permissions = excluded.permissions, updated_at = now()
  returning id into v_id;
  perform audit(case when v_new then 'custom_role.created' else 'custom_role.changed' end, 'firm_custom_roles', v_id, p_firm,
                jsonb_build_object('key', v_key, 'base_role', p_base_role, 'permissions', to_jsonb(p_permissions)));
  return jsonb_build_object('id', v_id, 'key', v_key, 'created', v_new);
end $$;
revoke execute on function public.upsert_custom_role(uuid, text, text, firm_role, text[]) from public, anon;
grant  execute on function public.upsert_custom_role(uuid, text, text, firm_role, text[]) to authenticated;

/** Remove a custom role nobody holds. */
create or replace function public.delete_custom_role(p_firm uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare v_key text := lower(btrim(coalesce(p_key, ''))); v_holders int; v_id uuid;
begin
  if not (admin_w(p_firm) and has_permission(p_firm, 'manage_team')) then raise exception 'not permitted' using errcode = '42501'; end if;
  select id into v_id from firm_custom_roles where firm_id = p_firm and key = v_key;
  if v_id is null then raise exception 'this firm has no custom role called %', v_key; end if;
  select count(*) into v_holders from firm_members where firm_id = p_firm and custom_role_key = v_key;
  if v_holders > 0 then
    raise exception '% member(s) hold the role % — move them to another role first', v_holders, v_key;
  end if;
  delete from firm_custom_roles where firm_id = p_firm and key = v_key;
  perform audit('custom_role.deleted', 'firm_custom_roles', v_id, p_firm, jsonb_build_object('key', v_key));
end $$;
revoke execute on function public.delete_custom_role(uuid, text) from public, anon;
grant  execute on function public.delete_custom_role(uuid, text) to authenticated;

-- ================================================================ 7. an invitation carries a title
-- Migration 12's accept_staff_invite(), with the title carried onto the membership. Everything
-- else is as it was: the identity provider's email must match, and only an owner invites an owner.
create or replace function public.accept_staff_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv staff_invites%rowtype; v_email text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_inv from staff_invites where token = p_token and accepted_by is null and expires_at > now() for update;
  if not found then raise exception 'invite invalid or expired'; end if;
  v_email := coalesce(auth.jwt() ->> 'email', (select email from auth.users where id = auth.uid()));
  if v_email is null or lower(v_email) <> lower(v_inv.email) then
    raise exception 'this invite was sent to a different email address' using errcode = '42501';
  end if;
  insert into firm_members (firm_id, user_id, role, title) values (v_inv.firm_id, auth.uid(), v_inv.role, v_inv.title)
  on conflict (firm_id, user_id) do update set role = excluded.role, title = coalesce(excluded.title, firm_members.title);
  if v_inv.role in ('lawyer', 'admin', 'owner') then
    insert into lawyer_profiles (firm_id, user_id, is_public) values (v_inv.firm_id, auth.uid(), false)
    on conflict (firm_id, user_id) do nothing;
  end if;
  update staff_invites set accepted_by = auth.uid() where id = v_inv.id;
  perform audit('staff_invite.accepted', 'staff_invite', v_inv.id, v_inv.firm_id,
                jsonb_build_object('role', v_inv.role, 'title', v_inv.title));
  return jsonb_build_object('firm_id', v_inv.firm_id, 'role', v_inv.role, 'title', v_inv.title);
end $$;
revoke execute on function public.accept_staff_invite(text) from public, anon;
grant  execute on function public.accept_staff_invite(text) to authenticated;
