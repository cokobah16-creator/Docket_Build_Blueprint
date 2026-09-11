-- Where a firm stands is one answer, computed; a skipped step is the only thing stored. An import
-- is staged and processed a bounded batch at a time, each row on its own: dates kept, old file
-- numbers kept, unknown status keys refused, clients linked only where the firm could already see
-- them, everyone else invited. Run alone or with the others. Rolls back.
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
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into firms (slug, name, reference_prefix) values ('ob-other', 'Other Chambers', 'OB');
insert into fx select 'other', id from firms where slug = 'ob-other';
insert into auth.users (id, email) values
  (gen_random_uuid(),'ob-admin@test'), (gen_random_uuid(),'ob-lawyer@test'), (gen_random_uuid(),'ob-staff@test'),
  (gen_random_uuid(),'ob-client@test'), (gen_random_uuid(),'ob-far@test'), (gen_random_uuid(),'ob-stranger@test'), (gen_random_uuid(),'ob-other-admin@test');
insert into fx select 'admin',    id from auth.users where email='ob-admin@test';
insert into fx select 'lawyer',   id from auth.users where email='ob-lawyer@test';
insert into fx select 'staff',    id from auth.users where email='ob-staff@test';
insert into fx select 'client',   id from auth.users where email='ob-client@test';
insert into fx select 'far',      id from auth.users where email='ob-far@test';
insert into fx select 'stranger', id from auth.users where email='ob-stranger@test';
insert into fx select 'oadmin',   id from auth.users where email='ob-other-admin@test';
update profiles set full_name = 'Chukwuemeka Okonkwo', phone = '+2348031112222' where id = (select v from fx where k='client');
update profiles set full_name = 'Far Away', phone = '+2348039998888' where id = (select v from fx where k='far');
update profiles set full_name = 'Ngozi Lawyer', phone = '+2348035550000' where id = (select v from fx where k='lawyer');
update profiles set full_name = 'Ngozi Lawyer' where id = (select v from fx where k='staff');
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'),  (select v from fx where k='admin'),  'admin'),
  ((select v from fx where k='firm'),  (select v from fx where k='lawyer'), 'lawyer'),
  ((select v from fx where k='firm'),  (select v from fx where k='staff'),  'staff'),
  ((select v from fx where k='other'), (select v from fx where k='oadmin'), 'owner');
-- The client is already on a matter of the firm, so the firm can see them; 'far' is nobody's.
insert into matters (firm_id, reference, title, type, handling_lawyer_id)
  values ((select v from fx where k='firm'), 'OB-M-2026-000001', 'Existing file', 'advisory', (select v from fx where k='lawyer'));
insert into matter_parties (matter_id, firm_id, user_id, role)
  values ((select id from matters where reference = 'OB-M-2026-000001'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');
insert into fx values ('batch', gen_random_uuid());

-- ---------------------------------------------------------------- 1. readiness is one answer, in the booking engine's order
do $$
declare l uuid := (select v from fx where k='lawyer'); st uuid := (select v from fx where k='stranger'); f uuid := (select v from fx where k='firm'); r jsonb;
        exp_bookable bool;
begin
  perform t_as(l);
  r := firm_readiness(f);
  perform t_check('a member reads where the firm stands', r ? 'gates' and r ? 'skipped' and r ? 'reference_issued');
  perform t_reset();
  select (select status = 'active' from firms where id = f) and firm_policies_published(f)
         and exists (select 1 from services s where s.firm_id = f and s.is_active
                      and ((select paystack_subaccount is not null from firms where id = f) or not (s.requires_prepayment and s.price_minor > 0)))
         and exists (select 1 from lawyer_profiles lp where lp.firm_id = f and lp.is_public
                      and exists (select 1 from availability_rules a where a.firm_id = f and a.lawyer_id = lp.user_id)) into exp_bookable;
  perform t_check('bookable is exactly what book_appointment() would allow', (r -> 'gates' ->> 'bookable')::bool = exp_bookable);
  perform t_check('the lawyers counted as bookable are the public ones with hours of their own',
    (r ->> 'public_lawyers_with_hours')::int = (select count(*) from lawyer_profiles lp where lp.firm_id = f and lp.is_public
                                                  and exists (select 1 from availability_rules a where a.firm_id = f and a.lawyer_id = lp.user_id)));
  perform t_check('site_open is the firm''s status', (r -> 'gates' ->> 'site_open')::bool = (select status = 'active' from firms where id = f));
  perform t_check('a settlement account is needed the day any priced service is on — every priced booking raises an invoice',
    (r ->> 'needs_settlement')::bool = exists (select 1 from services where firm_id = f and is_active and price_minor > 0));
  perform t_check('payment_ready is the account, or nothing priced',
    (r -> 'gates' ->> 'payment_ready')::bool = ((select paystack_subaccount is not null from firms where id = f) or not (r ->> 'needs_settlement')::bool));
  perform t_check('the counts are the tables'' counts', (r ->> 'matters')::int = (select count(*) from matters where firm_id = f and deleted_at is null)
                                                     and (r ->> 'clients')::int = (select count(distinct user_id) from matter_parties where firm_id = f and role = 'client'));
  perform t_as(st);
  perform t_check('a stranger is refused', t_refused(format('select firm_readiness(%L)', f), '42501'));
  perform t_reset();
end $$;

-- Hours on one lawyer and a public profile on another is not a bookable firm, whatever the two
-- counts say on their own; and a priced service with payment after the consultation still needs
-- somewhere for its invoice to settle.
do $$
declare l uuid := (select v from fx where k='lawyer'); ad uuid := (select v from fx where k='admin'); f uuid := (select v from fx where k='firm'); r jsonb; v_sub text;
        v_rules int; v_public int;
begin
  -- The seed carries neither hours nor profiles: the scenario is built here and taken down after.
  select count(*) into v_rules from availability_rules where firm_id = f;
  select count(*) into v_public from lawyer_profiles where firm_id = f and is_public;
  update lawyer_profiles set is_public = false where firm_id = f;
  -- The admin has hours and no public profile; the lawyer has a public profile and no hours.
  insert into lawyer_profiles (firm_id, user_id, slug, is_public) values (f, ad, 'ob-admin-private', false), (f, l, 'ob-lawyer-public', true);
  insert into availability_rules (firm_id, lawyer_id, weekday, start_time, end_time) values (f, ad, 2, '09:00', '13:00');
  perform t_as(l);
  r := firm_readiness(f);
  perform t_check('with hours on a private lawyer and a public lawyer without hours, the firm is not bookable',
    not (r -> 'gates' ->> 'bookable')::bool and (r ->> 'availability_rules')::int > 0 and (r ->> 'public_lawyers')::int > 0 and (r ->> 'public_lawyers_with_hours')::int = 0);
  perform t_reset();
  update lawyer_profiles set is_public = true where firm_id = f and user_id = ad;
  perform t_as(l);
  r := firm_readiness(f);
  perform t_check('the lawyer with hours going public is what makes the difference', (r ->> 'public_lawyers_with_hours')::int = 1);
  perform t_reset();
  delete from availability_rules where firm_id = f and lawyer_id = ad;
  delete from lawyer_profiles where firm_id = f and user_id in (ad, l);
  update lawyer_profiles set is_public = true where firm_id = f;
  perform t_check('the scenario is taken down', (select count(*) from availability_rules where firm_id = f) = v_rules and (select count(*) from lawyer_profiles where firm_id = f and is_public) = v_public);

  select paystack_subaccount into v_sub from firms where id = f;
  update firms set paystack_subaccount = null where id = f;
  update services set requires_prepayment = false where firm_id = f and is_active and price_minor > 0;
  perform t_as(l);
  r := firm_readiness(f);
  perform t_check('a priced service with payment afterwards, and no account: not payment-ready',
    (r ->> 'needs_settlement')::bool and not (r ->> 'settlement_account')::bool and not (r -> 'gates' ->> 'payment_ready')::bool);
  perform t_reset();
  update firms set paystack_subaccount = v_sub where id = f;
  update services set requires_prepayment = true where firm_id = f and is_active and price_minor > 0;
end $$;

-- ---------------------------------------------------------------- 2. a skipped step is stored, with who and why; a fact never is
do $$
declare ad uuid := (select v from fx where k='admin'); sf uuid := (select v from fx where k='staff'); f uuid := (select v from fx where k='firm'); r jsonb;
begin
  perform t_as(sf);
  perform t_check('staff cannot skip a step', t_refused(format('select skip_onboarding_step(%L, ''settlement'', ''cash only'')', f), '42501'));
  perform t_reset(); perform t_as(ad);
  perform skip_onboarding_step(f, 'settlement', 'We take payment in chambers for now');
  r := firm_readiness(f);
  perform t_check('an admin skips a step and readiness says so', r -> 'skipped' ? 'settlement' and r -> 'skipped' -> 'settlement' ->> 'note' = 'We take payment in chambers for now' and (r -> 'skipped' -> 'settlement' ->> 'by')::uuid = ad);
  perform t_check('an unknown step is refused', t_refused(format('select skip_onboarding_step(%L, ''breakfast'', null)', f), '23514'));
  perform t_check('a skip cannot be written directly', t_refused(format('insert into firm_onboarding_steps (firm_id, step) values (%L, ''brand'')', f), '42501'));
  perform resume_onboarding_step(f, 'settlement');
  r := firm_readiness(f);
  perform t_check('resumed, it is gone', not (r -> 'skipped' ? 'settlement'));
  perform t_reset();
  perform t_check('both are in the audit log', (select count(*) = 2 from audit_log where firm_id = f and action in ('onboarding.step_skipped', 'onboarding.step_resumed')));
end $$;

-- ---------------------------------------------------------------- 3. the helpers say null, never a guess
do $$
begin
  perform t_check('a local number becomes E.164', import_phone_key('0803 111 2222') = '+2348031112222');
  perform t_check('an international number is kept', import_phone_key('+44 20 7946 0958') = '+442079460958');
  perform t_check('234 without the plus gains it', import_phone_key('2348031112222') = '+2348031112222');
  perform t_check('nonsense is null', import_phone_key('call me') is null);
  perform t_check('a stray plus before a local number is read as local, never stored as +0…', import_phone_key('+0803 111 2222') = '+2348031112222');
  perform t_check('+234 followed by the trunk 0 drops the 0', import_phone_key('+234 0803 111 2222') = '+2348031112222' and import_phone_key('234 0803 111 2222') = '+2348031112222');
  perform t_check('ten digits starting with 0 is a digit short, so null — never +2340…', import_phone_key('0803111222') is null);
  perform t_check('a short number is null', import_phone_key('1234567') is null and import_phone_key('01 234 5678') is null);
  perform t_check('an ISO day is that day', import_day('2021-03-12') = date '2021-03-12');
  perform t_check('a day/month/year is that day', import_day('12/03/2021') = date '2021-03-12' and import_day('12.03.2021') = date '2021-03-12');
  perform t_check('an unreadable day fails, not guesses', t_fails('select import_day(''yesterday'')', 'not readable'));
end $$;

-- ---------------------------------------------------------------- 4. staging: owners and admins only, before processing only
do $$
declare ad uuid := (select v from fx where k='admin'); sf uuid := (select v from fx where k='staff'); l uuid := (select v from fx where k='lawyer'); oa uuid := (select v from fx where k='oadmin');
        f uuid := (select v from fx where k='firm'); b uuid := (select v from fx where k='batch'); court text;
begin
  select name into court from courts where firm_id is null order by name limit 1;
  perform t_as(sf);
  perform t_check('staff cannot stage an import', t_refused(format('insert into import_batches (id, firm_id, source_name, created_by) values (%L, %L, ''old.csv'', %L)', b, f, sf), '42501'));
  perform t_reset(); perform t_as(ad);
  insert into import_batches (id, firm_id, source_name, row_count, created_by) values (b, f, 'caseload.csv', 12, ad);
  insert into import_rows (batch_id, firm_id, row_no, raw) values
    (b, f, 1, jsonb_build_object('title', 'Okonkwo v Eze', 'cause_title', 'Okonkwo v Eze & 2 Ors', 'type', 'Litigation', 'status', 'in_progress', 'court', 'Customary Court, Asaba',
                                 'suit_number', 'A/123/2021', 'opened_on', '12/03/2021', 'legacy_reference', 'F-001', 'handling_lawyer', 'ob-lawyer@test',
                                 'client_name', 'Chukwuemeka Okonkwo', 'client_phone', '0803 111 2222', 'opposing_party', 'Emeka Eze; Eze & Sons Ltd', 'next_action', 'File reply')),
    (b, f, 2, jsonb_build_object('title', 'Far v Near', 'type', 'advisory', 'client_name', 'Far Away', 'client_phone', '08039998888', 'court', court)),
    (b, f, 3, jsonb_build_object('title', 'Bad status', 'type', 'advisory', 'status', 'bogus')),
    (b, f, 4, jsonb_build_object('title', 'Left out', 'type', 'advisory')),
    (b, f, 5, jsonb_build_object('title', 'Okonkwo again', 'type', 'litigation', 'legacy_reference', 'F-001')),
    (b, f, 6, jsonb_build_object('title', 'Time travel', 'type', 'advisory', 'opened_on', '2020-01-15', 'closed_on', '2019-12-01')),
    (b, f, 7, jsonb_build_object('title', 'Named only', 'type', 'estate', 'client_name', 'Somebody Unreachable', 'opened_on', '2019-06-30', 'closed_on', '2020-02-01', 'status', 'closed')),
    (b, f, 8, jsonb_build_object('title', 'Wrong type', 'type', 'quantum')),
    (b, f, 9, jsonb_build_object('title', 'Colleague as client', 'type', 'advisory', 'client_phone', '+2348035550000')),
    (b, f, 10, jsonb_build_object('title', 'Two of them', 'type', 'advisory', 'handling_lawyer', 'Ngozi Lawyer')),
    (b, f, 11, jsonb_build_object('title', 'Bad phone', 'type', 'advisory', 'client_name', 'Nobody Reachable', 'client_phone', '1234567')),
    (b, f, 12, jsonb_build_object('title', 'Bad phone, good email', 'type', 'advisory', 'client_phone', '1234567', 'client_email', 'Reach@Example.com'));
  update import_rows set skip = true where batch_id = b and row_no = 4;
  perform t_check('an admin stages a batch and unticks a row', (select count(*) = 12 and bool_or(skip) from import_rows where batch_id = b));
  perform t_reset();
  update firm_members set role = 'staff' where firm_id = f and user_id = ad;
  perform t_as(ad);
  perform t_check('the admin who staged it, demoted, reads none of it', not exists (select 1 from import_batches where id = b) and not exists (select 1 from import_rows where batch_id = b));
  perform t_reset();
  update firm_members set role = 'admin' where firm_id = f and user_id = ad;
  perform t_as(l);
  perform t_check('a lawyer who is not an admin cannot read the staged rows', not exists (select 1 from import_rows where batch_id = b));
  perform t_check('nor process them', t_refused(format('select process_import_batch(%L)', b), '42501'));
  perform t_reset(); perform t_as(oa);
  perform t_check('another firm''s owner cannot see or process it', not exists (select 1 from import_batches where id = b) and t_refused(format('select process_import_batch(%L)', b), '42501'));
  perform t_reset();
end $$;

-- A file staged in chunks whose chunks did not all arrive is not filed in part.
do $$
declare ad uuid := (select v from fx where k='admin'); f uuid := (select v from fx where k='firm'); b2 uuid := gen_random_uuid();
begin
  perform t_as(ad);
  insert into import_batches (id, firm_id, source_name, row_count, created_by) values (b2, f, 'half.csv', 3, ad);
  insert into import_rows (batch_id, firm_id, row_no, raw) values (b2, f, 1, jsonb_build_object('title', 'Only one arrived', 'type', 'advisory'));
  perform t_check('a batch short of its rows is refused, saying how short', t_fails(format('select process_import_batch(%L)', b2), 'not fully staged: 1 of 3 rows'));
  perform t_check('and nothing was filed from it', not exists (select 1 from matters where firm_id = f and title = 'Only one arrived'));
  perform discard_import_batch(b2);
  perform t_check('discarded, it is gone', not exists (select 1 from import_batches where id = b2) and not exists (select 1 from import_rows where batch_id = b2));
  perform t_reset();
  perform t_check('the discard is audited', exists (select 1 from audit_log where firm_id = f and action = 'import.discarded' and entity_id = b2 and (meta ->> 'staged')::int = 1));
end $$;

-- ---------------------------------------------------------------- 5. processing: bounded, each row on its own, re-runnable
do $$
declare ad uuid := (select v from fx where k='admin'); l uuid := (select v from fx where k='lawyer'); cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm');
        b uuid := (select v from fx where k='batch'); r jsonb; m1 uuid; m2 uuid; m7 uuid;
begin
  perform t_as(ad);
  r := process_import_batch(b, 3);
  perform t_check('three rows processed, nine left', (r ->> 'processed')::int = 3 and (r ->> 'remaining')::int = 9);
  r := process_import_batch(b, 25);
  perform t_check('the rest processed, none left', (r ->> 'remaining')::int = 0);
  perform t_check('the batch is marked processed', (select processed_at is not null from import_batches where id = b));
  perform t_check('outcomes: six created, two skipped, four failed',
    (select count(*) filter (where outcome = 'created') = 6 and count(*) filter (where outcome = 'skipped') = 2 and count(*) filter (where outcome = 'failed') = 4 from import_rows where batch_id = b));
  perform t_check('row 11: a phone nobody can read is said, not guessed — no invitation, and the row counts as a client not invited',
    (select outcome = 'created' and invite_id is null and note like 'client not invited: the phone "1234567" is not readable%' from import_rows where batch_id = b and row_no = 11));
  perform t_check('row 12: the same phone beside an email — invited by the email, and the note says the phone is not on it',
    (select outcome = 'created' and invite_id is not null and note like 'invitation created by email — the phone "1234567" was not readable%' from import_rows where batch_id = b and row_no = 12)
    and exists (select 1 from invites i join import_rows r on r.invite_id = i.id where r.batch_id = b and r.row_no = 12 and i.phone is null and i.email = 'reach@example.com'));
  perform t_check('row 9: a colleague''s number is refused as a client, and no invitation is made', (select outcome = 'created' and invite_id is null and note like 'client not invited: that phone or email belongs to a member%' from import_rows where batch_id = b and row_no = 9));
  perform t_check('row 10: two members with the same name fail the row rather than pick one', (select outcome = 'failed' and note like 'handling lawyer "Ngozi Lawyer" matches 2 members%' from import_rows where batch_id = b and row_no = 10));
  select matter_id into m1 from import_rows where batch_id = b and row_no = 1;
  select matter_id into m2 from import_rows where batch_id = b and row_no = 2;
  select matter_id into m7 from import_rows where batch_id = b and row_no = 7;
  perform t_check('row 1: the matter keeps its dates and its old file number, with a Docket reference of its own',
    (select opened_at = date '2021-03-12' and closed_at is null and legacy_reference = 'F-001' and reference <> 'F-001' and reference is not null from matters where id = m1));
  perform t_check('row 1: status by key, court kept as text when unknown, suit number recorded',
    (select ms.key = 'in_progress' and m.court_id is null and m.court_name = 'Customary Court, Asaba' and m.suit_number = 'A/123/2021' from matters m join matter_statuses ms on ms.id = m.status_id where m.id = m1)
    and exists (select 1 from matter_court_numbers where matter_id = m1 and number = 'A/123/2021'));
  perform t_check('row 1: the handling lawyer leads it', exists (select 1 from matter_lawyers where matter_id = m1 and user_id = l and is_lead) and (select handling_lawyer_id = l from matters where id = m1));
  perform t_check('row 1: the other side is on the register, one per semicolon', (select count(*) = 2 from matter_adverse_parties where matter_id = m1));
  perform t_check('row 1: the client is invited, never linked — even one the firm already deals with',
    not exists (select 1 from matter_parties where matter_id = m1)
    and (select invite_id is not null and note like 'invitation created%' from import_rows where batch_id = b and row_no = 1)
    and exists (select 1 from invites i join import_rows ir on ir.invite_id = i.id where ir.batch_id = b and ir.row_no = 1 and i.phone = '+2348031112222' and i.matter_id = m1));
  perform t_check('row 1: an internal note records the import and nothing client-visible was invented',
    exists (select 1 from updates where matter_id = m1 and visibility = 'internal' and title = 'Brought onto Docket') and not exists (select 1 from updates where matter_id = m1 and visibility = 'client'));
  perform t_check('row 2: a client nobody knows is invited, and the platform court is matched',
    (select invite_id is not null and note like 'invitation created%' from import_rows where batch_id = b and row_no = 2)
    and exists (select 1 from invites i join import_rows ir on ir.invite_id = i.id where ir.batch_id = b and ir.row_no = 2 and i.phone = '+2348039998888' and i.role = 'client' and i.matter_id = m2)
    and not exists (select 1 from matter_parties where matter_id = m2)
    and (select court_id is not null from matters where id = m2));
  perform t_check('row 3: an unknown status fails the row, and no matter was filed without one', (select outcome = 'failed' and note like 'unknown status%' and matter_id is null from import_rows where batch_id = b and row_no = 3) and not exists (select 1 from matters where firm_id = f and title = 'Bad status'));
  perform t_check('row 4: unticked, left out', (select outcome = 'skipped' from import_rows where batch_id = b and row_no = 4));
  perform t_check('row 5: the same old file number is not imported twice', (select outcome = 'skipped' and note like 'already on Docket as %' from import_rows where batch_id = b and row_no = 5));
  perform t_check('row 6: closed before opened fails', (select outcome = 'failed' and note like 'closed before%' from import_rows where batch_id = b and row_no = 6));
  perform t_check('row 7: a closed matter keeps both days and its terminal status, with the client named for later',
    (select opened_at = date '2019-06-30' and closed_at = date '2020-02-01' from matters where id = m7) and (select note like 'client "Somebody Unreachable" named%' from import_rows where batch_id = b and row_no = 7));
  perform t_check('row 8: an unknown type fails', (select outcome = 'failed' and note like 'unknown matter type%' from import_rows where batch_id = b and row_no = 8));
  perform t_check('every created matter is audited as imported', (select count(*) = 6 from audit_log where firm_id = f and action = 'matter.imported'));
  perform t_check('a batch that has filed is the record and cannot be discarded', t_fails(format('select discard_import_batch(%L)', b), 'already begun filing'));
  perform t_check('the duplicate preview names what is already on the books, by old file number, suit number and cause title',
    (select count(*) = 3 and bool_and(reference is not null) from preview_import_duplicates(f, array['F-001', 'F-999'], array['a/123/2021'], array['okonkwo v eze & 2 ors', 'nobody v nobody'])));
  perform t_check('with nothing to compare it names nothing', (select count(*) = 0 from preview_import_duplicates(f, null, null, null)));
  perform t_check('a processed row can no longer be changed', (select not skip from import_rows where batch_id = b and row_no = 1) and t_refused(format('insert into import_rows (batch_id, firm_id, row_no, raw) values (%L, %L, 9, ''{}'')', b, f), '42501'));
  perform t_check('an outcome cannot be staged by hand', t_refused(format('insert into import_rows (batch_id, firm_id, row_no, raw, outcome, processed_at) values (%L, %L, 10, ''{}'', ''created'', now())', b, f), '42501'));
  perform t_check('p_limit null is the default, not no limit', (process_import_batch(b, null) ->> 'processed')::int = 0);
  perform t_check('nothing is ever deleted', t_refused(format('delete from import_rows where batch_id = %L', b), '42501') and t_refused(format('delete from import_batches where id = %L', b), '42501'));
  r := process_import_batch(b, 25);
  perform t_check('running it again does nothing', (r ->> 'processed')::int = 0);
  perform t_reset(); perform t_as(l);
  perform t_check('a lawyer who is not an admin cannot run the duplicate preview', t_refused(format('select * from preview_import_duplicates(%L, array[''F-001''], null, null)', f), '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 6. the conflict switch reaches the import: the matter comes in, the client does not
do $$
declare ad uuid := (select v from fx where k='admin'); f uuid := (select v from fx where k='firm'); b uuid := gen_random_uuid(); r jsonb;
begin
  perform t_as(ad);
  update firms set conflict_checks_required = true where id = f;
  insert into import_batches (id, firm_id, source_name, row_count, created_by) values (b, f, 'later.csv', 1, ad);
  insert into import_rows (batch_id, firm_id, row_no, raw) values (b, f, 1, jsonb_build_object('title', 'Needs clearance', 'type', 'advisory', 'client_phone', '+2348031112222'));
  r := process_import_batch(b, 25);
  perform t_check('with clearance required the matter is created and no invitation is made, and the row says why',
    (select outcome = 'created' and matter_id is not null and invite_id is null and note like 'client not invited: this firm requires a cleared conflict check%' from import_rows where batch_id = b and row_no = 1));
  update firms set conflict_checks_required = false where id = f;
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
