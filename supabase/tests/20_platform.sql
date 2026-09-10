-- Docket — platform-first tests: any firm onboards through create_firm() and gets exactly what
-- Klinique got; platform admins manage firms but never see matter content. Runs in one
-- transaction and rolls back.
begin;

create or replace function t_as(u uuid, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', aal)::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create or replace function t_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  perform set_config('role', 'anon', false);
end $$;
create or replace function t_reset() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;
create or replace function t_check(name text, ok bool) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', name; else raise exception 'FAIL  %', name; end if;
end $$;

-- ---------------------------------------------------------------- fixture (as postgres)
create temp table fx (k text primary key, v uuid);
grant select on fx to anon, authenticated;
insert into auth.users (id, email) values
  (gen_random_uuid(), 'owner_one@ptest'), (gen_random_uuid(), 'owner_two@ptest'),
  (gen_random_uuid(), 'platform@ptest'),  (gen_random_uuid(), 'stranger@ptest');
insert into fx select split_part(email, '@', 1), id from auth.users where email like '%@ptest';
insert into platform_admins (user_id, note) values ((select v from fx where k='platform'), 'test platform admin');

-- ---------------------------------------------------------------- 1. self-serve firm creation
do $$
declare o1 uuid := (select v from fx where k='owner_one'); res jsonb; f uuid; ok bool;
begin
  perform t_as(o1, 'aal1');                                   -- a brand-new account: no MFA yet
  res := create_firm('Ubuntu & Partners', 'ubuntu-partners', 'Ubuntu & Partners LP', 'RC1234567', 'Africa/Lagos', 'NGN', null, 'LA', '{}', null, 'scn 445566');
  f := (res ->> 'firm_id')::uuid;
  perform t_check('create_firm returns the new firm',                      f is not null and res ->> 'slug' = 'ubuntu-partners');
  perform t_check('reference prefix derived from the name',                res ->> 'reference_prefix' = 'UP');
  perform t_check('creator is the owner',                                  (select role from firm_members where firm_id = f and user_id = o1) = 'owner');
  perform t_check('owner reads her firm',                                  (select count(*) from firms where id = f) = 1);
  perform t_check('new firm gets the 15 default matter statuses',          (select count(*) from matter_statuses where firm_id = f) = 15);
  perform t_check('new firm gets an unpriced, inactive consultation',      (select count(*) from services where firm_id = f and slug = 'legal-consultation' and price_minor = 0 and not is_active) = 1);
  perform t_check('new firm gets a consultation intake form',              (select count(*) from intake_forms where firm_id = f) = 1);
  perform t_check('new firm is pending verification on the free plan',     (select plan || '/' || status from firms where id = f) = 'free/pending');
  perform t_check('new firm has a versioned policies skeleton',            (select policies -> 'terms' ->> 'version' from firms where id = f) = '0-draft');
  perform t_check('the registrant has a private practitioner profile with her SCN', (select scn || '|' || is_public::text from lawyer_profiles where firm_id = f and user_id = o1) = 'SCN445566|false');

  ok := false;
  begin
    update firms set name = 'renamed' where id = f;
    ok := (select name from firms where id = f) <> 'renamed';          -- RLS filters the row: 0 rows updated
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('owner without MFA cannot change firm settings',         ok);
  perform t_reset();

  perform t_as(o1, 'aal2');
  update firms set name = 'Ubuntu & Partners LP' where id = f;
  perform t_check('owner with MFA edits firm settings',                    (select name from firms where id = f) = 'Ubuntu & Partners LP');
  ok := false;
  begin
    update firms set status = 'active' where id = f;
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('owner cannot activate her own firm',                   ok and (select status from firms where id = f) = 'pending');
  ok := false;
  begin
    update firms set slug = 'admin' where id = f;
  exception when insufficient_privilege or check_violation then ok := true;
  end;
  perform t_check('owner cannot rename the slug to a reserved name',      ok and (select slug from firms where id = f) = 'ubuntu-partners');
  ok := false;
  begin
    update firms set custom_domain = 'app.docket.app' where id = f;
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('custom domains are mapped by the platform',            ok);
  perform t_check('firm creation is in the audit trail',                   (select count(*) from audit_log where firm_id = f and action = 'firm.created') = 1);
  perform t_reset();
  insert into fx values ('firm_u', f);
end $$;

-- ---------------------------------------------------------------- 2. slug rules, duplicates, caps, anon
do $$
declare o2 uuid := (select v from fx where k='owner_two'); ok bool; res jsonb; i int; s text;
begin
  perform t_as(o2, 'aal1');
  foreach s in array array['www', 'admin', 'Bad Slug', 'a', 'double--dash', 'trailing-', 'ubuntu-partners'] loop
    ok := false;
    begin
      res := create_firm('Test Firm', s);
    exception when others then ok := sqlerrm like '%slug%';
    end;
    perform t_check('slug rejected: ' || s, ok);
  end loop;

  ok := false;
  begin
    res := create_firm('Y Firm', 'y-firm', p_timezone => 'Mars/Olympus');
  exception when others then ok := sqlerrm like '%timezone%';
  end;
  perform t_check('unknown timezone rejected',                             ok);

  ok := false;
  begin
    res := create_firm('Z Firm', 'z-firm', p_owner_email => 'owner_one@ptest');
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('ordinary user cannot create a firm for someone else',   ok);

  for i in 1..3 loop
    res := create_firm('Cap Firm ' || i, 'cap-firm-' || i);
  end loop;
  ok := false;
  begin
    res := create_firm('Cap Firm 4', 'cap-firm-4');
  exception when others then ok := sqlerrm like '%maximum%';
  end;
  perform t_check('an account owns at most three firms',                  ok);
  perform t_check('owner two sees only her own firms',                    (select count(*) from firms) = 3 and (select count(*) from firms where slug = 'ubuntu-partners') = 0);
  perform t_reset();

  perform t_anon();
  ok := false;
  begin
    res := create_firm('Anon Firm', 'anon-firm');
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('anonymous visitors cannot create firms',                ok);
  perform t_check('pending firms are not on the public projection',       (select count(*) from firm_public where slug in ('ubuntu-partners','cap-firm-1')) = 0);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. platform admin: lifecycle yes, content no
do $$
declare pa uuid := (select v from fx where k='platform'); st uuid := (select v from fx where k='stranger');
        o1 uuid := (select v from fx where k='owner_one'); fu uuid := (select v from fx where k='firm_u'); res jsonb; f uuid; ok bool;
begin
  -- content the platform must never see
  insert into matters (firm_id, reference, title, type) values (fu, 'UP-M-2026-000001', 'Confidential v Matter', 'litigation');

  perform t_as(pa, 'aal2');
  perform t_check('platform admin knows she is one',                       is_platform_admin());
  perform t_check('platform admin lists every firm (lifecycle view)',      (select count(*) from firm_admin where slug in ('ubuntu-partners','cap-firm-1','cap-firm-2','cap-firm-3')) = 4);
  perform t_check('platform admin has no row-level read of firms itself',  (select count(*) from firms) = 0);
  perform t_check('verification sees the owners and their SCNs',          (select owners from firm_admin where id = fu) like '%SCN445566%' and (select policies_published from firm_admin where id = fu) = false);
  perform t_check('platform admin sees firm memberships',                  (select count(*) from firm_members where firm_id = fu) = 1);
  perform t_check('platform admin sees no matters',                        (select count(*) from matters) = 0);
  perform t_check('platform admin sees no firm audit trail beyond lifecycle', (select count(*) from audit_log where entity not in ('firms','firm_members','firm')) = 0);
  perform set_firm_status(fu, 'active', 'RC1234567 checked on CAC portal');
  perform t_check('platform admin verifies and activates a firm',         (select status from firm_admin where id = fu) = 'active' and (select verified_at from firm_admin where id = fu) is not null);
  update firms set paystack_subaccount = 'ACCT_evil' where id = fu;
  perform t_check('platform admin cannot touch a firm''s other columns',   (select has_settlement_account from firm_admin where id = fu) = false);
  perform set_firm_status(fu, 'suspended', 'test');
  perform t_check('platform admin suspends a firm',                        (select status from firm_admin where id = fu) = 'suspended');
  perform t_reset();

  perform t_as(o1, 'aal2');
  perform t_check('the firm''s owner was told it went live',              (select count(*) from notifications where event = 'firm_activated' and firm_id = fu) >= 1);
  update firms set name = 'renamed while suspended' where id = fu;
  perform t_check('a suspended firm''s owner cannot write',                (select name from firms where id = fu) <> 'renamed while suspended');
  perform t_reset();
  perform t_anon();
  perform t_check('a suspended firm is not public',                        (select count(*) from firm_public where id = fu) = 0);
  perform t_reset();

  perform t_as(pa, 'aal2');
  perform set_firm_status(fu, 'active');

  res := create_firm('Chambers for Owner One', 'chambers-owner-one', p_owner_email => 'OWNER_ONE@ptest');
  f := (res ->> 'firm_id')::uuid;
  perform t_check('platform admin opens a firm for an existing account',   (res ->> 'owner_id')::uuid = o1 and (select status from firm_admin where id = f) = 'pending');
  perform t_check('platform admin is not a member of that firm',           (select count(*) from firm_members where firm_id = f and user_id = pa) = 0);
  ok := false;
  begin
    res := create_firm('Nobody Chambers', 'nobody-chambers', p_owner_email => 'nobody@ptest');
  exception when others then ok := sqlerrm like '%sign up first%';
  end;
  perform t_check('cannot open a firm for an email with no account',       ok);
  perform t_reset();

  perform t_as(st, 'aal2');
  perform t_check('ordinary user is not a platform admin',                 not is_platform_admin());
  perform t_check('ordinary user sees no firms',                           (select count(*) from firms) = 0);
  ok := false;
  begin
    insert into platform_admins (user_id) values (st);
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('nobody can promote themselves to platform admin',       ok);
  perform t_reset();

  perform t_as(o1, 'aal2');
  perform t_check('owner one now belongs to both her firms',               (select count(*) from firms) = 2);
  perform t_reset();

  perform t_anon();
  perform t_check('an activated firm is on the public projection, marked verified', (select verified from firm_public where id = fu) = true);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. a firm brings its own lawyers
do $$
declare o1 uuid := (select v from fx where k='owner_one'); fu uuid := (select v from fx where k='firm_u'); st uuid := (select v from fx where k='stranger');
        tok text; tok2 text; res jsonb; ok bool; newbie uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'new_lawyer@ptest') returning id into newbie;

  perform t_as(o1, 'aal2');
  insert into staff_invites (firm_id, email, role, created_by) values (fu, 'New_Lawyer@ptest', 'lawyer', o1) returning token into tok;
  perform t_check('owner invites a lawyer by email',                       tok is not null);
  insert into staff_invites (firm_id, email, role, created_by) values (fu, 'partner@ptest', 'owner', o1);
  perform t_check('an owner may invite another owner (partnerships)',     (select count(*) from staff_invites where firm_id = fu and role = 'owner') = 1);
  perform t_reset();

  -- an impostor who edits their profile email to match an invite is still refused: the
  -- identity provider's email is what counts
  insert into auth.users (id, email) values (gen_random_uuid(), 'impostor@ptest');
  perform t_as(o1, 'aal2');
  insert into staff_invites (firm_id, email, role, created_by) values (fu, 'target@ptest', 'admin', o1) returning token into tok2;
  perform t_reset();
  perform t_as((select id from auth.users where email = 'impostor@ptest'), 'aal2');
  update profiles set email = 'target@ptest' where id = auth.uid();
  ok := false;
  begin
    res := accept_staff_invite(tok2);
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('a self-edited profile email cannot claim an invite',   ok);
  perform t_reset();

  perform t_as(st, 'aal2');
  ok := false;
  begin
    res := accept_staff_invite(tok);
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('an invite cannot be accepted by a different email',    ok);
  perform t_reset();

  perform t_as(newbie, 'aal1');
  res := accept_staff_invite(tok);
  perform t_check('invited lawyer joins the firm',                         (res ->> 'role') = 'lawyer' and (select role from firm_members where firm_id = fu and user_id = newbie) = 'lawyer');
  perform t_check('invited lawyer gets a private profile to complete',    (select is_public from lawyer_profiles where firm_id = fu and user_id = newbie) = false);
  ok := false;
  begin
    res := accept_staff_invite(tok);
  exception when others then ok := sqlerrm like '%invalid or expired%';
  end;
  perform t_check('an invite is single-use',                              ok);
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
