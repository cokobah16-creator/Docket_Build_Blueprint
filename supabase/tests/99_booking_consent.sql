-- Consent before booking (migration 52): record_consent(p_firm, p_terms_version, p_privacy_version)
-- writes the caller's acceptance of a firm's terms and privacy notice, once, and only for the
-- caller, and only when the versions the caller was shown are the versions the firm has published.
-- It refuses a stale version (DKC01) and writes nothing, and it refuses anon, a firm that is not
-- active, and a firm whose versions are missing or still a '0-' draft. Rolls back.
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
begin execute 'reset role'; perform set_config('request.jwt.claims', '', false); end $$;
create or replace function t_check(name text, ok bool) returns void language plpgsql as $$
begin if ok then raise notice 'PASS  %', name; else raise exception 'FAIL  %', name; end if; end $$;
create or replace function t_refused(stmt text, code text) returns bool language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlstate = code; end $$;
create or replace function t_fails(stmt text, fragment text) returns bool language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlerrm like '%' || fragment || '%'; end $$;

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
grant select on fx to anon, authenticated;
insert into firms (slug, name, reference_prefix, status, policies) values
  ('bc-firm',      'Consent Chambers', 'BC', 'active',
     jsonb_build_object('terms',   jsonb_build_object('version', '2026-09-t', 'text', 'Terms.'),
                        'privacy', jsonb_build_object('version', '2026-09-p', 'text', 'Privacy.'))),
  ('bc-draft',     'Draft Chambers',   'BD', 'active',
     jsonb_build_object('terms',   jsonb_build_object('version', '0-draft', 'text', 'To be published.'),
                        'privacy', jsonb_build_object('version', '2026-09', 'text', 'Privacy.'))),
  ('bc-draft-p',   'Half Chambers',    'BH', 'active',
     jsonb_build_object('terms',   jsonb_build_object('version', '2026-09', 'text', 'Terms.'),
                        'privacy', jsonb_build_object('version', '0-draft', 'text', 'To be published.'))),
  ('bc-empty',     'Empty Chambers',   'BE', 'active', '{}'::jsonb),
  ('bc-no-priv',   'Terms Chambers',   'BT', 'active',
     jsonb_build_object('terms',   jsonb_build_object('version', '2026-09', 'text', 'Terms.'))),
  ('bc-pending',   'Pending Chambers', 'BP', 'pending',
     jsonb_build_object('terms',   jsonb_build_object('version', '2026-09', 'text', 'Terms.'),
                        'privacy', jsonb_build_object('version', '2026-09', 'text', 'Privacy.'))),
  ('bc-suspended', 'Paused Chambers',  'BS', 'suspended',
     jsonb_build_object('terms',   jsonb_build_object('version', '2026-09', 'text', 'Terms.'),
                        'privacy', jsonb_build_object('version', '2026-09', 'text', 'Privacy.')));
insert into fx select replace(slug, 'bc-', ''), id from firms where slug like 'bc-%';
insert into auth.users (id, email) values (gen_random_uuid(), 'bc-client-a@test'), (gen_random_uuid(), 'bc-client-b@test');
insert into fx select 'client_a', id from auth.users where email = 'bc-client-a@test';
insert into fx select 'client_b', id from auth.users where email = 'bc-client-b@test';

-- ---------------------------------------------------------------- the function's shape and grants
do $$
declare fn regprocedure := 'public.record_consent(uuid, text, text)'::regprocedure;
begin
  perform t_check('record_consent is security definer',
    (select prosecdef from pg_proc where oid = fn));
  perform t_check('with its search_path pinned to public',
    (select proconfig @> array['search_path=public'] from pg_proc where oid = fn));
  perform t_check('its arguments are the firm and the two versions shown: no user',
    pg_get_function_identity_arguments(fn) = 'p_firm uuid, p_terms_version text, p_privacy_version text');
  perform t_check('and there is no form of it that takes the firm alone',
    to_regprocedure('public.record_consent(uuid)') is null);
  perform t_check('it reads the firm FOR SHARE, so a publish cannot land between its check and its insert',
    pg_get_functiondef(fn) ~* 'from firms f where f\.id = p_firm\s+for share');
  perform t_check('authenticated may execute it',
    has_function_privilege('authenticated', fn, 'execute'));
  perform t_check('anon may not',
    not has_function_privilege('anon', fn, 'execute'));
  perform t_check('and public holds no execute grant',
    not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'));
end $$;

-- ---------------------------------------------------------------- who may call it
do $$
declare f uuid := (select v from fx where k='firm');
begin
  perform t_anon();
  perform t_check('an anonymous visitor is refused',
    t_refused(format('select public.record_consent(%L, %L, %L)', f, '2026-09-t', '2026-09-p'), '42501'));
  perform t_reset();

  perform set_config('request.jwt.claims', '{"role":"authenticated"}', false);
  perform set_config('role', 'authenticated', false);
  perform t_check('a session with no user in it is refused as not authenticated',
    t_refused(format('select public.record_consent(%L, %L, %L)', f, '2026-09-t', '2026-09-p'), '42501'));
  perform t_reset();

  perform t_check('and neither wrote a row',
    not exists (select 1 from consent_records where firm_id = f));
end $$;

-- ---------------------------------------------------------------- recording, once, at the current versions
do $$
declare f uuid := (select v from fx where k='firm'); a uuid := (select v from fx where k='client_a');
        b uuid := (select v from fx where k='client_b'); r jsonb; n int;
begin
  perform t_as(a, 'aal1');
  r := public.record_consent(f, '2026-09-t', '2026-09-p');
  perform t_reset();

  perform t_check('a client at aal1 records a terms row at the version the firm published',
    (select count(*) = 1 from consent_records where user_id = a and firm_id = f and kind = 'terms' and version = '2026-09-t'));
  perform t_check('and a privacy row at the privacy version',
    (select count(*) = 1 from consent_records where user_id = a and firm_id = f and kind = 'privacy' and version = '2026-09-p'));
  perform t_check('and nothing else: exactly two rows',
    (select count(*) = 2 from consent_records where user_id = a and firm_id = f));
  perform t_check('each carries when it was accepted',
    not exists (select 1 from consent_records where user_id = a and firm_id = f and accepted_at is null));
  perform t_check('it returns the versions it recorded and the rows it wrote',
    r ->> 'terms_version' = '2026-09-t' and r ->> 'privacy_version' = '2026-09-p' and (r ->> 'rows_written')::int = 2);
  perform t_check('one consent.recorded audit line names the firm, the caller and both versions',
    (select count(*) = 1 from audit_log where action = 'consent.recorded' and firm_id = f and actor_id = a
        and meta ->> 'terms_version' = '2026-09-t' and meta ->> 'privacy_version' = '2026-09-p'));

  -- the same acceptance again is the same acceptance
  perform t_as(a, 'aal1');
  r := public.record_consent(f, '2026-09-t', '2026-09-p');
  perform t_reset();
  perform t_check('calling it again writes nothing',
    (select count(*) = 2 from consent_records where user_id = a and firm_id = f) and (r ->> 'rows_written')::int = 0);
  perform t_check('and writes no second audit line',
    (select count(*) = 1 from audit_log where action = 'consent.recorded' and firm_id = f and actor_id = a));

  -- the firm publishes new terms. A client still holding the page that showed the old version is
  -- refused, and nothing is written for them: they never saw version 2026-10-t.
  update firms set policies = jsonb_set(policies, '{terms,version}', '"2026-10-t"') where id = f;
  select count(*) into n from audit_log where action = 'consent.recorded' and firm_id = f;
  perform t_as(a, 'aal1');
  perform t_check('after the firm publishes new terms, accepting the old terms version is refused as stale (DKC01)',
    t_refused(format('select public.record_consent(%L, %L, %L)', f, '2026-09-t', '2026-09-p'), 'DKC01'));
  perform t_check('with words that say the firm changed them',
    t_fails(format('select public.record_consent(%L, %L, %L)', f, '2026-09-t', '2026-09-p'), 'has changed its terms or privacy notice'));
  perform t_check('a stale privacy version is refused the same way',
    t_refused(format('select public.record_consent(%L, %L, %L)', f, '2026-10-t', '2026-08-p'), 'DKC01'));
  perform t_check('and so is a version that was never given',
    t_refused(format('select public.record_consent(%L, %L, %L)', f, '2026-10-t', null), 'DKC01'));
  perform t_reset();
  perform t_check('a stale acceptance writes no row: the client is not on record for 2026-10-t',
    (select count(*) = 2 from consent_records where user_id = a and firm_id = f)
    and not exists (select 1 from consent_records where user_id = a and firm_id = f and version = '2026-10-t'));
  perform t_check('and no consent.recorded audit line',
    (select count(*) = n from audit_log where action = 'consent.recorded' and firm_id = f));

  -- the client reloads, is shown 2026-10-t, and accepts it: only the new terms version is new
  perform t_as(a, 'aal1');
  r := public.record_consent(f, '2026-10-t', '2026-09-p');
  perform t_reset();
  perform t_check('after the firm publishes new terms, one terms row at the new version is added',
    (select count(*) = 1 from consent_records where user_id = a and firm_id = f and kind = 'terms' and version = '2026-10-t')
    and (r ->> 'rows_written')::int = 1 and r ->> 'terms_version' = '2026-10-t');
  perform t_check('and the privacy acceptance, whose version did not change, is not repeated',
    (select count(*) = 1 from consent_records where user_id = a and firm_id = f and kind = 'privacy'));
  perform t_check('the earlier terms row is kept',
    (select count(*) = 1 from consent_records where user_id = a and firm_id = f and kind = 'terms' and version = '2026-09-t'));

  -- another client, the same firm
  select count(*) into n from consent_records where user_id = a;
  perform t_as(b, 'aal1');
  perform public.record_consent(f, '2026-10-t', '2026-09-p');
  perform t_check('another client records their own acceptance',
    (select count(*) = 2 from consent_records where user_id = b and firm_id = f));
  perform t_check('and cannot insert an acceptance in somebody else''s name',
    t_refused(format($q$insert into consent_records (user_id, firm_id, kind, version) values (%L, %L, 'terms', '2026-10-t')$q$, a, f), '42501'));
  perform t_reset();
  perform t_check('so the first client''s rows are exactly as they were',
    (select count(*) = n from consent_records where user_id = a));
  perform t_check('every row the function wrote was written by the person it names',
    (select count(*) = 5 from consent_records c join audit_log l on l.entity = 'consent_records' and l.entity_id = c.id
      where c.firm_id = f and l.action = 'consent_records.insert')
    and not exists (select 1 from consent_records c join audit_log l on l.entity = 'consent_records' and l.entity_id = c.id
                     where c.firm_id = f and l.actor_id is distinct from c.user_id));
end $$;

-- ---------------------------------------------------------------- refusals
-- Each firm is called with the versions it actually stores, so what is refused is the firm's state,
-- not a mismatch: a caller cannot get a '0-' draft recorded by naming it.
do $$
declare a uuid := (select v from fx where k='client_a');
begin
  perform t_as(a, 'aal1');
  perform t_check('a firm whose terms are still a 0- draft is refused, even when the caller names the draft',
    t_fails(format('select public.record_consent(%L, %L, %L)', (select v from fx where k='draft'), '0-draft', '2026-09'), 'has not published its terms and privacy notice'));
  perform t_check('so is one whose privacy notice is still a 0- draft',
    t_fails(format('select public.record_consent(%L, %L, %L)', (select v from fx where k='draft-p'), '2026-09', '0-draft'), 'has not published its terms and privacy notice'));
  perform t_check('a firm with no terms or privacy version at all is refused',
    t_fails(format('select public.record_consent(%L, %L, %L)', (select v from fx where k='empty'), null, null), 'has not published its terms and privacy notice'));
  perform t_check('and so is an empty version, even when the caller sends the same empty string',
    t_fails(format('select public.record_consent(%L, %L, %L)', (select v from fx where k='empty'), '', ''), 'has not published its terms and privacy notice'));
  perform t_check('a firm with terms but no privacy version is refused',
    t_fails(format('select public.record_consent(%L, %L, %L)', (select v from fx where k='no-priv'), '2026-09', null), 'has not published its terms and privacy notice'));
  perform t_check('a firm that is still pending is refused',
    t_fails(format('select public.record_consent(%L, %L, %L)', (select v from fx where k='pending'), '2026-09', '2026-09'), 'not active'));
  perform t_check('a suspended firm is refused',
    t_fails(format('select public.record_consent(%L, %L, %L)', (select v from fx where k='suspended'), '2026-09', '2026-09'), 'not active'));
  perform t_check('an unknown firm is refused',
    t_fails(format('select public.record_consent(%L, %L, %L)', gen_random_uuid(), '2026-09', '2026-09'), 'not active'));
  perform t_reset();

  perform t_check('and no refused call wrote a row',
    not exists (select 1 from consent_records c join fx on fx.v = c.firm_id
                 where fx.k in ('draft', 'draft-p', 'empty', 'no-priv', 'pending', 'suspended')));
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
