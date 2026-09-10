-- Docket — Nigerian reference data tests: courts, states, holidays, practitioner fields, matters in a court.
-- Runs in one transaction and rolls back.
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

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
grant select on fx to anon, authenticated;
insert into firms (slug, name, reference_prefix, state_code) values ('firm-n', 'Firm N', 'FN', 'DE'), ('firm-o', 'Firm O', 'FO', 'LA');
insert into fx select 'firm_n', id from firms where slug = 'firm-n';
insert into fx select 'firm_o', id from firms where slug = 'firm-o';
insert into auth.users (id, email) values (gen_random_uuid(), 'lawyer_n@ntest'), (gen_random_uuid(), 'lawyer_o@ntest'), (gen_random_uuid(), 'client_n@ntest');
insert into fx select split_part(email, '@', 1), id from auth.users where email like '%@ntest';
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm_n'), (select v from fx where k='lawyer_n'), 'lawyer'),
  ((select v from fx where k='firm_o'), (select v from fx where k='lawyer_o'), 'lawyer');
insert into lawyer_profiles (firm_id, user_id, slug, title, scn, year_of_call, nba_branch, is_public)
values ((select v from fx where k='firm_n'), (select v from fx where k='lawyer_n'), 'lawyer-n', 'Partner', 'SCN098765', 2012, 'Asaba', true);

-- ---------------------------------------------------------------- 1. reference data is there and readable
do $$
begin
  perform t_check('36 states plus the FCT',                                  (select count(*) from ng_states) = 37);
  perform t_check('six geopolitical zones',                                  (select count(distinct zone) from ng_states) = 6);
  perform t_check('every state has a High Court and a Federal High Court division',
                  (select count(*) from courts where level = 'state_high' and firm_id is null) = 36
                  and (select count(*) from courts where level = 'federal_high' and firm_id is null) = 37);
  perform t_check('Court of Appeal divisions seeded',                        (select count(*) from courts where level = 'court_of_appeal') >= 18);
  perform t_check('the Supreme Court is unique',                             (select count(*) from courts where level = 'supreme') = 1);
  perform t_check('a firm may record its state of practice',                (select count(*) from firms where state_code = 'DE') = 1);
  perform t_check('Democracy Day is a public holiday',                       is_public_holiday('2026-06-12'));
  perform t_check('a Saturday is not a sitting day',                         is_non_sitting_day('2026-09-12'));
  perform t_check('an ordinary Tuesday is a sitting day',                    not is_non_sitting_day('2026-09-15'));
  insert into court_vacations (level, name, starts_on, ends_on, note) values (null, 'Test vacation', '2026-09-14', '2026-09-18', 'test');
  perform t_check('a published vacation makes a weekday non-sitting',       is_non_sitting_day('2026-09-15', 'state_high', 'LA'));
  perform t_check('criminal is now a matter type',                          exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'matter_type' and e.enumlabel = 'criminal'));
end $$;

-- ---------------------------------------------------------------- 2. courts: platform-wide vs firm-private
do $$
declare ln uuid := (select v from fx where k='lawyer_n'); lo uuid := (select v from fx where k='lawyer_o'); cn uuid := (select v from fx where k='client_n');
        fn uuid := (select v from fx where k='firm_n'); fo uuid := (select v from fx where k='firm_o'); priv uuid; pub uuid; ok bool; m uuid;
begin
  select id into pub from courts where level = 'state_high' and state_code = 'DE';

  perform t_as(ln, 'aal2');
  perform t_check('staff read the platform court directory',              (select count(*) from courts where firm_id is null) > 100);
  insert into courts (firm_id, level, name, short_name, state_code, division, city, created_by)
  values (fn, 'magistrate', 'Chief Magistrates'' Court, Asaba (Court 2)', 'CMC Asaba 2', 'DE', 'Asaba 2', 'Asaba', ln)
  returning id into priv;
  perform t_check('a firm adds its own court',                              priv is not null);

  insert into matters (firm_id, reference, title, type, court_id, suit_number)
  values (fn, 'FN-M-2026-000001', 'State v Accused', 'criminal', pub, 'A/12C/2026') returning id into m;
  perform t_check('matter points at a structured court and inherits its name', (select court_name from matters where id = m) like 'High Court of Delta State%');
  update matters set court_id = priv where id = m;
  perform t_check('matter can move to the firm''s private court',           (select court_id from matters where id = m) = priv);
  perform t_reset();

  perform t_as(lo, 'aal2');
  perform t_check('another firm cannot see the private court',              (select count(*) from courts where id = priv) = 0);
  ok := false;
  begin
    insert into matters (firm_id, reference, title, type, court_id) values (fo, 'FO-M-2026-000001', 'X v Y', 'litigation', priv);
  exception when others then ok := sqlerrm like '%not available to this firm%';
  end;
  perform t_check('another firm cannot file a matter in the private court', ok);
  ok := false;
  begin
    insert into courts (firm_id, level, name, created_by) values (null, 'tribunal', 'Rogue Tribunal', lo);
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('staff cannot add platform-wide courts',                  ok);
  ok := false;
  begin
    update courts set name = 'tampered' where id = pub;
    ok := (select name from courts where id = pub) <> 'tampered';
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('staff cannot edit platform-wide courts',                 ok);
  perform t_reset();

  perform t_as(cn, 'aal1');
  ok := false;
  begin
    insert into courts (firm_id, level, name, created_by) values (fn, 'magistrate', 'Client court', cn);
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('clients cannot add courts',                              ok);
  perform t_reset();

  perform t_anon();
  perform t_check('anon reads states (for forms)',                         (select count(*) from ng_states) = 37);
  perform t_check('anon reads public holidays',                            (select count(*) from public_holidays) >= 8);
  perform t_check('public lawyer profile carries year of call, not SCN',   (select year_of_call from lawyer_public where slug = 'lawyer-n') = 2012
                                                                           and not exists (select 1 from information_schema.columns where table_name = 'lawyer_public' and column_name = 'scn'));
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
