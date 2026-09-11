-- Receipts are per reader, "seen by the other side" is one honest column, and "who owes the
-- reply" is derived. Old messages keep counting the old way. Run alone or with the others. Rolls back.
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

-- ---------------------------------------------------------------- fixture: a firm, two lawyers, a client on a matter
create temp table fx (k text primary key, v uuid);
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values
  (gen_random_uuid(), 'reads-a@test'), (gen_random_uuid(), 'reads-b@test'), (gen_random_uuid(), 'reads-client@test'), (gen_random_uuid(), 'reads-stranger@test');
insert into fx select 'a',        id from auth.users where email = 'reads-a@test';
insert into fx select 'b',        id from auth.users where email = 'reads-b@test';
insert into fx select 'client',   id from auth.users where email = 'reads-client@test';
insert into fx select 'stranger', id from auth.users where email = 'reads-stranger@test';
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'), (select v from fx where k='a'), 'lawyer'),
  ((select v from fx where k='firm'), (select v from fx where k='b'), 'lawyer');
insert into matters (firm_id, reference, title, type, handling_lawyer_id)
  values ((select v from fx where k='firm'), 'RC-M-2026-000001', 'Reads v Counting', 'litigation', (select v from fx where k='a'));
insert into fx select 'matter', id from matters where reference = 'RC-M-2026-000001';
insert into matter_parties (matter_id, firm_id, user_id, role) values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');

-- ---------------------------------------------------------------- 1. an old message counts the old way
do $$
declare f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter'); cl uuid := (select v from fx where k='client');
        a uuid := (select v from fx where k='a'); b uuid := (select v from fx where k='b'); old_id uuid;
begin
  -- A row as the migration left every message that predates receipts: reads_tracked false, set
  -- at insert because the immutability trigger (rightly) refuses to change it afterwards.
  insert into messages (firm_id, matter_id, sender_id, body, reads_tracked) values (f, m, cl, 'from before receipts', false) returning id into old_id;
  perform t_as(a);
  perform t_check('an untracked message is unread for one lawyer', (select unread_for_me = 1 from firm_threads where matter_id = m));
  perform t_reset(); perform t_as(b);
  perform t_check('and for the other', (select unread_for_me = 1 from firm_threads where matter_id = m));
  perform t_check('the thread is waiting on the firm', (select not last_from_firm from firm_threads where matter_id = m));
  perform t_reset(); perform t_as(a);
  perform mark_thread_read(m, null);
  perform t_check('one lawyer reading it clears it firm-wide, as it always did', (select unread_for_me = 0 from firm_threads where matter_id = m));
  perform t_reset(); perform t_as(b);
  perform t_check('for the other lawyer too — no receipt was invented for the past', (select unread_for_me = 0 from firm_threads where matter_id = m));
  perform t_check('and no receipt exists for it', not exists (select 1 from message_reads where message_id = old_id));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. a new message is read per person
do $$
declare f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter'); cl uuid := (select v from fx where k='client');
        a uuid := (select v from fx where k='a'); b uuid := (select v from fx where k='b'); m1 uuid; n int;
begin
  perform t_as(cl, 'aal1');
  insert into messages (firm_id, matter_id, sender_id, body) values (f, m, cl, 'please advise') returning id into m1;
  perform t_reset();
  perform t_check('a new message is tracked', (select reads_tracked from messages where id = m1));
  perform t_as(a);
  perform t_check('unread for lawyer A', (select unread_for_me = 1 from firm_threads where matter_id = m));
  perform t_check('and Today counts it for A', (select unread_messages = 1 from firm_overview where firm_id = f));
  perform t_check('and the firm owes a reply', (select threads_awaiting_reply = 1 from firm_overview where firm_id = f));
  select mark_thread_read(m, null) into n;
  perform t_check('A reads it: one new receipt', n = 1);
  perform t_check('A has nothing unread', (select unread_for_me = 0 from firm_threads where matter_id = m));
  perform t_check('and Today says 0 for A', (select unread_messages = 0 from firm_overview where firm_id = f));
  perform t_reset(); perform t_as(b);
  perform t_check('B still has it unread — A reading it is not B reading it', (select unread_for_me = 1 from firm_threads where matter_id = m));
  perform t_check('Today says 1 for B', (select unread_messages = 1 from firm_overview where firm_id = f));
  perform t_check('the firm still owes the reply, whoever has read it', (select threads_awaiting_reply = 1 from firm_overview where firm_id = f));
  perform t_check('B sees that A read it', exists (select 1 from message_reads where message_id = m1 and user_id = a));
  perform t_reset(); perform t_as(cl, 'aal1');
  perform t_check('the client sees their message was seen by the firm', (select read_at is not null from messages where id = m1));
  perform t_check('but not which lawyer read it', not exists (select 1 from message_reads where message_id = m1 and user_id = a));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. the firm replies; the client reads
do $$
declare f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter'); cl uuid := (select v from fx where k='client');
        a uuid := (select v from fx where k='a'); m2 uuid;
begin
  perform t_as(a);
  -- A second later than the client's message: inside one transaction now() is the transaction's
  -- start, so every insert here shares created_at and "who spoke last" would be decided by uuid.
  -- In service each message is its own request and the instants differ; the suite must not tie.
  insert into messages (firm_id, matter_id, sender_id, body, created_at) values (f, m, a, 'advised', now() + interval '1 second') returning id into m2;
  perform t_check('the firm spoke last: nothing owed', (select last_from_firm from firm_threads where matter_id = m));
  perform t_check('Today: no thread awaiting reply', (select threads_awaiting_reply = 0 from firm_overview where firm_id = f));
  perform t_check('a lawyer does not count their own message as unread', (select unread_for_me = 0 from firm_threads where matter_id = m));
  perform t_reset(); perform t_as(cl, 'aal1');
  perform t_check('the client has one unread', (select unread_for_me = 1 from firm_threads where matter_id = m));
  perform mark_thread_read(m, null);
  perform t_check('the client reads it', (select unread_for_me = 0 from firm_threads where matter_id = m));
  perform t_check('and the lawyer''s message shows read', (select read_at is not null from messages where id = m2));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. the doors
do $$
declare m uuid := (select v from fx where k='matter'); cl uuid := (select v from fx where k='client'); st uuid := (select v from fx where k='stranger');
        m1 uuid := (select id from messages where body = 'please advise'); ok bool;
begin
  perform t_as(cl, 'aal1');
  ok := t_refused(format('insert into message_reads (message_id, user_id) values (%L, %L)', m1, cl), '42501');
  perform t_check('a receipt cannot be written directly — mark_thread_read() is the door', ok);
  perform t_reset(); perform t_as(st, 'aal1');
  ok := t_refused(format('select mark_thread_read(%L, null)', m), '42501');
  perform t_check('a stranger cannot mark a thread they cannot read', ok);
  perform t_check('nor see it', not exists (select 1 from firm_threads where matter_id = m));
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
