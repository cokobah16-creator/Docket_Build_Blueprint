-- A next action is a work item: it has an owner and a due DAY, the day is a calendar day, and the
-- overview counts the ones whose day has passed. Rolls back.
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

create temp table fx (k text primary key, v uuid);
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values (gen_random_uuid(), 'na-lawyer@test'), (gen_random_uuid(), 'na-client@test');
insert into fx select 'lawyer', id from auth.users where email = 'na-lawyer@test';
insert into fx select 'client', id from auth.users where email = 'na-client@test';
insert into firm_members (firm_id, user_id, role) values ((select v from fx where k='firm'), (select v from fx where k='lawyer'), 'lawyer');
insert into matters (firm_id, reference, title, type) values ((select v from fx where k='firm'), 'NA-M-2026-000001', 'Next v Action', 'litigation');
insert into fx select 'matter', id from matters where reference = 'NA-M-2026-000001';
insert into matter_parties (matter_id, firm_id, user_id, role) values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');

do $$
declare f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter');
        lw uuid := (select v from fx where k='lawyer'); cl uuid := (select v from fx where k='client'); ok bool;
begin
  perform t_as(lw);
  update matters set next_action = 'File the written address', next_action_owner_id = lw, next_action_due = date '2026-09-30' where id = m;
  perform t_check('a lawyer gives the next action an owner and a due day', (select next_action_owner_id = lw and next_action_due = date '2026-09-30' from matters where id = m));
  perform t_check('the due day reads back as the day that was written, not shifted', (select next_action_due::text = '2026-09-30' from matters where id = m));
  perform t_check('a due day still ahead is not overdue', (select next_actions_overdue = 0 from firm_overview where firm_id = f));
  update matters set next_action_due = current_date - 1 where id = m;
  perform t_check('a due day that has passed is counted on the overview', (select next_actions_overdue = 1 from firm_overview where firm_id = f));
  update matters set closed_at = current_date where id = m;
  perform t_check('but not on a closed matter', (select next_actions_overdue = 0 from firm_overview where firm_id = f));
  update matters set closed_at = null where id = m;
  perform t_reset();

  perform t_as(cl, 'aal1');
  perform t_check('the client reads the next action and its due day', (select next_action_due is not null from matters where id = m));
  ok := t_refused(format('update matters set next_action_due = null where id = %L', m), '42501');
  perform t_check('and cannot change it', ok or (select next_action_due is not null from matters where id = m));
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
