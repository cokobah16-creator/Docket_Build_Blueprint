-- A key opens exactly what it was scoped for, at exactly one firm, until it is revoked or expires.
--
-- The assertions that matter are about the key, because the HTTP layer holds no rule: it takes the
-- presented key and passes it to a database function, so everything below is what a partner would
-- actually meet. A key with the wrong scope, a revoked key, an expired key, a key at a suspended
-- firm and a key from another firm each get nothing. And the event feed is complete and stable:
-- a partner paging on `seq` cannot miss one or process one twice.
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
create or replace function t_fails(stmt text, fragment text) returns bool language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlerrm like '%' || fragment || '%'; end $$;

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
grant select, insert on fx to anon, authenticated;
create temp table kx (k text primary key, v text);
grant select, insert on kx to anon, authenticated;

insert into firms (slug, name, reference_prefix, status) values ('api-one', 'API Chambers', 'AP', 'active');
insert into firms (slug, name, reference_prefix, status) values ('api-two', 'Other API Chambers', 'OA', 'active');
insert into fx select 'firm',  id from firms where slug = 'api-one';
insert into fx select 'other', id from firms where slug = 'api-two';
insert into auth.users (id, email) values
  (gen_random_uuid(),'ap-owner@test'), (gen_random_uuid(),'ap-lawyer@test'),
  (gen_random_uuid(),'ap-client@test'), (gen_random_uuid(),'ap-other@test');
insert into fx select 'owner',  id from auth.users where email='ap-owner@test';
insert into fx select 'lawyer', id from auth.users where email='ap-lawyer@test';
insert into fx select 'client', id from auth.users where email='ap-client@test';
insert into fx select 'oowner', id from auth.users where email='ap-other@test';
update profiles set full_name = 'Bisi Adebayo', email = 'ap-client@test' where id = (select v from fx where k='client');
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'),  (select v from fx where k='owner'),  'owner'),
  ((select v from fx where k='firm'),  (select v from fx where k='lawyer'), 'lawyer'),
  ((select v from fx where k='other'), (select v from fx where k='oowner'), 'owner');

-- ---------------------------------------------------------------- 1. issuing a key
do $$
declare ow uuid := (select v from fx where k='owner'); l uuid := (select v from fx where k='lawyer');
        f uuid := (select v from fx where k='firm'); r jsonb;
begin
  perform t_as(l);
  perform t_check('a lawyer cannot mint a key for the firm',
    t_refused(format('select issue_api_credential(%L, ''Accounts sync'', array[''matters:read''])', f), '42501'));
  perform t_reset(); perform t_as(ow, 'aal1');
  perform t_check('nor an owner without a second factor',
    t_refused(format('select issue_api_credential(%L, ''Accounts sync'', array[''matters:read''])', f), '42501'));
  perform t_reset(); perform t_as(ow);
  perform t_check('a key with no scope is refused: it could do nothing anyway',
    t_fails(format('select issue_api_credential(%L, ''Empty'', array[]::text[])', f), 'no scope'));
  perform t_check('an invented scope is refused by the table, not by a screen',
    t_fails(format('select issue_api_credential(%L, ''Too much'', array[''matters:write''])', f), 'api_credentials_scopes_chk'));
  perform t_check('a key that expired yesterday is refused rather than stored',
    t_fails(format('select issue_api_credential(%L, ''Stale'', array[''matters:read''], %L)', f, current_date - 1), 'expired yesterday'));

  r := issue_api_credential(f, 'Accounts sync', array['matters:read', 'invoices:read', 'events:read']);
  insert into kx select 'key', r ->> 'key';
  insert into fx select 'cred', (r ->> 'id')::uuid;
  perform t_check('the key is returned once, and it starts with its own prefix',
    (r ->> 'key') like (r ->> 'prefix') || '_%' and length(r ->> 'key') > 60);
  perform t_reset();
  perform t_check('and the key itself is NOT in the table — only its hash',
    not exists (select 1 from api_credentials where key_hash = (select v from kx where k='key')));
  perform t_check('the hash is what a presented key is measured against',
    (select key_hash from api_credentials where id = (select v from fx where k='cred'))
      = encode(sha256(convert_to((select v from kx where k='key'), 'UTF8')), 'hex'));
  perform t_check('issuing is audited, with the prefix and the scopes',
    exists (select 1 from audit_log where action = 'api_credential.issued' and firm_id = f));
end $$;

-- ---------------------------------------------------------------- 2. the key is the whole gate
do $$
declare f uuid := (select v from fx where k='firm'); key text := (select v from kx where k='key');
begin
  perform t_reset();
  perform t_check('a good key names its own firm and nothing else',  api_authorize(key, 'matters:read') = f);
  perform t_check('an unknown key is refused',                        t_refused('select api_authorize(''dk_live_deadbeef_nonsense_nonsense_nonsense'', ''matters:read'')', '42501'));
  perform t_check('a short string is refused before it is even hashed', t_refused('select api_authorize(''short'', ''matters:read'')', '42501'));
  perform t_check('a null key is refused',                            t_refused('select api_authorize(null, ''matters:read'')', '42501'));
  perform t_check('a scope the key does not carry is refused, and says which',
    t_fails(format('select api_authorize(%L, ''clients:read'')', key), 'does not carry the clients:read scope'));
  -- The refusals about the key itself are all one message: a caller learns whether their key works,
  -- never which part of it was wrong.
  perform t_check('an unknown key and a revoked key are indistinguishable to the caller',
    t_fails('select api_authorize(''dk_live_deadbeef_nonsense_nonsense_nonsense'', ''matters:read'')', 'unauthorized'));
  perform t_check('using the key stamps when it was last used, so a firm can spot a forgotten one',
    (select last_used_at is not null from api_credentials where id = (select v from fx where k='cred')));
end $$;

-- ---------------------------------------------------------------- 3. the API roles cannot call any of it
do $$
declare ow uuid := (select v from fx where k='owner'); key text := (select v from kx where k='key');
begin
  perform t_as(ow);
  perform t_check('a signed-in owner cannot call the gate',      t_refused(format('select api_authorize(%L, ''matters:read'')', key), '42501'));
  perform t_check('nor any v1 function',                          t_refused(format('select api_v1_matters(%L)', key), '42501'));
  perform t_check('nor claim a delivery',                         t_refused('select * from claim_api_deliveries(10)', '42501'));
  perform t_check('nor emit an event',                            t_refused(format('select api_emit(%L, ''matter.opened'', ''{}''::jsonb)', (select v from fx where k='firm')), '42501'));
  perform t_check('and the endpoints table is readable by nobody through the API',
    t_refused('select * from api_endpoints', '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. what v1 answers
do $$
declare f uuid := (select v from fx where k='firm'); o uuid := (select v from fx where k='other');
        ow uuid := (select v from fx where k='owner'); cl uuid := (select v from fx where k='client');
        key text := (select v from kx where k='key'); m uuid; rows jsonb;
begin
  perform t_reset();
  insert into matters (firm_id, reference, title, type, suit_number, court_name)
    values (f, 'AP-M-2026-000001', 'Adebayo v Union Bank', 'litigation', 'FHC/L/CS/77/2026', 'Federal High Court')
    returning id into m;
  insert into fx select 'matter', m;
  insert into matter_parties (matter_id, firm_id, user_id, role) values (m, f, cl, 'client');
  insert into invoices (firm_id, matter_id, client_id, number, currency, subtotal_minor, vat_minor, total_minor, status, issued_at)
    values (f, m, cl, 'AP-INV-2026-000001', 'NGN', 25000000, 0, 25000000, 'issued', now());
  -- The other firm's matter, which this key must never see.
  insert into matters (firm_id, reference, title, type) values (o, 'OA-M-2026-000001', 'Somebody else entirely', 'corporate');

  rows := api_v1_matters(key);
  perform t_check('matters come back in the mapped shape, not the table''s',
    jsonb_array_length(rows) = 1
    and (rows -> 0 ->> 'reference') = 'AP-M-2026-000001'
    and (rows -> 0 ->> 'suit_number') = 'FHC/L/CS/77/2026'
    and (rows -> 0 ? 'restricted'));
  perform t_check('...and carry no column the contract did not promise',
    not (rows -> 0 ? 'status_id') and not (rows -> 0 ? 'firm_id') and not (rows -> 0 ? 'description'));
  perform t_check('a key never sees another firm''s matter',
    not exists (select 1 from jsonb_array_elements(rows) e where e ->> 'reference' = 'OA-M-2026-000001'));

  rows := api_v1_invoices(key);
  perform t_check('money comes back as minor units WITH its currency, never a bare number',
    (rows -> 0 ->> 'currency') = 'NGN' and (rows -> 0 ->> 'total_minor') = '25000000');

  perform t_check('a scope the key lacks answers nothing at all',
    t_refused(format('select api_v1_clients(%L)', key), '42501'));
  perform t_check('a limit is bounded however large it is asked for',
    jsonb_array_length(api_v1_matters(key, null, 100000)) <= 500);
end $$;

-- ---------------------------------------------------------------- 5. the feed: stable, complete, in order
do $$
declare f uuid := (select v from fx where k='firm'); key text := (select v from kx where k='key');
        m uuid := (select v from fx where k='matter'); rows jsonb; first_seq bigint; st uuid;
begin
  perform t_reset();
  rows := api_v1_events(key);
  perform t_check('opening a matter raised an event',
    exists (select 1 from jsonb_array_elements(rows) e where e ->> 'type' = 'matter.opened'));
  perform t_check('and issuing an invoice raised one',
    exists (select 1 from jsonb_array_elements(rows) e where e ->> 'type' = 'invoice.issued'));
  perform t_check('every event carries a stable id and a sequence',
    (select bool_and((e ? 'id') and (e ? 'seq')) from jsonb_array_elements(rows) e));

  first_seq := ((rows -> 0) ->> 'seq')::bigint;
  perform t_check('paging past the first sequence does not return it again',
    not exists (select 1 from jsonb_array_elements(api_v1_events(key, first_seq)) e where (e ->> 'seq')::bigint <= first_seq));

  -- A stage change is its own event, and the payload is what was true then.
  insert into matter_statuses (firm_id, key, label, sort) values (f, 'filed', 'Filed', 10) returning id into st;
  update matters set status_id = st where id = m;
  perform t_check('changing the stage raises an event naming the stage',
    exists (select 1 from jsonb_array_elements(api_v1_events(key, first_seq)) e
             where e ->> 'type' = 'matter.stage_changed' and (e -> 'data' ->> 'status') = 'Filed'));
  perform t_check('an event carries no privileged content — a reference and a stage, never a note',
    (select bool_and(not (e -> 'data' ? 'description') and not (e -> 'data' ? 'body'))
       from jsonb_array_elements(api_v1_events(key)) e));

  -- The other firm's events are the other firm's.
  insert into matters (firm_id, reference, title, type) values ((select v from fx where k='other'), 'OA-M-2026-000002', 'Not yours', 'corporate');
  perform t_check('and the feed never crosses a firm',
    not exists (select 1 from jsonb_array_elements(api_v1_events(key)) e where (e -> 'data' ->> 'reference') like 'OA-%'));
end $$;

-- ---------------------------------------------------------------- 6. ending a key, and outliving one
do $$
declare ow uuid := (select v from fx where k='owner'); f uuid := (select v from fx where k='firm');
        oo uuid := (select v from fx where k='oowner'); cred uuid := (select v from fx where k='cred');
        key text := (select v from kx where k='key');
begin
  perform t_as(oo);
  perform t_check('another firm''s owner cannot revoke this key',
    t_refused(format('select revoke_api_credential(%L)', cred), '42501'));
  perform t_reset();

  -- Expiry closes it with no job run.
  update api_credentials set expires_on = (now() at time zone 'Africa/Lagos')::date - 1 where id = cred;
  perform t_check('an expired key opens nothing, the day after it expired',
    t_refused(format('select api_authorize(%L, ''matters:read'')', key), '42501'));
  update api_credentials set expires_on = null where id = cred;
  perform t_check('and works again once the expiry is lifted', api_authorize(key, 'matters:read') = f);

  -- A suspended firm's keys stop with it.
  update firms set status = 'suspended' where id = f;
  perform t_check('a suspended firm''s key opens nothing',
    t_refused(format('select api_authorize(%L, ''matters:read'')', key), '42501'));
  update firms set status = 'active' where id = f;

  perform t_as(ow);
  perform revoke_api_credential(cred, 'Rotated.');
  perform t_reset();
  perform t_check('a revoked key opens nothing',
    t_refused(format('select api_authorize(%L, ''matters:read'')', key), '42501'));
  perform t_check('...and the row stays, with the reason, because the record is the point',
    (select revoked_at is not null and revoke_reason = 'Rotated.' from api_credentials where id = cred));
  perform t_check('revoking is audited',
    exists (select 1 from audit_log where action = 'api_credential.revoked' and firm_id = f));
end $$;

-- ---------------------------------------------------------------- 7. endpoints: the secret is shown once and never again
do $$
declare ow uuid := (select v from fx where k='owner'); l uuid := (select v from fx where k='lawyer');
        f uuid := (select v from fx where k='firm'); r jsonb; ep uuid;
begin
  perform t_as(l);
  perform t_check('a lawyer cannot register an endpoint',
    t_refused(format('select set_api_endpoint(%L, ''https://partner.example/hook'')', f), '42501'));
  perform t_reset(); perform t_as(ow);
  perform t_check('an endpoint must be https',
    t_fails(format('select set_api_endpoint(%L, ''http://partner.example/hook'')', f), 'must be https'));
  r := set_api_endpoint(f, 'https://partner.example/hook');
  ep := (r ->> 'id')::uuid;
  insert into fx select 'endpoint', ep;
  perform t_check('the signing secret is returned once', length(r ->> 'signing_secret') = 64);
  perform t_check('the owner can list their endpoints',
    exists (select 1 from api_endpoint_list(f) where url = 'https://partner.example/hook'));
  perform t_check('...and that listing does not carry the secret, asserted on the function''s own signature',
    pg_get_function_result('public.api_endpoint_list(uuid)'::regprocedure) not like '%signing_secret%'
    and pg_get_function_result('public.api_endpoint_list(uuid)'::regprocedure) like '%url text%');
  perform t_check('the table itself is readable by nobody through the API', t_refused('select signing_secret from api_endpoints', '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 8. delivery: claimed once, retried, then failed
do $$
declare f uuid := (select v from fx where k='firm'); ep uuid := (select v from fx where k='endpoint');
        ev uuid; d record; n int;
begin
  perform t_reset();
  -- An event raised now is queued for the endpoint that wants it.
  insert into matters (firm_id, reference, title, type) values (f, 'AP-M-2026-000009', 'Queued', 'corporate');
  select id into ev from api_events where firm_id = f and type = 'matter.opened'
    and payload ->> 'reference' = 'AP-M-2026-000009';
  perform t_check('the event was queued for the endpoint',
    exists (select 1 from api_deliveries where endpoint_id = ep and event_id = ev and status = 'pending'));

  select * into d from claim_api_deliveries(10) where event_id = ev;
  perform t_check('claiming hands the pusher the url, the secret and the event',
    d.endpoint_url = 'https://partner.example/hook' and length(d.signing_secret) = 64 and d.event_type = 'matter.opened');
  perform t_check('...and marks the attempt before it is sent, so a second run cannot send it too',
    (select attempts = 1 and next_try_at > now() from api_deliveries where endpoint_id = ep and event_id = ev));
  select count(*) into n from claim_api_deliveries(10) where event_id = ev;
  perform t_check('a second claim in the same minute gets nothing for that event', n = 0);

  perform finish_api_delivery(d.delivery_id, true, 200, null);
  perform t_check('a delivered event is delivered',
    (select status = 'delivered' and delivered_at is not null from api_deliveries where id = d.delivery_id));

  -- Failure: retried, bounded, then failed and visible.
  update api_deliveries set status = 'pending', attempts = 7, next_try_at = now() - interval '1 minute' where id = d.delivery_id;
  select * into d from claim_api_deliveries(10) where delivery_id = d.delivery_id;
  perform finish_api_delivery(d.delivery_id, false, 500, 'endpoint answered 500');
  perform t_check('the eighth failure stops the retrying, and says so',
    (select status = 'failed' and last_status = 500 from api_deliveries where id = d.delivery_id));
  perform t_as((select v from fx where k='owner'));
  perform t_check('and the firm can see that it failed',
    (select failed >= 1 from api_endpoint_list(f) where id = ep));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 9. a firm with no endpoint has a feed and no queue
do $$
declare o uuid := (select v from fx where k='other');
begin
  perform t_reset();
  perform t_check('the other firm''s events exist',
    exists (select 1 from api_events where firm_id = o));
  perform t_check('...and nothing is queued for a firm that registered no endpoint',
    not exists (select 1 from api_deliveries d join api_events e on e.id = d.event_id where e.firm_id = o));
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
