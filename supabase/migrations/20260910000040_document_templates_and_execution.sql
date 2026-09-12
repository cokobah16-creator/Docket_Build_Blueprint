-- A document drawn from the matter's own facts, and its execution: signed here with evidence,
-- or on paper and recorded.
--
-- Nothing in Docket could produce a document from what a matter already knows, and a signature
-- had nowhere to be. Now a firm keeps TEMPLATES — a body of text with {placeholders} that name
-- facts on the matter (the client, the court, the suit number, the lawyer with conduct, the firm)
-- — and prepare_generated_document() fills one from those facts, refusing to guess: a placeholder
-- whose fact is empty stops the generation and is named. The exact map of values rendered, and
-- the column each came from, is frozen on the version; a placeholder may never draw from an
-- internal note. The app renders the PDF as the signed-in person, hashes the bytes, and
-- finalize_generated_version() records the version as 'generated' with that checksum — the only
-- path that can mark a version generated, because the API roles can insert nothing but a plain
-- upload's columns.
--
-- A SIGNATURE IS WHAT THE DATABASE SAW, and no more: who (auth.uid()), the name they typed and
-- that it is theirs, the version and its checksum, that they opened exactly those bytes first
-- (a document_reads row within the half hour — the record migration 30 made the door), when
-- (UTC), and the terms version in force. No certificate, no cryptographic seal, no address from a
-- header anyone can set (migration 24's reasoning stands). A firm may only ask for an electronic
-- signature where the template allows it; an instrument the template marks 'paper' — a deed, an
-- affidavit sworn before a commissioner, anything stamped or registered — is executed on paper,
-- the scanned copy uploaded, and record_paper_execution() records the day (a calendar day), the
-- witness, who attested it and the stamp or registration reference, against that scanned version.
--
-- EXECUTION LOCKS THE DOCUMENT. From the first signature or the paper record, no further version
-- can be added to the document and its current version cannot be moved — by anyone, through any
-- door, the definer functions included — and it cannot be deleted. A change is a new document.
-- Signatures on a locked document may still be added to the locked version itself: the client
-- signs, the firm countersigns, the same bytes.

-- ---------------------------------------------------------------- 1. templates
create table if not exists public.document_templates (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms(id) on delete cascade,
  name         text not null check (length(name) between 2 and 120),
  matter_types matter_type[],                                          -- null: every type
  body         text not null check (length(body) between 1 and 60000),
  execution    text not null default 'either' check (execution in ('electronic', 'paper', 'either')),
  version      int  not null default 1,
  note         text check (note is null or length(note) <= 1000),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  retired_at   timestamptz
);
comment on table public.document_templates is 'A firm''s document template: text with {placeholders} naming facts on the matter. execution says how the instrument may be executed: electronically here, on paper, or either. The version bumps on every change of the body.';
alter table public.document_templates enable row level security;
create policy document_templates_select on public.document_templates for select using (is_firm_member(firm_id));
create policy document_templates_write_ins on public.document_templates for insert with check (admin_w(firm_id));
create policy document_templates_write_upd on public.document_templates for update using (admin_w(firm_id)) with check (admin_w(firm_id));
create policy document_templates_write_del on public.document_templates for delete using (admin_w(firm_id));
grant select, insert, update, delete on public.document_templates to authenticated;
revoke truncate, references, trigger on public.document_templates from anon, authenticated;
create trigger audit_document_templates after insert or update or delete on public.document_templates for each row execute function public.audit_row_change();

-- The facts a template may name. The list, not a note: nothing internal is ever on it.
create or replace function public.document_template_placeholders() returns text[]
language sql immutable as $$
  select array['firm.name','firm.legal_name','firm.rc_number','firm.address','firm.email','firm.phone',
               'matter.reference','matter.title','matter.cause_title','matter.type','matter.suit_number','matter.court',
               'matter.judicial_division','matter.judge','matter.opened_on','matter.opposing_party',
               'client.name','client.company','client.address','client.email','client.phone',
               'lawyer.name','lawyer.scn','lawyer.title','today']::text[]
$$;
grant execute on function public.document_template_placeholders() to authenticated;

create or replace function public.document_template_keys(p_body text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct m[1]), '{}'::text[]) from regexp_matches(coalesce(p_body, ''), '\{([a-z0-9_.]+)\}', 'g') m
$$;
grant execute on function public.document_template_keys(text) to authenticated;

create or replace function public.validate_document_template() returns trigger
language plpgsql set search_path = public as $$
declare k text; v_known text[] := document_template_placeholders();
begin
  foreach k in array document_template_keys(new.body) loop
    if not (k = any(v_known)) and k !~ '^extra\.[a-z0-9_]{1,40}$' then
      raise exception 'the placeholder {%} names nothing a template may draw on — the facts are %, or {extra.<name>} for a value typed at generation', k, array_to_string(v_known, ', ');
    end if;
  end loop;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  elsif new.body is distinct from old.body or new.execution is distinct from old.execution then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger document_templates_validate before insert or update on public.document_templates for each row execute function public.validate_document_template();

-- ---------------------------------------------------------------- 2. what a version and a document now carry
alter table public.document_versions
  add column if not exists kind                 text not null default 'upload' check (kind in ('upload', 'generated', 'executed_paper')),
  add column if not exists source_template_id   uuid references public.document_templates(id) on delete set null,
  add column if not exists template_version     int,
  add column if not exists facts                jsonb,
  add column if not exists executed_on          date,
  add column if not exists witness_name         text check (witness_name is null or length(witness_name) <= 200),
  add column if not exists attested_by          text check (attested_by is null or length(attested_by) <= 200),
  add column if not exists stamp_ref            text check (stamp_ref is null or length(stamp_ref) <= 120),
  add column if not exists registration_ref     text check (registration_ref is null or length(registration_ref) <= 120),
  add column if not exists executed_recorded_by uuid references public.profiles(id) on delete set null;
comment on column public.document_versions.facts is 'For a generated version: the exact value rendered for every placeholder, and the column each came from. Frozen; never re-read.';
comment on column public.document_versions.executed_on is 'For an instrument executed on paper: the calendar day of execution, as written on it. Never shifted.';
-- The API roles insert a plain upload and nothing else; kind, facts and the paper record are the functions'.
revoke insert on public.document_versions from anon, authenticated;
grant insert (id, document_id, storage_path, mime, size_bytes, checksum, uploaded_by) on public.document_versions to authenticated;

alter table public.documents
  add column if not exists locked_version_id      uuid references public.document_versions(id) on delete restrict,
  add column if not exists locked_at              timestamptz,
  add column if not exists signature_requested_at timestamptz,
  add column if not exists signature_requested_by uuid references public.profiles(id) on delete set null;
comment on column public.documents.locked_version_id is 'Set by the first signature or the paper record: the executed version. From then on no version is added, the pointer does not move, the row is not deleted.';
-- The API roles update what the screens update and nothing else: the pointer and the lock are the functions'.
revoke update on public.documents from anon, authenticated;
grant update (name, category, client_visible, reviewed_at, reviewed_by) on public.documents to authenticated;

create or replace function public.document_lock_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.locked_version_id is not null then
    if new.locked_version_id is distinct from old.locked_version_id or new.locked_at is distinct from old.locked_at then
      raise exception 'this document is locked on its executed version and the lock does not move';
    end if;
    if new.current_version_id is distinct from old.current_version_id then
      raise exception 'this document is locked on its executed version: the current version does not move';
    end if;
    if new.deleted_at is not null and old.deleted_at is null then
      raise exception 'an executed document is not deleted';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists documents_lock_guard on public.documents;
create trigger documents_lock_guard before update on public.documents for each row execute function public.document_lock_guard();

create or replace function public.document_versions_lock_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from documents d where d.id = new.document_id and d.locked_version_id is not null) then
    raise exception 'this document is locked on its executed version: no further version can be added — a change is a new document';
  end if;
  return new;
end $$;
drop trigger if exists document_versions_lock_guard on public.document_versions;
create trigger document_versions_lock_guard before insert on public.document_versions for each row execute function public.document_versions_lock_guard();

-- ---------------------------------------------------------------- 3. signatures
create table if not exists public.document_signatures (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents(id) on delete cascade,
  version_id      uuid not null references public.document_versions(id) on delete restrict,
  firm_id         uuid not null references public.firms(id) on delete cascade,
  matter_id       uuid references public.matters(id) on delete cascade,
  signer_id       uuid not null references public.profiles(id) on delete restrict,
  signer_role     text not null check (signer_role in ('client', 'staff')),
  signer_name     text not null,
  signer_scn      text,
  checksum        text not null,
  read_at         timestamptz not null,
  signed_at       timestamptz not null default now(),
  consent_version text,
  unique (version_id, signer_id)
);
comment on table public.document_signatures is 'What the database saw when a person signed a version here: who, the name they typed, the version and its checksum, that they had opened those bytes, when, and the terms in force. Nothing more is claimed.';
alter table public.document_signatures enable row level security;
create policy document_signatures_select on public.document_signatures for select using (can_access_document(document_id));
grant select on public.document_signatures to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.document_signatures from anon, authenticated;
create index if not exists document_signatures_document_idx on public.document_signatures (document_id, signed_at);

-- ---------------------------------------------------------------- 4. the facts, and the generation
create or replace function public.document_facts(p_matter uuid, p_client uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m matters%rowtype; f firms%rowtype; c courts%rowtype; p profiles%rowtype; lp lawyer_profiles%rowtype; lawyer profiles%rowtype;
        v_client uuid; v_tz text; v_vals jsonb; v_src jsonb;
begin
  select * into m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  select * into f from firms where id = m.firm_id;
  v_tz := coalesce(f.timezone, 'Africa/Lagos');
  if m.court_id is not null then select * into c from courts where id = m.court_id; end if;
  v_client := p_client;
  if v_client is null then
    select mp.user_id into v_client from matter_parties mp where mp.matter_id = p_matter and mp.role = 'client' order by mp.user_id limit 1;
  elsif not exists (select 1 from matter_parties mp where mp.matter_id = p_matter and mp.user_id = v_client and mp.role = 'client') then
    raise exception 'that person is not a client on this matter';
  end if;
  if v_client is not null then select * into p from profiles where id = v_client; end if;
  if m.handling_lawyer_id is not null then
    select * into lawyer from profiles where id = m.handling_lawyer_id;
    select * into lp from lawyer_profiles where firm_id = m.firm_id and user_id = m.handling_lawyer_id;
  end if;
  v_vals := jsonb_build_object(
    'firm.name', f.name, 'firm.legal_name', coalesce(f.legal_name, f.name), 'firm.rc_number', f.rc_number,
    'firm.address', f.brand -> 'contact' ->> 'address', 'firm.email', f.brand -> 'contact' ->> 'email', 'firm.phone', f.brand -> 'contact' ->> 'phone',
    'matter.reference', m.reference, 'matter.title', m.title, 'matter.cause_title', m.cause_title, 'matter.type', m.type::text,
    'matter.suit_number', m.suit_number, 'matter.court', coalesce(c.name, m.court_name), 'matter.judicial_division', coalesce(m.judicial_division, c.division),
    'matter.judge', m.judge, 'matter.opened_on', to_char(m.opened_at, 'FMDD FMMonth YYYY'), 'matter.opposing_party', m.opposing_party,
    'client.name', p.full_name, 'client.company', p.company_name, 'client.address', p.address, 'client.email', p.email, 'client.phone', p.phone,
    'lawyer.name', lawyer.full_name, 'lawyer.scn', lp.scn, 'lawyer.title', lp.title,
    'today', to_char((now() at time zone v_tz)::date, 'FMDD FMMonth YYYY'));
  v_src := jsonb_build_object(
    'firm.name', 'firms.name', 'firm.legal_name', 'firms.legal_name', 'firm.rc_number', 'firms.rc_number',
    'firm.address', 'firms.brand.contact.address', 'firm.email', 'firms.brand.contact.email', 'firm.phone', 'firms.brand.contact.phone',
    'matter.reference', 'matters.reference', 'matter.title', 'matters.title', 'matter.cause_title', 'matters.cause_title', 'matter.type', 'matters.type',
    'matter.suit_number', 'matters.suit_number', 'matter.court', case when c.id is not null then 'courts.name' else 'matters.court_name' end,
    'matter.judicial_division', 'matters.judicial_division', 'matter.judge', 'matters.judge', 'matter.opened_on', 'matters.opened_at', 'matter.opposing_party', 'matters.opposing_party',
    'client.name', 'profiles.full_name', 'client.company', 'profiles.company_name', 'client.address', 'profiles.address', 'client.email', 'profiles.email', 'client.phone', 'profiles.phone',
    'lawyer.name', 'profiles.full_name', 'lawyer.scn', 'lawyer_profiles.scn', 'lawyer.title', 'lawyer_profiles.title',
    'today', 'the day, in the firm''s calendar');
  return jsonb_build_object('values', v_vals, 'sources', v_src, 'client_id', v_client, 'lawyer_id', m.handling_lawyer_id);
end $$;
revoke execute on function public.document_facts(uuid, uuid) from public, anon, authenticated;

-- Fill the template from the facts and open the document. The bytes are the app's to render and
-- store; the version is recorded by finalize_generated_version() below.
create or replace function public.prepare_generated_document(p_matter uuid, p_template uuid, p_name text default null, p_client uuid default null, p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matters%rowtype; t document_templates%rowtype; v_facts jsonb; v_vals jsonb; v_keys text[]; k text; v_missing text[] := '{}'; v_text text;
        v_doc uuid := gen_random_uuid(); v_ver uuid := gen_random_uuid(); v_name text; v_val text; v_used jsonb := '{}'::jsonb;
begin
  select * into m from matters where id = p_matter and deleted_at is null;
  if not found or not matter_row_w(m.firm_id, p_matter) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into t from document_templates where id = p_template and firm_id = m.firm_id;
  if not found then raise exception 'template not found'; end if;
  if t.retired_at is not null then raise exception 'the template "%" is retired', t.name; end if;
  if t.matter_types is not null and not (m.type = any(t.matter_types)) then raise exception 'the template "%" is for % matters', t.name, array_to_string(t.matter_types, ', '); end if;
  v_facts := document_facts(p_matter, p_client);
  v_vals := v_facts -> 'values';
  if p_extra is not null and jsonb_typeof(p_extra) = 'object' then
    for k in select key from jsonb_object_keys(p_extra) key loop
      if k !~ '^[a-z0-9_]{1,40}$' then raise exception 'an extra value is named with lower-case letters, digits and underscores (got "%")', k; end if;
      if jsonb_typeof(p_extra -> k) <> 'string' or length(p_extra ->> k) > 2000 then raise exception 'extra.% is text of at most 2,000 characters', k; end if;
      v_vals := v_vals || jsonb_build_object('extra.' || k, p_extra ->> k);
    end loop;
  end if;
  v_keys := document_template_keys(t.body);
  v_text := t.body;
  foreach k in array v_keys loop
    v_val := nullif(btrim(coalesce(v_vals ->> k, '')), '');
    if v_val is null then v_missing := v_missing || k; continue; end if;
    v_used := v_used || jsonb_build_object(k, jsonb_build_object('value', v_val, 'source', coalesce(v_facts -> 'sources' ->> k, 'typed at generation')));
    v_text := replace(v_text, '{' || k || '}', v_val);
  end loop;
  if cardinality(v_missing) > 0 then
    raise exception 'nothing is guessed: the matter has no value for %', array_to_string(v_missing, ', ');
  end if;
  v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), t.name);
  insert into documents (id, firm_id, matter_id, name, category, client_visible, uploaded_by)
  values (v_doc, m.firm_id, p_matter, left(v_name, 200), 'generated', false, auth.uid());
  return jsonb_build_object('document_id', v_doc, 'version_id', v_ver, 'storage_path', m.firm_id || '/' || v_doc || '/' || v_ver || '.pdf',
                            'name', left(v_name, 200), 'text', v_text, 'facts', v_used, 'template_version', t.version, 'execution', t.execution,
                            'client_id', v_facts ->> 'client_id');
end $$;
revoke execute on function public.prepare_generated_document(uuid, uuid, text, uuid, jsonb) from public, anon;
grant  execute on function public.prepare_generated_document(uuid, uuid, text, uuid, jsonb) to authenticated;

create or replace function public.finalize_generated_version(p_document uuid, p_version uuid, p_storage_path text, p_size_bytes bigint, p_checksum text, p_template uuid, p_facts jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare d documents%rowtype; t document_templates%rowtype;
begin
  select * into d from documents where id = p_document and deleted_at is null for update;
  if not found or not matter_row_w(d.firm_id, d.matter_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if d.category <> 'generated' then raise exception 'only a generated document is finalised here'; end if;
  if d.current_version_id is not null or exists (select 1 from document_versions where document_id = p_document) then raise exception 'this document already has its version'; end if;
  if p_checksum is null or p_checksum !~ '^[0-9a-f]{64}$' then raise exception 'a generated version carries the sha256 of its bytes'; end if;
  if p_storage_path <> d.firm_id || '/' || d.id || '/' || p_version || '.pdf' then raise exception 'the storage path is not this version''s'; end if;
  select * into t from document_templates where id = p_template and firm_id = d.firm_id;
  if not found then raise exception 'template not found'; end if;
  insert into document_versions (id, document_id, storage_path, mime, size_bytes, checksum, uploaded_by, kind, source_template_id, template_version, facts)
  values (p_version, p_document, p_storage_path, 'application/pdf', p_size_bytes, p_checksum, auth.uid(), 'generated', t.id, t.version, coalesce(p_facts, '{}'::jsonb));
  perform audit('document.generated', 'document', p_document, d.firm_id,
                jsonb_build_object('matter_id', d.matter_id, 'version_id', p_version, 'checksum', p_checksum, 'template_id', t.id, 'template_version', t.version, 'template', t.name));
end $$;
revoke execute on function public.finalize_generated_version(uuid, uuid, text, bigint, text, uuid, jsonb) from public, anon;
grant  execute on function public.finalize_generated_version(uuid, uuid, text, bigint, text, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- 5. execution
-- How an instrument may be executed, from the template that made its current version; an
-- uploaded document is 'either'.
create or replace function public.document_execution_mode(p_document uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select t.execution from documents d join document_versions v on v.id = d.current_version_id
                    join document_templates t on t.id = v.source_template_id where d.id = p_document), 'either')
$$;
revoke execute on function public.document_execution_mode(uuid) from public, anon, authenticated;

create or replace function public.request_signature(p_document uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d documents%rowtype; v document_versions%rowtype; r record;
begin
  select * into d from documents where id = p_document and deleted_at is null for update;
  if not found or not matter_row_w(d.firm_id, d.matter_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if d.current_version_id is null then raise exception 'this document has no file yet'; end if;
  select * into v from document_versions where id = d.current_version_id;
  if v.checksum is null then raise exception 'this version has no checksum, so a signature over it would be evidence of nothing — upload it again'; end if;
  if document_execution_mode(p_document) = 'paper' then raise exception 'this instrument is executed on paper: print it, sign before a witness, and upload the signed copy'; end if;
  if d.locked_version_id is not null then raise exception 'this document is already executed'; end if;
  update documents set client_visible = true, signature_requested_at = now(), signature_requested_by = auth.uid() where id = p_document;
  for r in select mp.user_id from matter_parties mp where mp.matter_id = d.matter_id and mp.role = 'client' loop
    perform enqueue_notification(r.user_id, d.firm_id, 'document_ready_to_sign', jsonb_build_object('document_id', d.id, 'matter_id', d.matter_id, 'name', d.name));
  end loop;
  perform audit('document.signature_requested', 'document', p_document, d.firm_id, jsonb_build_object('matter_id', d.matter_id, 'version_id', v.id, 'checksum', v.checksum));
end $$;
revoke execute on function public.request_signature(uuid) from public, anon;
grant  execute on function public.request_signature(uuid) to authenticated;

create or replace function public.record_signature(p_version uuid, p_typed_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v document_versions%rowtype; d documents%rowtype; v_uid uuid := auth.uid(); v_staff boolean; v_is_client boolean; v_name text; v_typed text; v_read timestamptz;
        v_scn text; v_id uuid; v_consent text; r record; v_norm text; v_typed_norm text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v from document_versions where id = p_version;
  if not found then raise exception 'version not found'; end if;
  select * into d from documents where id = v.document_id and deleted_at is null for update;
  if not found then raise exception 'document not found'; end if;
  v_staff := staff_w(d.firm_id) and can_see_matter(d.matter_id);
  -- Who may sign as the client is the matter's CLIENT, not any party to it. is_matter_party() is
  -- true for a contact and for co-counsel as well, and request_signature() asks only the clients —
  -- so without this a contact on a shared document could sign, be recorded as the client signer,
  -- and lock the document before the person whose signature was actually wanted.
  v_is_client := exists (select 1 from matter_parties mp
                          where mp.matter_id = d.matter_id and mp.user_id = v_uid and mp.role = 'client')
              or is_appointment_client(d.appointment_id);
  if not (v_staff or (d.client_visible and v_is_client)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not v_staff and d.signature_requested_at is null then raise exception 'the firm has not asked for a signature on this document'; end if;
  if d.locked_version_id is not null and d.locked_version_id <> v.id then raise exception 'this document is executed on another version'; end if;
  if v.checksum is null then raise exception 'this version has no checksum, so a signature over it would be evidence of nothing'; end if;
  if document_execution_mode(d.id) = 'paper' then raise exception 'this instrument is executed on paper, not signed here'; end if;
  -- An instrument already executed on paper is not also signed here: the record of its execution
  -- is what happened, and a typed name beside it would claim a second, different act.
  if v.kind = 'executed_paper' then raise exception 'this instrument was executed on paper, not signed here'; end if;
  -- The signer opened exactly these bytes, recently. The read record is the door (migration 30).
  select max(at) into v_read from document_reads where version_id = v.id and user_id = v_uid and at > now() - interval '30 minutes';
  if v_read is null then raise exception 'open the document first: a signature is over bytes the signer has seen'; end if;
  select full_name into v_name from profiles where id = v_uid;
  v_norm := lower(regexp_replace(coalesce(v_name, ''), '\s+', ' ', 'g'));
  v_typed_norm := lower(regexp_replace(coalesce(p_typed_name, ''), '\s+', ' ', 'g'));
  if v_norm = '' then raise exception 'your profile has no name to sign with — add it first'; end if;
  if btrim(v_typed_norm) <> btrim(v_norm) then raise exception 'type your name exactly as it is on your profile: %', v_name; end if;
  if v_staff then select scn into v_scn from lawyer_profiles where firm_id = d.firm_id and user_id = v_uid; end if;
  select policies -> 'terms' ->> 'version' into v_consent from firms where id = d.firm_id;
  insert into document_signatures (document_id, version_id, firm_id, matter_id, signer_id, signer_role, signer_name, signer_scn, checksum, read_at, consent_version)
  values (d.id, v.id, d.firm_id, d.matter_id, v_uid, case when v_staff then 'staff' else 'client' end, btrim(p_typed_name), v_scn, v.checksum, v_read, v_consent)
  returning id into v_id;
  if d.locked_version_id is null then
    update documents set locked_version_id = v.id, locked_at = now() where id = d.id;
  end if;
  perform audit('document.signed', 'document', d.id, d.firm_id,
                jsonb_build_object('matter_id', d.matter_id, 'version_id', v.id, 'checksum', v.checksum, 'signer_role', case when v_staff then 'staff' else 'client' end, 'signature_id', v_id, 'read_at', v_read));
  -- This is the one event in Docket with two audiences: the client hears that the firm
  -- countersigned, and the firm hears that the client signed. They open different screens, and a
  -- client sent to /firm/… reaches a page they cannot see — so the payload says whose it is and
  -- both renderers read it rather than guessing from the event name.
  if v_staff then
    if d.client_visible then
      for r in select mp.user_id from matter_parties mp where mp.matter_id = d.matter_id and mp.role = 'client' loop
        perform enqueue_notification(r.user_id, d.firm_id, 'document_signed', jsonb_build_object('document_id', d.id, 'matter_id', d.matter_id, 'name', d.name, 'signer', btrim(p_typed_name), 'audience', 'client'));
      end loop;
    end if;
  else
    for r in select ml.user_id from matter_lawyers ml where ml.matter_id = d.matter_id loop
      perform enqueue_notification(r.user_id, d.firm_id, 'document_signed', jsonb_build_object('document_id', d.id, 'matter_id', d.matter_id, 'name', d.name, 'signer', btrim(p_typed_name), 'audience', 'firm'));
    end loop;
  end if;
  if d.client_visible and d.matter_id is not null then
    insert into updates (matter_id, firm_id, kind, visibility, title, body, occurred_at, posted_by, payload)
    values (d.matter_id, d.firm_id, 'document', 'client', 'Signed: ' || d.name, btrim(p_typed_name) || ' signed ' || d.name || '.', now(), v_uid,
            jsonb_build_object('document_id', d.id, 'version_id', v.id, 'signature_id', v_id));
  end if;
  return v_id;
end $$;
revoke execute on function public.record_signature(uuid, text) from public, anon;
grant  execute on function public.record_signature(uuid, text) to authenticated;

create or replace function public.record_paper_execution(p_document uuid, p_version uuid, p_executed_on date, p_witness_name text default null, p_attested_by text default null, p_stamp_ref text default null, p_registration_ref text default null)
returns void language plpgsql security definer set search_path = public as $$
declare d documents%rowtype; v document_versions%rowtype;
begin
  select * into d from documents where id = p_document and deleted_at is null for update;
  if not found or not matter_row_w(d.firm_id, d.matter_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if d.locked_version_id is not null then raise exception 'this document is already executed'; end if;
  select * into v from document_versions where id = p_version and document_id = p_document;
  if not found then raise exception 'that version is not this document''s'; end if;
  if v.checksum is null then raise exception 'this version has no checksum — upload the signed copy again'; end if;
  if p_executed_on is null then raise exception 'give the day it was executed'; end if;
  if p_executed_on > (now() at time zone 'Africa/Lagos')::date then raise exception 'the day of execution is not in the future'; end if;
  update document_versions
     set kind = 'executed_paper', executed_on = p_executed_on, witness_name = nullif(btrim(coalesce(p_witness_name, '')), ''),
         attested_by = nullif(btrim(coalesce(p_attested_by, '')), ''), stamp_ref = nullif(btrim(coalesce(p_stamp_ref, '')), ''),
         registration_ref = nullif(btrim(coalesce(p_registration_ref, '')), ''), executed_recorded_by = auth.uid()
   where id = p_version;
  update documents set locked_version_id = p_version, locked_at = now(), current_version_id = p_version where id = p_document;
  perform audit('document.executed_on_paper', 'document', p_document, d.firm_id,
                jsonb_build_object('matter_id', d.matter_id, 'version_id', p_version, 'checksum', v.checksum, 'executed_on', p_executed_on,
                                   'witness', nullif(btrim(coalesce(p_witness_name, '')), ''), 'attested_by', nullif(btrim(coalesce(p_attested_by, '')), '')));
  if d.client_visible and d.matter_id is not null then
    insert into updates (matter_id, firm_id, kind, visibility, title, body, occurred_at, posted_by, payload)
    values (d.matter_id, d.firm_id, 'document', 'client', 'Executed: ' || d.name, d.name || ' was executed on ' || to_char(p_executed_on, 'FMDD FMMonth YYYY') || '.', now(), auth.uid(),
            jsonb_build_object('document_id', d.id, 'version_id', p_version, 'executed_on', p_executed_on));
  end if;
end $$;
revoke execute on function public.record_paper_execution(uuid, uuid, date, text, text, text, text) from public, anon;
grant  execute on function public.record_paper_execution(uuid, uuid, date, text, text, text, text) to authenticated;

-- The pointer trigger of migration 10 runs after every version insert; the lock guard above runs
-- before it and refuses the insert, so an executed document's pointer never has a new version to
-- move to. The paper record moves the pointer itself, once, while setting the lock.
