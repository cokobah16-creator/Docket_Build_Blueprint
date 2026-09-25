-- Consent before booking, first pass: record_consent(p_firm, p_terms_version, p_privacy_version)
-- (legal readiness item 6).
--
-- WHAT WAS WRONG. A client's acceptance of a firm's terms and privacy notice was a plain insert
-- into consent_records from the browser's session. The only rule on it is the insert policy of
-- migration 21, user_id = auth.uid(), so the VERSION was whatever the request said: a hidden input
-- on the portal gate, which anybody can edit, and nothing checked it against the version the firm
-- had published. The booking wizard asked for no consent at all, so intake answers, files and a
-- payment were taken before any acceptance was recorded.
--
-- WHAT THIS ADDS. One definer function, record_consent(p_firm, p_terms_version, p_privacy_version).
-- The two versions are the ones the client was shown beside the boxes. It takes no user:
--  · the user is auth.uid(), so nobody can record an acceptance for somebody else;
--  · it reads the firm's row FOR SHARE and checks the two versions it was given against the ones
--    stored in firms.policies. When either differs, it refuses with SQLSTATE DKC01 and writes
--    nothing. So a client is never on record for a version they were not shown: the page that drew
--    the boxes can be older than the firm's last publish (the tenant resolver caches the firm for a
--    minute), and the app cannot find that out after the rows are written, only before;
--  · FOR SHARE holds the row until this transaction ends. A publish that commits first is what
--    this call reads; a publish that starts later waits for this call to finish. So the versions
--    checked are the versions written, and a firm moving back to a '0-' draft cannot slip in
--    between the check and the insert;
--  · it refuses when nobody is signed in, when the firm is missing or not active, and when either
--    stored version is missing, empty or still a '0-' draft. That is firm_policies_published()'s
--    test (migration 15, the gate book_appointment() uses), made here on the row this call locked
--    rather than in a second statement that reads the firm again;
--  · it writes a 'terms' row and a 'privacy' row, and writes nothing when this person already
--    holds a row for that kind at that version for that firm, so pressing the button twice is one
--    acceptance. An advisory lock on (user, firm) makes that true for two presses at once too;
--  · it writes one audit line, consent.recorded, when it wrote anything. The audit_row_change()
--    trigger on consent_records (migration 3) still writes its own line per row.
-- It returns the versions it recorded and how many rows it wrote.
--
-- Clients never hold MFA, so this is granted to authenticated at aal1. Recording your own
-- acceptance is not a staff write. anon and public are revoked.
--
-- WHAT THIS DOES NOT DO YET, AND WHY. The deployed frontend on main still inserts into
-- consent_records directly (the portal gate), and main's compat suite asserts that a client at aal1
-- can. So this migration does NOT drop consent_records_insert or revoke insert on the table, and
-- it does NOT change book_appointment()'s signature or body. The app on this branch records
-- consent through record_consent() before it books; the database does not yet refuse a booking
-- without it. Both steps come in a later migration, once no deployed code inserts directly.

create or replace function public.record_consent(p_firm uuid, p_terms_version text, p_privacy_version text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_status text; v_terms text; v_privacy text; v_new int := 0;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  -- FOR SHARE: a publish (an update of this row) waits until this call has written its rows, so
  -- the versions checked below are the versions written.
  select f.status, f.policies -> 'terms' ->> 'version', f.policies -> 'privacy' ->> 'version'
    into v_status, v_terms, v_privacy
    from firms f where f.id = p_firm
    for share;
  if not found or v_status <> 'active' then raise exception 'this firm is not active on Docket'; end if;

  -- firm_policies_published()'s test, on the row read above.
  if coalesce(v_terms, '') = '' or coalesce(v_privacy, '') = ''
     or v_terms like '0-%' or v_privacy like '0-%' then
    raise exception 'this firm has not published its terms and privacy notice yet';
  end if;

  -- The client accepts what they were shown, or nothing is recorded.
  if p_terms_version is distinct from v_terms or p_privacy_version is distinct from v_privacy then
    raise exception 'the firm has changed its terms or privacy notice since they were shown'
      using errcode = 'DKC01',
            detail = format('shown terms %s, privacy %s; published terms %s, privacy %s',
                            coalesce(p_terms_version, 'none'), coalesce(p_privacy_version, 'none'), v_terms, v_privacy);
  end if;

  -- One caller, one firm, one acceptance at a time: two presses at once must not both find no row
  -- and both insert.
  perform pg_advisory_xact_lock(hashtextextended('record_consent:' || v_user::text || ':' || p_firm::text, 0));

  insert into consent_records (user_id, firm_id, kind, version)
  select v_user, p_firm, k.kind, k.version
    from (values ('terms'::consent_kind, v_terms), ('privacy'::consent_kind, v_privacy)) as k(kind, version)
   where not exists (select 1 from consent_records c
                      where c.user_id = v_user and c.firm_id = p_firm and c.kind = k.kind and c.version = k.version);
  get diagnostics v_new = row_count;

  if v_new > 0 then
    perform audit('consent.recorded', 'consent_records', null, p_firm,
                  jsonb_build_object('terms_version', v_terms, 'privacy_version', v_privacy, 'rows_written', v_new));
  end if;

  return jsonb_build_object('terms_version', v_terms, 'privacy_version', v_privacy, 'rows_written', v_new);
end $$;

revoke execute on function public.record_consent(uuid, text, text) from public, anon;
grant execute on function public.record_consent(uuid, text, text) to authenticated;
