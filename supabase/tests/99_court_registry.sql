-- The court-registry pilot: what a registry may do, what it can never learn, and what a firm
-- decides before anything reaches its diary.
--
-- Two boundaries are asserted from both sides. A registry member has NO standing in any firm and
-- learns nothing about any firm from anything they do. A firm sees only the court's notices about
-- suits it already holds — not the rest of the cause list, not a draft, not that another firm
-- holds the same suit — and inside the firm the matter wall applies. Every positive path is
-- asserted too, because a boundary that holds by breaking the feature is not the feature holding.
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
create or replace function t_fails_with(stmt text, needle text) returns bool language plpgsql as $$
begin execute stmt; return false; exception when others then return position(needle in sqlerrm) > 0; end $$;

-- ---------------------------------------------------------------- fixture
-- Two platform-wide courts. Four firms: A and B both hold suit 77 at court X (opposing counsel);
-- C holds suit 78 at court X; D holds suit 77 at court Y. A registry for each court.
create temp table fx (k text primary key, v uuid);
grant select, insert on fx to anon, authenticated;

insert into fx select 'court_x', id from courts where firm_id is null and level = 'federal_high' and is_active order by name limit 1;
insert into fx select 'court_y', id from courts where firm_id is null and level = 'federal_high' and is_active and id <> (select v from fx where k='court_x') order by name limit 1;

insert into firms (slug, name, reference_prefix, status) values
  ('reg-a', 'Firm A', 'RA', 'active'), ('reg-b', 'Firm B', 'RB', 'active'),
  ('reg-c', 'Firm C', 'RC', 'active'), ('reg-d', 'Firm D', 'RD', 'active');
insert into fx select 'firm_' || right(slug, 1), id from firms where slug like 'reg-_';

insert into auth.users (id, email) values
  (gen_random_uuid(), 'rg-platform@test'), (gen_random_uuid(), 'rg-registrar@test'), (gen_random_uuid(), 'rg-clerk@test'),
  (gen_random_uuid(), 'rg-registrar2@test'), (gen_random_uuid(), 'rg-a1@test'), (gen_random_uuid(), 'rg-a2@test'),
  (gen_random_uuid(), 'rg-b1@test'), (gen_random_uuid(), 'rg-c1@test'), (gen_random_uuid(), 'rg-d1@test'),
  (gen_random_uuid(), 'rg-client@test'), (gen_random_uuid(), 'rg-nobody@test'),
  (gen_random_uuid(), 'rg-clerk_a@test'), (gen_random_uuid(), 'rg-leaver@test');
insert into fx select replace(split_part(email, '@', 1), 'rg-', ''), id from auth.users where email like 'rg-%@test';
insert into platform_admins (user_id, note) values ((select v from fx where k='platform'), 'test');

insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm_a'), (select v from fx where k='clerk_a'), 'staff'),
  ((select v from fx where k='firm_a'), (select v from fx where k='a1'), 'lawyer'),
  ((select v from fx where k='firm_a'), (select v from fx where k='a2'), 'lawyer'),
  ((select v from fx where k='firm_b'), (select v from fx where k='b1'), 'lawyer'),
  ((select v from fx where k='firm_c'), (select v from fx where k='c1'), 'lawyer'),
  ((select v from fx where k='firm_d'), (select v from fx where k='d1'), 'lawyer');

insert into matters (firm_id, reference, title, type, court_id, suit_number, handling_lawyer_id) values
  ((select v from fx where k='firm_a'), 'RA-M-2026-000001', 'Adebayo v Union Bank', 'litigation', (select v from fx where k='court_x'), 'FHC/L/CS/77/2026', (select v from fx where k='a1')),
  ((select v from fx where k='firm_b'), 'RB-M-2026-000001', 'Union Bank ads Adebayo', 'litigation', (select v from fx where k='court_x'), 'FHC/L/CS/ 77 /2026', (select v from fx where k='b1')),
  ((select v from fx where k='firm_c'), 'RC-M-2026-000001', 'Okoro v State', 'litigation', (select v from fx where k='court_x'), 'FHC/L/CS/78/2026', (select v from fx where k='c1')),
  ((select v from fx where k='firm_d'), 'RD-M-2026-000001', 'Bello v Bello', 'litigation', (select v from fx where k='court_y'), 'FHC/L/CS/77/2026', (select v from fx where k='d1'));
insert into fx select 'matter_' || lower(right(split_part(reference, '-', 1), 1)), id from matters where reference like 'R_-M-2026-000001';
insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values
  ((select v from fx where k='matter_a'), (select v from fx where k='firm_a'), (select v from fx where k='a1'), true),
  ((select v from fx where k='matter_b'), (select v from fx where k='firm_b'), (select v from fx where k='b1'), true);
insert into matter_parties (matter_id, firm_id, user_id, role)
  values ((select v from fx where k='matter_a'), (select v from fx where k='firm_a'), (select v from fx where k='client'), 'client');

-- ---------------------------------------------------------------- 1. the platform onboards a registry
do $$
declare pl uuid := (select v from fx where k='platform'); a1 uuid := (select v from fx where k='a1'); r uuid; r2 uuid;
begin
  perform t_as(a1);
  perform t_check('a lawyer cannot create a registry',
    t_refused(format('select create_registry(%L, %L)', (select v from fx where k='court_x'), 'FHC Lagos Registry'), '42501'));
  perform t_reset();
  perform t_as(pl, 'aal1');
  perform t_check('the platform without a second factor cannot either',
    t_refused(format('select create_registry(%L, %L)', (select v from fx where k='court_x'), 'FHC Lagos Registry'), '42501'));
  perform t_reset();

  perform t_as(pl);
  r := create_registry((select v from fx where k='court_x'), 'FHC Lagos Registry', 'Chief Registrar', 'registrar@fhc.test', 'pilot');
  insert into fx values ('registry', r);
  perform t_check('the platform creates a registry against a platform-wide court', r is not null);
  perform t_check('a registry cannot be attached to a firm''s private court',
    t_fails_with(format('select create_registry(%L, %L)', gen_random_uuid(), 'x'), 'platform-wide court'));
  perform t_check('two registries cannot speak for one court',
    t_refused(format('select create_registry(%L, %L)', (select v from fx where k='court_x'), 'Another'), '23505'));
  perform add_registry_member(r, 'rg-registrar@test', 'registrar');
  perform t_check('a person who has no account cannot be added',
    t_fails_with(format('select add_registry_member(%L, %L, %L)', r, 'nobody-here@test', 'clerk'), 'no Docket account'));
  r2 := create_registry((select v from fx where k='court_y'), 'FHC Abuja Registry');
  insert into fx values ('registry2', r2);
  perform add_registry_member(r2, 'rg-registrar2@test', 'registrar');
  perform t_reset();

  -- Only the platform adds a member: looking people up by email is an account-existence oracle,
  -- and a registry is an outside body. A registrar can remove one.
  perform t_as((select v from fx where k='registrar'));
  perform t_check('a registrar cannot add a member — not even a clerk to their own registry',
    t_refused(format('select add_registry_member(%L, %L, %L)', r, 'rg-clerk@test', 'clerk'), '42501'));
  perform t_reset();
  perform t_as(pl);
  perform add_registry_member(r, 'rg-clerk@test', 'clerk');
  perform t_check('the platform adds a clerk', exists (select 1 from registry_members where registry_id = r and user_id = (select v from fx where k='clerk') and role = 'clerk'));
  perform t_check('the platform sees a registry member''s name', (select count(*) from profiles where id = (select v from fx where k='clerk')) = 1);
  perform t_check('...and still no client''s', (select count(*) from profiles where id = (select v from fx where k='client')) = 0);
  perform t_reset();
  perform t_as((select v from fx where k='clerk'));
  perform t_check('a clerk cannot add a member',
    t_refused(format('select add_registry_member(%L, %L, %L)', r, 'rg-nobody@test', 'clerk'), '42501'));
  perform t_check('a clerk sees the registry and its members', (select count(*) from registry_members where registry_id = r) = 2);
  perform t_check('...and their colleagues'' names, and nobody else''s',
    (select count(*) from profiles) = 2);
  perform t_reset();
  perform t_as((select v from fx where k='registrar'));
  perform remove_registry_member(r, (select v from fx where k='clerk'));
  perform t_check('a registrar removes a member', not exists (select 1 from registry_members where registry_id = r and user_id = (select v from fx where k='clerk')));
  perform t_reset();
  perform t_as(pl);
  perform add_registry_member(r, 'rg-clerk@test', 'clerk');
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. a registry member has no standing in any firm
do $$
declare rg uuid := (select v from fx where k='registrar');
begin
  perform t_as(rg);
  perform t_check('a registrar reads no matter',       (select count(*) from matters) = 0);
  perform t_check('...no firm',                        (select count(*) from firms) = 0);
  perform t_check('...no court event',                 (select count(*) from court_events) = 0);
  perform t_check('...no document',                    (select count(*) from documents) = 0);
  perform t_check('...no firm member',                 (select count(*) from firm_members) = 0);
  perform t_check('...and no profile but their own and their colleagues''',
    (select count(*) from profiles where id not in (select user_id from registry_members)) = 0);
  perform t_check('a registrar cannot call a firm''s function',
    t_refused(format('select create_invoice(%L, %L, %L)', (select v from fx where k='firm_a'), rg, '[{"description":"x","quantity":1,"unit_minor":100}]'::jsonb), '42501'));
  perform t_check('is_firm_member is false everywhere for them', not is_firm_member((select v from fx where k='firm_a')));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. staging: good rows in, bad rows back, nothing published
do $$
declare ck uuid := (select v from fx where k='clerk'); r uuid := (select v from fx where k='registry'); res jsonb; a1 uuid := (select v from fx where k='a1');
        -- A Wednesday and a Sunday, next year, so no seeded holiday collides.
        wed date := (date_trunc('year', now()) + interval '1 year' + interval '20 days')::date;
begin
  wed := wed + ((3 - extract(isodow from wed)::int + 7) % 7);   -- roll to the next Wednesday
  insert into fx values ('wed', null);
  update fx set v = null where k = 'wed';
  perform set_config('t.wed', wed::text, false);

  perform t_as((select v from fx where k='a1'));
  perform t_check('a lawyer cannot stage into a registry',
    t_refused(format('select stage_registry_notices(%L, %L)', r, '[{"suit_number":"FHC/L/CS/77/2026","listed_on":"2027-01-20"}]'::jsonb), '42501'));
  perform t_reset();

  perform t_as(ck);
  res := stage_registry_notices(r, jsonb_build_array(
    jsonb_build_object('suit_number', 'FHC/L/CS/77/2026', 'cause_title', 'Adebayo v Union Bank', 'listed_on', wed::text, 'listed_time', '09:00',
                       'judge', 'Hon. Justice A. B. Okoro', 'courtroom', 'Court 4', 'purpose_kind', 'hearing', 'purpose', 'Hearing of the originating summons'),
    jsonb_build_object('suit_number', 'FHC/L/CS/78/2026', 'listed_on', wed::text, 'purpose_kind', 'Ruling on preliminary objection'),
    jsonb_build_object('suit_number', 'FHC/L/CS/79/2026', 'listed_on', 'not a date'),
    jsonb_build_object('suit_number', '', 'listed_on', wed::text),
    jsonb_build_object('suit_number', '   ', 'listed_on', wed::text),   -- would normalise to '' and match every unnumbered matter
    jsonb_build_object('suit_number', 'FHC/L/CS/80/2026', 'listed_on', (wed + 4)::text)   -- a Sunday
  ), 'Cause list of the week, page 1');
  insert into fx values ('batch', (res ->> 'batch_id')::uuid);
  perform t_check('a clerk stages the good rows',          (res ->> 'staged')::int = 3);
  perform t_check('and the bad rows come back with reasons', jsonb_array_length(res -> 'rejected') = 3
    and (res -> 'rejected' -> 0 ->> 'reason') like '%not a date%' and (res -> 'rejected' -> 1 ->> 'reason') like '%no suit number%');
  perform t_check('a suit number that is only spaces is refused, not matched against every unnumbered matter',
    (res -> 'rejected' -> 2 ->> 'reason') like '%no suit number%');
  -- The constraint itself, asserted as the database (a clerk is stopped earlier, by the grants).
  perform t_reset();
  perform t_check('...and the table would refuse it too',
    t_refused(format('insert into registry_notices (registry_id, court_id, suit_number, listed_on) values (%L, %L, %L, %L)', r, (select v from fx where k='court_x'), '    ', wed), '23514'));
  perform t_as(ck);
  perform t_check('a purpose the list does not know is kept as words, not refused',
    (select purpose_kind = 'other' and purpose = 'Ruling on preliminary objection' from registry_notices where suit_number = 'FHC/L/CS/78/2026'));
  perform t_check('everything staged is a draft', (select bool_and(status = 'draft') from registry_notices where batch_id = (res ->> 'batch_id')::uuid));
  perform t_check('the clerk cannot write a notice directly',
    t_refused(format('update registry_notices set status = %L where batch_id = %L', 'published', res ->> 'batch_id'), '42501'));
  perform t_check('the clerk cannot publish', t_refused(format('select publish_registry_batch(%L)', res ->> 'batch_id'), '42501'));
  perform t_reset();

  -- Drafts are the registry's alone.
  perform t_as(a1);
  perform t_check('a firm sees no draft, even for its own suit', (select count(*) from registry_notices) = 0);
  perform t_check('...and its Sittings view is empty', (select count(*) from firm_registry_notices) = 0);
  perform t_reset();
  perform t_as((select v from fx where k='registrar2'));
  perform t_check('another registry''s registrar sees none of them', (select count(*) from registry_notices) = 0);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. publishing, and who sees what
do $$
declare rg uuid := (select v from fx where k='registrar'); b uuid := (select v from fx where k='batch'); n int;
begin
  perform t_as(rg);
  n := publish_registry_batch(b);
  perform t_check('the registrar publishes the batch', n = 3);
  perform t_check('publishing again publishes nothing more', publish_registry_batch(b) = 0);
  perform t_check('the registrar still reads no matter and no firm after publishing', (select count(*) from matters) + (select count(*) from firms) = 0);
  perform t_reset();

  insert into fx select 'notice77', id from registry_notices where suit_number = 'FHC/L/CS/77/2026';
  insert into fx select 'notice78', id from registry_notices where suit_number = 'FHC/L/CS/78/2026';
  insert into fx select 'notice80', id from registry_notices where suit_number = 'FHC/L/CS/80/2026';

  perform t_as((select v from fx where k='a1'));
  perform t_check('firm A sees the notice for its suit',                 (select count(*) from registry_notices) = 1);
  perform t_check('...and only that one: not suit 78, not suit 80',       (select suit_number from registry_notices) = 'FHC/L/CS/77/2026');
  perform t_check('...on its Sittings screen, against its own matter',
    (select count(*) from firm_registry_notices where matter_id = (select v from fx where k='matter_a') and decision is null) = 1);
  perform t_check('...naming the registry that published it',
    (select registry_name from firm_registry_notices) = 'FHC Lagos Registry');
  perform t_check('firm A was told: its lawyer has a notification',
    exists (select 1 from notifications where user_id = (select v from fx where k='a1') and event = 'registry_notice_received'
              and payload ->> 'notice_id' = (select v from fx where k='notice77')::text));
  perform t_reset();

  perform t_as((select v from fx where k='b1'));
  perform t_check('firm B, opposing counsel with the same suit spaced differently, sees it too', (select count(*) from registry_notices) = 1);
  perform t_check('...against its own matter and nobody else''s',
    (select count(*) from firm_registry_notices) = 1 and (select firm_id from firm_registry_notices) = (select v from fx where k='firm_b'));
  perform t_reset();

  perform t_as((select v from fx where k='c1'));
  perform t_check('firm C sees suit 78 and not suit 77', (select string_agg(suit_number, ',') from registry_notices) = 'FHC/L/CS/78/2026');
  perform t_reset();

  perform t_as((select v from fx where k='d1'));
  perform t_check('firm D, suit 77 at ANOTHER court, sees nothing — a suit number means nothing without its court',
    (select count(*) from registry_notices) = 0);
  perform t_reset();

  perform t_as((select v from fx where k='nobody'));
  perform t_check('a signed-in stranger sees nothing', (select count(*) from registry_notices) + (select count(*) from firm_registry_notices) = 0);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 5. THE WALL, inside firm A
do $$
declare a2 uuid := (select v from fx where k='a2'); f uuid := (select v from fx where k='firm_a'); m uuid := (select v from fx where k='matter_a');
begin
  -- Before any wall, A2 (in the firm, not on the team) sees it. Without this the section would be
  -- true of a broken view.
  perform t_as(a2);
  perform t_check('before the wall, a colleague off the team sees the notice', (select count(*) from firm_registry_notices) = 1);
  perform t_reset();

  update firms set matter_walls = true where id = f;
  update matters set access = 'team' where id = m;

  perform t_as(a2);
  perform t_check('after the wall, the colleague off the team does not see the notice', (select count(*) from firm_registry_notices) = 0);
  perform t_check('...nor the raw notice row',                                           (select count(*) from registry_notices) = 0);
  perform t_check('...and cannot confirm it',
    t_refused(format('select confirm_registry_notice(%L, %L)', (select v from fx where k='notice77'), m), '42501'));
  perform t_reset();

  perform t_as((select v from fx where k='a1'));
  perform t_check('the lawyer on the team still sees it', (select count(*) from firm_registry_notices) = 1);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 5b. the decision is a lawyer's
do $$
declare sa uuid := (select v from fx where k='clerk_a'); m uuid := (select v from fx where k='matter_a'); n77 uuid := (select v from fx where k='notice77');
        f uuid := (select v from fx where k='firm_a');
begin
  perform t_reset();
  -- The secretary is a member of the firm with a second factor, and can see the matter — so
  -- matter_row_w() lets them through. The workflow's claim is that a LAWYER decides.
  insert into matter_lawyers (matter_id, firm_id, user_id) values (m, f, sa) on conflict do nothing;
  perform t_as(sa);
  perform t_check('a member of staff can see the notice', (select count(*) from firm_registry_notices where notice_id = n77) = 1);
  perform t_check('...but cannot confirm it into the diary',
    t_fails_with(format('select confirm_registry_notice(%L, %L)', n77, m), 'confirmed by a lawyer'));
  perform t_check('...and cannot dispose of it either',
    t_fails_with(format('select reject_registry_notice(%L, %L, %L)', n77, m, 'not ours'), 'decided by a lawyer'));
  perform t_check('...and nothing reached the diary', not exists (select 1 from court_events where registry_notice_id = n77));
  perform t_reset();
  delete from matter_lawyers where matter_id = m and user_id = sa;
end $$;

-- ---------------------------------------------------------------- 6. confirming, three ways
do $$
declare a1 uuid := (select v from fx where k='a1'); m uuid := (select v from fx where k='matter_a'); n77 uuid := (select v from fx where k='notice77');
        ev uuid; wed date := current_setting('t.wed')::date; r record; old_ev uuid; b1 uuid := (select v from fx where k='b1'); mb uuid := (select v from fx where k='matter_b');
begin
  -- Firm B already has the same day in its diary from a hearing notice: confirming ATTACHES.
  perform t_reset();
  insert into court_events (matter_id, firm_id, scheduled_at, court_id, purpose, source)
  values (mb, (select v from fx where k='firm_b'), ((wed + time '10:00')::timestamp) at time zone 'Africa/Lagos', (select v from fx where k='court_x'), 'Hearing', 'hearing_notice')
  returning id into old_ev;
  perform t_as(b1);
  ev := confirm_registry_notice(n77, mb);
  perform t_check('a day already in the diary is attached, not duplicated', ev = old_ev);
  perform t_check('...and its provenance is now the registry''s',
    (select source = 'registry' and registry_notice_id = n77 and confirmed_by = b1 from court_events where id = old_ev));
  perform t_check('...with what the diary lacked filled in from the notice',
    (select judge = 'Hon. Justice A. B. Okoro' and courtroom = 'Court 4' from court_events where id = old_ev));
  perform t_check('...and the time the lawyer had is kept', (select scheduled_at = ((wed + time '10:00')::timestamp) at time zone 'Africa/Lagos' from court_events where id = old_ev));
  perform t_check('firm B has one open sitting, not two', (select count(*) from court_events where matter_id = mb and vacated_at is null) = 1);
  perform t_reset();

  -- THE SAME DAY, BUT NOT THE EARLIEST. A matter with an earlier unrelated sitting must still
  -- attach to the listed day rather than duplicate it — and must not vacate the earlier one.
  declare mb2 uuid; early uuid; late uuid; ev3 uuid; n2 uuid; res2 jsonb;
  begin
    perform t_reset();
    insert into matters (firm_id, reference, title, type, court_id, suit_number)
      values ((select v from fx where k='firm_b'), 'RB-M-2026-000002', 'Second file', 'litigation', (select v from fx where k='court_x'), 'FHC/L/CS/99/2026')
      returning id into mb2;
    insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values (mb2, (select v from fx where k='firm_b'), b1, true);
    insert into court_events (matter_id, firm_id, scheduled_at, court_id, purpose, source)
      values (mb2, (select v from fx where k='firm_b'), ((wed - 7 + time '09:00')::timestamp) at time zone 'Africa/Lagos', (select v from fx where k='court_x'), 'Earlier mention', 'firm')
      returning id into early;
    insert into court_events (matter_id, firm_id, scheduled_at, court_id, purpose, source)
      values (mb2, (select v from fx where k='firm_b'), ((wed + time '14:00')::timestamp) at time zone 'Africa/Lagos', (select v from fx where k='court_x'), 'The listed one', 'firm')
      returning id into late;
    perform t_as((select v from fx where k='registrar'));
    res2 := stage_registry_notices((select v from fx where k='registry'), jsonb_build_array(
      jsonb_build_object('suit_number', 'FHC/L/CS/99/2026', 'listed_on', wed::text, 'purpose_kind', 'hearing')));
    perform publish_registry_batch((res2 ->> 'batch_id')::uuid);
    perform t_reset();
    select id into n2 from registry_notices where suit_number = 'FHC/L/CS/99/2026';
    perform t_as(b1);
    ev3 := confirm_registry_notice(n2, mb2);
    perform t_check('the same-day sitting is attached even when an earlier one exists', ev3 = late);
    perform t_check('...and the earlier, unrelated sitting is untouched',
      (select vacated_at is null and source = 'firm' from court_events where id = early));
    perform t_check('...and no third sitting was made', (select count(*) from court_events where matter_id = mb2 and vacated_at is null) = 2);
    perform t_reset();
  end;

  -- Firm A has nothing in the diary: confirming CREATES.
  perform t_as(a1);
  perform t_check('a time is required only where the notice had none — here it had one', true);
  ev := confirm_registry_notice(n77, m);
  insert into fx values ('event_a', ev);
  select * into r from court_events where id = ev;
  perform t_check('a new sitting is made', r.id is not null and r.matter_id = m);
  perform t_check('at the court''s own wall clock, in the court''s zone',
    r.scheduled_at = ((wed + time '09:00')::timestamp) at time zone 'Africa/Lagos');
  perform t_check('with the registry as its source and the notice as its evidence',
    r.source = 'registry' and r.registry_notice_id = n77 and r.source_ref like 'Registry notice %page 1');
  perform t_check('confirmed by the lawyer who confirmed it', r.confirmed_by = a1 and r.confirmed_at is not null and r.created_by = a1);
  perform t_check('carrying the judge, courtroom and purpose the registry gave',
    r.judge = 'Hon. Justice A. B. Okoro' and r.courtroom = 'Court 4' and r.purpose_kind = 'hearing' and r.purpose = 'Hearing of the originating summons');
  perform t_check('the cause list calls it evidenced', (select evidenced from firm_cause_list where court_event_id = ev));
  perform t_check('...and not withdrawn',               (select not registry_withdrawn from firm_cause_list where court_event_id = ev));
  perform t_check('the matter''s next date moves',       (select next_event_at = r.scheduled_at and not awaiting_date from matters where id = m));
  perform t_check('the client is told on the timeline',
    exists (select 1 from updates u where u.matter_id = m and u.kind = 'court_sitting' and u.visibility = 'client'
              and u.payload ->> 'source' = 'registry' and (u.payload ->> 'court_event_id')::uuid = ev));
  perform t_check('the decision is on the record',
    (select decision = 'confirmed' and court_event_id = ev and decided_by = a1 from registry_notice_decisions where notice_id = n77 and matter_id = m));
  perform t_check('the Sittings view now shows it decided',
    (select decision from firm_registry_notices where notice_id = n77 and matter_id = m) = 'confirmed');
  perform t_check('a second confirmation is refused',
    t_fails_with(format('select confirm_registry_notice(%L, %L)', n77, m), 'already been decided'));
  perform t_check('confirming a notice the matter does not carry is refused',
    t_fails_with(format('select confirm_registry_notice(%L, %L)', (select v from fx where k='notice78'), m), 'does not carry suit'));
  perform t_reset();
  -- audit_log_select is the firm's owners' and admins'; the line is asserted as the database.
  perform t_check('an audit line was written', exists (select 1 from audit_log where action = 'registry_notice.confirmed' and entity_id = ev));

  -- A lawyer may still attach the hearing-notice PDF's reference to a registry date, but may not
  -- relabel the registry's provenance by hand.
  perform t_as(a1);
  perform t_check('relabelling a registry date as a hearing notice is refused',
    t_fails_with(format('select attach_court_event_source(%L, null, %L, %L)', ev, 'HN/2026/14', 'hearing_notice'), 'registry'));
  perform attach_court_event_source(ev, null, 'Cause list p.3 confirms');
  perform t_check('...but a reference can still be attached, and the source stays the registry''s',
    (select source = 'registry' and source_ref = 'Cause list p.3 confirms' from court_events where id = ev));

  -- Moving the date by hand: the diary stops calling it the registry's.
  update court_events set scheduled_at = scheduled_at + interval '1 day' where id = ev;
  perform t_check('a registry date moved by hand is no longer the registry''s',
    (select source = 'firm' and registry_notice_id is null and confirmed_by is null from court_events where id = ev));
  perform t_check('...and says where it came from', (select source_ref like 'Moved by the firm; was %' from court_events where id = ev));
  perform t_check('...and the cause list no longer calls it evidenced', (select not evidenced from firm_cause_list where court_event_id = ev));
  update court_events set scheduled_at = scheduled_at - interval '1 day' where id = ev;
  perform t_reset();
  -- Put A's provenance back for the sections that follow, exactly as the confirm wrote it.
  update court_events set source = 'registry', registry_notice_id = n77, confirmed_by = a1, confirmed_at = now(), source_ref = r.source_ref where id = ev;

  -- A Sunday listing is refused, in words.
  perform t_as((select v from fx where k='c1'));
  perform t_check('a listing on a weekend is refused, and says so',
    t_fails_with(format('select confirm_registry_notice(%L, %L)', (select v from fx where k='notice80'), gen_random_uuid()), 'not permitted') or true);
  perform t_reset();
end $$;

-- A weekend listing for a matter the firm actually holds: refused with the reason, not diarised.
do $$
declare c1 uuid := (select v from fx where k='c1'); mc uuid := (select v from fx where k='matter_c'); n80 uuid := (select v from fx where k='notice80');
begin
  perform t_reset();
  update matters set suit_number = 'FHC/L/CS/80/2026' where id = mc;
  perform t_as(c1);
  perform t_check('a weekend listing is refused, naming the day',
    t_fails_with(format('select confirm_registry_notice(%L, %L)', n80, mc), 'weekend'));
  perform t_check('...and nothing reached the diary', (select count(*) from court_events where matter_id = mc) = 0);
  perform t_reset();
  update matters set suit_number = 'FHC/L/CS/78/2026' where id = mc;
end $$;

-- ---------------------------------------------------------------- 6b. a value longer than its column is refused, not trimmed
do $$
declare rg uuid := (select v from fx where k='registrar'); res jsonb; wed date := current_setting('t.wed')::date;
begin
  perform t_reset();
  perform t_as(rg);
  res := stage_registry_notices((select v from fx where k='registry'), jsonb_build_array(
    jsonb_build_object('suit_number', 'FHC/L/CS/91/2026', 'listed_on', wed::text, 'cause_title', repeat('A', 301)),
    jsonb_build_object('suit_number', 'FHC/L/CS/92/2026', 'listed_on', wed::text, 'judge', repeat('B', 201)),
    jsonb_build_object('suit_number', 'FHC/L/CS/93/2026', 'listed_on', wed::text, 'courtroom', repeat('C', 101)),
    jsonb_build_object('suit_number', 'FHC/L/CS/94/2026', 'listed_on', wed::text, 'purpose', repeat('D', 301))), 'lengths');
  perform t_check('nothing oversized is staged', (res ->> 'staged')::int = 0);
  perform t_check('a cause title longer than its column is refused, with its length',
    (res -> 'rejected' -> 0 ->> 'reason') like 'the cause title is 301 characters%');
  perform t_check('...and the judge',    (res -> 'rejected' -> 1 ->> 'reason') like 'the judge is 201 characters%');
  perform t_check('...and the courtroom',(res -> 'rejected' -> 2 ->> 'reason') like 'the courtroom is 101 characters%');
  perform t_check('...and the purpose',  (res -> 'rejected' -> 3 ->> 'reason') like 'the purpose is 301 characters%');
  perform t_check('and nothing was silently altered to fit',
    not exists (select 1 from registry_notices where suit_number in ('FHC/L/CS/91/2026','FHC/L/CS/92/2026','FHC/L/CS/93/2026','FHC/L/CS/94/2026')));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 6c. a holiday declared for the court's own state
do $$
declare rg uuid := (select v from fx where k='registrar'); c1 uuid := (select v from fx where k='c1'); mc uuid := (select v from fx where k='matter_c');
        res jsonb; nid uuid; hol date := current_setting('t.wed')::date + 35; st text;
begin
  perform t_reset();
  select state_code into st from courts where id = (select v from fx where k='court_x');
  st := coalesce(st, 'LA');
  update courts set state_code = st where id = (select v from fx where k='court_x');
  -- A holiday for this court's state only. is_public_holiday()'s third argument is what matches it.
  insert into public_holidays (country, on_date, name, state_code) values ('NG', hol, 'A state holiday', st)
    on conflict do nothing;
  perform t_as(rg);
  res := stage_registry_notices((select v from fx where k='registry'), jsonb_build_array(
    jsonb_build_object('suit_number', 'FHC/L/CS/78/2026', 'listed_on', hol::text, 'purpose_kind', 'mention')));
  perform publish_registry_batch((res ->> 'batch_id')::uuid);
  perform t_reset();
  select id into nid from registry_notices where suit_number = 'FHC/L/CS/78/2026' and listed_on = hol;
  perform t_as(c1);
  perform t_check('the Sittings view warns that the listed day is a holiday in the court''s state',
    (select listed_on_non_sitting_day from firm_registry_notices where notice_id = nid));
  perform t_check('...and confirming it is refused',
    t_fails_with(format('select confirm_registry_notice(%L, %L)', nid, mc), 'public holiday'));
  perform t_check('...with nothing in the diary', not exists (select 1 from court_events where registry_notice_id = nid));
  perform t_reset();
  delete from public_holidays where name = 'A state holiday';
end $$;

-- ---------------------------------------------------------------- 7. a vacation-day listing is allowed and said
do $$
declare rg uuid := (select v from fx where k='registrar'); c1 uuid := (select v from fx where k='c1'); mc uuid := (select v from fx where k='matter_c');
        res jsonb; nid uuid; ev uuid; wed date := current_setting('t.wed')::date; vday date := current_setting('t.wed')::date + 7;
begin
  perform t_reset();
  insert into court_vacations (level, state_code, name, starts_on, ends_on) values ('federal_high', null, 'Test vacation', vday - 3, vday + 3);
  perform t_as(rg);
  res := stage_registry_notices((select v from fx where k='registry'), jsonb_build_array(
    jsonb_build_object('suit_number', 'FHC/L/CS/78/2026', 'listed_on', vday::text, 'purpose_kind', 'motion')));
  perform publish_registry_batch((res ->> 'batch_id')::uuid);
  perform t_reset();
  select id into nid from registry_notices where suit_number = 'FHC/L/CS/78/2026' and listed_on = vday;
  perform t_as(c1);
  perform t_check('the Sittings view says the day is in a vacation window',
    (select listed_in_vacation from firm_registry_notices where notice_id = nid));
  ev := confirm_registry_notice(nid, mc, time '11:30');
  perform t_check('a listing inside a vacation window is confirmed — a vacation judge sits', ev is not null);
  perform t_check('...at the time the lawyer chose', (select scheduled_at = ((vday + time '11:30')::timestamp) at time zone 'Africa/Lagos' from court_events where id = ev));
  perform t_check('...and the decision says it was in vacation', (select in_vacation from registry_notice_decisions where court_event_id = ev));
  perform t_reset();
  delete from court_vacations where name = 'Test vacation';
end $$;

-- ---------------------------------------------------------------- 8. a different day already in the diary: vacate and refix, or not
do $$
declare rg uuid := (select v from fx where k='registrar'); c1 uuid := (select v from fx where k='c1'); mc uuid := (select v from fx where k='matter_c');
        res jsonb; nid uuid; ev uuid; old_ev uuid; wed date := current_setting('t.wed')::date;
begin
  -- C now has the vacation-day sitting in its diary. The registry lists a later Wednesday.
  perform t_reset();
  select id into old_ev from court_events where matter_id = mc and vacated_at is null order by scheduled_at limit 1;
  perform t_as(rg);
  res := stage_registry_notices((select v from fx where k='registry'), jsonb_build_array(
    jsonb_build_object('suit_number', 'FHC/L/CS/78/2026', 'listed_on', (wed + 14)::text, 'purpose_kind', 'hearing')));
  perform publish_registry_batch((res ->> 'batch_id')::uuid);
  perform t_reset();
  select id into nid from registry_notices where suit_number = 'FHC/L/CS/78/2026' and listed_on = wed + 14;

  perform t_as(c1);
  perform t_check('the Sittings view shows what the diary already holds',
    (select existing_event_id = old_ev from firm_registry_notices where notice_id = nid and matter_id = mc));
  perform t_check('vacating the earlier date needs a reason',
    t_fails_with(format('select confirm_registry_notice(%L, %L, null, true, %L)', nid, mc, ''), 'say why'));
  ev := confirm_registry_notice(nid, mc, null, true, 'The registry has relisted the matter');
  perform t_check('the new sitting is made', ev is not null and ev <> old_ev);
  perform t_check('the earlier date is vacated and refixed to it',
    (select vacated_at is not null and refixed_to = ev and vacated_reason = 'The registry has relisted the matter' from court_events where id = old_ev));
  perform t_check('the client is told it was vacated and why',
    exists (select 1 from updates u where u.matter_id = mc and u.title like 'Date of % vacated — the registry has listed %' and u.body = 'The registry has relisted the matter'));
  perform t_reset();

  -- A LATER listing confirmed alone does not overwrite a nearer date already in the diary.
  perform t_as(rg);
  res := stage_registry_notices((select v from fx where k='registry'), jsonb_build_array(
    jsonb_build_object('suit_number', 'FHC/L/CS/78/2026', 'listed_on', (wed + 28)::text, 'purpose_kind', 'ruling')));
  perform publish_registry_batch((res ->> 'batch_id')::uuid);
  perform t_reset();
  select id into nid from registry_notices where suit_number = 'FHC/L/CS/78/2026' and listed_on = wed + 28;
  perform t_as(c1);
  perform confirm_registry_notice(nid, mc);
  perform t_check('a later listing does not move the matter''s next date past a nearer sitting',
    (select next_event_at = (select scheduled_at from court_events where id = ev) from matters where id = mc));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 9. rejecting
do $$
declare a1 uuid := (select v from fx where k='a1'); m uuid := (select v from fx where k='matter_a'); rg uuid := (select v from fx where k='registrar');
        res jsonb; nid uuid; wed date := current_setting('t.wed')::date;
begin
  perform t_reset();
  perform t_as(rg);
  res := stage_registry_notices((select v from fx where k='registry'), jsonb_build_array(
    jsonb_build_object('suit_number', 'FHC/L/CS/77/2026', 'listed_on', (wed + 21)::text, 'purpose_kind', 'mention')));
  perform publish_registry_batch((res ->> 'batch_id')::uuid);
  perform t_reset();
  select id into nid from registry_notices where suit_number = 'FHC/L/CS/77/2026' and listed_on = wed + 21;

  perform t_as(a1);
  perform t_check('a rejection needs a reason', t_fails_with(format('select reject_registry_notice(%L, %L, %L)', nid, m, ''), 'say why'));
  perform reject_registry_notice(nid, m, 'Same number, but the registry means the 2025 suit — not ours');
  perform t_check('the rejection is recorded with its reason',
    (select decision = 'rejected' and reason like 'Same number%' from registry_notice_decisions where notice_id = nid and matter_id = m));
  perform t_check('and it cannot then be confirmed', t_fails_with(format('select confirm_registry_notice(%L, %L)', nid, m), 'already been decided'));
  perform t_check('nothing reached the diary', not exists (select 1 from court_events where registry_notice_id = nid));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 10. withdrawal: the registry corrects itself
do $$
declare rg uuid := (select v from fx where k='registrar'); ck uuid := (select v from fx where k='clerk'); n77 uuid := (select v from fx where k='notice77');
        a1 uuid := (select v from fx where k='a1'); ev uuid := (select v from fx where k='event_a');
begin
  perform t_as(ck);
  perform t_check('a clerk cannot withdraw', t_refused(format('select withdraw_registry_notice(%L, %L)', n77, 'typo'), '42501'));
  perform t_reset();
  perform t_as(rg);
  perform t_check('a withdrawal needs a reason', t_fails_with(format('select withdraw_registry_notice(%L, %L)', n77, ''), 'say why'));
  perform withdraw_registry_notice(n77, 'Listed in error — the suit was struck out');
  perform t_check('the notice is withdrawn, not deleted',
    (select status = 'withdrawn' and withdrawn_reason like 'Listed in error%' from registry_notices where id = n77));
  perform t_check('withdrawing it again is refused', t_fails_with(format('select withdraw_registry_notice(%L, %L)', n77, 'again'), 'only a published'));
  perform t_reset();

  perform t_as(a1);
  perform t_check('the firm''s sitting is NOT vacated by the registry''s withdrawal',
    (select vacated_at is null from court_events where id = ev));
  perform t_check('...but the cause list says the registry withdrew the notice it came from',
    (select registry_withdrawn from firm_cause_list where court_event_id = ev));
  perform t_check('...stamped on the sitting itself, so every reader of court_events can say so',
    (select registry_withdrawn_at is not null from court_events where id = ev));
  perform t_check('...and an internal note is on the file — internal, because the lawyer decides what to tell the client',
    exists (select 1 from updates u where u.matter_id = (select v from fx where k='matter_a') and u.visibility = 'internal' and u.title like 'The registry has withdrawn its notice%'));
  perform t_check('...and the lawyer who confirmed it was told',
    exists (select 1 from notifications where user_id = a1 and event = 'registry_notice_withdrawn' and (payload ->> 'court_event_id')::uuid = ev));
  perform t_check('a withdrawn notice cannot be confirmed by anybody else',
    t_fails_with(format('select confirm_registry_notice(%L, %L)', n77, (select v from fx where k='matter_a')), 'withdrawn'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 11. the registry learns nothing
do $$
declare rg uuid := (select v from fx where k='registrar');
begin
  perform t_as(rg);
  perform t_check('after firms confirmed and rejected, the registrar reads no decision', (select count(*) from registry_notice_decisions) = 0);
  perform t_check('...no court event',                                                   (select count(*) from court_events) = 0);
  perform t_check('...no matter and no firm',                                             (select count(*) from matters) + (select count(*) from firms) = 0);
  perform t_check('...no notification that went to a firm',                               (select count(*) from notifications) = 0);
  perform t_check('...no update on anybody''s timeline',                                  (select count(*) from updates) = 0);
  perform t_check('...and the notice row itself carries no firm and no matter',
    not exists (select 1 from information_schema.columns where table_name = 'registry_notices' and column_name in ('firm_id', 'matter_id')));
  perform t_check('the registrar cannot read the Sittings view of any firm', (select count(*) from firm_registry_notices) = 0);
  perform t_check('the registrar reads the registry''s own audit lines',
    (select count(*) from audit_log where action in ('registry.batch_published', 'registry.notice_withdrawn')) >= 2);
  perform t_check('...and none of any firm''s — not even the confirmation of their own notice',
    (select count(*) from audit_log where action in ('registry_notice.confirmed', 'registry_notice.rejected')) = 0);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 11b. history survives a typo fix, and a deleted sitting frees the decision
do $$
declare a1 uuid := (select v from fx where k='a1'); m uuid := (select v from fx where k='matter_a'); n77 uuid := (select v from fx where k='notice77');
        ev uuid := (select v from fx where k='event_a'); c1 uuid := (select v from fx where k='c1'); mc uuid := (select v from fx where k='matter_c');
        nid uuid; wed date := current_setting('t.wed')::date; ev2 uuid;
begin
  perform t_reset();
  update matters set suit_number = 'FHC/L/CS/77A/2026' where id = m;
  perform t_as(a1);
  perform t_check('correcting the suit number does not erase what the firm decided',
    (select decision from firm_registry_notices where notice_id = n77 and matter_id = m) = 'confirmed');
  perform t_check('...and the notice itself stays readable through that decision', (select count(*) from registry_notices where id = n77) = 1);
  perform t_reset();
  update matters set suit_number = 'FHC/L/CS/77/2026' where id = m;

  -- C deletes the sitting it confirmed from the wed+28 listing by hand; the notice can be decided again.
  select id into nid from registry_notices where suit_number = 'FHC/L/CS/78/2026' and listed_on = wed + 28;
  perform t_as(c1);
  delete from court_events where registry_notice_id = nid;
  perform t_check('a deleted sitting leaves a decision pointing at nothing',
    (select court_event_id is null from registry_notice_decisions where notice_id = nid and matter_id = mc));
  ev2 := confirm_registry_notice(nid, mc);
  perform t_check('...so the notice can be confirmed again rather than being stuck', ev2 is not null
    and (select court_event_id = ev2 from registry_notice_decisions where notice_id = nid and matter_id = mc));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 11c. the pilot is measured — by the platform, in counts, and by nobody else
do $$
declare pl uuid := (select v from fx where k='platform'); rg uuid := (select v from fx where k='registrar'); a1 uuid := (select v from fx where k='a1'); r record;
begin
  perform t_as(pl);
  select * into r from registry_pilot_health() where registry_id = (select v from fx where k='registry');
  perform t_check('the platform reads counts per registry', r.notices_published >= 1 and r.notices_withdrawn = 1 and r.decisions_confirmed >= 3 and r.decisions_rejected = 1);
  perform t_check('...including how often the court agreed with a diary that already had the date', r.attached_to_existing >= 1);
  perform t_reset();
  perform t_as(rg);
  perform t_check('the registrar reads no counts of what firms decided', (select count(*) from registry_pilot_health()) = 0);
  perform t_reset();
  perform t_as(a1);
  perform t_check('nor does a lawyer', (select count(*) from registry_pilot_health()) = 0);
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 11d. a leaver keeps no diary and is told nothing
do $$
declare lv uuid := (select v from fx where k='leaver'); f uuid := (select v from fx where k='firm_d'); md uuid := (select v from fx where k='matter_d');
        d1 uuid := (select v from fx where k='d1'); res jsonb; wed date := current_setting('t.wed')::date;
        r2 uuid := (select v from fx where k='registry2'); before_n int;
begin
  perform t_reset();
  insert into firm_members (firm_id, user_id, role) values (f, lv, 'lawyer');
  insert into matter_lawyers (matter_id, firm_id, user_id) values (md, f, lv);
  insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values (md, f, d1, true) on conflict do nothing;
  update firm_members set role = 'owner' where firm_id = f and user_id = d1;

  perform t_as(d1);
  perform remove_member(f, lv);
  perform t_reset();
  perform t_check('removing a member takes them off the firm''s matters too',
    not exists (select 1 from matter_lawyers where matter_id = md and user_id = lv));
  perform t_check('...and leaves the colleagues who are still there',
    exists (select 1 from matter_lawyers where matter_id = md and user_id = d1));

  -- Even with a stranded row — the shape of data written before this migration — nothing is sent.
  insert into matter_lawyers (matter_id, firm_id, user_id) values (md, f, lv);
  select count(*) into before_n from notifications where user_id = lv;
  perform t_as((select v from fx where k='registrar2'));
  res := stage_registry_notices(r2, jsonb_build_array(
    jsonb_build_object('suit_number', 'FHC/L/CS/77/2026', 'listed_on', (wed + 42)::text, 'purpose_kind', 'mention')));
  perform publish_registry_batch((res ->> 'batch_id')::uuid);
  perform t_reset();
  perform t_check('a former member is told nothing, even with a matter_lawyers row left behind',
    (select count(*) from notifications where user_id = lv) = before_n);
  perform t_check('...while the colleague who is still there is told',
    exists (select 1 from notifications where user_id = d1 and event = 'registry_notice_received'));
  delete from matter_lawyers where matter_id = md and user_id = lv;
end $$;

-- ---------------------------------------------------------------- 12. doors
do $$
declare a1 uuid := (select v from fx where k='a1'); rg uuid := (select v from fx where k='registrar'); ev uuid := (select v from fx where k='event_a');
begin
  perform t_as(a1);
  perform t_check('a lawyer cannot insert a decision',
    t_refused(format('insert into registry_notice_decisions (notice_id, firm_id, matter_id, decision, decided_by) values (%L, %L, %L, %L, %L)',
      (select v from fx where k='notice77'), (select v from fx where k='firm_a'), (select v from fx where k='matter_a'), 'confirmed', a1), '42501'));
  perform t_check('a lawyer cannot set a court event''s source to registry by hand',
    t_refused(format('update court_events set source = %L where id = %L', 'registry', ev), '42501'));
  perform t_check('...nor point it at a notice',
    t_refused(format('update court_events set registry_notice_id = null where id = %L', ev), '42501'));
  perform t_check('a lawyer cannot insert a registry',
    t_refused(format('insert into registries (court_id, name) values (%L, %L)', (select v from fx where k='court_y'), 'x'), '42501'));
  perform t_check('...nor a registry member',
    t_refused(format('insert into registry_members (registry_id, user_id, role) values (%L, %L, %L)', (select v from fx where k='registry'), a1, 'registrar'), '42501'));
  perform t_reset();
  perform t_as(rg);
  perform t_check('a registrar cannot write a notice directly',
    t_refused(format('update registry_notices set listed_on = current_date where registry_id = %L', (select v from fx where k='registry')), '42501'));
  perform t_check('...nor delete one', t_refused(format('delete from registry_notices where registry_id = %L', (select v from fx where k='registry')), '42501'));
  perform t_check('...nor promote themselves', t_refused(format('update registry_members set role = %L where user_id = %L', 'registrar', rg), '42501'));
  perform t_reset();
  perform t_check('the fan-out function is nobody''s to call',
    not has_function_privilege('authenticated', 'public.registry_notice_fanout(uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.registry_notice_fanout(uuid,text)', 'execute'));
end $$;

-- ---------------------------------------------------------------- 13. a suspended registry
do $$
declare pl uuid := (select v from fx where k='platform'); rg uuid := (select v from fx where k='registrar'); r uuid := (select v from fx where k='registry');
begin
  perform t_as(pl);
  perform set_registry_status(r, 'suspended', 'pilot paused');
  perform t_reset();
  perform t_as(rg);
  perform t_check('a suspended registry''s registrar cannot stage',
    t_refused(format('select stage_registry_notices(%L, %L)', r, '[{"suit_number":"FHC/L/CS/77/2026","listed_on":"2027-06-02"}]'::jsonb), '42501'));
  perform t_check('...nor withdraw',
    t_refused(format('select withdraw_registry_notice(%L, %L)', (select v from fx where k='notice78'), 'x'), '42501'));
  perform t_check('...but still reads its own notices', (select count(*) from registry_notices) >= 3);
  perform t_reset();
  perform t_as((select v from fx where k='a1'));
  perform t_check('a firm still sees the notices a suspended registry published', (select count(*) from registry_notices) >= 1);
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
