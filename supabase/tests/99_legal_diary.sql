-- Where a court date came from is recorded, and a deadline is counted by the database, shown day
-- by day with what it relied on, and confirmed by a lawyer. Run alone or with the others. Rolls back.
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
-- The audit trail, read past RLS: a lawyer cannot read audit_log (owners and admins do), and the
-- question here is whether the line was written, not who may read it.
create or replace function t_audit(p_action text, p_entity uuid) returns jsonb language sql security definer as $$
  select jsonb_build_object('firm_id', firm_id, 'actor_id', actor_id, 'meta', meta) from audit_log where action = p_action and entity_id = p_entity order by at desc limit 1 $$;

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
grant select on fx to anon, authenticated;
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values (gen_random_uuid(), 'ld-lawyer@test'), (gen_random_uuid(), 'ld-staff@test'), (gen_random_uuid(), 'ld-client@test'), (gen_random_uuid(), 'ld-admin@test');
insert into fx select 'lawyer', id from auth.users where email = 'ld-lawyer@test';
insert into fx select 'staff',  id from auth.users where email = 'ld-staff@test';
insert into fx select 'client', id from auth.users where email = 'ld-client@test';
insert into fx select 'padmin', id from auth.users where email = 'ld-admin@test';
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'), (select v from fx where k='lawyer'), 'lawyer'),
  ((select v from fx where k='firm'), (select v from fx where k='staff'), 'staff');
insert into platform_admins (user_id, note) values ((select v from fx where k='padmin'), 'legal diary suite');
insert into courts (id, firm_id, level, name, state_code) values (gen_random_uuid(), null, 'state_high', 'High Court of Lagos State (suite)', 'LA');
insert into fx select 'court', id from courts where name = 'High Court of Lagos State (suite)';
insert into matters (firm_id, reference, title, type, handling_lawyer_id, court_id)
  values ((select v from fx where k='firm'), 'LD-M-2026-000001', 'Okafor v Lagos State', 'litigation', (select v from fx where k='lawyer'), (select v from fx where k='court'));
insert into fx select 'matter', id from matters where reference = 'LD-M-2026-000001';
insert into matters (firm_id, reference, title, type, handling_lawyer_id)
  values ((select v from fx where k='firm'), 'LD-M-2026-000002', 'Another file', 'advisory', (select v from fx where k='lawyer'));
insert into fx select 'matter2', id from matters where reference = 'LD-M-2026-000002';
insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='lawyer'), true);
insert into matter_parties (matter_id, firm_id, user_id, role) values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');
insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by) values
  (gen_random_uuid(), (select v from fx where k='firm'), (select v from fx where k='matter'), 'hearing-notice.pdf', 'court', false, (select v from fx where k='lawyer')),
  (gen_random_uuid(), (select v from fx where k='firm'), (select v from fx where k='matter2'), 'elsewhere.pdf', 'court', false, (select v from fx where k='lawyer'));
insert into fx select 'notice', id from documents where name = 'hearing-notice.pdf';
insert into fx select 'other_doc', id from documents where name = 'elsewhere.pdf';

-- ---------------------------------------------------------------- 1. the rules are the platform's, and everybody may read them
do $$
declare pa uuid := (select v from fx where k='padmin'); l uuid := (select v from fx where k='lawyer'); r1 uuid := gen_random_uuid(); r0 uuid := gen_random_uuid();
begin
  perform t_as(l);
  perform t_check('a lawyer cannot enter a rule', t_refused(format('insert into court_rules (id, name, version, effective_from) values (%L, ''x'', ''1'', ''2020-01-01'')', r1), '42501'));
  perform t_reset(); perform t_as(pa, 'aal1');
  perform t_check('nor a platform admin without a second factor', t_refused(format('insert into court_rules (id, name, version, effective_from) values (%L, ''x'', ''1'', ''2020-01-01'')', r1), '42501'));
  perform t_reset(); perform t_as(pa);
  insert into court_rules (id, level, state_code, name, citation, version, effective_from) values (r1, 'state_high', 'LA', 'High Court of Lagos State (Civil Procedure) Rules (suite)', 'HCL CPR', '2019', '2019-01-31');
  insert into rule_provisions (rule_id, key, label, citation, trigger_kind, period, unit, count_mode) values
    (r1, 'defence_days', 'Statement of defence', 'Order 17 rule 1', 'service_effected', 42, 'days', 'calendar'),
    (r1, 'clear_notice', 'Notice of application', 'Order 43', 'filing', 7, 'days', 'clear'),
    (r1, 'working_five', 'Compliance with an order', 'Order 5', 'order_made', 5, 'days', 'working'),
    (r1, 'months_three', 'Notice of appeal against a final judgment', 's. 24', 'judgment_delivered', 3, 'months', 'calendar');
  insert into rule_provisions (rule_id, key, label, trigger_kind, period, unit, count_mode, excludes_vacation) values
    (r1, 'vac_excluded', 'Reply after a ruling', 'ruling_delivered', 5, 'days', 'calendar', true);
  insert into court_rules (id, level, state_code, name, version, effective_from, retired_on) values (r0, 'state_high', 'LA', 'High Court of Lagos State Rules (suite, old)', '2012', '2012-01-01', '2019-01-31');
  insert into rule_provisions (rule_id, key, label, trigger_kind, period) values (r0, 'old_defence', 'Statement of defence (old rules)', 'service_effected', 30);
  perform t_check('a bad provision key is refused', t_refused(format('insert into rule_provisions (rule_id, key, label, trigger_kind, period) values (%L, ''Bad Key'', ''x'', ''filing'', 1)', r1), '23514'));
  perform t_check('the rule is audited as a platform act', exists (select 1 from audit_log where action = 'court_rules.insert' and entity_id = r1 and actor_id = pa));
  perform t_reset();
  insert into fx values ('rule', r1), ('old_rule', r0);
  perform set_config('role', 'anon', false);
  perform t_check('anyone may read the rules, as with holidays', (select count(*) >= 2 from court_rules) and (select count(*) >= 6 from rule_provisions));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. the count, day by day
do $$
declare l uuid := (select v from fx where k='lawyer'); c jsonb; v uuid := gen_random_uuid();
begin
  perform t_as(l);
  c := count_deadline('2026-03-02', 14, 'days', 'calendar', 'state_high', 'LA');
  perform t_check('fourteen calendar days from a Monday is the Monday a fortnight on', (c ->> 'due_on')::date = '2026-03-16' and (c ->> 'counted_days')::int = 14 and jsonb_array_length(c -> 'skipped') = 0);
  c := count_deadline('2026-03-02', 12, 'days', 'calendar', 'state_high', 'LA');
  perform t_check('a last day on a Saturday rolls to Monday, and both rolled days are written down', (c ->> 'due_on')::date = '2026-03-16' and jsonb_array_length(c -> 'rolled') = 2 and c -> 'rolled' -> 0 ->> 'reason' = 'the court does not sit');
  c := count_deadline('2026-03-02', 12, 'days', 'calendar', 'state_high', 'LA', false, false);
  perform t_check('unless the provision does not roll', (c ->> 'due_on')::date = '2026-03-14');
  c := count_deadline('2026-03-02', 7, 'days', 'clear', 'state_high', 'LA');
  perform t_check('seven clear days: the act on the day after the seventh', (c ->> 'due_on')::date = '2026-03-10');
  c := count_deadline('2026-03-06', 5, 'days', 'working', 'state_high', 'LA');
  perform t_check('five working days from a Friday is the next Friday, the weekend skipped and said', (c ->> 'due_on')::date = '2026-03-13' and jsonb_array_length(c -> 'skipped') = 2);
  c := count_deadline('2026-01-31', 3, 'months', 'calendar', 'state_high', 'LA');
  perform t_check('three months from 31 January is 30 April', (c ->> 'due_on')::date = '2026-04-30');
  perform t_check('an empty vacation calendar is said in the count', not (c -> 'coverage' ->> 'any_vacation_calendar')::bool and (c -> 'coverage' ->> 'holidays_entered_for_year')::bool);
  perform t_check('a unit nobody has is refused', t_fails('select count_deadline(''2026-03-02'', 2, ''weeks'', ''calendar'')', 'days or months'));
  perform t_check('a period of nothing is refused', t_fails('select count_deadline(''2026-03-02'', 0, ''days'', ''calendar'')', 'between 1 and 3660'));
  perform t_reset();
  -- A vacation during which time does not run, for the High Court in Lagos.
  insert into court_vacations (id, level, state_code, name, starts_on, ends_on, time_runs) values (v, 'state_high', 'LA', 'Suite vacation', '2026-03-05', '2026-03-08', false);
  perform t_as(l);
  c := count_deadline('2026-03-02', 5, 'days', 'calendar', 'state_high', 'LA', true, true);
  perform t_check('a provision that stops for the vacation skips its days and says so',
    (c ->> 'due_on')::date = '2026-03-11' and jsonb_array_length(c -> 'skipped') = 4 and c -> 'skipped' -> 0 ->> 'reason' = 'time does not run: vacation'
    and (c -> 'coverage' ->> 'vacation_rows_in_range')::int = 1 and (c -> 'coverage' ->> 'any_vacation_calendar')::bool);
  c := count_deadline('2026-03-02', 5, 'days', 'calendar', 'state_high', 'LA', false, true);
  perform t_check('one that does not stop counts straight through — the court not sitting is a different question', (c ->> 'due_on')::date = '2026-03-09' and jsonb_array_length(c -> 'skipped') = 0 and jsonb_array_length(c -> 'rolled') = 2);
  c := count_deadline('2026-03-02', 5, 'days', 'calendar', 'federal_high', 'LA', true, true);
  perform t_check('a vacation for the High Court does not stop time in the Federal High Court', (c ->> 'due_on')::date = '2026-03-09');
  perform t_reset();
  delete from court_vacations where id = v;
end $$;

-- ---------------------------------------------------------------- 3. a deadline is counted, proposed, confirmed by a lawyer, never edited
do $$
declare l uuid := (select v from fx where k='lawyer'); sf uuid := (select v from fx where k='staff'); cl uuid := (select v from fx where k='client');
        f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter'); r1 uuid := (select v from fx where k='rule'); r0 uuid := (select v from fx where k='old_rule');
        pv_def uuid; pv_old uuid; pv_months uuid; d1 uuid; d2 uuid; d3 uuid; d4 uuid;
begin
  select id into pv_def from rule_provisions where rule_id = r1 and key = 'defence_days';
  select id into pv_months from rule_provisions where rule_id = r1 and key = 'months_three';
  select id into pv_old from rule_provisions where rule_id = r0 and key = 'old_defence';
  perform t_as(l);
  d1 := compute_deadline(m, 'service_effected', '2026-03-02', pv_def, null, null, jsonb_build_object('note', 'served at chambers'));
  perform t_check('a deadline is proposed with the rule as it read, the jurisdiction, the count and the day due',
    (select status = 'proposed' and due_on = '2026-04-13' and rule_version = '2019' and rule_name like 'High Court of Lagos State (Civil%' and provision_label = 'Statement of defence'
            and jurisdiction ->> 'level' = 'state_high' and jurisdiction ->> 'state_code' = 'LA' and (calculation ->> 'counted_days')::int = 42
            and computed_by = l and title = 'Statement of defence' and trigger_ref ->> 'note' = 'served at chambers' from deadlines where id = d1));
  perform t_check('it is audited', (t_audit('deadline.computed', d1) ->> 'firm_id')::uuid = f and (t_audit('deadline.computed', d1) -> 'meta' ->> 'manual')::bool = false);
  perform t_check('a provision counted from the wrong event is refused', t_fails(format('select compute_deadline(%L, ''judgment_delivered'', ''2026-03-02'', %L)', m, pv_def), 'counts from service effected, not from judgment delivered'));
  perform t_check('a rule not in force on the day is refused', t_fails(format('select compute_deadline(%L, ''service_effected'', ''2026-03-02'', %L)', m, pv_old), 'were not in force on 2 Mar 2026'));
  d4 := compute_deadline(m, 'service_effected', '2015-05-05', pv_old);
  perform t_check('but counts a day it was in force', (select due_on = '2015-06-04' and rule_version = '2012' from deadlines where id = d4));
  perform t_check('a rule for another court is refused', t_fails(format('select compute_deadline(%L, ''judgment_delivered'', ''2026-03-02'', %L)', (select v from fx where k='matter2'), pv_months), 'this matter''s court is not recorded'));
  perform t_check('the row cannot be written by hand', t_refused(format('insert into deadlines (firm_id, matter_id, title, trigger_kind, trigger_on, due_on) values (%L, %L, ''x'', ''filing'', ''2026-01-01'', ''2026-01-02'')', f, m), '42501')
                                                   and t_refused(format('update deadlines set due_on = ''2030-01-01'' where id = %L', d1), '42501'));
  perform t_reset(); perform t_as(sf);
  d2 := compute_deadline(m, 'filing', '2026-03-02', null, '2026-03-20', 'File the written address');
  perform t_check('a staff member enters a deadline by hand, and the row says it is the firm''s own date', (select status = 'proposed' and rule_id is null and calculation ->> 'count_mode' = 'manual' and due_on = '2026-03-20' from deadlines where id = d2));
  perform t_check('but does not confirm one', t_refused(format('select confirm_deadline(%L)', d2), '42501'));
  perform t_check('without a rule, the day is required', t_fails(format('select compute_deadline(%L, ''filing'', ''2026-03-02'')', m), 'give the day'));
  perform t_check('and a title', t_fails(format('select compute_deadline(%L, ''filing'', ''2026-03-02'', null, ''2026-03-20'')', m), 'needs a title'));
  perform t_check('and it does not fall before its event', t_fails(format('select compute_deadline(%L, ''filing'', ''2026-03-02'', null, ''2026-03-01'', ''x'')', m), 'does not fall before'));
  perform t_reset(); perform t_as(l);
  perform confirm_deadline(d1);
  perform t_check('a lawyer confirms it, and the confirmation is audited', (select status = 'confirmed' and confirmed_by = l and confirmed_at is not null from deadlines where id = d1)
                                                                       and t_audit('deadline.confirmed', d1) is not null);
  perform t_check('once', t_fails(format('select confirm_deadline(%L)', d1), 'already confirmed'));
  d3 := compute_deadline(m, 'service_effected', '2026-03-03', pv_def, null, 'Statement of defence (service re-effected)', '{}'::jsonb, d1);
  perform t_check('a change is a new row that supersedes the old', (select status = 'superseded' and superseded_by = d3 from deadlines where id = d1) and (select status = 'proposed' and due_on = '2026-04-14' from deadlines where id = d3));
  perform t_check('a superseded deadline is not superseded again', t_fails(format('select compute_deadline(%L, ''service_effected'', ''2026-03-04'', %L, null, null, ''{}'', %L)', m, pv_def, d1), 'already superseded'));
  perform discharge_deadline(d2, 'Address filed on 18 March');
  perform t_check('a discharged deadline keeps its note, and the discharge is audited', (select status = 'discharged' and discharged_by = l and discharge_note = 'Address filed on 18 March' from deadlines where id = d2)
                                                                                    and t_audit('deadline.discharged', d2) is not null);
  perform t_check('and is not discharged twice', t_fails(format('select discharge_deadline(%L)', d2), 'already discharged'));
  perform t_check('the firm reads its deadlines with the matter beside each', (select count(*) = 4 and bool_and(reference = 'LD-M-2026-000001') from firm_deadlines where matter_id = m));
  perform t_reset(); perform t_as(cl, 'aal1');
  perform t_check('the client sees no deadline, anywhere', (select count(*) = 0 from deadlines) and (select count(*) = 0 from firm_deadlines) and t_refused(format('select compute_deadline(%L, ''filing'', ''2026-03-02'', null, ''2026-03-20'', ''x'')', m), '42501'));
  perform t_reset();
  insert into fx values ('d3', d3);
end $$;

-- ---------------------------------------------------------------- 4. reminders go to the matter's lawyers, once each
do $$
declare l uuid := (select v from fx where k='lawyer'); d3 uuid := (select v from fx where k='d3'); n int; v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  perform t_as(l); perform confirm_deadline(d3); perform t_reset();
  update deadlines set due_on = v_today + 1 where id = d3;
  n := enqueue_deadline_reminders();
  perform t_check('a deadline due tomorrow: the week-out and day-out nudges, to the lawyer', n = 2
    and exists (select 1 from notifications where user_id = l and event = 'deadline_due_t7' and channel = 'in_app' and (payload ->> 'deadline_id')::uuid = d3)
    and exists (select 1 from notifications where user_id = l and event = 'deadline_due_t1' and channel = 'in_app')
    and (select reminders_sent @> array['t7', 't1'] from deadlines where id = d3));
  perform t_check('and not again', enqueue_deadline_reminders() = 0);
  update deadlines set due_on = v_today where id = d3;
  n := enqueue_deadline_reminders();
  perform t_check('on the day, the last one', n = 1 and exists (select 1 from notifications where user_id = l and event = 'deadline_due_t0'));
  perform t_check('the cron function is nobody''s to call from the API', not has_function_privilege('authenticated', 'public.enqueue_deadline_reminders()', 'execute'));
end $$;

-- ---------------------------------------------------------------- 5. where a court date came from
do $$
declare l uuid := (select v from fx where k='lawyer'); cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter');
        e uuid := gen_random_uuid(); notice uuid := (select v from fx where k='notice'); other uuid := (select v from fx where k='other_doc');
begin
  perform t_as(l);
  insert into court_events (id, matter_id, firm_id, scheduled_at, purpose, court_id) values (e, m, f, '2026-05-04 09:00+01', 'Mention', (select v from fx where k='court'));
  perform t_check('a court date records who made it and when', (select created_by = l and created_at is not null and source = 'firm' from court_events where id = e));
  perform t_check('and leaves a line in the firm''s audit trail', (t_audit('court_events.insert', e) ->> 'firm_id')::uuid = f and (t_audit('court_events.insert', e) ->> 'actor_id')::uuid = l);
  perform t_check('a date the firm reported is not evidenced', (select not evidenced from firm_cause_list where court_event_id = e));
  perform t_check('a document from another matter is not its evidence', t_fails(format('select attach_court_event_source(%L, %L)', e, other), 'must be a document on this matter'));
  perform t_check('nor is nothing', t_fails(format('select attach_court_event_source(%L)', e), 'attach a document, a reference, or both'));
  perform attach_court_event_source(e, notice, 'Cause list of 4 May 2026, item 12');
  perform t_check('with the notice attached it is a hearing-notice date, evidenced, and confirmed by whoever attached it',
    (select source = 'hearing_notice' and source_document_id = notice and source_ref like 'Cause list%' and confirmed_by = l and confirmed_at is not null from court_events where id = e)
    and (select evidenced from firm_cause_list where court_event_id = e));
  perform t_check('the attachment is audited too', t_audit('court_events.update', e) -> 'meta' -> 'changed' ? 'source_document_id');
  perform t_check('a stray source word is refused', t_fails(format('select attach_court_event_source(%L, null, ''x'', ''rumour'')', e), 'hearing_notice or cause_list'));
  perform t_reset(); perform t_as(cl, 'aal1');
  perform t_check('a client reads the date and cannot attach anything to it', exists (select 1 from court_events where id = e) and t_refused(format('select attach_court_event_source(%L, null, ''x'')', e), '42501'));
  perform t_reset();
  update court_events set reminders_sent = array['t3'::text] where id = e;
  perform t_check('a reminder stamp is not an audit event', (select count(*) = 1 from audit_log where action = 'court_events.update' and entity_id = e));
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
