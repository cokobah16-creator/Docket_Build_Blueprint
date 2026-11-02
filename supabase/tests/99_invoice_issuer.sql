-- Who issued an invoice (migration 59): invoice_issuer(p_invoice) gives the firm's name, legal name
-- and RC/BN, and its TIN only when the invoice charges VAT, to a caller whom can_access_invoice()
-- lets read the invoice: its client (a draft excepted), the firm's people inside any matter wall,
-- and a representative with the money right (99_delegation.sql). Everyone else, and an invoice
-- that does not exist, is refused in the same words, 42501 "not permitted"; anon is refused by the
-- grant before the function runs. The last check holds it to invoices_select for every caller and
-- every invoice here. The client's invoice page and PDF print the TIN from it, because firm_public
-- never carries one (migration 51). Rolls back.
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
-- The refusal in full, code and words, or null when the statement ran: "the same words" is a claim
-- about the message, not only the code.
create or replace function t_error(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
grant select on fx to anon, authenticated;
insert into firms (slug, name, legal_name, rc_number, tin, reference_prefix, vat_rate, status) values
  ('ii-firm',  'Issuer Chambers', 'Issuer Chambers LP', 'RC 1234567', '12345678-0001', 'II', 7.50, 'active'),
  ('ii-other', 'Other Chambers',  'Other Chambers LP',  'RC 7654321', '87654321-0001', 'IO', 7.50, 'active'),
  -- A firm that typed spaces into its identity fields: nothing printable, so nothing is returned.
  ('ii-blank', 'Blank Chambers',  '   ',                '  ',         '  ',            'IB', 7.50, 'active');
insert into fx select replace(slug, 'ii-', ''), id from firms where slug like 'ii-%';
insert into auth.users (id, email) values
  (gen_random_uuid(), 'ii-client@test'), (gen_random_uuid(), 'ii-client2@test'),
  (gen_random_uuid(), 'ii-inside@test'), (gen_random_uuid(), 'ii-outside@test'), (gen_random_uuid(), 'ii-elsewhere@test');
insert into fx select replace(split_part(email, '@', 1), 'ii-', ''), id from auth.users where email like 'ii-%@test';
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'),  (select v from fx where k='inside'),    'lawyer'),
  ((select v from fx where k='firm'),  (select v from fx where k='outside'),   'lawyer'),
  ((select v from fx where k='other'), (select v from fx where k='elsewhere'), 'lawyer');
insert into matters (firm_id, reference, title, type, handling_lawyer_id)
  values ((select v from fx where k='firm'), 'II-M-2026-000001', 'Issuer v Walled', 'litigation', (select v from fx where k='inside'));
insert into fx select 'matter', id from matters where reference = 'II-M-2026-000001';
-- A second client of the same firm, on a matter of their own, so that "another client of the same
-- firm" below is one.
insert into matters (firm_id, reference, title, type)
  values ((select v from fx where k='firm'), 'II-M-2026-000002', 'Issuer v Second', 'advisory');
insert into fx select 'matter2', id from matters where reference = 'II-M-2026-000002';
insert into matter_parties (matter_id, firm_id, user_id, role) values
  ((select v from fx where k='matter'),  (select v from fx where k='firm'), (select v from fx where k='client'),  'client'),
  ((select v from fx where k='matter2'), (select v from fx where k='firm'), (select v from fx where k='client2'), 'client');
-- Six invoices for the first client: a consultation fee with VAT and one without, a draft, a
-- cancelled one, one on the matter (walled below), and one from the firm with blank details. And
-- one for the second client.
insert into invoices (firm_id, matter_id, client_id, number, currency, subtotal_minor, vat_minor, total_minor, status, issued_at) values
  ((select v from fx where k='firm'),  null, (select v from fx where k='client'), 'II-INV-VAT',       'NGN', 3000000, 225000, 3225000, 'issued',    now()),
  ((select v from fx where k='firm'),  null, (select v from fx where k='client'), 'II-INV-NOVAT',     'NGN', 3000000, 0,      3000000, 'issued',    now()),
  ((select v from fx where k='firm'),  null, (select v from fx where k='client'), 'II-INV-DRAFT',     'NGN', 3000000, 225000, 3225000, 'draft',     null),
  ((select v from fx where k='firm'),  null, (select v from fx where k='client'), 'II-INV-CANCELLED', 'NGN', 3000000, 225000, 3225000, 'cancelled', now()),
  ((select v from fx where k='firm'),  (select v from fx where k='matter'),
                                             (select v from fx where k='client'), 'II-INV-MATTER',    'NGN', 4500000, 337500, 4837500, 'issued',    now()),
  ((select v from fx where k='blank'), null, (select v from fx where k='client'), 'II-INV-BLANK',     'NGN', 3000000, 225000, 3225000, 'issued',    now()),
  ((select v from fx where k='firm'),  null, (select v from fx where k='client2'), 'II-INV-CLIENT2',  'NGN', 3000000, 225000, 3225000, 'issued',    now());
insert into fx select lower(replace(number, 'II-INV-', 'inv_')), id from invoices where number like 'II-INV-%';

-- ---------------------------------------------------------------- the function's shape and grants
do $$
declare fn regprocedure := 'public.invoice_issuer(uuid)'::regprocedure;
begin
  perform t_check('invoice_issuer is security definer',
    (select prosecdef from pg_proc where oid = fn));
  perform t_check('with its search_path pinned to public',
    (select proconfig @> array['search_path=public'] from pg_proc where oid = fn));
  perform t_check('it takes the invoice and nothing else',
    pg_get_function_identity_arguments(fn) = 'p_invoice uuid');
  perform t_check('its one test is can_access_invoice(), the test the invoice''s own rows use',
    pg_get_functiondef(fn) ~ 'if not can_access_invoice\(p_invoice\) then');
  perform t_check('authenticated may execute it',
    has_function_privilege('authenticated', fn, 'execute'));
  perform t_check('anon may not',
    not has_function_privilege('anon', fn, 'execute'));
  perform t_check('and public holds no execute grant',
    not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'));
end $$;

-- ---------------------------------------------------------------- the invoice's client
-- At aal1: a client never holds MFA, and the invoice page and its PDF run as the client.
do $$
declare c uuid := (select v from fx where k='client'); r jsonb;
begin
  perform t_as(c, 'aal1');
  r := invoice_issuer((select v from fx where k='inv_vat'));
  perform t_check('the client gets the firm''s name',               r ->> 'name' = 'Issuer Chambers');
  perform t_check('...and its registered name',                    r ->> 'legal_name' = 'Issuer Chambers LP');
  perform t_check('...and its RC/BN',                              r ->> 'rc_number' = 'RC 1234567');
  perform t_check('...and its TIN, because the invoice charges VAT', r ->> 'tin' = '12345678-0001');

  r := invoice_issuer((select v from fx where k='inv_novat'));
  perform t_check('an invoice without VAT still names its issuer',  r ->> 'legal_name' = 'Issuer Chambers LP' and r ->> 'rc_number' = 'RC 1234567');
  perform t_check('...but carries no TIN',                          r ? 'tin' and r ->> 'tin' is null);

  r := invoice_issuer((select v from fx where k='inv_cancelled'));
  perform t_check('a cancelled VAT invoice keeps its issuer and TIN, as its PDF does', r ->> 'tin' = '12345678-0001');

  perform t_check('a draft is refused, as the draft itself is',
    t_refused(format('select invoice_issuer(%L)', (select v from fx where k='inv_draft')), '42501'));

  r := invoice_issuer((select v from fx where k='inv_blank'));
  perform t_check('a firm''s blank details come back as JSON nulls, not as spaces or missing keys',
    r is not null and r ?& array['name', 'legal_name', 'rc_number', 'tin']
    and jsonb_typeof(r -> 'legal_name') = 'null' and jsonb_typeof(r -> 'rc_number') = 'null'
    and jsonb_typeof(r -> 'tin') = 'null');
  perform t_check('...while its name, which a firm cannot leave blank, still comes back', r ->> 'name' = 'Blank Chambers');
  perform t_reset();

  -- firm_public hides a suspended firm. Its client still holds its invoices, and who issued them
  -- has not changed.
  update firms set status = 'suspended' where id = (select v from fx where k='firm');
  perform t_as(c, 'aal1');
  r := invoice_issuer((select v from fx where k='inv_vat'));
  perform t_check('a suspended firm''s client still learns who issued the invoice',
    r ->> 'name' = 'Issuer Chambers' and r ->> 'legal_name' = 'Issuer Chambers LP' and r ->> 'tin' = '12345678-0001');
  perform t_reset();
  update firms set status = 'active' where id = (select v from fx where k='firm');
end $$;

-- ---------------------------------------------------------------- everyone else
do $$
declare inv uuid := (select v from fx where k='inv_vat');
begin
  perform t_as((select v from fx where k='client2'), 'aal1');
  perform t_check('the second client is a client of the same firm',
    is_client_of_firm((select v from fx where k='firm')));
  perform t_check('...who reads who issued their own invoice',
    invoice_issuer((select v from fx where k='inv_client2')) ->> 'tin' = '12345678-0001');
  perform t_check('...and is refused on the first client''s, in the words "not permitted"',
    t_error(format('select invoice_issuer(%L)', inv)) = '42501 not permitted');
  perform t_check('an invoice that does not exist is refused in the same words, so an id cannot be probed',
    t_error(format('select invoice_issuer(%L)', gen_random_uuid())) = '42501 not permitted');
  perform t_check('and so is no invoice at all',
    t_error('select invoice_issuer(null)') = '42501 not permitted');
  perform t_reset();

  perform t_as((select v from fx where k='elsewhere'));
  perform t_check('a lawyer at another firm is refused in the same words',
    t_error(format('select invoice_issuer(%L)', inv)) = '42501 not permitted');
  perform t_reset();

  perform t_anon();
  perform t_check('anon cannot call it at all: the grant refuses it before the function runs',
    t_error(format('select invoice_issuer(%L)', inv)) like '42501 permission denied for function invoice_issuer%');
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- the firm's own people, and the wall
do $$
declare f uuid := (select v from fx where k='firm'); m uuid := (select v from fx where k='matter');
        inside uuid := (select v from fx where k='inside'); outside uuid := (select v from fx where k='outside');
        mi uuid := (select v from fx where k='inv_matter');
begin
  perform t_as(outside);
  perform t_check('a member of the firm reads who issued a consultation invoice',
    invoice_issuer((select v from fx where k='inv_vat')) ->> 'tin' = '12345678-0001');
  perform t_check('...and a matter''s invoice while the matter is open to the firm',
    invoice_issuer(mi) ->> 'legal_name' = 'Issuer Chambers LP');
  perform t_reset();

  update firms set matter_walls = true where id = f;
  insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values (m, f, inside, true);
  update matters set access = 'team' where id = m;

  perform t_as(outside);
  perform t_check('once the matter is walled, a colleague outside its team is refused',
    t_refused(format('select invoice_issuer(%L)', mi), '42501'));
  perform t_reset();
  perform t_as(inside);
  perform t_check('...while the matter''s own lawyer still reads it',
    invoice_issuer(mi) ->> 'tin' = '12345678-0001');
  perform t_reset();
  perform t_as((select v from fx where k='client'), 'aal1');
  perform t_check('...and so does the client, whom the wall does not concern',
    invoice_issuer(mi) ->> 'rc_number' = 'RC 1234567');
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- the same answer as the invoice's own row
-- invoice_issuer() asks can_access_invoice(); invoices_select carries the same predicate inline.
-- Should either change without the other, a client would be shown an invoice whose issuer is
-- refused, or be told who issued an invoice they cannot open. So for every caller here and every
-- invoice here, with the wall up: the function answers exactly when the row can be read.
do $$
declare who record; inv record; reads bool; err text; mismatches text[] := '{}';
begin
  for who in select k, v, case when k like 'client%' then 'aal1' else 'aal2' end as aal
               from fx where k in ('client', 'client2', 'inside', 'outside', 'elsewhere') order by k loop
    for inv in select k, v from fx where k like 'inv\_%' order by k loop
      perform t_as(who.v, who.aal);
      reads := exists (select 1 from invoices where id = inv.v);
      err := t_error(format('select invoice_issuer(%L)', inv.v));
      perform t_reset();
      if reads is distinct from (err is null) or err <> '42501 not permitted' then
        mismatches := mismatches || format('%s on %s: row %s, issuer %s', who.k, inv.k,
                                           case when reads then 'read' else 'hidden' end, coalesce(err, 'answered'));
      end if;
    end loop;
  end loop;
  perform t_check('for every caller and every invoice, it answers exactly when invoices_select shows the invoice'
                  || coalesce(': ' || nullif(array_to_string(mismatches, '; '), ''), ''),
                  cardinality(mismatches) = 0);
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
