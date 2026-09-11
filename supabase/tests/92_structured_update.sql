-- A client update has a shape: what it means, what happens next, what the client must do — or,
-- stated, nothing — and when to expect the next one. Old callers of post_court_update() still
-- resolve. Rolls back.
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
begin execute stmt; return false; exception when others then return code is null or sqlstate = code; end $$;

create temp table fx (k text primary key, v uuid);
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values (gen_random_uuid(), 'su-lawyer@test'), (gen_random_uuid(), 'su-client@test');
insert into fx select 'lawyer', id from auth.users where email = 'su-lawyer@test';
insert into fx select 'client', id from auth.users where email = 'su-client@test';
insert into firm_members (firm_id, user_id, role) values ((select v from fx where k='firm'), (select v from fx where k='lawyer'), 'lawyer');
insert into matters (firm_id, reference, title, type) values ((select v from fx where k='firm'), 'SU-M-2026-000001', 'Shape v Silence', 'litigation');
insert into fx select 'matter', id from matters where reference = 'SU-M-2026-000001';
insert into matter_parties (matter_id, firm_id, user_id, role) values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');

do $$
declare f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter');
        lw uuid := (select v from fx where k='lawyer'); cl uuid := (select v from fx where k='client'); u1 uuid; u2 uuid; u3 uuid; ok bool;
begin
  perform t_as(lw);
  -- the shape main's front end and suite use: seven positional arguments, nothing after
  u1 := post_court_update(m, 'mention', now() - interval '1 day', null, null, null, null, 'Came up for mention.');
  perform t_check('a caller passing the old arguments still resolves', u1 is not null);
  perform t_check('and states nothing about action, honestly', (select action_required is null and meaning is null from updates where id = u1));

  u2 := post_court_update(m, 'adjourned', now(), null, 'the defendant', null, null, 'Adjourned; nothing for you to do.',
                          null, null, null, false, null, null, null,
                          'The other side asked for more time and the court allowed it.', 'We will be told the new date by the registry.',
                          null, false, current_date + 14);
  perform t_check('the structured update is stored', (select meaning like 'The other side%' and next_step like 'We will be told%' and action_required = false and next_update_by = current_date + 14 from updates where id = u2));

  u3 := post_court_update(m, 'hearing_notice', now(), null, null, date_trunc('week', now() + interval '21 days') + interval '2 days 10 hours', 'hearing', 'A date is fixed.',
                          null, null, null, true, null, null, null,
                          'Your case will be heard.', 'We attend and argue it.', 'Be at court by 8:30 that morning with your ID.', true, null);
  perform t_check('an action the client must take is stored with the flag', (select action_required and client_action like 'Be at court%' from updates where id = u3));

  ok := t_refused(format($q$select post_court_update(%L, 'mention', now(), null, null, null, null, 'x', null, null, null, false, null, null, null, null, null, null, true, null)$q$, m), null);
  perform t_check('"the client must act" with nothing said is refused', ok);
  ok := t_refused(format($q$select post_court_update(%L, 'mention', now(), null, null, null, null, 'x', null, null, null, false, null, null, null, null, null, 'do this', false, null)$q$, m), null);
  perform t_check('"nothing needed" beside an action is refused', ok);

  -- the free note the console posts directly, under updates_insert
  insert into updates (matter_id, firm_id, kind, visibility, title, body, posted_by, meaning, action_required, next_update_by)
  values (m, f, 'correspondence', 'client', 'Letter sent to the other side', null, lw, 'We have put our position in writing.', false, current_date + 7);
  perform t_check('a plain note carries the shape too', exists (select 1 from updates where matter_id = m and kind = 'correspondence' and action_required = false));
  ok := t_refused(format($q$insert into updates (matter_id, firm_id, kind, visibility, title, posted_by, action_required) values (%L, %L, 'note', 'client', 'x', %L, true)$q$, m, f, lw), '23514');
  perform t_check('the check constraint holds the same line for direct inserts', ok);
  perform t_reset();

  perform t_as(cl, 'aal1');
  perform t_check('the client reads what it means, what is next and what they must do', (select count(*) = 1 from updates where id = u3 and meaning is not null and client_action is not null));
  perform t_check('and reads "nothing needed" as a stated fact, not an absence', (select action_required = false from updates where id = u2));
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
