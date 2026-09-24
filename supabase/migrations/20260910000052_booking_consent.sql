-- Consent before booking, first pass: record_consent(p_firm) (legal readiness item 6).
--
-- WHAT WAS WRONG. A client's acceptance of a firm's terms and privacy notice was a plain insert
-- into consent_records from the browser's session. The only rule on it is the insert policy of
-- migration 21, user_id = auth.uid(), so the VERSION was whatever the request said: a hidden input
-- on the portal gate, which anybody can edit, and nothing checked it against the version the firm
-- had published. The booking wizard asked for no consent at all, so intake answers, files and a
-- payment were taken before any acceptance was recorded.
--
-- WHAT THIS ADDS. One definer function, record_consent(p_firm). It takes no version and no user:
--  · the user is auth.uid(), so nobody can record an acceptance for somebody else;
--  · the versions are the ones in firms.policies for that firm at the moment of the call, so the
--    row says what the firm had actually published, not what a form claimed;
--  · it refuses when nobody is signed in, when the firm is missing or not active, and when either
--    version is missing or is still a '0-' draft (firm_policies_published(), migration 15, the same
--    gate book_appointment() uses);
--  · it writes a 'terms' row and a 'privacy' row, and writes nothing when this person already
--    holds a row for that kind at that version for that firm, so pressing the button twice is one
--    acceptance. An advisory lock on (user, firm) makes that true for two presses at once too;
--  · it writes one audit line, consent.recorded, when it wrote anything. The audit_row_change()
--    trigger on consent_records (migration 3) still writes its own line per row.
-- It returns the versions it recorded, so the caller can check they are the ones it showed.
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

create or replace function public.record_consent(p_firm uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_status text; v_terms text; v_privacy text; v_new int := 0;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select f.status, f.policies -> 'terms' ->> 'version', f.policies -> 'privacy' ->> 'version'
    into v_status, v_terms, v_privacy
    from firms f where f.id = p_firm;
  if not found or v_status <> 'active' then raise exception 'this firm is not active on Docket'; end if;
  if not firm_policies_published(p_firm) then
    raise exception 'this firm has not published its terms and privacy notice yet';
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

revoke execute on function public.record_consent(uuid) from public, anon;
grant execute on function public.record_consent(uuid) to authenticated;
