-- Docket Network: two separate firms register, one invites the other's official email, the code
-- proves the email was received and grants nothing, an authorised member accepts, the two firms
-- are connected, they work one authorised matter together, and ending the connection closes
-- every door while leaving the lead firm's records exactly as they were.
--
-- The assertions that matter are the refusals: a wrong code, a locked code, a code entered by a
-- stranger, a firm that is not verified, a member without the permission, a firm that is not
-- connected reading nothing, and a connection that has ended sharing nothing.
--
-- Run alone or with the others. Rolls back.
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
/** The code and the token, read out of the outbox as postgres: the only place they exist in clear.
 *  Every row in this suite shares one now(), so the LIVE email is found by matching its token's hash
 *  to the invitation that is still pending, not by created_at. */
create or replace function t_secrets(p_email text) returns table (code text, token text) language sql as $$
  select substring(e.body from 'Verification code: ([A-Z0-9]{4}-[A-Z0-9]{4})'),
         substring(e.link_path from 'token=([0-9a-f]{64})')
    from outbound_emails e
    join network_invitations i
      on i.token_hash = encode(sha256(convert_to(substring(e.link_path from 'token=([0-9a-f]{64})'), 'UTF8')), 'hex')
   where e.to_email = p_email and i.status = 'pending'
   limit 1
$$;

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
grant select, insert on fx to anon, authenticated;
insert into auth.users (id, email) values
  (gen_random_uuid(), 'nw-a-owner@lagoschambers.test'), (gen_random_uuid(), 'nw-a-staff@lagoschambers.test'),
  (gen_random_uuid(), 'nw-a-client@test'),
  (gen_random_uuid(), 'nw-b-owner@londonlaw.test'), (gen_random_uuid(), 'nw-b-lawyer@londonlaw.test'),
  (gen_random_uuid(), 'nw-c-owner@accrapartners.test'),
  (gen_random_uuid(), 'nw-stranger@elsewhere.test'), (gen_random_uuid(), 'nw-platform@test');
insert into fx select 'a_owner',  id from auth.users where email = 'nw-a-owner@lagoschambers.test';
insert into fx select 'a_staff',  id from auth.users where email = 'nw-a-staff@lagoschambers.test';
insert into fx select 'client',   id from auth.users where email = 'nw-a-client@test';
insert into fx select 'b_owner',  id from auth.users where email = 'nw-b-owner@londonlaw.test';
insert into fx select 'b_lawyer', id from auth.users where email = 'nw-b-lawyer@londonlaw.test';
insert into fx select 'c_owner',  id from auth.users where email = 'nw-c-owner@accrapartners.test';
insert into fx select 'stranger', id from auth.users where email = 'nw-stranger@elsewhere.test';
insert into fx select 'platform', id from auth.users where email = 'nw-platform@test';
insert into platform_admins (user_id, note) values ((select v from fx where k = 'platform'), 'network test');

-- Three firms register themselves, each by its own owner, the way any firm does.
do $$
declare r jsonb;
begin
  perform t_as((select v from fx where k = 'a_owner'));
  r := create_firm('Lagos Chambers', 'lagos-chambers', p_state_code => 'LA');
  insert into fx select 'firm_a', (r ->> 'firm_id')::uuid;
  perform t_reset();
  perform t_as((select v from fx where k = 'b_owner'));
  r := create_firm('London Law', 'london-law');
  insert into fx select 'firm_b', (r ->> 'firm_id')::uuid;
  perform t_reset();
  perform t_as((select v from fx where k = 'c_owner'));
  r := create_firm('Accra Partners', 'accra-partners');
  insert into fx select 'firm_c', (r ->> 'firm_id')::uuid;
  perform t_reset();
end $$;
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k = 'firm_a'), (select v from fx where k = 'a_staff'), 'staff'),
  ((select v from fx where k = 'firm_b'), (select v from fx where k = 'b_lawyer'), 'lawyer');
update profiles set email = 'nw-a-staff@lagoschambers.test' where id = (select v from fx where k = 'a_staff');
-- A matter at firm A, with its client and a document with a checksummed version.
insert into matters (firm_id, reference, title, type, suit_number, court_name)
  values ((select v from fx where k = 'firm_a'), 'LC-FIX-000001', 'Okoro v Thames Shipping', 'litigation', 'FHC/L/CS/44/2026', 'Federal High Court, Lagos');
insert into fx select 'matter', id from matters where reference = 'LC-FIX-000001';
insert into matter_parties (matter_id, firm_id, user_id, role)
  values ((select v from fx where k = 'matter'), (select v from fx where k = 'firm_a'), (select v from fx where k = 'client'), 'client');
insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by) values
  (gen_random_uuid(), (select v from fx where k = 'firm_a'), (select v from fx where k = 'matter'), 'bill-of-lading.pdf', 'evidence', true, (select v from fx where k = 'a_owner'));
insert into fx select 'doc', id from documents where name = 'bill-of-lading.pdf';
insert into document_versions (id, document_id, storage_path, mime, size_bytes, checksum, uploaded_by)
  values (gen_random_uuid(), (select v from fx where k = 'doc'),
          (select v from fx where k = 'firm_a') || '/' || (select v from fx where k = 'doc') || '/v1.pdf', 'application/pdf', 1024, repeat('c', 64), (select v from fx where k = 'a_owner'));
insert into fx select 'v1', id from document_versions where document_id = (select v from fx where k = 'doc');

-- ---------------------------------------------------------------- 1. an unverified firm cannot invite; a verified one can, within its permissions
do $$
declare a uuid := (select v from fx where k = 'firm_a'); b uuid := (select v from fx where k = 'firm_b'); c uuid := (select v from fx where k = 'firm_c'); r jsonb;
begin
  perform t_as((select v from fx where k = 'a_owner'));
  perform t_check('a firm Docket has not verified cannot invite',
    t_fails(format($q$select invite_firm(%L, 'partners@londonlaw.test', 'We have a shipping matter with a London defendant.')$q$, a), 'must be verified'));
  perform t_reset();
  perform t_as((select v from fx where k = 'platform'));
  perform set_firm_status(a, 'active', 'test'); perform set_firm_status(b, 'active', 'test'); perform set_firm_status(c, 'active', 'test');
  perform t_reset();
  perform t_as((select v from fx where k = 'a_staff'));
  perform t_check('a staff member without invite_firms cannot invite',
    t_refused(format($q$select invite_firm(%L, 'partners@londonlaw.test', 'We have a shipping matter with a London defendant.')$q$, a), '42501'));
  perform t_reset();
  perform t_as((select v from fx where k = 'a_owner'));
  perform t_check('an invitation says why',
    t_fails(format($q$select invite_firm(%L, 'partners@londonlaw.test', 'hi')$q$, a), 'at least ten characters'));
  perform t_check('an invitation to your own firm''s member is refused',
    t_fails(format($q$select invite_firm(%L, 'nw-a-staff@lagoschambers.test', 'We have a shipping matter with a London defendant.')$q$, a), 'your own firm'));
  r := invite_firm(a, 'Partners@LondonLaw.test', 'We have a shipping matter with a London defendant and need local counsel.', 'Ngozi Okafor');
  insert into fx select 'inv1', (r ->> 'invitation_id')::uuid;
  perform t_check('the invitation returns an id and an expiry, and no secret',
    (r ->> 'invitation_id') is not null and (r ->> 'expires_at')::timestamptz > now() + interval '71 hours' and not (r ? 'code') and not (r ? 'token'));
  perform t_check('the inviting firm reads its own invitation, lowercased, with the snapshot',
    (select to_email = 'partners@londonlaw.test' and from_firm_name = 'Lagos Chambers' and from_representative = 'Ngozi Okafor' and status = 'pending'
       from network_invitations where id = (select v from fx where k = 'inv1')));
  perform t_check('but never the hashes',
    t_refused(format($q$select code_hash from network_invitations where id = %L$q$, (select v from fx where k = 'inv1')), '42501'));
  perform t_check('a second open invitation to the same address is refused',
    t_fails(format($q$select invite_firm(%L, 'partners@londonlaw.test', 'We have a shipping matter with a London defendant.')$q$, a), 'already open'));
  perform t_reset();
  perform t_check('the email is in the outbox with the code and the link, for the dispatcher alone',
    (select count(*) from outbound_emails where to_email = 'partners@londonlaw.test' and kind = 'network_invitation'
       and body like '%Verification code: %' and link_path like '/network/join?token=%') = 1);
  perform t_check('the code is eight characters from the unambiguous alphabet',
    (select code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$' from t_secrets('partners@londonlaw.test')));
  perform t_as((select v from fx where k = 'b_owner'));
  perform t_check('no API role reads the outbox',
    t_refused($q$select body from outbound_emails$q$, '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. the code is single use, bounded, and proves only an email
do $$
declare a uuid := (select v from fx where k = 'firm_a'); inv uuid := (select v from fx where k = 'inv1'); s record; r jsonb; i int; wrong text;
begin
  select * into s from t_secrets('partners@londonlaw.test');
  perform t_anon();
  perform t_check('a visitor cannot verify',
    t_refused(format($q$select verify_network_invitation(%L, %L)$q$, s.token, s.code), '42501'));
  perform t_reset();
  perform t_as((select v from fx where k = 'b_owner'));
  perform t_check('a link that is not a link is refused',
    t_fails($q$select verify_network_invitation('nonsense', 'ABCD-EFGH')$q$, 'not valid'));
  perform t_check('an unknown token is refused in the same words',
    t_fails(format($q$select verify_network_invitation(%L, 'ABCD-EFGH')$q$, repeat('0', 64)), 'not valid'));
  wrong := case when s.code = 'ABCD-EFGH' then 'JKLM-NPQR' else 'ABCD-EFGH' end;
  r := verify_network_invitation(s.token, wrong);
  perform t_check('a wrong code is an answer, not an error',
    r ->> 'status' = 'wrong_code' and (r ->> 'attempts_left')::int = 4);
  perform t_reset();
  perform t_check('...and it is counted on the row',
    (select attempts from network_invitations where id = inv) = 1);
  perform t_as((select v from fx where k = 'b_owner'));
  for i in 1..4 loop
    r := verify_network_invitation(s.token, wrong);
  end loop;
  perform t_check('five wrong codes lock the invitation', r ->> 'status' = 'locked' and (r ->> 'attempts_left')::int = 0);
  r := verify_network_invitation(s.token, s.code);
  perform t_check('...even for the right code', r ->> 'status' = 'locked');
  perform t_reset();

  -- The inviting firm resends: a fresh code and token, the old ones dead, attempts reset.
  perform t_as((select v from fx where k = 'a_owner'));
  r := resend_network_invitation(inv);
  perform t_check('a resend mints a fresh code and resets the count',
    (r ->> 'resends')::int = 1 and (select attempts = 0 and resends = 1 from network_invitations where id = inv));
  perform t_reset();
  perform t_check('the old token is dead',
    (select t_fails(format($q$select verify_network_invitation(%L, %L)$q$, s.token, s.code), 'not valid') from (select t_as((select v from fx where k = 'b_owner'))) x));
  perform t_reset();
  select * into s from t_secrets('partners@londonlaw.test');
  perform t_as((select v from fx where k = 'stranger'));
  r := verify_network_invitation(s.token, lower(s.code));
  perform t_check('whoever holds the link and the code proves the email, case aside',
    r ->> 'status' = 'verified' and r ->> 'from_firm_name' = 'Lagos Chambers' and r ->> 'reason' like 'We have a shipping matter%');
  perform t_check('the same person entering it again is told the same thing, and nothing is counted',
    (verify_network_invitation(s.token, s.code) ->> 'status') = 'verified');
  perform t_reset();
  perform t_check('and the code is spent on the row',
    (select status = 'verified' and code_hash = 'used' and attempts = 0 and verified_by = (select v from fx where k = 'stranger') from network_invitations where id = inv));
  perform t_as((select v from fx where k = 'b_owner'));
  perform t_check('anybody else entering it is told it is spoken for',
    t_fails(format($q$select verify_network_invitation(%L, %L)$q$, s.token, s.code), 'already been verified by somebody else'));
  perform t_check('a verification by a stranger cannot be claimed by a firm the stranger is not in',
    t_fails(format($q$select respond_network_invitation(%L, %L, true)$q$, inv, (select v from fx where k = 'firm_b')), 'not a member of that firm'));
  perform t_reset();
  perform t_as((select v from fx where k = 'stranger'));
  perform t_check('verifying grants the stranger nothing',
    not exists (select 1 from firm_connections) and not exists (select 1 from network_directory));
  perform t_reset();
  -- The inviting firm withdraws that one and starts again with the right address.
  perform t_as((select v from fx where k = 'a_owner'));
  perform revoke_network_invitation(inv, 'sent to the wrong person');
  perform t_check('a withdrawn invitation is revoked', (select status from network_invitations where id = inv) = 'revoked');
  r := invite_firm(a, 'nw-b-owner@londonlaw.test', 'We have a shipping matter with a London defendant and need local counsel.');
  insert into fx select 'inv2', (r ->> 'invitation_id')::uuid;
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. the receiving firm accepts, and the two are connected
do $$
declare a uuid := (select v from fx where k = 'firm_a'); b uuid := (select v from fx where k = 'firm_b'); inv uuid := (select v from fx where k = 'inv2'); s record; r jsonb; conn uuid;
begin
  perform t_check('a member already on Docket is told in the app as well',
    exists (select 1 from notifications where user_id = (select v from fx where k = 'b_owner') and event = 'network_invitation_received'));
  select * into s from t_secrets('nw-b-owner@londonlaw.test');
  perform t_as((select v from fx where k = 'b_lawyer'));
  r := verify_network_invitation(s.token, s.code);
  perform t_check('a lawyer at the receiving firm enters the code', r ->> 'status' = 'verified');
  perform t_check('the receiving firm sees it waiting for an answer',
    exists (select 1 from network_incoming where id = inv and my_firm_id = b));
  perform t_reset();
  perform t_as((select v from fx where k = 'b_owner'));
  perform set_member_permissions(b, (select v from fx where k = 'b_lawyer'), '{"invite_firms": false}');
  perform t_reset();
  perform t_as((select v from fx where k = 'b_lawyer'));
  perform t_check('but a lawyer whose firm withheld invite_firms cannot answer',
    t_refused(format($q$select respond_network_invitation(%L, %L, true)$q$, inv, b), '42501'));
  perform t_reset();
  perform t_as((select v from fx where k = 'b_owner'));
  perform set_member_permissions(b, (select v from fx where k = 'b_lawyer'), '{"invite_firms": null}');
  perform t_check('the firm cannot accept into the inviting firm''s own name',
    t_refused(format($q$select respond_network_invitation(%L, %L, true)$q$, inv, a), '42501'));
  perform upsert_network_profile(b, '{"official_email": "partners@londonlaw.test", "country_code": "GB", "city": "London", "practice_areas": ["litigation", "corporate"], "languages": ["English"], "visibility": "network"}');
  r := respond_network_invitation(inv, b, true);
  conn := (r ->> 'connection_id')::uuid;
  insert into fx select 'conn', conn;
  perform t_check('the invited domain matched the firm''s own, so the connection is active at once', r ->> 'status' = 'active');
  perform t_check('the invitation is closed as accepted, naming the firm',
    (select status = 'accepted' and accepted_firm_id = b and connection_id = conn from network_invitations where id = inv));
  perform t_check('London sees Lagos among its connected firms',
    exists (select 1 from connected_firms where connection_id = conn and my_firm_id = b and other_firm_id = a and status = 'active'));
  perform t_reset();
  perform t_as((select v from fx where k = 'a_owner'));
  perform t_check('and Lagos sees London, with the contact details London chose to share',
    (select other_firm_name = 'London Law' and official_email = 'partners@londonlaw.test' and city = 'London'
       from connected_firms where connection_id = conn and my_firm_id = a));
  perform t_check('both firms were told',
    exists (select 1 from notifications where user_id = (select v from fx where k = 'a_owner') and event = 'network_connection_accepted'));
  r := invite_firm(a, 'nw-b-lawyer@londonlaw.test', 'Let us connect again, through your lawyer this time.');
  insert into fx select 'inv3', (r ->> 'invitation_id')::uuid;
  perform t_reset();
  perform t_check('and both audit trails say so',
    (select count(distinct firm_id) from audit_log where action = 'network.connected' and entity_id = conn) = 2);
  select * into s from t_secrets('nw-b-lawyer@londonlaw.test');
  perform t_as((select v from fx where k = 'b_lawyer'));
  perform verify_network_invitation(s.token, s.code);
  perform t_check('connecting two firms that are already connected is refused',
    t_fails(format($q$select respond_network_invitation(%L, %L, true)$q$, (select v from fx where k = 'inv3'), b), 'already connected'));
  perform t_reset();
  perform t_as((select v from fx where k = 'a_owner'));
  perform revoke_network_invitation((select v from fx where k = 'inv3'), 'already connected');
  perform t_reset();
  perform t_as((select v from fx where k = 'c_owner'));
  perform t_check('a third firm sees no connection it is not party to',
    not exists (select 1 from firm_connections) and not exists (select 1 from connected_firms));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. the directory shows what a firm chose to show, and nothing it did not
do $$
declare a uuid := (select v from fx where k = 'firm_a'); b uuid := (select v from fx where k = 'firm_b'); c uuid := (select v from fx where k = 'firm_c');
begin
  perform t_as((select v from fx where k = 'c_owner'));
  perform upsert_network_profile(c, '{"visibility": "private", "country_code": "GH", "city": "Accra", "official_email": "partners@accrapartners.test"}');
  perform t_reset();
  perform t_as((select v from fx where k = 'a_owner'));
  perform upsert_network_profile(a, '{"visibility": "network", "country_code": "NG", "city": "Lagos", "practice_areas": ["litigation", "arbitration"], "languages": ["English", "Yoruba"], "share_contacts": false, "official_email": "chambers@lagoschambers.test"}');
  perform t_check('Lagos finds London in the directory, and knows they are connected',
    (select connected and country_code = 'GB' and 'litigation' = any (practice_areas) from network_directory where firm_id = b));
  perform t_check('a private firm is not in the directory', not exists (select 1 from network_directory where firm_id = c));
  perform t_check('the directory carries no contact details',
    not exists (select 1 from information_schema.columns where table_name = 'network_directory' and column_name in ('official_email', 'telephone', 'office_address')));
  perform t_reset();
  perform t_as((select v from fx where k = 'b_owner'));
  perform t_check('a firm that keeps its contacts to itself shows London no email',
    (select official_email is null and contacts is null and city = 'Lagos' from connected_firms where my_firm_id = b and other_firm_id = a));
  perform t_check('a lawyer may not rewrite the firm''s network profile',
    (select t_refused(format($q$select upsert_network_profile(%L, '{"visibility": "private"}')$q$, b), '42501') from (select t_as((select v from fx where k = 'b_lawyer'))) x));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 5. a joint matter: a role, shared tasks, one named document
do $$
declare a uuid := (select v from fx where k = 'firm_a'); b uuid := (select v from fx where k = 'firm_b'); c uuid := (select v from fx where k = 'firm_c');
        m uuid := (select v from fx where k = 'matter'); col uuid; task uuid; v1 uuid := (select v from fx where k = 'v1');
begin
  perform t_as((select v from fx where k = 'a_owner'));
  perform t_check('a role that is not one of the six is refused',
    t_fails(format($q$select propose_collaboration(%L, %L, 'joint_counsel', 'Act as our London counsel on the arrest of the vessel.', true, null, 'captain')$q$, m, b), 'a role is'));
  col := propose_collaboration(m, b, 'joint_counsel', 'Act as our London counsel on the arrest of the vessel.', true, null, 'local_counsel');
  insert into fx select 'col', col;
  perform t_check('the lead firm proposes with a role', (select role from matter_collaborations where id = col) = 'local_counsel');
  perform t_reset();
  perform t_as((select v from fx where k = 'b_owner'));
  perform t_check('the other firm reads the role in its inbox', (select role from collaboration_inbox where id = col) = 'local_counsel');
  perform respond_to_collaboration(col, true);
  perform t_reset();
  perform t_as((select v from fx where k = 'a_owner'));
  perform t_check('the lead firm sees a joint matter with one participant',
    (select live_collaborations = 1 and participants -> 0 ->> 'firm_name' = 'London Law' and participants -> 0 ->> 'role' = 'local_counsel' from joint_matters where matter_id = m));
  task := create_collaboration_task(col, b, 'File the arrest application', 'Admiralty Court, by Friday.', current_date + 3);
  perform t_check('the lead firm sets London a task', (select assigned_firm_id = b and status = 'open' from collaboration_tasks where id = task));
  perform share_document_with_collaborator(col, v1);
  perform t_reset();
  perform t_as((select v from fx where k = 'b_lawyer'));
  perform t_check('London reads the task and the shared version',
    exists (select 1 from collaboration_tasks where id = task) and exists (select 1 from document_versions where id = v1));
  perform t_check('and not the matter itself', not exists (select 1 from matters where id = m));
  perform t_check('London cannot cancel a task it did not set',
    t_fails(format($q$select close_collaboration_task(%L, 'cancelled')$q$, task), 'only the firm that set'));
  perform close_collaboration_task(task, 'done');
  perform t_check('London marks it done', (select status from collaboration_tasks where id = task) = 'done');
  perform t_reset();
  perform t_as((select v from fx where k = 'c_owner'));
  perform t_check('a third firm sees none of it',
    not exists (select 1 from collaboration_tasks) and not exists (select 1 from joint_matters) and not exists (select 1 from document_versions where id = v1));
  perform t_reset();
  perform t_check('the client was told another firm is on the file',
    exists (select 1 from updates where matter_id = m and visibility = 'client' and title like 'London Law is now working%'));
end $$;

-- ---------------------------------------------------------------- 6. suspension stops new work; ending closes every door and keeps the records
do $$
declare a uuid := (select v from fx where k = 'firm_a'); b uuid := (select v from fx where k = 'firm_b'); conn uuid := (select v from fx where k = 'conn');
        m uuid := (select v from fx where k = 'matter'); col uuid := (select v from fx where k = 'col'); v1 uuid := (select v from fx where k = 'v1'); n_docs int; n_versions int; n_updates int;
begin
  perform t_as((select v from fx where k = 'b_owner'));
  perform set_connection_status(conn, b, 'suspended', 'Conflict check pending on our side.');
  perform t_reset();
  perform t_as((select v from fx where k = 'a_owner'));
  perform t_check('a suspended connection refuses new work',
    t_fails(format($q$select propose_collaboration(%L, %L, 'agency', 'Appear for us on Monday, please.')$q$, m, b), 'suspended'));
  perform t_check('and the other firm cannot lift a suspension it did not make',
    t_fails(format($q$select set_connection_status(%L, %L, 'active')$q$, conn, a), 'only the firm that suspended'));
  perform t_reset();
  perform t_as((select v from fx where k = 'b_owner'));
  perform set_connection_status(conn, b, 'active');
  perform t_check('the suspending firm lifts it', (select status from firm_connections where id = conn) = 'active');
  perform t_reset();

  select count(*) into n_docs from documents where firm_id = a; select count(*) into n_versions from document_versions dv join documents d on d.id = dv.document_id where d.firm_id = a;
  select count(*) into n_updates from updates where matter_id = m;
  perform t_as((select v from fx where k = 'a_owner'));
  perform set_connection_status(conn, a, 'ended', 'The matter has settled.');
  perform t_check('ending the connection ends the live collaboration the same second',
    (select ended_at is not null and end_reason like 'the connection between the firms ended%' from matter_collaborations where id = col) and not collaboration_live(col));
  perform t_check('the lead firm''s records are exactly as they were',
    (select count(*) from documents where firm_id = a) = n_docs
    and (select count(*) from document_versions dv join documents d on d.id = dv.document_id where d.firm_id = a) = n_versions
    and (select count(*) from updates where matter_id = m) = n_updates
    and exists (select 1 from matters where id = m and deleted_at is null));
  perform t_reset();
  perform t_as((select v from fx where k = 'b_lawyer'));
  perform t_check('London can no longer read the shared version, the tasks or the joint work',
    not exists (select 1 from document_versions where id = v1) and not exists (select 1 from collaboration_tasks) and not exists (select 1 from collaboration_updates where collaboration_id = col));
  perform t_check('an ended connection cannot be revived by either side',
    t_fails(format($q$select set_connection_status(%L, %L, 'active')$q$, conn, b), 'has ended'));
  perform t_reset();
  perform t_check('both firms were told it ended, with the count',
    exists (select 1 from notifications where user_id = (select v from fx where k = 'b_owner') and event = 'network_connection_ended' and (payload ->> 'collaborations_ended')::int = 1));
end $$;

-- ---------------------------------------------------------------- 7. review: an invited domain that matches nothing the firm said about itself
do $$
declare a uuid := (select v from fx where k = 'firm_a'); c uuid := (select v from fx where k = 'firm_c'); r jsonb; s record; inv uuid; conn uuid;
begin
  perform t_as((select v from fx where k = 'a_owner'));
  r := invite_firm(a, 'managing.partner@gmail.test', 'We would like to connect for Ghana referrals.');
  inv := (r ->> 'invitation_id')::uuid;
  perform t_reset();
  select * into s from t_secrets('managing.partner@gmail.test');
  perform t_as((select v from fx where k = 'c_owner'));
  perform verify_network_invitation(s.token, s.code);
  r := respond_network_invitation(inv, c, true);
  conn := (r ->> 'connection_id')::uuid;
  perform t_check('an address the firm never claimed puts the connection in review', r ->> 'status' = 'review');
  perform t_check('a connection in review counts as no connection',
    not firms_connected(a, c)
    and t_fails(format($q$select propose_alliance(%L, 'Ghana and Nigeria Group', array[%L]::uuid[])$q$, c, a), 'connected to'));
  perform t_check('and neither firm can activate it', t_fails(format($q$select set_connection_status(%L, %L, 'active')$q$, conn, c), 'in review'));
  perform t_reset();
  perform t_as((select v from fx where k = 'a_owner'));
  perform t_check('nor the platform without a second factor',
    (select t_refused(format($q$select review_connection(%L, true, 'checked')$q$, conn), '42501') from (select t_as((select v from fx where k = 'platform'), 'aal1')) x));
  perform t_reset();
  perform t_as((select v from fx where k = 'platform'));
  perform review_connection(conn, true, 'Checked against the Ghana Bar Association register.');
  perform t_check('the platform settles it', (select status = 'active' and reviewed_by = (select v from fx where k = 'platform') from firm_connections where id = conn));
  perform t_reset();
  perform t_check('and both firms are told', exists (select 1 from notifications where user_id = (select v from fx where k = 'c_owner') and event = 'network_connection_accepted'));
end $$;

-- ---------------------------------------------------------------- 8. introductions and alliances between connected firms
do $$
declare a uuid := (select v from fx where k = 'firm_a'); c uuid := (select v from fx where k = 'firm_c'); b uuid := (select v from fx where k = 'firm_b'); intro uuid; al uuid; note uuid;
begin
  perform t_as((select v from fx where k = 'a_owner'));
  intro := request_introduction(a, c, 'referral_request', 'A client needs a Ghanaian firm for a land registration in Accra; no client details here.', 'GH', 'property');
  perform t_check('a connected firm can be approached even when it is private in the directory', (select status from network_introductions where id = intro) = 'sent');
  perform t_check('a second open approach to the same firm is refused',
    t_fails(format($q$select request_introduction(%L, %L, 'introduction', 'Another one, while the first is open and unanswered.')$q$, a, c), 'already have an approach open'));
  perform t_reset();
  perform t_as((select v from fx where k = 'c_owner'));
  perform respond_introduction(intro, true, 'Gladly. Our property partner will write to you.');
  perform t_check('the approached firm answers', (select status = 'accepted' and response like 'Gladly%' from network_introductions where id = intro));
  perform t_reset();
  perform t_as((select v from fx where k = 'b_owner'));
  perform t_check('a firm not party to an approach reads nothing of it', not exists (select 1 from network_introductions where id = intro));
  perform t_check('an unconnected firm that keeps out of the directory cannot be approached',
    t_fails(format($q$select request_introduction(%L, %L, 'introduction', 'We would like to meet you in Accra, please and thank you.')$q$, b, c), 'cannot be reached'));
  perform t_reset();

  perform t_as((select v from fx where k = 'a_owner'));
  perform t_check('an alliance needs connected firms',
    t_fails(format($q$select propose_alliance(%L, 'West Africa Shipping Group', array[%L]::uuid[])$q$, a, b), 'connected to'));
  al := propose_alliance(a, 'West Africa Shipping Group', array[c], array['litigation', 'property'], array['NG', 'GH'], 'Referrals go to the member in the client''s jurisdiction; fees stay with the firm that does the work.');
  perform t_check('the founder is in and the alliance is proposed',
    (select status from firm_alliances where id = al) = 'proposed' and (select status from alliance_members where alliance_id = al and firm_id = a) = 'accepted');
  note := post_alliance_note(al, a, 'internal', 'Our own view: keep the Accra work under our conduct.');
  perform t_reset();
  perform t_as((select v from fx where k = 'c_owner'));
  perform t_check('the invited firm sees the proposal and not the other firm''s internal note',
    exists (select 1 from firm_alliances where id = al) and not exists (select 1 from alliance_notes where id = note));
  perform respond_alliance(al, c, true);
  perform t_check('two accepted firms make it active', (select status = 'active' and starts_on is not null from firm_alliances where id = al));
  perform post_alliance_note(al, c, 'shared', 'Agreed. Our property partner is the contact for Accra.');
  perform t_reset();
  perform t_as((select v from fx where k = 'a_owner'));
  perform t_check('a shared note reaches the founder', exists (select 1 from alliance_notes where alliance_id = al and visibility = 'shared' and firm_id = c));
  perform t_check('the dashboard counts it all',
    (select (o ->> 'connected')::int = 1 and (o ->> 'alliances_active')::int = 1 and (o ->> 'joint_matters')::int = 0 and (o ->> 'verified')::bool
       from network_overview(a) o));
  perform leave_or_terminate_alliance(al, a, true, 'Rolled into a formal partnership.');
  perform t_check('any member may terminate it for everybody', (select status = 'terminated' and terminated_by_firm_id = a from firm_alliances where id = al));
  perform t_reset();
  perform t_as((select v from fx where k = 'b_owner'));
  perform t_check('a firm outside the alliance reads nothing of it', not exists (select 1 from firm_alliances where id = al) and not exists (select 1 from alliance_notes where alliance_id = al));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 9. the outbox is the dispatcher's alone
do $$
declare n int; r record;
begin
  perform t_as((select v from fx where k = 'a_owner'));
  perform t_check('a signed in person cannot claim the outbox',
    t_refused($q$select * from claim_outbound_emails(5)$q$, '42501'));
  perform t_reset();
  select count(*) into n from claim_outbound_emails(50);
  perform t_check('the service role claims every queued email', n >= 3 and (select count(*) from outbound_emails where status = 'sending') = n);
  for r in select id from outbound_emails where status = 'sending' loop
    perform finish_outbound_email(r.id, 'sent', 'resend', 'msg_' || r.id::text);
  end loop;
  perform t_check('and finishes them', (select count(*) from outbound_emails where status = 'sent' and provider = 'resend') = n);
  perform t_check('every network act is audited',
    (select count(*) from audit_log where action like 'network.%') >= 12);
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
