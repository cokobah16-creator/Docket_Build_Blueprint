-- Granular permissions, custom roles, titles, and the two tiers that cannot write.
--
-- What matters here is what is refused: a lawyer denied one permission is refused by the RPC and
-- by a direct insert alike; a readonly member reads everything the firm shares and writes nothing;
-- an external member reads only the matters they are put on; an owner cannot be narrowed by
-- anybody; and every change is the database's to make and to audit.
--
-- Run alone or with the others. Rolls back.
begin;

create or replace function t_as(u uuid, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', aal)::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create or replace function t_reset() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', false); end $$;
create or replace function t_check(name text, ok bool) returns void language plpgsql as $$
begin if ok then raise notice 'PASS  %', name; else raise exception 'FAIL  %', name; end if; end $$;
create or replace function t_refused(stmt text, code text) returns bool language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlstate = code; end $$;
create or replace function t_fails(stmt text, fragment text) returns bool language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlerrm like '%' || fragment || '%'; end $$;

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
grant select, insert on fx to anon, authenticated;

insert into firms (slug, name, reference_prefix, status) values ('perm-firm', 'Permission Chambers', 'PF', 'active');
insert into firms (slug, name, reference_prefix, status) values ('perm-other', 'Other Chambers', 'OC', 'active');
insert into fx select 'firm',  id from firms where slug = 'perm-firm';
insert into fx select 'other', id from firms where slug = 'perm-other';
insert into auth.users (id, email) values
  (gen_random_uuid(), 'pm-owner@test'), (gen_random_uuid(), 'pm-owner2@test'), (gen_random_uuid(), 'pm-admin@test'),
  (gen_random_uuid(), 'pm-lawyer@test'), (gen_random_uuid(), 'pm-staff@test'), (gen_random_uuid(), 'pm-ro@test'),
  (gen_random_uuid(), 'pm-ext@test'), (gen_random_uuid(), 'pm-client@test'), (gen_random_uuid(), 'pm-new@test'),
  (gen_random_uuid(), 'pq-owner@test');
insert into fx select replace(split_part(email, '@', 1), 'pm-', ''), id from auth.users where email like 'pm-%@test';
insert into fx select 'qowner', id from auth.users where email = 'pq-owner@test';

insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k = 'firm'), (select v from fx where k = 'owner'),  'owner'),
  ((select v from fx where k = 'firm'), (select v from fx where k = 'owner2'), 'owner'),
  ((select v from fx where k = 'firm'), (select v from fx where k = 'admin'),  'admin'),
  ((select v from fx where k = 'firm'), (select v from fx where k = 'lawyer'), 'lawyer'),
  ((select v from fx where k = 'firm'), (select v from fx where k = 'staff'),  'staff'),
  ((select v from fx where k = 'firm'), (select v from fx where k = 'ro'),     'readonly'),
  ((select v from fx where k = 'firm'), (select v from fx where k = 'ext'),    'external'),
  ((select v from fx where k = 'other'), (select v from fx where k = 'qowner'), 'owner');
insert into matter_statuses (firm_id, key, label) values ((select v from fx where k = 'firm'), 'open', 'Open');

insert into matters (firm_id, reference, title, type) values
  ((select v from fx where k = 'firm'), 'PF-FIX-000001', 'Firm wide matter', 'litigation'),
  ((select v from fx where k = 'firm'), 'PF-FIX-000002', 'Matter the external works', 'corporate');
insert into fx select 'm1', id from matters where reference = 'PF-FIX-000001';
insert into fx select 'm2', id from matters where reference = 'PF-FIX-000002';
insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values
  ((select v from fx where k = 'm1'), (select v from fx where k = 'firm'), (select v from fx where k = 'lawyer'), true),
  ((select v from fx where k = 'm2'), (select v from fx where k = 'firm'), (select v from fx where k = 'lawyer'), true),
  ((select v from fx where k = 'm2'), (select v from fx where k = 'firm'), (select v from fx where k = 'ext'), false);
insert into matter_parties (matter_id, firm_id, user_id, role) values
  ((select v from fx where k = 'm1'), (select v from fx where k = 'firm'), (select v from fx where k = 'client'), 'client');
insert into updates (matter_id, firm_id, kind, visibility, title, posted_by) values
  ((select v from fx where k = 'm1'), (select v from fx where k = 'firm'), 'note', 'client', 'On the firm wide matter', (select v from fx where k = 'lawyer')),
  ((select v from fx where k = 'm2'), (select v from fx where k = 'firm'), 'note', 'client', 'On the external''s matter', (select v from fx where k = 'lawyer'));

-- ---------------------------------------------------------------- 1. the defaults
do $$
declare f uuid := (select v from fx where k = 'firm');
begin
  perform t_as((select v from fx where k = 'lawyer'));
  perform t_check('a lawyer may open matters by default',              has_permission(f, 'create_matters'));
  perform t_check('and may not change the firm''s settings',            not has_permission(f, 'manage_settings'));
  perform t_reset();
  perform t_as((select v from fx where k = 'staff'));
  perform t_check('staff may open matters but not invite firms',       has_permission(f, 'create_matters') and not has_permission(f, 'invite_firms'));
  perform t_reset();
  perform t_as((select v from fx where k = 'ro'));
  perform t_check('readonly reads matters and edits nothing',          has_permission(f, 'view_matters') and not has_permission(f, 'edit_matters'));
  perform t_check('readonly is a member the write gate refuses',       is_firm_member(f) and not staff_w(f));
  perform t_reset();
  perform t_as((select v from fx where k = 'ext'));
  perform t_check('external is a member the write gate refuses too',   is_firm_member(f) and not staff_w(f));
  perform t_reset();
  perform t_as((select v from fx where k = 'owner'));
  perform t_check('an owner holds every permission',                   array_length(my_permissions(f), 1) = array_length(permission_keys(), 1));
  perform t_check('a colleague''s permissions are readable by a colleague',
    'edit_matters' = any (member_permissions(f, (select v from fx where k = 'lawyer')))
    and not ('manage_settings' = any (member_permissions(f, (select v from fx where k = 'lawyer')))));
  perform t_reset();
  perform t_as((select v from fx where k = 'qowner'));
  perform t_check('and by nobody outside the firm',                    member_permissions(f, (select v from fx where k = 'lawyer')) = '{}'::text[]);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. the two tiers that cannot write
do $$
declare f uuid := (select v from fx where k = 'firm'); m1 uuid := (select v from fx where k = 'm1'); m2 uuid := (select v from fx where k = 'm2');
        ro uuid := (select v from fx where k = 'ro'); ex uuid := (select v from fx where k = 'ext');
begin
  perform t_as(ro);
  perform t_check('readonly reads every firm wide matter',             (select count(*) from matters where id in (m1, m2)) = 2);
  perform t_check('readonly cannot create a task',
    t_refused(format($q$insert into tasks (firm_id, matter_id, title) values (%L, %L, 'Try')$q$, f, m1), '42501'));
  perform t_check('readonly cannot post an update',
    t_refused(format($q$insert into updates (matter_id, firm_id, kind, visibility, title, posted_by) values (%L, %L, 'note', 'internal', 'Try', %L)$q$, m1, f, ro), '42501'));
  perform t_reset();
  perform t_as(ex);
  perform t_check('external reads only the matter it is put on',      exists (select 1 from matters where id = m2) and not exists (select 1 from matters where id = m1));
  perform t_check('and only that matter''s updates',                   exists (select 1 from updates where matter_id = m2) and not exists (select 1 from updates where matter_id = m1));
  perform t_check('and writes nothing even there',
    t_refused(format($q$insert into tasks (firm_id, matter_id, title) values (%L, %L, 'Try')$q$, f, m2), '42501'));
  perform t_check('the gate says the same thing',                      can_see_matter(m2) and not can_see_matter(m1));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. a denied permission is refused at the RPC and at the table
do $$
declare f uuid := (select v from fx where k = 'firm'); l uuid := (select v from fx where k = 'lawyer'); o uuid := (select v from fx where k = 'owner');
        res jsonb; r jsonb;
begin
  perform t_as(l);
  r := open_matter(f, 'Opened by the lawyer', 'litigation');
  perform t_check('a lawyer opens a matter',                           (r ->> 'matter_id') is not null);
  perform t_reset();
  perform t_as(o);
  res := set_member_permissions(f, l, '{"create_matters": false}');
  perform t_check('an owner denies one permission',                    (res ->> 'set')::int = 1 and not ((res -> 'permissions') ? 'create_matters'));
  perform t_reset();
  perform t_as(l);
  perform t_check('the RPC now refuses with 42501',
    t_refused(format($q$select open_matter(%L, 'Second try', 'litigation')$q$, f), '42501'));
  perform t_check('...naming the permission',
    t_fails(format($q$select open_matter(%L, 'Second try', 'litigation')$q$, f), 'create matters'));
  perform t_check('and so does a direct insert',
    t_refused(format($q$insert into matters (firm_id, reference, title, type) values (%L, 'PF-FIX-000099', 'Direct', 'litigation')$q$, f), '42501'));
  perform t_check('the lawyer still edits what exists',                has_permission(f, 'edit_matters') and not ('create_matters' = any (my_permissions(f))));
  perform t_reset();
  perform t_as(o);
  res := set_member_permissions(f, l, '{"create_matters": null}');
  perform t_check('clearing the denial restores the default',         (res ->> 'cleared')::int = 1 and (res -> 'permissions') ? 'create_matters');
  perform t_reset();
  perform t_as(l);
  r := open_matter(f, 'Third try', 'litigation');
  perform t_check('and the lawyer opens matters again',                (r ->> 'matter_id') is not null);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. who may change permissions, and whose
do $$
declare f uuid := (select v from fx where k = 'firm'); o uuid := (select v from fx where k = 'owner'); o2 uuid := (select v from fx where k = 'owner2');
        a uuid := (select v from fx where k = 'admin'); l uuid := (select v from fx where k = 'lawyer'); s uuid := (select v from fx where k = 'staff');
        q uuid := (select v from fx where k = 'qowner');
begin
  perform t_as(l);
  perform t_check('a lawyer cannot change permissions',
    t_refused(format($q$select set_member_permissions(%L, %L, '{"use_ai": false}')$q$, f, s), '42501'));
  perform t_reset();
  perform t_as(o);
  perform t_check('nobody changes their own',
    t_fails(format($q$select set_member_permissions(%L, %L, '{"use_ai": false}')$q$, f, o), 'own permissions'));
  perform t_check('an owner cannot be narrowed',
    t_fails(format($q$select set_member_permissions(%L, %L, '{"use_ai": false}')$q$, f, o2), 'every permission'));
  perform t_check('an unknown permission is refused',
    t_fails(format($q$select set_member_permissions(%L, %L, '{"fly": true}')$q$, f, l), 'unknown permission'));
  perform t_check('a value that is not true, false or null is refused',
    t_fails(format($q$select set_member_permissions(%L, %L, '{"use_ai": "yes"}')$q$, f, l), 'true, false or null'));
  perform t_check('a stranger is not a member',
    t_fails(format($q$select set_member_permissions(%L, %L, '{"use_ai": true}')$q$, f, q), 'not a member'));
  perform set_member_permissions(f, a, '{"manage_team": false}');
  perform t_reset();
  perform t_as(a);
  perform t_check('an admin denied manage_team cannot change anybody''s',
    t_refused(format($q$select set_member_permissions(%L, %L, '{"use_ai": false}')$q$, f, s), '42501'));
  perform t_reset();
  perform t_as(o);
  perform set_member_permissions(f, a, '{"manage_team": null}');
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 5. custom roles
do $$
declare f uuid := (select v from fx where k = 'firm'); o uuid := (select v from fx where k = 'owner'); s uuid := (select v from fx where k = 'staff');
        o2 uuid := (select v from fx where k = 'owner2'); res jsonb;
begin
  perform t_as(o);
  res := upsert_custom_role(f, 'billing_clerk', 'Billing clerk', 'staff', array['view_matters', 'view_financials', 'create_invoices']);
  perform t_check('an owner defines a role',                            (res ->> 'created')::bool);
  perform t_check('a bad key is refused',
    t_fails(format($q$select upsert_custom_role(%L, 'Billing Clerk', 'x', 'staff', '{}')$q$, f), 'lowercase'));
  perform t_check('owner is not a role to hand out',
    t_fails(format($q$select upsert_custom_role(%L, 'boss', 'Boss', 'owner', '{}')$q$, f), 'not a role a firm hands out'));
  perform t_check('an unknown permission in a role is refused',
    t_fails(format($q$select upsert_custom_role(%L, 'odd', 'Odd', 'staff', array['fly'])$q$, f), 'unknown permission'));
  perform set_member_custom_role(f, s, 'billing_clerk');
  perform t_check('putting an owner on a role is refused',
    t_fails(format($q$select set_member_custom_role(%L, %L, 'billing_clerk')$q$, f, o2), 'cannot narrow'));
  perform t_check('an unknown role is refused by name',
    t_fails(format($q$select set_member_custom_role(%L, %L, 'nothing')$q$, f, s), 'no custom role'));
  perform t_reset();
  perform t_as(s);
  perform t_check('the role''s list replaces the tier''s defaults',     has_permission(f, 'view_financials') and not has_permission(f, 'manage_documents'));
  perform t_reset();
  perform t_as(o);
  perform set_member_permissions(f, s, '{"manage_documents": true}');
  perform t_reset();
  perform t_as(s);
  perform t_check('a grant still wins over the role',                   has_permission(f, 'manage_documents'));
  perform t_reset();
  perform t_as(o);
  perform t_check('a role somebody holds cannot be deleted',
    t_fails(format($q$select delete_custom_role(%L, 'billing_clerk')$q$, f), 'hold the role'));
  perform set_member_custom_role(f, s, null);
  perform delete_custom_role(f, 'billing_clerk');
  perform t_check('once nobody holds it, it goes',                     not exists (select 1 from firm_custom_roles where firm_id = f and key = 'billing_clerk'));
  perform set_member_permissions(f, s, '{"manage_documents": null}');
  perform t_reset();
  perform t_check('the role''s life is audited',
    (select count(*) from audit_log where firm_id = f and action in ('custom_role.created', 'custom_role.deleted')) = 2);
end $$;

-- ---------------------------------------------------------------- 6. titles
do $$
declare f uuid := (select v from fx where k = 'firm'); o uuid := (select v from fx where k = 'owner'); l uuid := (select v from fx where k = 'lawyer');
        s uuid := (select v from fx where k = 'staff'); ro uuid := (select v from fx where k = 'ro');
begin
  perform t_as(o);
  perform set_member_title(f, l, 'Senior Partner');
  perform t_reset();
  perform t_check('an owner titles a colleague',                       (select title from firm_members where firm_id = f and user_id = l) = 'Senior Partner');
  perform t_as(l);
  perform set_member_title(f, l, 'Partner');
  perform t_check('a member titles themselves',                        (select title from firm_members where firm_id = f and user_id = l) = 'Partner');
  perform t_check('but not a colleague',
    t_refused(format($q$select set_member_title(%L, %L, 'Clerk')$q$, f, s), '42501'));
  perform t_reset();
  perform t_as(ro);
  perform t_check('readonly cannot even title themselves',
    t_refused(format($q$select set_member_title(%L, %L, 'Reader')$q$, f, ro), '42501'));
  perform t_reset();
  perform t_check('titles are audited',
    (select count(*) from audit_log where firm_id = f and action = 'firm_members.title') = 2);
end $$;

-- ---------------------------------------------------------------- 7. an invitation carries a tier and a title
do $$
declare f uuid := (select v from fx where k = 'firm'); a uuid := (select v from fx where k = 'admin'); o uuid := (select v from fx where k = 'owner');
        n uuid := (select v from fx where k = 'new'); tok text; r jsonb;
begin
  perform t_as(a);
  insert into staff_invites (firm_id, email, role, title, created_by) values (f, 'pm-new@test', 'readonly', 'Read only User', a);
  perform t_check('an admin invites a readonly member with a title',   (select count(*) from staff_invites where firm_id = f and email = 'pm-new@test') = 1);
  perform t_check('an admin still cannot invite an owner',
    t_refused(format($q$insert into staff_invites (firm_id, email, role, created_by) values (%L, 'pm-boss@test', 'owner', %L)$q$, f, a), '42501')
    or t_refused(format($q$insert into staff_invites (firm_id, email, role, created_by) values (%L, 'pm-boss@test', 'owner', %L)$q$, f, a), '23514'));
  perform t_reset();
  select token into tok from staff_invites where firm_id = f and email = 'pm-new@test';
  perform t_as(n);
  r := accept_staff_invite(tok);
  perform t_check('the invitee joins as readonly with the title',      r ->> 'role' = 'readonly'
                                                                        and (select role = 'readonly' and title = 'Read only User' from firm_members where firm_id = f and user_id = n));
  perform t_check('and the write gate refuses them',                   is_firm_member(f) and not staff_w(f));
  perform t_reset();
  perform t_as(o);
  perform set_member_permissions(f, a, '{"manage_team": false}');
  perform t_reset();
  perform t_as(a);
  perform t_check('an admin denied manage_team cannot invite',
    t_refused(format($q$insert into staff_invites (firm_id, email, role, created_by) values (%L, 'pm-late@test', 'staff', %L)$q$, f, a), '42501'));
  perform t_reset();
  perform t_as(o);
  perform set_member_permissions(f, a, '{"manage_team": null}');
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 8. the guards on money, firms and settings
do $$
declare f uuid := (select v from fx where k = 'firm'); q uuid := (select v from fx where k = 'other'); o uuid := (select v from fx where k = 'owner');
        s uuid := (select v from fx where k = 'staff'); l uuid := (select v from fx where k = 'lawyer'); a uuid := (select v from fx where k = 'admin');
        c uuid := (select v from fx where k = 'client'); m1 uuid := (select v from fx where k = 'm1'); o2 uuid := (select v from fx where k = 'owner2');
        items jsonb := '[{"description": "Consultation", "quantity": 1, "unit_minor": 1000000}]'; cid uuid;
begin
  perform t_as(s);
  perform create_invoice(f, c, items);
  perform t_check('staff raise an invoice by default',                 (select count(*) from invoices where firm_id = f) = 1);
  perform t_reset();
  perform t_as(o);
  perform set_member_permissions(f, s, '{"create_invoices": false}');
  perform set_member_permissions(f, l, '{"invite_firms": false}');
  perform set_member_permissions(f, a, '{"manage_settings": false}');
  perform t_reset();
  perform t_as(s);
  perform t_check('denied, staff cannot raise one',
    t_refused(format($q$select create_invoice(%L, %L, %L)$q$, f, c, items), '42501'));
  perform t_check('...and the refusal names the permission',
    t_fails(format($q$select create_invoice(%L, %L, %L)$q$, f, c, items), 'create invoices'));
  perform t_reset();
  perform t_as(l);
  perform t_check('denied, a lawyer cannot bring another firm in',
    t_refused(format($q$select propose_collaboration(%L, %L, 'referral', 'Please take this on.')$q$, m1, q), '42501'));
  perform t_reset();
  perform t_as(a);
  perform t_check('denied, an admin cannot change the firm''s settings',
    t_refused(format($q$update firms set name = 'Renamed' where id = %L$q$, f), '42501'));
  perform t_reset();
  perform t_as(o);
  perform set_member_permissions(f, s, '{"create_invoices": null}');
  perform set_member_permissions(f, l, '{"invite_firms": null}');
  perform set_member_permissions(f, a, '{"manage_settings": null}');
  perform t_reset();
  perform t_as(l);
  cid := propose_collaboration(m1, q, 'referral', 'Please take this on.');
  perform t_check('restored, the lawyer brings the other firm in',    cid is not null);
  perform t_reset();

  -- A grant row an owner should never have: planted as postgres, it changes nothing.
  insert into firm_member_permissions (firm_id, user_id, permission, granted) values (f, o2, 'view_matters', false);
  perform t_as(o2);
  perform t_check('a planted denial cannot narrow an owner',           has_permission(f, 'view_matters') and array_length(my_permissions(f), 1) = array_length(permission_keys(), 1));
  perform t_reset();
  perform t_check('every permission change is audited',
    (select count(*) from audit_log where firm_id = f and action = 'firm_members.permissions') >= 8);
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
