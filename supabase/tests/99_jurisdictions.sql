-- The jurisdiction registry: a firm registers only under an active jurisdiction, a jurisdiction
-- is activated only after a recorded validation, and only the platform moves either.
--
-- Run alone or with the others. Rolls back.
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
insert into auth.users (id, email) values
  (gen_random_uuid(), 'ju-owner@test'), (gen_random_uuid(), 'ju-platform@test'), (gen_random_uuid(), 'ju-nobody@test');
insert into fx select 'owner',    id from auth.users where email = 'ju-owner@test';
insert into fx select 'platform', id from auth.users where email = 'ju-platform@test';
insert into fx select 'nobody',   id from auth.users where email = 'ju-nobody@test';
insert into platform_admins (user_id, note) values ((select v from fx where k = 'platform'), 'jurisdiction test');

-- ---------------------------------------------------------------- 1. the registry is public, and the platform's to write
do $$
begin
  perform t_anon();
  perform t_check('a visitor reads the registry',                      (select count(*) from jurisdictions) >= 8);
  perform t_check('Nigeria is the one active jurisdiction',            (select count(*) from jurisdictions where status = 'active') = 1
                                                                        and (select status from jurisdictions where code = 'NG') = 'active');
  perform t_check('Nigeria''s validation is recorded, not assumed',     (select validated_at is not null and length(validation_note) > 50 from jurisdictions where code = 'NG'));
  perform t_check('the other seven are designed and say what a validation must cover',
    (select count(*) from jurisdictions where status = 'designed' and config ? 'validation_scope') = 7);
  perform t_check('every jurisdiction offers practice areas',           (select count(distinct jurisdiction_code) from jurisdiction_practice_areas) = (select count(*) from jurisdictions));
  perform t_check('is_jurisdiction_active() answers a visitor',          is_jurisdiction_active('ng') and not is_jurisdiction_active('GB') and not is_jurisdiction_active('XX'));
  perform t_check('a visitor cannot register a country',
    t_refused($q$insert into jurisdictions (code, name, legal_system, currency_code, timezone) values ('XX', 'Nowhere', 'common_law', 'USD', 'UTC')$q$, '42501'));
  perform t_check('a visitor cannot move a jurisdiction',
    t_refused($q$update jurisdictions set status = 'active' where code = 'GB'$q$, '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. registration under an inactive jurisdiction is refused
do $$
declare o uuid := (select v from fx where k = 'owner'); res jsonb; f uuid;
begin
  perform t_as(o);
  perform t_check('a designed jurisdiction refuses a firm',
    t_fails($q$select create_firm('Lincoln Chambers', 'lincoln-chambers', p_jurisdiction => 'GB')$q$, 'not yet active'));
  perform t_check('an unknown jurisdiction is refused by name',
    t_fails($q$select create_firm('Nowhere Chambers', 'nowhere-chambers', p_jurisdiction => 'XX')$q$, 'unknown jurisdiction'));
  res := create_firm('Abuja Chambers', 'abuja-chambers', p_state_code => 'FC');
  f := (res ->> 'firm_id')::uuid;
  insert into fx select 'abuja', f;
  perform t_check('the default registers under Nigeria',               res ->> 'jurisdiction' = 'NG'
                                                                        and (select jurisdiction_code from firms where id = f) = 'NG');
  perform t_check('and keeps the Nigerian defaults',                    (select default_currency = 'NGN' and timezone = 'Africa/Lagos' from firms where id = f));
  perform t_check('an owner cannot move the firm''s jurisdiction',
    t_refused(format($q$update firms set jurisdiction_code = 'GB' where id = %L$q$, f), '42501'));
  perform t_check('a Nigerian firm''s state is still checked',
    t_fails($q$select create_firm('Bad State', 'bad-state-chambers', p_state_code => 'ZZ')$q$, 'unknown state'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. the lifecycle is the platform's, in order
do $$
declare pa uuid := (select v from fx where k = 'platform'); nb uuid := (select v from fx where k = 'nobody'); gb uuid;
begin
  select id into gb from jurisdictions where code = 'GB';
  perform t_as(nb);
  perform t_check('a signed in person who is not the platform cannot validate',
    t_refused($q$select set_jurisdiction_status('GB', 'validated', 'Reviewed by somebody who should not be able to.')$q$, '42501'));
  perform t_reset();
  perform t_as(pa, 'aal1');
  perform t_check('a platform admin without a second factor cannot either',
    t_refused($q$select set_jurisdiction_status('GB', 'validated', 'Reviewed without MFA.')$q$, '42501'));
  perform t_reset();
  perform t_as(pa);
  perform t_check('designed cannot jump to active',
    t_fails($q$select set_jurisdiction_status('GB', 'active')$q$, 'validated before it is activated'));
  perform t_check('a validation without a note is refused',
    t_fails($q$select set_jurisdiction_status('GB', 'validated', 'ok')$q$, 'say what was reviewed'));
  perform set_jurisdiction_status('GB', 'validated', 'Court directory, CPR deadlines and SRA rules reviewed by the test harness.');
  perform t_check('a validation records who and what',
    (select status = 'validated' and validated_by = pa and validated_at is not null and validation_note like 'Court directory%' from jurisdictions where code = 'GB'));
  perform set_jurisdiction_status('GB', 'active');
  perform t_check('then it activates',                                   (select status = 'active' and activated_at is not null and activated_by = pa from jurisdictions where code = 'GB'));
  perform set_jurisdiction_status('GB', 'active');
  perform t_check('setting the same status again changes nothing',      (select count(*) from jurisdictions where code = 'GB' and status = 'active') = 1);
  perform t_reset();
  perform t_check('every move is audited',
    (select count(*) from audit_log where action = 'jurisdiction.status' and entity_id = gb) = 2);
end $$;

-- ---------------------------------------------------------------- 4. a firm registers under the activated jurisdiction
do $$
declare o uuid := (select v from fx where k = 'owner'); res jsonb; f uuid; g uuid;
begin
  perform t_as(o);
  res := create_firm('Lincoln Chambers', 'lincoln-chambers', p_jurisdiction => 'GB', p_state_code => 'England and Wales');
  f := (res ->> 'firm_id')::uuid;
  insert into fx select 'lincoln', f;
  perform t_check('a British firm registers under GB',                 (select jurisdiction_code from firms where id = f) = 'GB');
  perform t_check('and takes the jurisdiction''s currency and timezone where none was given',
    (select default_currency = 'GBP' and timezone = 'Europe/London' and state_code is null and region = 'England and Wales' from firms where id = f));
  res := create_firm('Belfast Chambers', 'belfast-chambers', p_default_currency => 'USD', p_timezone => 'Europe/Belfast', p_jurisdiction => 'gb');
  g := (res ->> 'firm_id')::uuid;
  perform t_check('a currency and timezone the caller chose are kept',  (select default_currency = 'USD' and timezone = 'Europe/Belfast' from firms where id = g));
  perform t_check('a region outside Nigeria is bounded and not looked up',
    t_fails($q$select create_firm('Odd Region', 'odd-region', p_jurisdiction => 'GB', p_state_code => repeat('x', 81))$q$, 'up to 80'));
  perform t_check('the registration audit names the jurisdiction',
    exists (select 1 from audit_log where action = 'firm.created' and entity_id = f and meta ->> 'jurisdiction' = 'GB'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 5. suspension closes registration and keeps the firms
do $$
declare pa uuid := (select v from fx where k = 'platform'); nb uuid := (select v from fx where k = 'nobody'); res jsonb;
begin
  perform t_as(pa);
  perform set_jurisdiction_status('GB', 'suspended', 'Regulatory question raised.');
  perform t_reset();
  perform t_as(nb);
  perform t_check('a suspended jurisdiction refuses a new firm',
    t_fails($q$select create_firm('Late Chambers', 'late-chambers', p_jurisdiction => 'GB')$q$, 'registered as suspended'));
  perform t_reset();
  perform t_check('the firms already under it stay',                   (select count(*) from firms where jurisdiction_code = 'GB') = 2);
  perform t_as(pa);
  perform t_check('a jurisdiction firms practise in cannot go back to designed',
    t_fails($q$select set_jurisdiction_status('GB', 'designed')$q$, 'cannot go back to designed'));
  perform set_jurisdiction_status('GB', 'active');
  perform t_check('and reopens',                                         is_jurisdiction_active('GB'));

  res := upsert_jurisdiction('IE', 'Ireland', 'common_law', 'EUR', 'Europe/Dublin', 'en-IE', 'English', 'DD/MM/YYYY',
                             jsonb_build_object('validation_scope', 'Courts Service directory, Rules of the Superior Courts, Law Society of Ireland rules, GDPR.'), 90);
  perform t_check('the platform registers a new country as designed',  (res ->> 'created')::bool and (select status from jurisdictions where code = 'IE') = 'designed');
  res := upsert_jurisdiction('IE', 'Republic of Ireland', 'common_law', 'EUR', 'Europe/Dublin');
  perform t_check('describing it again keeps its status',              not (res ->> 'created')::bool and (select name = 'Republic of Ireland' and status = 'designed' from jurisdictions where code = 'IE'));
  perform t_check('a timezone the server does not know is refused',
    t_fails($q$select upsert_jurisdiction('FR', 'France', 'civil_law', 'EUR', 'Europe/Nowhere')$q$, 'unknown timezone'));
  perform t_check('a currency Docket cannot invoice in is refused',
    t_fails($q$select upsert_jurisdiction('FR', 'France', 'civil_law', 'XXX', 'Europe/Paris')$q$, 'not one Docket can invoice in'));
  perform t_check('a code that is not ISO 3166 is refused',
    t_fails($q$select upsert_jurisdiction('FRA', 'France', 'civil_law', 'EUR', 'Europe/Paris')$q$, 'two letter'));
  perform set_jurisdiction_status('IE', 'validated', 'Reviewed by the test harness for the purpose of this check.');
  perform set_jurisdiction_status('IE', 'designed');
  perform t_check('a validated country with no firms can go back to designed, and forgets its validation',
    (select status = 'designed' and validated_at is null and validated_by is null from jurisdictions where code = 'IE'));
  perform t_check('coverage names every jurisdiction with its firms, to the platform',
    (select firms from jurisdiction_coverage() where code = 'GB') = 2 and (select count(*) from jurisdiction_coverage()) >= 9);
  perform t_reset();
  perform t_as(nb);
  perform t_check('and nothing to anybody else',                        (select count(*) from jurisdiction_coverage()) = 0);
  perform t_check('nor may they register a country',
    t_refused($q$select upsert_jurisdiction('FR', 'France', 'civil_law', 'EUR', 'Europe/Paris')$q$, '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 6. the public projection carries it
do $$
declare pa uuid := (select v from fx where k = 'platform'); f uuid := (select v from fx where k = 'lincoln');
begin
  perform t_as(pa);
  perform set_firm_status(f, 'active', 'test activation');
  perform t_reset();
  perform t_anon();
  perform t_check('firm_public says which jurisdiction a firm is under', (select jurisdiction_code from firm_public where id = f) = 'GB');
  perform t_check('and is still not writable',
    t_refused(format($q$update firm_public set jurisdiction_code = 'NG' where id = %L$q$, f), '42501'));
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
