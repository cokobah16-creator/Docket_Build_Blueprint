-- "We asked for this and it has not arrived" becomes a row.
--
-- A documents row could not exist without bytes, so a request was unrepresentable: staff asked
-- in a message, the client forgot, and nothing on either screen said what was outstanding. The
-- assessment's #15 (first half) and the precondition for pre-consultation check-in (#11).
--
-- A request is staff asking the client on a matter for a named document, with why and by when
-- (a calendar DAY). The client sees it on the matter's documents tab and uploads against it; the
-- upload fulfils the request through fulfil_document_request(), the one door, which checks the
-- document is on the same matter and marks the request fulfilled once. Staff can cancel a request
-- (never delete: what was asked for is part of the file's history). The wall reaches requests as
-- it reaches documents.
create table public.document_requests (
  id                    uuid primary key default gen_random_uuid(),
  firm_id               uuid not null references public.firms(id) on delete cascade,
  matter_id             uuid not null references public.matters(id) on delete cascade,
  title                 text not null check (length(btrim(title)) between 2 and 200),
  why                   text check (why is null or length(why) <= 2000),
  due_on                date,
  requested_by          uuid references public.profiles(id) on delete set null,
  requested_at          timestamptz not null default now(),
  fulfilled_document_id uuid references public.documents(id) on delete set null,
  fulfilled_at          timestamptz,
  cancelled_at          timestamptz,
  check (fulfilled_at is null or cancelled_at is null)
);
create index document_requests_open_idx on public.document_requests (matter_id, due_on) where fulfilled_at is null and cancelled_at is null;
create index document_requests_firm_idx on public.document_requests (firm_id, requested_at desc);

alter table public.document_requests enable row level security;
create policy document_requests_select on public.document_requests for select
  using (matter_row_r(firm_id, matter_id) or is_matter_party(matter_id));
create policy document_requests_insert on public.document_requests for insert
  with check (matter_row_w(firm_id, matter_id) and requested_by = (select auth.uid()));
-- Staff edit or cancel; fulfilment goes through the function. Never deleted.
create policy document_requests_update on public.document_requests for update
  using (matter_row_w(firm_id, matter_id)) with check (matter_row_w(firm_id, matter_id));
revoke all on public.document_requests from anon;
revoke delete on public.document_requests from authenticated;
grant select, insert, update on public.document_requests to authenticated;

comment on table public.document_requests is
  'Staff asking the client on a matter for a named document, by a calendar day. Fulfilled once through fulfil_document_request(); cancelled, never deleted.';

-- The client (or staff on their behalf) links an uploaded document to the request. The document
-- must be on the same matter; a request is fulfilled once; a cancelled request cannot be.
create or replace function public.fulfil_document_request(p_request uuid, p_document uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_r document_requests%rowtype; v_d documents%rowtype; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_r from document_requests where id = p_request;
  if not found or not (matter_row_r(v_r.firm_id, v_r.matter_id) or is_matter_party(v_r.matter_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_r.cancelled_at is not null then raise exception 'this request was withdrawn'; end if;
  if v_r.fulfilled_at is not null then raise exception 'this request has already been answered'; end if;
  select * into v_d from documents where id = p_document and deleted_at is null;
  if not found or v_d.matter_id is distinct from v_r.matter_id then
    raise exception 'that document is not on this matter';
  end if;
  update document_requests set fulfilled_document_id = v_d.id, fulfilled_at = now() where id = v_r.id;
  perform audit('document_request.fulfilled', 'document_requests', v_r.id, v_r.firm_id,
                jsonb_build_object('document_id', v_d.id, 'title', v_r.title, 'matter_id', v_r.matter_id));
  if v_r.requested_by is not null and v_r.requested_by <> v_uid then
    perform enqueue_notification(v_r.requested_by, v_r.firm_id, 'document_received',
      jsonb_build_object('request_id', v_r.id, 'matter_id', v_r.matter_id, 'title', v_r.title, 'document_id', v_d.id, 'name', v_d.name));
  end if;
end $$;
revoke execute on function public.fulfil_document_request(uuid, uuid) from public, anon;
grant  execute on function public.fulfil_document_request(uuid, uuid) to authenticated;

-- The client is told what was asked for, and by when.
create or replace function public.notify_document_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select user_id from matter_parties where matter_id = new.matter_id and role in ('client', 'contact') loop
    perform enqueue_notification(r.user_id, new.firm_id, 'document_requested',
      jsonb_build_object('request_id', new.id, 'matter_id', new.matter_id, 'title', new.title, 'due_on', new.due_on));
  end loop;
  return new;
end $$;
drop trigger if exists document_requests_notify on public.document_requests;
create trigger document_requests_notify after insert on public.document_requests
  for each row execute function public.notify_document_request();
revoke execute on function public.notify_document_request() from public, anon, authenticated;
