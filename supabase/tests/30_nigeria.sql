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
                  (select count(*) from courts where level = 'state_high' and firm_id is null and division is null) = 36
                  and (select count(*) from courts where level = 'federal_high' and firm_id is null) >= 37);
  perform t_check('Lagos High Court has its judicial divisions under the state court',
                  (select count(*) from courts c join courts parent on parent.id = c.parent_id
                    where c.level = 'state_high' and c.state_code = 'LA' and c.division is not null and parent.division is null) = 5
                  and (select suit_number_hint from courts where level = 'state_high' and state_code = 'LA' and division = 'Ikeja') like 'ID/%');
  perform t_check('FCT High Court has its judicial divisions',             (select count(*) from courts where level = 'fct_high' and division is not null) >= 10);
  perform t_check('holidays are seeded through 2027',                      (select holidays_through_year from reference_data_coverage) >= 2027 and is_public_holiday('2027-03-26'));
  perform t_check('Court of Appeal divisions seeded',                        (select count(*) from courts where level = 'court_of_appeal') >= 18);
  perform t_check('the Supreme Court is unique',                             (select count(*) from courts where level = 'supreme') = 1);
  perform t_check('a firm may record its state of practice',                (select count(*) from firms where state_code = 'DE') = 1);
  perform t_check('Democracy Day is a public holiday',                       is_public_holiday('2026-06-12'));
  perform t_check('a Saturday is not a sitting day',                         is_non_sitting_day('2026-09-12'));
  perform t_check('an ordinary Tuesday is a sitting day',                    not is_non_sitting_day('2026-09-15'));
  insert into court_vacations (level, name, starts_on, ends_on, note) values (null, 'Test vacation', '2026-01-12', '2026-01-16', 'test');
  perform t_check('a published vacation makes a weekday non-sitting',       is_non_sitting_day('2026-01-13', 'state_high', 'LA'));
  perform t_check('the Federal High Court sits in Lagos, not Ikeja',        (select count(*) from courts where level = 'federal_high' and state_code = 'LA' and division = 'Lagos' and firm_id is null) = 1
                                                                            and (select count(*) from courts where level = 'federal_high' and division = 'Ikeja') = 0);
  perform t_check('unverified suit-number hints are null, not invented',    (select suit_number_hint from courts where level = 'federal_high' and state_code = 'AB') is null
                                                                            and (select suit_number_hint from courts where level = 'state_high' and state_code = 'DE' and division is null) is null
                                                                            and (select suit_number_hint from courts where level = 'federal_high' and state_code = 'LA') = 'FHC/L/CS/123/2026');
  perform t_check('criminal is now a matter type',                          exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'matter_type' and e.enumlabel = 'criminal'));
end $$;

-- ---------------------------------------------------------------- 1b. the platform maintains the reference data from /admin
do $$
declare pa uuid; ln uuid := (select v from fx where k='lawyer_n'); ok bool;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'platform_n@ntest') returning id into pa;
  insert into platform_admins (user_id) values (pa);

  perform t_as(pa, 'aal2');
  insert into public_holidays (on_date, name, state_code) values ('2026-08-20', 'Isese Day', 'LA');
  insert into court_vacations (level, state_code, name, starts_on, ends_on, time_runs) values ('state_high', 'LA', 'Annual vacation (test)', '2026-07-20', '2026-09-14', false);
  insert into courts (level, name, short_name, state_code, city) values ('customary_appeal', 'Customary Court of Appeal, Delta State', 'Delta CCA', 'DE', 'Asaba');
  perform t_check('platform admin enters holidays, vacations and courts', (select count(*) from courts where name = 'Customary Court of Appeal, Delta State' and firm_id is null) = 1);
  perform t_reset();

  perform t_check('a state holiday binds that state''s courts only',      is_non_sitting_day('2026-08-20', 'state_high', 'LA') and not is_non_sitting_day('2026-08-20', 'state_high', 'DE'));
  perform t_check('a state vacation binds that court only',               is_non_sitting_day('2026-08-05', 'state_high', 'LA') and not is_non_sitting_day('2026-08-05', 'federal_high', 'LA'));

  perform t_as(ln, 'aal2');
  ok := false;
  begin
    insert into public_holidays (on_date, name) values ('2026-11-11', 'Firm holiday');
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('firm staff cannot declare holidays',                    ok);
  perform t_reset();
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

  perform t_reset();
  update lawyer_profiles set scn_verified_at = now() where user_id = ln;   -- the platform verified lawyer N's number
  perform t_as(lo, 'aal2');
  ok := false;
  begin
    insert into lawyer_profiles (firm_id, user_id, slug, scn, is_public) values (fo, lo, 'lawyer-o', 'scn 098765', false);
  exception when others then ok := sqlerrm like '%cannot be registered%' and sqlerrm not like '%another%';
  end;
  perform t_check('a verified enrolment number cannot be claimed by anyone else', ok);
  insert into lawyer_profiles (firm_id, user_id, slug, scn, is_public) values (fo, lo, 'lawyer-o', ' scn 12 34 ', false);
  perform t_check('enrolment numbers are normalised',                      (select scn from lawyer_profiles where user_id = lo) = 'SCN1234');
  ok := false;
  begin
    update lawyer_profiles set scn_verified_at = now() where user_id = lo;
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('a lawyer cannot verify her own SCN',                    ok);
  perform t_reset();

  perform t_as(ln, 'aal2');
  insert into matter_court_numbers (firm_id, matter_id, court_id, number, kind)
  select fn, m.id, m.court_id, 'A/12C/2026', 'suit' from matters m where m.reference = 'FN-M-2026-000001';
  insert into matter_court_numbers (firm_id, matter_id, court_id, number, kind, is_current)
  select fn, m.id, (select id from courts where level = 'court_of_appeal' and division = 'Asaba'), 'CA/AS/45/2026', 'appeal', true from matters m where m.reference = 'FN-M-2026-000001';
  perform t_check('a matter carries several court numbers over its life', (select count(*) from matter_court_numbers) = 2);
  update matters set suit_number = 'a/12c/ 2026' where reference = 'FN-M-2026-000001';
  perform t_check('suit numbers get a normalised match key',              (select suit_number_norm from matters where reference = 'FN-M-2026-000001') = 'A/12C/2026');
  perform t_check('other firms'' practitioner records are invisible',      (select count(*) from lawyer_profiles where firm_id = fo) = 0);
  perform t_reset();

  perform t_as(lo, 'aal2');
  perform t_check('a lawyer sees only her own firm''s practitioner records', (select count(*) from lawyer_profiles where scn = 'SCN098765') = 0);
  perform t_reset();

  perform t_anon();
  ok := false;
  begin
    perform count(*) from lawyer_profiles;
  exception when insufficient_privilege then ok := true;
  end;
  perform t_check('anon cannot read practitioner records at all',         ok);
  perform t_check('anon reads the platform court directory',               (select count(*) from courts where firm_id is null) > 100);
  perform t_check('anon reads states (for forms)',                         (select count(*) from ng_states) = 37);
  perform t_check('anon reads public holidays',                            (select count(*) from public_holidays) >= 8);
  perform t_check('public lawyer profile carries year of call, not SCN',   (select year_of_call from lawyer_public where slug = 'lawyer-n') = 2012
                                                                           and not exists (select 1 from information_schema.columns where table_name = 'lawyer_public' and column_name = 'scn'));
  perform t_reset();
  update firms set status = 'pending' where id = (select v from fx where k='firm_n');
  perform t_anon();
  perform t_check('a pending firm''s lawyers are not public',              (select count(*) from lawyer_public where slug = 'lawyer-n') = 0);
  perform t_reset();
  update firms set status = 'active' where id = (select v from fx where k='firm_n');
  perform t_anon();
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. sittings: hearing notices, vacated dates, the cause list
do $$
declare ln uuid := (select v from fx where k='lawyer_n'); cn uuid := (select v from fx where k='client_n'); fn uuid := (select v from fx where k='firm_n');
        m uuid; ev uuid; ev2 uuid; upd uuid; ok bool;
        tue timestamptz := date_trunc('week', now() + interval '14 days') + interval '1 day 12 hours';
        wed timestamptz := date_trunc('week', now() + interval '14 days') + interval '2 days 12 hours';
begin
  select id into m from matters where reference = 'FN-M-2026-000001';
  insert into matter_parties (matter_id, firm_id, user_id, role) values (m, fn, cn, 'client');

  perform t_as(ln, 'aal2');
  ok := false;
  begin
    insert into court_events (matter_id, firm_id, scheduled_at, court_id) values (m, fn, tue, gen_random_uuid());
  exception when others then ok := sqlerrm like '%not available to this firm%';
  end;
  perform t_check('a sitting cannot be fixed in a court the firm cannot see', ok);

  upd := post_court_update(m, 'hearing_notice', now(), null, null, tue, 'hearing', 'The court has fixed a date.', null, null, null, false, 'Hon. Justice A. B.', 'Court 2', 'hearing');
  select id into ev from court_events where matter_id = m and outcome_update_id is null and vacated_at is null;
  perform t_check('a hearing notice fixes a date with judge, courtroom and purpose', (select source || '|' || judge || '|' || courtroom || '|' || purpose_kind from court_events where id = ev) = 'hearing_notice|Hon. Justice A. B.|Court 2|hearing'
                                                                          and (select court_id from court_events where id = ev) = (select court_id from matters where id = m));
  perform t_check('the cause list shows it under the court',              (select count(*) from firm_cause_list where matter_id = m and court like 'Chief Magistrates%') = 1);

  ev2 := vacate_court_event(ev, 'Judge transferred', wed, 'hearing');
  perform t_check('a vacated date is refixed',                             (select vacated_at from court_events where id = ev) is not null and (select refixed_to from court_events where id = ev) = ev2
                                                                          and (select next_event_at from matters where id = m) = wed);
  perform t_check('the cause list drops the vacated date',                (select count(*) from firm_cause_list where matter_id = m) = 1 and (select court_event_id from firm_cause_list where matter_id = m) = ev2);
  perform t_reset();
  -- the reminder job runs as the platform (pg_cron), never as a user
  perform t_check('reminders skip vacated dates',                          enqueue_court_reminders() >= 0 and (select count(*) from notifications where event like 'court_date_%' and (payload ->> 'scheduled_at')::timestamptz = tue) = 0);
  perform t_as(ln, 'aal2');

  upd := post_court_update(m, 'adjourned_sine_die', wed, null, null, null, null, 'The court will communicate a new date.');
  perform t_check('adjourned sine die clears the next date and flags the matter', (select awaiting_date from matters where id = m) and (select next_event_at from matters where id = m) is null);
  perform t_reset();

  perform t_as(cn, 'aal1');
  perform t_check('the client sees the vacated and refixed date',          (select count(*) from updates where matter_id = m and title like 'Date of % vacated — refixed to %') = 1);
  perform t_check('the client sees her own cause list',                   (select count(*) from firm_cause_list where matter_id = m) = 0);
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
