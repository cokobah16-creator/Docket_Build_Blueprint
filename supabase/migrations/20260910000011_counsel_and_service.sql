-- Docket — migration 11: counsel on the other side, and service of court processes.
--
-- Litigation is a conversation between firms conducted through the court.
-- This migration gives every firm on Docket two primitives for it:
--
--   matter_counsel   who acts for the other parties on a matter (opposing
--                    counsel, co-counsel) — a firm on Docket, or an address
--                    for service off the platform
--   process_service  a court process (originating summons, motion on notice,
--                    notice of appeal, hearing notice …) served on that counsel:
--                    through Docket when they are on it, otherwise by email,
--                    personal service, courier, bailiff or substituted service.
--                    The served firm acknowledges in the app, which is the
--                    serving firm's proof of service.
--
-- The rule "the database decides who sees what" holds across firms: the
-- served firm sees the service record and can open the served document —
-- and nothing else about the matter. The serving firm's client sees a
-- client-visible timeline entry ("Served …") so the case is visibly moving.

create type public.counsel_side   as enum ('opposing', 'co_counsel', 'other');
create type public.service_method as enum ('platform', 'email', 'personal', 'courier', 'bailiff', 'substituted');

-- ---------------------------------------------------------------- counsel
create table public.matter_counsel (
  id                  uuid primary key default gen_random_uuid(),
  firm_id             uuid not null references public.firms on delete cascade,     -- the firm whose matter this is
  matter_id           uuid not null references public.matters on delete cascade,
  side                public.counsel_side not null,
  party_name          text,                                                          -- the party this counsel acts for
  counsel_firm_id     uuid references public.firms on delete set null,             -- set when the other side is on Docket
  counsel_name        text,
  counsel_firm_name   text,                                                          -- free text when off-platform
  scn                 text,
  email               text,
  phone               text,
  address_for_service text,
  note                text,
  created_by          uuid references public.profiles,
  created_at          timestamptz not null default now(),
  check (counsel_firm_id is not null or counsel_name is not null or counsel_firm_name is not null),
  check (counsel_firm_id is null or counsel_firm_id <> firm_id)
);
create index matter_counsel_matter_idx  on public.matter_counsel (matter_id);
create index matter_counsel_counsel_idx on public.matter_counsel (counsel_firm_id) where counsel_firm_id is not null;

alter table public.matter_counsel enable row level security;
create policy matter_counsel_select on public.matter_counsel for select using (is_firm_member(firm_id));
create policy matter_counsel_insert on public.matter_counsel for insert with check (staff_w(firm_id) and created_by = auth.uid());
create policy matter_counsel_modify on public.matter_counsel for update using (staff_w(firm_id)) with check (staff_w(firm_id));
create policy matter_counsel_delete on public.matter_counsel for delete using (staff_w(firm_id));

-- ---------------------------------------------------------------- service of process
create table public.process_service (
  id                   uuid primary key default gen_random_uuid(),
  firm_id              uuid not null references public.firms on delete cascade,     -- serving firm
  matter_id            uuid not null references public.matters on delete cascade,
  counsel_id           uuid not null references public.matter_counsel on delete restrict,
  document_id          uuid not null references public.documents on delete restrict,
  process_title        text not null,                                                 -- as on the face of the process
  case_title           text,                                                          -- snapshot: the served firm cannot read matters
  suit_number          text,
  court_name           text,
  method               public.service_method not null,
  served_at            timestamptz not null default now(),
  served_by            uuid references public.profiles,
  acknowledged_at      timestamptz,
  acknowledged_by      uuid references public.profiles,
  acknowledgement_note text,
  proof_document_id    uuid references public.documents on delete set null,          -- affidavit of service, courier slip
  note                 text,
  created_at           timestamptz not null default now()
);
create index process_service_matter_idx  on public.process_service (matter_id, served_at desc);
create index process_service_counsel_idx on public.process_service (counsel_id);

-- a member of the firm that was served (only meaningful when counsel is on Docket)
create or replace function public.is_served_firm_member(p_counsel uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from matter_counsel mc
                    where mc.id = p_counsel and mc.counsel_firm_id is not null and public.is_firm_member(mc.counsel_firm_id)) $$;

alter table public.process_service enable row level security;
create policy process_service_select on public.process_service for select
  using (is_firm_member(firm_id) or is_served_firm_member(counsel_id));
create policy process_service_modify on public.process_service for update
  using (staff_w(firm_id)) with check (staff_w(firm_id));
-- rows are created by serve_process() and acknowledged by acknowledge_service(); the serving firm may
-- only touch its own bookkeeping columns directly
revoke insert, delete on public.process_service from anon, authenticated;
revoke update on public.process_service from anon, authenticated;
grant  update (note, proof_document_id) on public.process_service to authenticated;

-- a served document is readable (and downloadable — the storage policies call this) by the served firm
create or replace function public.can_access_document(d uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (
       select 1 from documents doc
       where doc.id = d
         and ( public.is_firm_member(doc.firm_id)
            or (doc.client_visible and doc.deleted_at is null
                and (public.is_matter_party(doc.matter_id) or public.is_appointment_client(doc.appointment_id)))
            or exists (select 1 from process_service ps
                       where ps.document_id = doc.id and public.is_served_firm_member(ps.counsel_id)) ) ) $$;

-- ---------------------------------------------------------------- serve_process
create or replace function public.serve_process(
  p_matter uuid, p_counsel uuid, p_document uuid, p_process_title text,
  p_method public.service_method, p_served_at timestamptz default now(), p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_m matters%rowtype; v_c matter_counsel%rowtype; v_d documents%rowtype; v_id uuid; v_firm_name text;
        v_to text; r record;
begin
  select * into v_m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  if not staff_w(v_m.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into v_c from matter_counsel where id = p_counsel and matter_id = p_matter;
  if not found then raise exception 'counsel is not on this matter'; end if;
  select * into v_d from documents where id = p_document and matter_id = p_matter and firm_id = v_m.firm_id and deleted_at is null;
  if not found then raise exception 'document is not on this matter'; end if;
  if length(trim(coalesce(p_process_title, ''))) = 0 then raise exception 'process title is required'; end if;
  if p_method = 'platform' and v_c.counsel_firm_id is null then
    raise exception 'counsel is not on Docket — choose another method of service';
  end if;

  insert into process_service (firm_id, matter_id, counsel_id, document_id, process_title, case_title, suit_number, court_name,
                               method, served_at, served_by, note)
  values (v_m.firm_id, p_matter, p_counsel, p_document, trim(p_process_title), v_m.title, v_m.suit_number, v_m.court_name,
          p_method, coalesce(p_served_at, now()), auth.uid(), p_note)
  returning id into v_id;

  v_to := coalesce(v_c.counsel_name, v_c.counsel_firm_name, (select name from firms where id = v_c.counsel_firm_id), 'counsel');
  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
  values (p_matter, v_m.firm_id, 'filing', 'client',
          format('%s served on %s', trim(p_process_title), v_to), p_note,
          jsonb_build_object('process_service_id', v_id, 'method', p_method, 'document_id', p_document),
          coalesce(p_served_at, now()), auth.uid());

  if v_c.counsel_firm_id is not null then
    select name into v_firm_name from firms where id = v_m.firm_id;
    for r in select user_id from firm_members where firm_id = v_c.counsel_firm_id and role in ('owner','admin','lawyer') loop
      perform enqueue_notification(r.user_id, v_c.counsel_firm_id, 'process_served',
        jsonb_build_object('process_service_id', v_id, 'process_title', trim(p_process_title),
                           'case_title', v_m.title, 'suit_number', v_m.suit_number,
                           'serving_firm_id', v_m.firm_id, 'serving_firm_name', v_firm_name));
    end loop;
  end if;

  perform audit('process.served', 'process_service', v_id, v_m.firm_id,
                jsonb_build_object('matter_id', p_matter, 'counsel_id', p_counsel, 'method', p_method, 'document_id', p_document));
  return v_id;
end $$;

-- ---------------------------------------------------------------- acknowledge_service (by the served firm)
create or replace function public.acknowledge_service(p_service uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_s process_service%rowtype; v_c matter_counsel%rowtype; v_ack_firm text;
begin
  select * into v_s from process_service where id = p_service for update;
  if not found then raise exception 'service record not found'; end if;
  select * into v_c from matter_counsel where id = v_s.counsel_id;
  if v_c.counsel_firm_id is null or not staff_w(v_c.counsel_firm_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_s.acknowledged_at is not null then raise exception 'already acknowledged'; end if;

  update process_service set acknowledged_at = now(), acknowledged_by = auth.uid(), acknowledgement_note = p_note
   where id = p_service;

  select name into v_ack_firm from firms where id = v_c.counsel_firm_id;
  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
  values (v_s.matter_id, v_s.firm_id, 'correspondence', 'internal',
          format('Service of %s acknowledged by %s', v_s.process_title, v_ack_firm), p_note,
          jsonb_build_object('process_service_id', p_service), now(), auth.uid());
  if v_s.served_by is not null then
    perform enqueue_notification(v_s.served_by, v_s.firm_id, 'service_acknowledged',
      jsonb_build_object('process_service_id', p_service, 'process_title', v_s.process_title, 'by_firm', v_ack_firm));
  end if;
  perform audit('process.acknowledged', 'process_service', p_service, v_s.firm_id, jsonb_build_object('by_firm', v_c.counsel_firm_id));
  perform audit('process.acknowledged', 'process_service', p_service, v_c.counsel_firm_id, jsonb_build_object('serving_firm', v_s.firm_id));
end $$;

-- ---------------------------------------------------------------- what the served firm sees: its inbox
-- Definer view (the served firm cannot read matter_counsel under its own RLS); the predicate
-- restricts rows to members of the served firm or of the serving firm.
create view public.service_inbox with (security_invoker = false) as
  select ps.id, ps.process_title, ps.case_title, ps.suit_number, ps.court_name, ps.method, ps.served_at,
         ps.acknowledged_at, ps.document_id, ps.firm_id as serving_firm_id, mc.counsel_firm_id as served_firm_id
  from public.process_service ps
  join public.matter_counsel mc on mc.id = ps.counsel_id
  where mc.counsel_firm_id is not null
    and (public.is_firm_member(mc.counsel_firm_id) or public.is_firm_member(ps.firm_id));
revoke all on public.service_inbox from anon;
grant select on public.service_inbox to authenticated;

revoke execute on function public.is_served_firm_member(uuid) from public, anon;
grant  execute on function public.is_served_firm_member(uuid) to authenticated;
revoke execute on function public.serve_process(uuid,uuid,uuid,text,public.service_method,timestamptz,text) from public, anon;
grant  execute on function public.serve_process(uuid,uuid,uuid,text,public.service_method,timestamptz,text) to authenticated;
revoke execute on function public.acknowledge_service(uuid,text) from public, anon;
grant  execute on function public.acknowledge_service(uuid,text) to authenticated;
