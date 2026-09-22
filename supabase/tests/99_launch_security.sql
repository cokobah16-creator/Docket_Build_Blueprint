-- Direct API regression checks for the launch security migration. The production
-- transaction rolls back every fixture created here.
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

create temp table fx(k text primary key, v uuid);
grant select on fx to authenticated;
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values
  (gen_random_uuid(), 'launch-staff@test'),
  (gen_random_uuid(), 'launch-victim@test'),
  (gen_random_uuid(), 'launch-platform@test');
insert into fx select split_part(email, '@', 1), id from auth.users where email like 'launch-%@test';
insert into firm_members (firm_id, user_id, role)
values ((select v from fx where k='firm'), (select v from fx where k='launch-staff'), 'owner');
insert into platform_admins (user_id) values ((select v from fx where k='launch-platform'));
insert into matters (firm_id, reference, title, type, description)
values ((select v from fx where k='firm'), 'LS-M-2026-000001', 'A private matter', 'family', 'Staff strategy only');
insert into fx select 'matter', id from matters where reference = 'LS-M-2026-000001';

do $$
declare f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter');
        st uuid := (select v from fx where k='launch-staff'); victim uuid := (select v from fx where k='launch-victim');
        ok bool := false;
begin
  perform t_check('API roles cannot directly create or rewrite an appointment',
    not has_table_privilege('authenticated', 'public.appointments', 'INSERT')
    and not has_table_privilege('authenticated', 'public.appointments', 'UPDATE'));
  perform t_check('API roles cannot hard-delete a matter',
    not has_table_privilege('authenticated', 'public.matters', 'DELETE'));
  perform t_as(st, 'aal1');
  perform t_check('a staff session without MFA cannot read a matter',
    not exists (select 1 from matters where id = m));
  perform t_reset(); perform t_as(st);
  begin
    insert into matter_parties (matter_id, firm_id, user_id, role) values (m, f, victim, 'client');
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('a firm cannot attach a stranger through the direct API', ok);
  perform t_reset();
  -- Emulate a client accepting a verified invitation; only this explicit act opens the view.
  insert into matter_parties (matter_id, firm_id, user_id, role) values (m, f, victim, 'client');
  perform t_as(victim, 'aal1');
  perform t_check('a client reads their matter from the narrow view only',
    not exists (select 1 from matters where id = m)
    and exists (select 1 from portal_matters where id = m));
  ok := false;
  begin execute 'select description from portal_matters limit 1';
  exception when undefined_column then ok := true;
  end;
  perform t_check('the client view never exposes internal notes', ok);
  perform t_reset();
end $$;

do $$
declare st uuid := (select v from fx where k='launch-staff');
        victim uuid := (select v from fx where k='launch-victim');
        platform uuid := (select v from fx where k='launch-platform'); ok bool := false;
begin
  -- Keep the victim's identity-provider address but place it on the attacker's
  -- self-editable public profile. The platform must not grant the attacker a role.
  update profiles set email = null where id = victim;
  update profiles set email = 'launch-victim@test' where id = st;
  perform t_as(platform);
  begin
    perform create_firm('Spoof Test', 'launch-spoof', p_owner_email => 'launch-victim@test');
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('a spoofed profile email cannot choose a new firm owner', ok);
  perform t_reset();
end $$;

do $$
declare f uuid := (select v from fx where k='firm'); other uuid; a text; b text;
begin
  insert into firms (slug, name, reference_prefix) values ('launch-other-firm', 'Another AK firm', 'AK') returning id into other;
  a := next_reference(f, 'invoice'); b := next_reference(other, 'invoice');
  perform t_check('firms with the same initials mint different global invoice numbers', a <> b);
end $$;
rollback;
