-- Firm to firm, beyond service of process: referrals, joint counsel, and appearing as agent.
--
-- The assessment's #21. Docket already has the hard half of this and it is the strongest thing in
-- the product: serve_process() hands a NAMED VERSION of a document to another firm on the platform,
-- the served firm reads it through one definer view with a fixed column list and nothing else, the
-- act is acknowledged once, and it can be revoked. That is the discipline. This migration extends
-- it to the other two ways Nigerian firms actually work together, and changes none of it.
--
-- WHAT IS DIFFERENT FROM SERVICE, AND WHY. Service is unilateral by nature: a party is served
-- whether they like it or not, so serve_process() needs no consent from the other side. A
-- collaboration is the opposite — it is a working relationship, so it is proposed by one firm and
-- is worth NOTHING until the other accepts. Until then the receiving firm sees an invitation and no
-- file: not a document, not an update, not the matter's own title beyond what the proposing firm
-- chose to put in the snapshot.
--
-- WHAT THE OTHER FIRM CAN EVER SEE, AND HOW.
--
--  · Never the matter row. The other firm is not a member of the firm that owns the file, so
--    `matters` is not theirs to read and no policy here changes that. They read a SNAPSHOT taken
--    when the collaboration was proposed — case title, suit number, court — through a definer view
--    with a fixed column list, exactly as the served firm reads service_inbox. If the file is later
--    renamed, the snapshot does not follow it: what they were told is what they were told.
--  · Documents ONE NAMED VERSION AT A TIME. Sharing is per version and per document, with the
--    checksum recorded, so a document that gains a new version tomorrow does not silently widen
--    what the other firm holds. This is the same rule as service and for the same reason: what was
--    handed over must be a thing you can name afterwards.
--  · Updates only where the proposing firm said so, and then only the CLIENT-FACING ones. An
--    internal note is the firm's own work product and is never shared through a collaboration,
--    however wide the arrangement: co-counsel who need the strategy can be given a document, which
--    is a decision somebody makes, rather than a feed nobody reviewed.
--  · Nothing after it ends. Liveness is tested at the moment of the read — accepted, not declined,
--    not ended, and not past its last day, with the day compared in the owning firm's timezone
--    because ends_on is a calendar day. No job runs; an ended collaboration is closed the second it
--    is ended.
--
-- REVOCATION CANNOT RECALL A COPY. Ending a collaboration stops every future read and nothing else.
-- A document already downloaded is on somebody else's disk and Docket has no power over it. The
-- screens say that in those words, as the service screens do, because a product that implies
-- otherwise about a legal document is lying about the only thing that matters.
--
-- THE CLIENT IS TOLD. Handing a client's file to another firm is a disclosure, and the client hears
-- of it on their own timeline the moment the other firm accepts. Docket does not make it conditional
-- on the client's consent: whether a referral needs the client's agreement is a professional
-- question with a real answer in the rules of practice, and a product that silently enforced its own
-- guess would be making that decision for the lawyer. It records, it tells, and it leaves the
-- judgement where it belongs.

-- ================================================================ 1. the arrangement
create table public.matter_collaborations (
  id              uuid primary key default gen_random_uuid(),
  -- The firm whose matter it is. Only this firm may share anything.
  firm_id         uuid not null references public.firms(id) on delete cascade,
  matter_id       uuid not null references public.matters(id) on delete cascade,
  -- The firm being brought in. Must be on Docket: there is nothing to share with a firm that has
  -- no account, and an off-platform arrangement is a note on the matter, not a row here.
  with_firm_id    uuid not null references public.firms(id) on delete cascade,
  kind            text not null check (kind in ('referral', 'joint_counsel', 'agency')),
  -- The snapshot. The other firm never reads `matters`, so this is what they are told, frozen.
  case_title      text,
  suit_number     text,
  court_name      text,
  scope_note      text not null check (length(btrim(scope_note)) between 2 and 2000),
  share_updates   boolean not null default false,
  ends_on         date,
  proposed_by     uuid references public.profiles(id) on delete set null,
  proposed_at     timestamptz not null default now(),
  accepted_at     timestamptz,
  accepted_by     uuid references public.profiles(id) on delete set null,
  declined_at     timestamptz,
  declined_by     uuid references public.profiles(id) on delete set null,
  decline_reason  text check (decline_reason is null or length(decline_reason) <= 1000),
  ended_at        timestamptz,
  ended_by        uuid references public.profiles(id) on delete set null,
  end_reason      text check (end_reason is null or length(end_reason) <= 1000),
  created_at      timestamptz not null default now(),
  constraint collaborations_not_self_chk check (with_firm_id <> firm_id),
  constraint collaborations_answered_chk check (accepted_at is null or declined_at is null)
);
create index matter_collaborations_matter_idx on public.matter_collaborations (matter_id);
create index matter_collaborations_with_idx   on public.matter_collaborations (with_firm_id, accepted_at);
-- One live arrangement of a kind per pair per matter: proposing the same thing twice is a mistake,
-- not a second arrangement.
create unique index matter_collaborations_live_idx on public.matter_collaborations (matter_id, with_firm_id, kind)
  where declined_at is null and ended_at is null;

alter table public.matter_collaborations enable row level security;
-- The owning firm's staff who may see the matter, and any member of the firm being brought in.
-- The second arm is deliberately NOT gated on acceptance: a firm must be able to read the
-- invitation in order to answer it.
create policy matter_collaborations_select on public.matter_collaborations for select
  using (matter_row_r(firm_id, matter_id) or is_firm_member(with_firm_id));
-- No write policy, no write grant: the six functions below are the only doors.
revoke insert, update, delete on public.matter_collaborations from anon, authenticated;

create trigger matter_collaborations_firm_guard before insert or update on public.matter_collaborations
  for each row execute function public.check_row_firm();
create trigger matter_collaborations_audit after insert or update or delete on public.matter_collaborations
  for each row execute function public.audit_row_change();

comment on table public.matter_collaborations is
  'A referral, joint retainer or agency arrangement between two firms on Docket. Worth nothing until the other firm accepts; ends on a day or on either firm''s word. Written only by its own functions.';
comment on column public.matter_collaborations.case_title is
  'A SNAPSHOT taken when the collaboration was proposed. The other firm cannot read `matters`, and renaming the file does not rewrite what they were told.';

-- Live: accepted, not declined, not ended, not past its last day — the day read in the owning
-- firm's timezone, because ends_on is a calendar day and never an instant.
create or replace function public.collaboration_live(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matter_collaborations mc join firms f on f.id = mc.firm_id
     where mc.id = c
       and mc.accepted_at is not null
       and mc.declined_at is null
       and mc.ended_at is null
       and (mc.ends_on is null
            or mc.ends_on >= (now() at time zone coalesce(f.timezone, 'Africa/Lagos'))::date))
$$;

/** A member of the firm that was brought in, on a collaboration that is live right now. */
create or replace function public.is_collaborating_firm(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from matter_collaborations mc
                  where mc.id = c and public.is_firm_member(mc.with_firm_id))
     and public.collaboration_live(c)
$$;
revoke execute on function public.collaboration_live(uuid), public.is_collaborating_firm(uuid) from public;
grant  execute on function public.collaboration_live(uuid), public.is_collaborating_firm(uuid) to anon, authenticated;

-- ================================================================ 2. what is shared, one version at a time
create table public.collaboration_documents (
  id                  uuid primary key default gen_random_uuid(),
  collaboration_id    uuid not null references public.matter_collaborations(id) on delete cascade,
  document_id         uuid not null references public.documents(id) on delete restrict,
  -- The version, named. A later version of the same document is NOT shared by this row.
  document_version_id uuid not null references public.document_versions(id) on delete restrict,
  checksum            text,
  shared_by           uuid references public.profiles(id) on delete set null,
  shared_at           timestamptz not null default now(),
  withdrawn_at        timestamptz,
  withdrawn_by        uuid references public.profiles(id) on delete set null,
  unique (collaboration_id, document_version_id)
);
create index collaboration_documents_version_idx on public.collaboration_documents (document_version_id);
alter table public.collaboration_documents enable row level security;
create policy collaboration_documents_select on public.collaboration_documents for select
  using (exists (select 1 from matter_collaborations mc
                  where mc.id = collaboration_id
                    and (matter_row_r(mc.firm_id, mc.matter_id) or is_collaborating_firm(mc.id))));
revoke insert, update, delete on public.collaboration_documents from anon, authenticated;

-- A note between the two firms, so an arrangement has somewhere to be conducted. Both sides read
-- it while the collaboration is live; neither can edit or delete what was said.
create table public.collaboration_notes (
  id               uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null references public.matter_collaborations(id) on delete cascade,
  firm_id          uuid not null references public.firms(id) on delete cascade,
  author_id        uuid references public.profiles(id) on delete set null,
  body             text not null check (length(btrim(body)) between 1 and 4000),
  created_at       timestamptz not null default now()
);
create index collaboration_notes_idx on public.collaboration_notes (collaboration_id, created_at);
alter table public.collaboration_notes enable row level security;
create policy collaboration_notes_select on public.collaboration_notes for select
  using (exists (select 1 from matter_collaborations mc
                  where mc.id = collaboration_id
                    and (matter_row_r(mc.firm_id, mc.matter_id) or is_collaborating_firm(mc.id))));
revoke insert, update, delete on public.collaboration_notes from anon, authenticated;

-- The bytes. The same shape as the served firm's arm, and for the same reason: a firm that was
-- handed a named version may open that version and nothing else on the file.
create or replace function public.can_access_document_version(v uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from document_versions dv join documents doc on doc.id = dv.document_id
     where dv.id = v
       and ( public.matter_row_r(doc.firm_id, doc.matter_id)
          or (doc.client_visible and doc.deleted_at is null
              and ( public.party_may_see_docs(doc.matter_id)
                 or public.acts_for_matter(doc.matter_id, 'docs')
                 or public.is_appointment_client(doc.appointment_id)))
          or exists (select 1 from process_service ps
                      where ps.document_version_id = dv.id and public.is_served_firm(ps.id))
          or exists (select 1 from collaboration_documents cd
                      where cd.document_version_id = dv.id
                        and cd.withdrawn_at is null
                        and public.is_collaborating_firm(cd.collaboration_id))) )
$$;

-- ================================================================ 3. the doors
create or replace function public.propose_collaboration(
  p_matter uuid, p_with_firm uuid, p_kind text, p_scope_note text,
  p_share_updates boolean default false, p_ends_on date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m matters%rowtype; v_id uuid; v_tz text; v_name text; r record;
begin
  select * into m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  if not matter_row_w(m.firm_id, p_matter) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_with_firm = m.firm_id then raise exception 'a firm does not collaborate with itself'; end if;
  if not exists (select 1 from firms f where f.id = p_with_firm and f.status = 'active') then
    raise exception 'that firm is not on Docket, or is not active — record an off-platform arrangement as a note instead';
  end if;
  select coalesce(timezone, 'Africa/Lagos') into v_tz from firms where id = m.firm_id;
  if p_ends_on is not null and p_ends_on < (now() at time zone v_tz)::date then
    raise exception 'an arrangement that ended yesterday shares nothing — give a day in the future, or none';
  end if;

  insert into matter_collaborations (firm_id, matter_id, with_firm_id, kind, case_title, suit_number, court_name,
                                     scope_note, share_updates, ends_on, proposed_by)
  values (m.firm_id, p_matter, p_with_firm, p_kind, m.title, m.suit_number, m.court_name,
          btrim(p_scope_note), coalesce(p_share_updates, false), p_ends_on, auth.uid())
  returning id into v_id;

  select name into v_name from firms where id = m.firm_id;
  for r in select user_id from firm_members where firm_id = p_with_firm and role in ('owner','admin','lawyer') loop
    perform enqueue_notification(r.user_id, p_with_firm, 'collaboration_proposed',
      jsonb_build_object('collaboration_id', v_id, 'kind', p_kind, 'from_firm_name', v_name,
                         'case_title', m.title, 'suit_number', m.suit_number));
  end loop;
  perform audit('collaboration.proposed', 'matter_collaboration', v_id, m.firm_id,
                jsonb_build_object('matter_id', p_matter, 'with_firm_id', p_with_firm, 'kind', p_kind,
                                   'share_updates', coalesce(p_share_updates, false), 'ends_on', p_ends_on));
  return v_id;
end $$;
revoke execute on function public.propose_collaboration(uuid, uuid, text, text, boolean, date) from public, anon;
grant  execute on function public.propose_collaboration(uuid, uuid, text, text, boolean, date) to authenticated;

-- The receiving firm answers. Until it does, it holds an invitation and no file.
create or replace function public.respond_to_collaboration(p_id uuid, p_accept boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c matter_collaborations%rowtype; v_name text; r record;
begin
  select * into c from matter_collaborations where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  if not staff_w(c.with_firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if c.accepted_at is not null or c.declined_at is not null then raise exception 'this has already been answered'; end if;
  if c.ended_at is not null then raise exception 'this was withdrawn before it was answered'; end if;

  if p_accept then
    update matter_collaborations set accepted_at = now(), accepted_by = auth.uid() where id = p_id;
  else
    update matter_collaborations set declined_at = now(), declined_by = auth.uid(),
                                     decline_reason = nullif(btrim(coalesce(p_reason, '')), '') where id = p_id;
  end if;

  select name into v_name from firms where id = c.with_firm_id;
  -- The proposing firm hears the answer.
  if c.proposed_by is not null then
    perform enqueue_notification(c.proposed_by, c.firm_id,
      case when p_accept then 'collaboration_accepted' else 'collaboration_declined' end,
      jsonb_build_object('collaboration_id', p_id, 'with_firm_name', v_name, 'matter_id', c.matter_id,
                         'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  end if;

  -- And so does the client, on their own timeline, the moment another firm is actually on the file.
  if p_accept then
    insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
    values (c.matter_id, c.firm_id, 'correspondence', 'client',
            format('%s is now working with us on this matter', v_name),
            c.scope_note, jsonb_build_object('collaboration_id', p_id, 'kind', c.kind), now(), c.proposed_by);
    for r in select mp.user_id from matter_parties mp where mp.matter_id = c.matter_id and mp.role in ('client', 'contact') loop
      perform enqueue_notification(r.user_id, c.firm_id, 'collaboration_started',
        jsonb_build_object('collaboration_id', p_id, 'matter_id', c.matter_id, 'with_firm_name', v_name, 'kind', c.kind));
    end loop;
  end if;

  perform audit(case when p_accept then 'collaboration.accepted' else 'collaboration.declined' end,
                'matter_collaboration', p_id, c.firm_id,
                jsonb_build_object('with_firm_id', c.with_firm_id, 'matter_id', c.matter_id,
                                   'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  perform audit(case when p_accept then 'collaboration.accepted' else 'collaboration.declined' end,
                'matter_collaboration', p_id, c.with_firm_id,
                jsonb_build_object('firm_id', c.firm_id, 'matter_id', c.matter_id));
end $$;
revoke execute on function public.respond_to_collaboration(uuid, boolean, text) from public, anon;
grant  execute on function public.respond_to_collaboration(uuid, boolean, text) to authenticated;

-- Sharing is the owning firm's act, one named version at a time.
create or replace function public.share_document_with_collaborator(p_collaboration uuid, p_version uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c matter_collaborations%rowtype; v document_versions%rowtype; d documents%rowtype; v_id uuid; r record;
begin
  select * into c from matter_collaborations where id = p_collaboration;
  if not found then raise exception 'not found'; end if;
  if not matter_row_w(c.firm_id, c.matter_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if not collaboration_live(p_collaboration) then
    raise exception 'this arrangement is not live — it has not been accepted, or it has ended';
  end if;
  select * into v from document_versions where id = p_version;
  if not found then raise exception 'version not found'; end if;
  select * into d from documents where id = v.document_id and deleted_at is null;
  if not found then raise exception 'document not found'; end if;
  if d.matter_id is distinct from c.matter_id then raise exception 'that document is not on this matter'; end if;
  if v.checksum is null then
    raise exception 'this version has no checksum, so what was handed over could not be named afterwards';
  end if;

  insert into collaboration_documents (collaboration_id, document_id, document_version_id, checksum, shared_by)
  values (p_collaboration, d.id, p_version, v.checksum, auth.uid())
  on conflict (collaboration_id, document_version_id) do update set withdrawn_at = null, withdrawn_by = null
  returning id into v_id;

  for r in select user_id from firm_members where firm_id = c.with_firm_id and role in ('owner','admin','lawyer') loop
    perform enqueue_notification(r.user_id, c.with_firm_id, 'collaboration_document_shared',
      jsonb_build_object('collaboration_id', p_collaboration, 'name', d.name, 'case_title', c.case_title));
  end loop;
  perform audit('collaboration.document_shared', 'matter_collaboration', p_collaboration, c.firm_id,
                jsonb_build_object('document_id', d.id, 'version_id', p_version, 'checksum', v.checksum,
                                   'with_firm_id', c.with_firm_id));
  return v_id;
end $$;
revoke execute on function public.share_document_with_collaborator(uuid, uuid) from public, anon;
grant  execute on function public.share_document_with_collaborator(uuid, uuid) to authenticated;

create or replace function public.withdraw_shared_document(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cd collaboration_documents%rowtype; c matter_collaborations%rowtype;
begin
  select * into cd from collaboration_documents where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  select * into c from matter_collaborations where id = cd.collaboration_id;
  if not matter_row_w(c.firm_id, c.matter_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if cd.withdrawn_at is not null then return; end if;
  update collaboration_documents set withdrawn_at = now(), withdrawn_by = auth.uid() where id = p_id;
  -- Withdrawing closes the door. It does not reach a copy already downloaded, and the screens say so.
  perform audit('collaboration.document_withdrawn', 'matter_collaboration', cd.collaboration_id, c.firm_id,
                jsonb_build_object('document_id', cd.document_id, 'version_id', cd.document_version_id));
end $$;
revoke execute on function public.withdraw_shared_document(uuid) from public, anon;
grant  execute on function public.withdraw_shared_document(uuid) to authenticated;

-- Either firm may end it. A working relationship neither side can leave is not one.
create or replace function public.end_collaboration(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c matter_collaborations%rowtype; r record; v_name text;
begin
  select * into c from matter_collaborations where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  if not (matter_row_w(c.firm_id, c.matter_id) or staff_w(c.with_firm_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if c.ended_at is not null then return; end if;
  update matter_collaborations set ended_at = now(), ended_by = auth.uid(),
                                   end_reason = nullif(btrim(coalesce(p_reason, '')), '') where id = p_id;

  select name into v_name from firms where id = case when staff_w(c.with_firm_id) then c.with_firm_id else c.firm_id end;
  for r in select user_id from firm_members
            where firm_id in (c.firm_id, c.with_firm_id) and role in ('owner','admin','lawyer') loop
    perform enqueue_notification(r.user_id, c.firm_id, 'collaboration_ended',
      jsonb_build_object('collaboration_id', p_id, 'case_title', c.case_title, 'by_firm_name', v_name));
  end loop;
  perform audit('collaboration.ended', 'matter_collaboration', p_id, c.firm_id,
                jsonb_build_object('with_firm_id', c.with_firm_id, 'matter_id', c.matter_id,
                                   'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  perform audit('collaboration.ended', 'matter_collaboration', p_id, c.with_firm_id,
                jsonb_build_object('firm_id', c.firm_id, 'matter_id', c.matter_id));
end $$;
revoke execute on function public.end_collaboration(uuid, text) from public, anon;
grant  execute on function public.end_collaboration(uuid, text) to authenticated;

create or replace function public.post_collaboration_note(p_collaboration uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c matter_collaborations%rowtype; v_firm uuid; v_id uuid;
begin
  select * into c from matter_collaborations where id = p_collaboration;
  if not found then raise exception 'not found'; end if;
  if not collaboration_live(p_collaboration) then raise exception 'this arrangement is not live'; end if;
  v_firm := case when matter_row_w(c.firm_id, c.matter_id) then c.firm_id
                 when staff_w(c.with_firm_id) then c.with_firm_id end;
  if v_firm is null then raise exception 'not permitted' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'say something'; end if;
  insert into collaboration_notes (collaboration_id, firm_id, author_id, body)
  values (p_collaboration, v_firm, auth.uid(), btrim(p_body)) returning id into v_id;
  perform audit('collaboration.note_posted', 'matter_collaboration', p_collaboration, v_firm,
                jsonb_build_object('note_id', v_id));
  return v_id;
end $$;
revoke execute on function public.post_collaboration_note(uuid, text) from public, anon;
grant  execute on function public.post_collaboration_note(uuid, text) to authenticated;

-- ================================================================ 4. what the other firm reads
-- INVARIANT, as on service_inbox: this is the ONLY read path into another firm's matter. Never
-- select *, never add a column that reaches the live matter row, and never widen the predicate.
-- The titles here are the snapshot taken at proposal, not the file's current name.
create view public.collaboration_inbox with (security_invoker = false) as
  select mc.id, mc.kind, mc.case_title, mc.suit_number, mc.court_name, mc.scope_note,
         mc.share_updates, mc.ends_on, mc.proposed_at, mc.accepted_at, mc.declined_at, mc.ended_at,
         mc.firm_id as from_firm_id, f.name as from_firm_name,
         mc.with_firm_id,
         (select count(*) from collaboration_documents cd
           where cd.collaboration_id = mc.id and cd.withdrawn_at is null) as shared_documents
    from matter_collaborations mc join firms f on f.id = mc.firm_id
   where public.is_firm_member(mc.with_firm_id) or public.matter_row_r(mc.firm_id, mc.matter_id);
revoke all on public.collaboration_inbox from anon;
grant select on public.collaboration_inbox to authenticated;
comment on view public.collaboration_inbox is
  'INVARIANT: the collaborating firm''s only read path into the arrangement. Titles are the snapshot taken at proposal. Never select *, never add a column that reaches the live matter.';

-- The updates a collaboration shares: the client-facing narrative only, and only where the owning
-- firm switched it on. An internal note is never here, whatever the arrangement.
create view public.collaboration_updates with (security_invoker = false) as
  select mc.id as collaboration_id, u.id as update_id, u.kind, u.title, u.body, u.occurred_at
    from matter_collaborations mc
    join updates u on u.matter_id = mc.matter_id and u.visibility = 'client'
   where mc.share_updates
     and (public.is_collaborating_firm(mc.id) or public.matter_row_r(mc.firm_id, mc.matter_id));
revoke all on public.collaboration_updates from anon;
grant select on public.collaboration_updates to authenticated;
comment on view public.collaboration_updates is
  'INVARIANT: client-facing updates only (visibility = ''client''), and only on a collaboration whose owner switched sharing on. An internal note is never shared through a collaboration.';
