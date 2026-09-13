-- A referral or a joint retainer opens exactly what was handed over, and not the file behind it.
--
-- The assertions that matter are the ones about what the other firm still cannot reach: the matter
-- row, the documents nobody shared, the later version of a document somebody did share, an internal
-- note, the client's messages, the invoices. And then the same list again after the arrangement
-- ends, because ending it is the only protection a firm has once it has brought somebody in.
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

insert into firms (slug, name, reference_prefix, status) values ('owner-firm', 'Instructing Chambers', 'IC', 'active');
insert into firms (slug, name, reference_prefix, status) values ('other-firm', 'Agent Chambers', 'AC', 'active');
insert into firms (slug, name, reference_prefix, status) values ('third-firm', 'Nothing To Do With It', 'NT', 'active');
insert into fx select 'firm',  id from firms where slug = 'owner-firm';
insert into fx select 'other', id from firms where slug = 'other-firm';
insert into fx select 'third', id from firms where slug = 'third-firm';
insert into auth.users (id, email) values
  (gen_random_uuid(),'cb-owner@test'), (gen_random_uuid(),'cb-agent@test'),
  (gen_random_uuid(),'cb-stranger@test'), (gen_random_uuid(),'cb-client@test');
insert into fx select 'lawyer',   id from auth.users where email='cb-owner@test';
insert into fx select 'agent',    id from auth.users where email='cb-agent@test';
insert into fx select 'stranger', id from auth.users where email='cb-stranger@test';
insert into fx select 'client',   id from auth.users where email='cb-client@test';
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'),  (select v from fx where k='lawyer'),   'owner'),
  ((select v from fx where k='other'), (select v from fx where k='agent'),    'owner'),
  ((select v from fx where k='third'), (select v from fx where k='stranger'), 'owner');

insert into matters (firm_id, reference, title, type, suit_number, court_name)
  values ((select v from fx where k='firm'), 'IC-M-2026-000001', 'Adeyemi v Lagos State', 'litigation', 'ID/9911/2026', 'High Court of Lagos State');
insert into fx select 'matter', id from matters where reference = 'IC-M-2026-000001';
insert into matter_parties (matter_id, firm_id, user_id, role)
  values ((select v from fx where k='matter'), (select v from fx where k='firm'), (select v from fx where k='client'), 'client');

-- Two documents: one will be shared, one never will.
insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by) values
  (gen_random_uuid(), (select v from fx where k='firm'), (select v from fx where k='matter'), 'written-address.pdf', 'pleading', true,  (select v from fx where k='lawyer')),
  (gen_random_uuid(), (select v from fx where k='firm'), (select v from fx where k='matter'), 'counsel-brief.pdf',   'pleading', false, (select v from fx where k='lawyer'));
insert into fx select 'doc',    id from documents where name = 'written-address.pdf';
insert into fx select 'secret', id from documents where name = 'counsel-brief.pdf';
insert into document_versions (id, document_id, storage_path, mime, size_bytes, checksum, uploaded_by)
  values (gen_random_uuid(), (select v from fx where k='doc'),
          (select v from fx where k='firm') || '/' || (select v from fx where k='doc') || '/v1.pdf', 'application/pdf', 1024, repeat('a', 64), (select v from fx where k='lawyer'));
insert into fx select 'v1', id from document_versions where document_id = (select v from fx where k='doc');
insert into document_versions (id, document_id, storage_path, mime, size_bytes, checksum, uploaded_by)
  values (gen_random_uuid(), (select v from fx where k='secret'),
          (select v from fx where k='firm') || '/' || (select v from fx where k='secret') || '/v1.pdf', 'application/pdf', 2048, repeat('b', 64), (select v from fx where k='lawyer'));
insert into fx select 'sv', id from document_versions where document_id = (select v from fx where k='secret');

insert into updates (matter_id, firm_id, kind, visibility, title, body, posted_by) values
  ((select v from fx where k='matter'), (select v from fx where k='firm'), 'note', 'client',   'Adjourned to November', 'The court adjourned for the written addresses.', (select v from fx where k='lawyer')),
  ((select v from fx where k='matter'), (select v from fx where k='firm'), 'note', 'internal', 'Our case is thin',      'We should settle.',                              (select v from fx where k='lawyer'));

-- ---------------------------------------------------------------- 1. an invitation is not a file
do $$
declare l uuid := (select v from fx where k='lawyer'); ag uuid := (select v from fx where k='agent');
        m uuid := (select v from fx where k='matter'); other uuid := (select v from fx where k='other'); c uuid;
begin
  perform t_as(l);
  c := propose_collaboration(m, other, 'agency', 'Appear for us at the hearing on 3 November.', true, null);
  insert into fx select 'collab', c;
  perform t_reset();

  perform t_as(ag);
  perform t_check('the other firm sees the invitation',
    exists (select 1 from collaboration_inbox where id = c and from_firm_name = 'Instructing Chambers'));
  perform t_check('...with the snapshot it was given, not the live matter',
    (select case_title = 'Adeyemi v Lagos State' and suit_number = 'ID/9911/2026' from collaboration_inbox where id = c));
  -- Everything below is what an unanswered invitation must NOT open.
  perform t_check('but not the matter itself',            not exists (select 1 from matters where id = m));
  perform t_check('nor any update on it',                 not exists (select 1 from updates where matter_id = m));
  perform t_check('nor anything through the shared-updates view, which is gated on being live',
    not exists (select 1 from collaboration_updates where collaboration_id = c));
  perform t_check('nor any document',                     not exists (select 1 from documents where matter_id = m));
  perform t_check('and the arrangement is not live',      not collaboration_live(c) and not is_collaborating_firm(c));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. what a proposal refuses
do $$
declare l uuid := (select v from fx where k='lawyer'); ag uuid := (select v from fx where k='agent');
        m uuid := (select v from fx where k='matter'); f uuid := (select v from fx where k='firm');
        other uuid := (select v from fx where k='other'); c uuid := (select v from fx where k='collab');
begin
  perform t_as(ag);
  perform t_check('the other firm cannot propose an arrangement over somebody else''s matter',
    t_refused(format('select propose_collaboration(%L, %L, ''referral'', ''Let us in.'')', m, other), '42501'));
  perform t_reset(); perform t_as(l);
  perform t_check('a firm cannot collaborate with itself',
    t_fails(format('select propose_collaboration(%L, %L, ''referral'', ''Odd.'')', m, f), 'does not collaborate with itself'));
  perform t_check('an arrangement that ended yesterday is refused rather than stored',
    t_fails(format('select propose_collaboration(%L, %L, ''referral'', ''Late.'', false, %L)', m, (select v from fx where k='third'), current_date - 1),
            'ended yesterday'));
  perform t_check('and the same arrangement is not proposed twice',
    t_fails(format('select propose_collaboration(%L, %L, ''agency'', ''Again.'')', m, other), 'matter_collaborations_live_idx'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. accepted: what opens, and what does not
do $$
declare l uuid := (select v from fx where k='lawyer'); ag uuid := (select v from fx where k='agent');
        m uuid := (select v from fx where k='matter'); c uuid := (select v from fx where k='collab');
        v1 uuid := (select v from fx where k='v1'); sv uuid := (select v from fx where k='sv');
begin
  perform t_as(ag);
  perform respond_to_collaboration(c, true);
  perform t_reset();
  perform t_check('the client is told, on their own timeline, the moment another firm is on the file',
    exists (select 1 from updates where matter_id = m and visibility = 'client' and title like '%Agent Chambers is now working with us%'));
  perform t_check('...and by notification',
    exists (select 1 from notifications where event = 'collaboration_started' and user_id = (select v from fx where k='client')));

  perform t_as(l);
  perform share_document_with_collaborator(c, v1);
  perform t_reset();

  perform t_as(ag);
  perform t_check('the arrangement is live now',  collaboration_live(c) and is_collaborating_firm(c));
  perform t_check('the shared version opens',     can_access_document_version(v1));
  perform t_check('the client-facing update is readable through the view',
    exists (select 1 from collaboration_updates where collaboration_id = c and title = 'Adjourned to November'));
  perform t_check('and the internal note is NOT, however wide the arrangement',
    not exists (select 1 from collaboration_updates where collaboration_id = c and title = 'Our case is thin'));
  perform t_check('a document nobody shared does not open',      not can_access_document_version(sv));
  perform t_check('the matter row is still not theirs to read',  not exists (select 1 from matters where id = m));
  perform t_check('nor the updates table itself',                not exists (select 1 from updates where matter_id = m));
  perform t_check('nor the documents table',                     not exists (select 1 from documents where matter_id = m));
  perform t_check('they can read what was shared, as a record',
    exists (select 1 from collaboration_documents where collaboration_id = c and document_version_id = v1));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. a later version is not shared by an earlier one
do $$
declare l uuid := (select v from fx where k='lawyer'); ag uuid := (select v from fx where k='agent');
        c uuid := (select v from fx where k='collab'); v2 uuid;
begin
  perform t_reset();
  insert into document_versions (id, document_id, storage_path, mime, size_bytes, checksum, uploaded_by)
    values (gen_random_uuid(), (select v from fx where k='doc'),
            (select v from fx where k='firm') || '/' || (select v from fx where k='doc') || '/v2.pdf',
            'application/pdf', 4096, repeat('c', 64), (select v from fx where k='lawyer'))
    returning id into v2;
  insert into fx select 'v2', v2;
  perform t_as(ag);
  perform t_check('a new version of a shared document is not itself shared', not can_access_document_version(v2));
  perform t_check('...while the version that was handed over still opens', can_access_document_version((select v from fx where k='v1')));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 5. sharing is the owning firm's act alone
do $$
declare ag uuid := (select v from fx where k='agent'); st uuid := (select v from fx where k='stranger');
        c uuid := (select v from fx where k='collab'); sv uuid := (select v from fx where k='sv');
begin
  perform t_as(ag);
  perform t_check('the collaborating firm cannot help itself to another document',
    t_refused(format('select share_document_with_collaborator(%L, %L)', c, sv), '42501'));
  perform t_check('nor write the sharing row by hand',
    t_refused(format('insert into collaboration_documents (collaboration_id, document_id, document_version_id) values (%L, %L, %L)',
                     c, (select v from fx where k='secret'), sv), '42501'));
  perform t_check('nor widen the arrangement by hand',
    t_refused(format('update matter_collaborations set share_updates = true, ends_on = null where id = %L', c), '42501'));
  perform t_reset();

  perform t_as(st);
  perform t_check('a third firm sees no arrangement at all', not exists (select 1 from collaboration_inbox where id = c));
  perform t_check('...and opens nothing',                    not can_access_document_version((select v from fx where k='v1')));
  perform t_check('...and cannot answer it',                 t_refused(format('select respond_to_collaboration(%L, true)', c), '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 6. a note is how the two firms talk, while it is live
do $$
declare l uuid := (select v from fx where k='lawyer'); ag uuid := (select v from fx where k='agent');
        st uuid := (select v from fx where k='stranger'); c uuid := (select v from fx where k='collab');
begin
  perform t_as(ag);
  perform post_collaboration_note(c, 'Noted — I will appear. Please send the brief.');
  perform t_reset(); perform t_as(l);
  perform post_collaboration_note(c, 'Brief attached above.');
  perform t_check('both firms read the exchange', (select count(*) = 2 from collaboration_notes where collaboration_id = c));
  perform t_reset();
  perform t_as(st);
  perform t_check('and a third firm reads none of it', not exists (select 1 from collaboration_notes where collaboration_id = c));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 7. withdrawing one document, then ending the whole thing
do $$
declare l uuid := (select v from fx where k='lawyer'); ag uuid := (select v from fx where k='agent');
        c uuid := (select v from fx where k='collab'); v1 uuid := (select v from fx where k='v1'); cd uuid;
begin
  perform t_reset();
  select id into cd from collaboration_documents where collaboration_id = c and document_version_id = v1;
  perform t_as(l);
  perform withdraw_shared_document(cd);
  perform t_reset();
  perform t_as(ag);
  perform t_check('a withdrawn document stops opening', not can_access_document_version(v1));
  perform t_reset();

  -- Share it again, so ending the arrangement is what closes it below rather than the withdrawal.
  perform t_as(l);
  perform share_document_with_collaborator(c, v1);
  perform t_reset();
  perform t_as(ag);
  perform t_check('re-sharing it opens it again', can_access_document_version(v1));
  -- Either side may end it. Here the firm that was brought in does.
  perform end_collaboration(c, 'Conflict discovered on our side.');
  perform t_check('once ended it is not live',                  not collaboration_live(c) and not is_collaborating_firm(c));
  perform t_check('the document closes with it',                not can_access_document_version(v1));
  perform t_check('the shared updates close with it',           not exists (select 1 from collaboration_updates where collaboration_id = c));
  perform t_check('the notes close with it',                    not exists (select 1 from collaboration_notes where collaboration_id = c));
  perform t_check('but the arrangement itself is still readable, because the record is the point',
    exists (select 1 from collaboration_inbox where id = c and ended_at is not null));
  perform t_check('and nothing more can be shared into it',
    t_fails(format('select post_collaboration_note(%L, ''hello?'')', c), 'not live'));
  perform t_reset();
  perform t_check('the reason is kept', (select end_reason = 'Conflict discovered on our side.' from matter_collaborations where id = c));
end $$;

-- ---------------------------------------------------------------- 8. expiry closes it with no job run
do $$
declare l uuid := (select v from fx where k='lawyer'); ag uuid := (select v from fx where k='agent');
        m uuid := (select v from fx where k='matter'); other uuid := (select v from fx where k='other');
        v1 uuid := (select v from fx where k='v1'); c2 uuid;
begin
  perform t_reset(); perform t_as(l);
  c2 := propose_collaboration(m, other, 'joint_counsel', 'Junior counsel for the trial.', false,
                              (now() at time zone 'Africa/Lagos')::date + 7);
  perform t_reset(); perform t_as(ag);
  perform respond_to_collaboration(c2, true);
  perform t_reset(); perform t_as(l);
  perform share_document_with_collaborator(c2, v1);
  perform t_reset(); perform t_as(ag);
  perform t_check('a dated arrangement is live until its day', can_access_document_version(v1));
  perform t_reset();
  update matter_collaborations set ends_on = (now() at time zone 'Africa/Lagos')::date - 1 where id = c2;
  perform t_as(ag);
  perform t_check('and shares nothing the day after, with no job having run', not can_access_document_version(v1));
  perform t_check('...nor is it live',                                        not collaboration_live(c2));
  perform t_reset();
  -- share_updates was off on this one, so nothing comes through even while it was live.
  update matter_collaborations set ends_on = null where id = c2;
  perform t_as(ag);
  perform t_check('an arrangement that does not share updates shares none, even when live',
    collaboration_live(c2) and not exists (select 1 from collaboration_updates where collaboration_id = c2));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 9. declining
do $$
declare l uuid := (select v from fx where k='lawyer'); st uuid := (select v from fx where k='stranger');
        m uuid := (select v from fx where k='matter'); third uuid := (select v from fx where k='third'); c3 uuid;
begin
  perform t_as(l);
  c3 := propose_collaboration(m, third, 'referral', 'Would you take this on?');
  perform t_reset(); perform t_as(st);
  perform respond_to_collaboration(c3, false, 'We act for the other side.');
  perform t_check('a declined arrangement is not live',   not collaboration_live(c3));
  perform t_check('it cannot be answered twice',          t_fails(format('select respond_to_collaboration(%L, true)', c3), 'already been answered'));
  perform t_reset();
  perform t_check('and the reason is kept for the firm that asked',
    (select decline_reason = 'We act for the other side.' from matter_collaborations where id = c3));
  perform t_check('no client update was written for a referral nobody took',
    not exists (select 1 from updates where matter_id = m and title like '%Nothing To Do With It is now working%'));
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
