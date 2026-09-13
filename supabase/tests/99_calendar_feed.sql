-- A subscribed calendar shows one person's diary, and the wall holds inside it.
--
-- A feed URL is a bearer credential that will sit in a phone's settings and a calendar provider's
-- fetchers, so the assertions that matter are about what it does NOT carry: a colleague's
-- consultations, a matter walled to a team this person is not on, a client's name unless they
-- deliberately asked for it, and anything at all once the token is rotated or the person leaves.
--
-- The wall is the sharpest of these. can_see_matter() asks about auth.uid() and there is no session
-- when a calendar app fetches a URL, so migration 47 writes the same test out against the feed's
-- owner. A wall that holds through the app and not through a calendar is not a wall, and this suite
-- is where that is checked.
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

/** How many entries of a kind a token's feed carries. */
create or replace function t_feed(tok text, k text) returns int language sql stable as $$
  select count(*)::int from calendar_feed_events(tok) where k is null or kind = k
$$;

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
grant select, insert on fx to anon, authenticated;
create temp table tk (k text primary key, v text);
grant select, insert on tk to anon, authenticated;

insert into firms (slug, name, reference_prefix, status) values ('cal-firm', 'Calendar Chambers', 'CC', 'active');
insert into fx select 'firm', id from firms where slug = 'cal-firm';
insert into auth.users (id, email) values
  (gen_random_uuid(),'cf-a@test'), (gen_random_uuid(),'cf-b@test'), (gen_random_uuid(),'cf-client@test'), (gen_random_uuid(),'cf-owner@test');
insert into fx select 'a',      id from auth.users where email='cf-a@test';
insert into fx select 'b',      id from auth.users where email='cf-b@test';
insert into fx select 'client', id from auth.users where email='cf-client@test';
insert into fx select 'owner',  id from auth.users where email='cf-owner@test';
update profiles set full_name = 'Folake Adeniran' where id = (select v from fx where k='client');
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'), (select v from fx where k='a'),     'lawyer'),
  ((select v from fx where k='firm'), (select v from fx where k='b'),     'lawyer'),
  ((select v from fx where k='firm'), (select v from fx where k='owner'), 'owner');

-- A's matter, and a second one that will be walled to B's team.
insert into matters (firm_id, reference, title, type, suit_number, court_name) values
  ((select v from fx where k='firm'), 'CC-M-2026-000001', 'Adeniran v Zenith', 'litigation', 'LD/1234/2026', 'High Court of Lagos State'),
  ((select v from fx where k='firm'), 'CC-M-2026-000002', 'The walled one',    'litigation', 'LD/5678/2026', 'High Court of Lagos State');
insert into fx select 'open',   id from matters where reference = 'CC-M-2026-000001';
insert into fx select 'walled', id from matters where reference = 'CC-M-2026-000002';
insert into matter_parties (matter_id, firm_id, user_id, role)
  values ((select v from fx where k='open'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');
insert into court_events (matter_id, firm_id, scheduled_at, court_name, purpose) values
  ((select v from fx where k='open'),   (select v from fx where k='firm'), now() + interval '10 days', 'High Court of Lagos State', 'Mention'),
  ((select v from fx where k='walled'), (select v from fx where k='firm'), now() + interval '11 days', 'High Court of Lagos State', 'Hearing');
insert into services (firm_id, slug, name, price_minor, currency, duration_min, is_active)
  values ((select v from fx where k='firm'), 'consult', 'Consultation', 0, 'NGN', 30, true);
insert into appointments (firm_id, reference, client_id, lawyer_id, service_id, mode, status, starts_at, ends_at, currency)
  values ((select v from fx where k='firm'), 'CC-2026-000001', (select v from fx where k='client'), (select v from fx where k='a'),
          (select id from services where firm_id = (select v from fx where k='firm')), 'virtual', 'confirmed',
          now() + interval '3 days', now() + interval '3 days 30 minutes', 'NGN');

-- ---------------------------------------------------------------- 1. issuing one, for yourself only
do $$
declare a uuid := (select v from fx where k='a'); f uuid := (select v from fx where k='firm'); r jsonb;
begin
  perform t_as(a, 'aal1');
  perform t_check('a member without a second factor cannot issue a feed',
    t_refused(format('select issue_calendar_feed(%L)', f), '42501'));
  perform t_reset(); perform t_as(a);
  r := issue_calendar_feed(f);
  insert into tk select 'a', r ->> 'token';
  insert into fx select 'feed_a', (r ->> 'id')::uuid;
  perform t_check('the token is 32 random bytes, shown once', length(r ->> 'token') = 64);
  perform t_reset();
  perform t_check('and the token itself is not stored — only its hash',
    (select token_hash from calendar_feeds where id = (select v from fx where k='feed_a'))
      = encode(sha256(convert_to((select v from tk where k='a'), 'UTF8')), 'hex')
    and not exists (select 1 from calendar_feeds where token_hash = (select v from tk where k='a')));
  perform t_check('issuing is audited', exists (select 1 from audit_log where action = 'calendar_feed.issued' and firm_id = f));
end $$;

-- ---------------------------------------------------------------- 2. what the diary carries
do $$
declare tok text := (select v from tk where k='a'); r record;
begin
  perform t_reset();
  -- Two sittings exist and neither matter is walled yet; the wall comes in section 3.
  perform t_check('the firm''s court sittings are there', t_feed(tok, 'court') = 2);
  perform t_check('...and A''s own consultation',      t_feed(tok, 'appointment') = 1);
  select * into r from calendar_feed_events(tok) where kind = 'court';
  perform t_check('a sitting names its purpose and the matter''s reference, not the client',
    r.summary = 'Mention: CC-M-2026-000001' and coalesce(r.description, '') not like '%Adeniran%');
  perform t_check('...and carries the court as its location', r.location = 'High Court of Lagos State');
  perform t_check('...and the suit number, which is not private and is what a lawyer looks for',
    r.description like '%LD/1234/2026%');
  select * into r from calendar_feed_events(tok) where kind = 'appointment';
  perform t_check('a consultation is named by its reference while client names are off',
    r.summary like '%CC-2026-000001%' and r.summary not like '%Folake%');
  perform t_check('nothing privileged is anywhere in the feed',
    not exists (select 1 from calendar_feed_events(tok) e
                 where coalesce(e.description, '') || e.summary like '%Zenith%'));
end $$;

-- ---------------------------------------------------------------- 3. THE WALL, through a URL with no session
do $$
declare a uuid := (select v from fx where k='a'); b uuid := (select v from fx where k='b');
        ow uuid := (select v from fx where k='owner'); f uuid := (select v from fx where k='firm');
        w uuid := (select v from fx where k='walled'); tok text := (select v from tk where k='a'); r jsonb;
begin
  perform t_reset();
  perform t_check('before the wall, A sees both sittings', t_feed(tok, 'court') = 2);

  update firms set matter_walls = true where id = f;
  -- B raises the wall on their own matter: migration 33 refuses a wall raised by somebody who
  -- would be locked out by it, which is the guard doing its job rather than the test being awkward.
  perform t_as(b);
  insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values (w, f, b, true);
  update matters set access = 'team' where id = w;
  perform t_reset();
  perform t_check('the matter really is walled to B''s team', (select access = 'team' from matters where id = w));

  perform t_check('A''s feed loses the walled sitting, with no session anywhere in the request',
    t_feed(tok, 'court') = 1);
  perform t_check('...and it is the walled one that went',
    not exists (select 1 from calendar_feed_events(tok) e where e.summary like '%CC-M-2026-000002%'));

  -- B, who is on that team, gets it in theirs. Otherwise "A sees one" would be equally true of a
  -- feed that had simply broken.
  perform t_as(b);
  r := issue_calendar_feed(f);
  insert into tk select 'b', r ->> 'token';
  perform t_reset();
  perform t_check('B, who is on the team, has the walled sitting in their own feed',
    exists (select 1 from calendar_feed_events(r ->> 'token') e where e.summary like '%CC-M-2026-000002%'));
  perform t_check('...and B does not have A''s consultation, because a diary is one person''s',
    (select count(*) from calendar_feed_events(r ->> 'token') e where e.kind = 'appointment') = 0);
end $$;

-- ---------------------------------------------------------------- 4. a client's name is a deliberate choice
do $$
declare a uuid := (select v from fx where k='a'); f uuid := (select v from fx where k='firm'); r jsonb; tok text;
begin
  perform t_reset(); perform t_as(a);
  r := issue_calendar_feed(f, true);
  tok := r ->> 'token';
  insert into tk select 'a_named', tok;
  perform t_reset();
  perform t_check('asked for, a client''s name appears',
    exists (select 1 from calendar_feed_events(tok) e where e.kind = 'appointment' and e.summary like '%Folake Adeniran%'));
  perform t_check('...and the matter''s title with it',
    exists (select 1 from calendar_feed_events(tok) e where e.kind = 'court' and e.description like '%Adeniran v Zenith%'));
  -- Issuing again rotated the feed, which is what somebody who has lost a phone expects.
  perform t_check('the previous token stops working the moment a new one is issued',
    t_refused(format('select * from calendar_feed_events(%L)', (select v from tk where k='a')), '42501'));
  perform t_check('...and the old row is kept, revoked, rather than deleted',
    (select revoked_at is not null from calendar_feeds where id = (select v from fx where k='feed_a')));
end $$;

-- ---------------------------------------------------------------- 5. a deadline is a day, and a confirmed one
do $$
declare a uuid := (select v from fx where k='a'); f uuid := (select v from fx where k='firm');
        m uuid := (select v from fx where k='open'); tok text := (select v from tk where k='a_named'); d record;
begin
  perform t_reset();
  insert into deadlines (firm_id, matter_id, title, trigger_kind, trigger_on, due_on, status, rule_name)
  values (f, m, 'File the written address', 'hearing_held', current_date, current_date + 21, 'confirmed', 'High Court Civil Procedure Rules');
  insert into deadlines (firm_id, matter_id, title, trigger_kind, trigger_on, due_on, status)
  values (f, m, 'Not yet confirmed', 'hearing_held', current_date, current_date + 22, 'proposed');

  perform t_check('a confirmed deadline is in the diary',      t_feed(tok, 'deadline') = 1);
  select * into d from calendar_feed_events(tok) where kind = 'deadline';
  perform t_check('...as a calendar DAY, not an instant that a timezone could move',
    d.day = current_date + 21 and d.starts_at is null);
  perform t_check('...and a proposed one is not, because it is not yet the firm''s word',
    not exists (select 1 from calendar_feed_events(tok) e where e.summary like '%Not yet confirmed%'));
end $$;

-- ---------------------------------------------------------------- 6. what a token stops opening
do $$
declare a uuid := (select v from fx where k='a'); ow uuid := (select v from fx where k='owner');
        f uuid := (select v from fx where k='firm'); tok text := (select v from tk where k='a_named'); fid uuid;
begin
  perform t_reset();
  perform t_check('an unknown token opens nothing',
    t_refused('select * from calendar_feed_events(''0000000000000000000000000000000000000000000000000000000000000000'')', '42501'));
  perform t_check('a short string is refused before it is hashed',
    t_refused('select * from calendar_feed_events(''short'')', '42501'));

  -- A firm suspended: its diaries stop with it.
  update firms set status = 'suspended' where id = f;
  perform t_check('a suspended firm''s feed opens nothing', t_refused(format('select * from calendar_feed_events(%L)', tok), '42501'));
  update firms set status = 'active' where id = f;

  -- Somebody who has left keeps no diary, even holding the URL.
  delete from firm_members where firm_id = f and user_id = a;
  perform t_check('a member who has left the firm has no diary, whatever they still hold',
    t_refused(format('select * from calendar_feed_events(%L)', tok), '42501'));
  insert into firm_members (firm_id, user_id, role) values (f, a, 'lawyer');

  -- An administrator can end a colleague's feed; a colleague cannot end theirs.
  select id into fid from calendar_feeds where user_id = a and revoked_at is null;
  perform t_as((select v from fx where k='b'));
  perform t_check('a colleague cannot revoke somebody else''s feed', t_refused(format('select revoke_calendar_feed(%L)', fid), '42501'));
  perform t_reset(); perform t_as(ow);
  perform revoke_calendar_feed(fid);
  perform t_reset();
  perform t_check('an administrator can, and it stops at once',
    t_refused(format('select * from calendar_feed_events(%L)', tok), '42501'));
  perform t_check('...and that is audited as somebody else''s act',
    exists (select 1 from audit_log where action = 'calendar_feed.revoked' and (meta ->> 'by_self') = 'false'));
end $$;

-- ---------------------------------------------------------------- 7. the doors
do $$
declare a uuid := (select v from fx where k='a'); f uuid := (select v from fx where k='firm');
begin
  perform t_as(a);
  perform t_check('no member may write a feed row by hand',
    t_refused(format('insert into calendar_feeds (firm_id, user_id, token_hash) values (%L, %L, ''x'')', f, a), '42501'));
  perform t_check('nor read anybody else''s',
    not exists (select 1 from calendar_feeds where user_id = (select v from fx where k='b')));
  perform t_check('nor call the feed function directly, however signed in they are',
    t_refused('select * from calendar_feed_events(''0000000000000000000000000000000000000000000000000000000000000000'')', '42501'));
  perform t_check('their own status is theirs to read, and carries no token',
    pg_get_function_result('public.calendar_feed_status(uuid)'::regprocedure) not like '%token%');
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
