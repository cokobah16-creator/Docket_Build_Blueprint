-- Document reads are recorded, and the record is what lets the bytes out.
--
-- audit_log records writes. Nobody could say who had OPENED a document — which, once a firm can
-- wall a matter (migration 29), is the detective control a wall needs: without it a firm cannot
-- even discover after the fact that a colleague opened a file they had no business in. A log the
-- app writes before fetching a file would be a log the app can forget to write. This one cannot be
-- skipped: the storage policy on the documents bucket requires a read recorded by the caller, for
-- that version, within the last five minutes — and a signed URL is minted under that policy. No
-- record, no bytes. The console and the portal call open_document_version() and then ask for the
-- URL; anything else asking storage directly gets nothing.
--
-- APPLY THIS ONLY WITH ITS FRONT END. A deployed front end that asks storage without recording a
-- read stops opening documents the moment this is live. Deploy the app that calls
-- open_document_version() first, then apply.
--
-- Who may read the record: staff who can see the matter (or the firm, for an appointment
-- document) — the same test as the document itself. A client sees no record: they get the one
-- derived fact on the document, "seen by your firm". Every open also lands in audit_log as
-- document.opened, so the firm's audit screen shows it beside everything else.

create table public.document_reads (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.document_versions(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  firm_id     uuid not null references public.firms(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  at          timestamptz not null default now()
);
create index document_reads_gate_idx on public.document_reads (version_id, user_id, at desc);
create index document_reads_document_idx on public.document_reads (document_id, at desc);

alter table public.document_reads enable row level security;
create policy document_reads_select on public.document_reads for select
  using (exists (select 1 from public.documents d where d.id = document_id and public.matter_row_r(d.firm_id, d.matter_id)));
revoke all on public.document_reads from anon;
revoke insert, update, delete on public.document_reads from authenticated;
grant select on public.document_reads to authenticated;

comment on table public.document_reads is
  'One row per open of a document version, written only by open_document_version(). The storage read policy requires a row by the caller within five minutes, so no bytes leave without one.';

-- The one door. The access test is can_access_document_version(): the firm (through the wall),
-- the client on the matter or appointment for a client-visible document, or a served firm for the
-- exact version served. Returns what the caller needs to ask storage for the file.
create or replace function public.open_document_version(p_version uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ver document_versions%rowtype; v_doc documents%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not can_access_document_version(p_version) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into v_ver from document_versions where id = p_version;
  select * into v_doc from documents where id = v_ver.document_id;
  insert into document_reads (version_id, document_id, firm_id, user_id) values (v_ver.id, v_doc.id, v_doc.firm_id, v_uid);
  perform audit('document.opened', 'document_versions', v_ver.id, v_doc.firm_id,
                jsonb_build_object('document_id', v_doc.id, 'name', v_doc.name, 'matter_id', v_doc.matter_id, 'appointment_id', v_doc.appointment_id));
  return jsonb_build_object('storage_path', v_ver.storage_path, 'mime', v_ver.mime, 'size_bytes', v_ver.size_bytes, 'name', v_doc.name);
end $$;
revoke execute on function public.open_document_version(uuid) from public, anon;
grant  execute on function public.open_document_version(uuid) to authenticated;

-- What the storage policy asks: has THIS caller recorded a read of THIS version just now?
create or replace function public.recorded_read(v uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from document_reads r
                  where r.version_id = v and r.user_id = auth.uid() and r.at > now() - interval '5 minutes')
$$;
revoke execute on function public.recorded_read(uuid) from public;
grant  execute on function public.recorded_read(uuid) to anon, authenticated;

-- The gate, on the bytes. Same shape as migration 12's policy with the record required too.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not present — skipping storage policy update';
    return;
  end if;
  execute $p$ drop policy if exists "documents: read the version you may access" on storage.objects $p$;
  execute $p$
    create policy "documents: read the version you may access, having recorded the read" on storage.objects for select
      using (bucket_id = 'documents'
             and public.can_access_document_version(split_part(storage.filename(name), '.', 1)::uuid)
             and public.recorded_read(split_part(storage.filename(name), '.', 1)::uuid))
  $p$;
end $$;
