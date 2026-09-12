-- A dropped connection loses nothing, and a retry makes nothing twice.
--
-- A lawyer posts a court update from a corridor on a phone. When the reply is lost the form
-- cannot know whether the posting landed; "send again" made a second timeline entry, a second
-- court event and a second client notification — and messages are immutable, so the duplicate
-- could not be withdrawn. Now the form mints a client reference for each posting and
-- post_court_update() returns the update already made for it instead of making another.
-- A message carries a client-minted id for the same reason (the primary key does the rest).
--
-- An upload that stopped between the documents row and the bytes left a row with no file that
-- the client saw as a document, the firm counted as an upload to review, and a document request
-- accepted as its answer. Such a row answers nothing now, can be retired by whoever made it or
-- by the firm, and is counted where the platform watches integrity.

-- ---------------------------------------------------------------- 1. a posting has a reference
alter table public.updates add column client_ref uuid;
create unique index updates_client_ref_idx on public.updates (matter_id, client_ref) where client_ref is not null;
comment on column public.updates.client_ref is 'Minted by the form for one posting; the same reference on the same matter is the same posting, so a retry returns this row.';

drop function public.post_court_update(uuid, text, timestamptz, text, text, timestamptz, text, text, text, uuid, text, boolean, text, text, text, text, text, text, boolean, date);
CREATE OR REPLACE FUNCTION public.post_court_update(p_matter uuid, p_outcome text, p_occurred_at timestamp with time zone DEFAULT now(), p_court_name text DEFAULT NULL::text, p_adjourned_at_instance_of text DEFAULT NULL::text, p_next_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_next_purpose text DEFAULT NULL::text, p_note_to_client text DEFAULT NULL::text, p_internal_note text DEFAULT NULL::text, p_court_id uuid DEFAULT NULL::uuid, p_judicial_division text DEFAULT NULL::text, p_allow_non_sitting boolean DEFAULT false, p_judge text DEFAULT NULL::text, p_courtroom text DEFAULT NULL::text, p_purpose_kind text DEFAULT NULL::text, p_meaning text DEFAULT NULL::text, p_next_step text DEFAULT NULL::text, p_client_action text DEFAULT NULL::text, p_action_required boolean DEFAULT NULL::boolean, p_next_update_by date DEFAULT NULL::date, p_client_ref uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_m matters%rowtype; v_tz text := 'Africa/Lagos'; v_title text; v_update uuid; v_next_txt text; v_court courts%rowtype; v_court_name text;
begin
  select * into v_m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  if not (staff_w(v_m.firm_id) and can_see_matter(v_m.id)) then raise exception 'not permitted' using errcode = '42501'; end if;
  -- A retry of a call whose reply was lost (migration 36): the same client reference on the same
  -- matter is the same posting, and the update it made is returned rather than made again.
  if p_client_ref is not null then
    select id into v_update from updates where matter_id = p_matter and client_ref = p_client_ref;
    if v_update is not null then return v_update; end if;
  end if;
  if p_outcome not in ('hearing_held','adjourned','ruling_delivered','judgment_delivered','struck_out','stood_down','mention',
                       'court_did_not_sit','hearing_notice','adjourned_sine_die') then
    raise exception 'unknown outcome %', p_outcome;
  end if;
  if p_outcome = 'hearing_notice' and p_next_date is null then raise exception 'a hearing notice fixes a date'; end if;
  -- The structured client update: a stated "nothing needed" and a stated action are different
  -- facts, and neither may contradict the other. Unstated (null) is allowed and is shown as such.
  if p_action_required is true and nullif(trim(p_client_action), '') is null then
    raise exception 'say what the client must do, or mark that nothing is needed from them';
  end if;
  if p_action_required is false and nullif(trim(p_client_action), '') is not null then
    raise exception 'nothing is needed from the client, so leave what they must do empty';
  end if;

  if p_court_id is not null then
    select * into v_court from courts where id = p_court_id and (firm_id is null or firm_id = v_m.firm_id);
    if not found then raise exception 'court % is not available to this firm', p_court_id; end if;
  elsif v_m.court_id is not null then
    select * into v_court from courts where id = v_m.court_id;
  end if;
  v_court_name := coalesce(p_court_name,
                           case when v_court.id is not null then v_court.name || coalesce(', ' || coalesce(p_judicial_division, v_m.judicial_division), '') end,
                           v_m.court_name);

  if p_next_date is not null and not p_allow_non_sitting
     and is_non_sitting_day((p_next_date at time zone v_tz)::date, v_court.level, v_court.state_code) then
    raise exception 'next date % is a weekend, public holiday or court vacation — confirm the vacation judge will sit (p_allow_non_sitting)',
      to_char(p_next_date at time zone v_tz, 'FMDD Mon YYYY');
  end if;

  v_next_txt := case when p_next_date is not null
                     then to_char(p_next_date at time zone v_tz, 'FMDD Mon YYYY')
                          || coalesce(' for ' || p_next_purpose, '') end;

  v_title := case p_outcome
    when 'hearing_held'       then 'Hearing held'
    when 'adjourned'          then 'Adjourned' || coalesce(' at the instance of ' || p_adjourned_at_instance_of, '')
                                   || coalesce(' to ' || v_next_txt, '')
    when 'adjourned_sine_die' then 'Adjourned sine die — a new date will be communicated by the court'
    when 'hearing_notice'     then 'Hearing notice: matter fixed for ' || v_next_txt
    when 'ruling_delivered'   then 'Ruling delivered'
    when 'judgment_delivered' then 'Judgment delivered'
    when 'struck_out'         then 'Matter struck out'
    when 'stood_down'         then 'Matter stood down'
    when 'mention'            then 'Matter came up for mention'
    when 'court_did_not_sit'  then 'Court did not sit'
  end;
  if p_outcome not in ('adjourned','hearing_notice','adjourned_sine_die') and v_next_txt is not null then
    v_title := v_title || ' — next date ' || v_next_txt;
  end if;

  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by,
                       meaning, next_step, client_action, action_required, next_update_by, client_ref)
  values (p_matter, v_m.firm_id, 'court_sitting', 'client', v_title, p_note_to_client,
          jsonb_build_object('outcome', p_outcome, 'court_name', v_court_name, 'court_id', v_court.id,
                             'adjourned_at_instance_of', p_adjourned_at_instance_of,
                             'next_date', p_next_date, 'next_purpose', p_next_purpose, 'judge', p_judge, 'courtroom', p_courtroom),
          p_occurred_at, auth.uid(),
          nullif(trim(p_meaning), ''), nullif(trim(p_next_step), ''), nullif(trim(p_client_action), ''), p_action_required, p_next_update_by, p_client_ref)
  returning id into v_update;

  if p_internal_note is not null and length(trim(p_internal_note)) > 0 then
    insert into updates (matter_id, firm_id, kind, visibility, title, body, occurred_at, posted_by)
    values (p_matter, v_m.firm_id, 'note', 'internal', 'Internal note — ' || v_title, p_internal_note, p_occurred_at, auth.uid());
  end if;

  -- a sitting closes the event fixed for that court day; a hearing notice does not (no sitting happened)
  if p_outcome <> 'hearing_notice' then
    update court_events set outcome_update_id = v_update
     where matter_id = p_matter and outcome_update_id is null and vacated_at is null
       and (scheduled_at at time zone v_tz)::date = (p_occurred_at at time zone v_tz)::date;
  end if;

  if p_next_date is not null then
    insert into court_events (matter_id, firm_id, scheduled_at, court_name, court_id, purpose, purpose_kind, judge, courtroom, source)
    values (p_matter, v_m.firm_id, p_next_date, v_court_name, v_court.id, p_next_purpose, p_purpose_kind, p_judge, p_courtroom,
            case when p_outcome = 'hearing_notice' then 'hearing_notice' else 'firm' end);
    update matters set next_event_at = p_next_date, next_event_note = p_next_purpose, awaiting_date = false,
                       court_name = coalesce(v_court_name, court_name),
                       court_id = coalesce(v_court.id, court_id),
                       judicial_division = coalesce(p_judicial_division, judicial_division),
                       judge = coalesce(p_judge, judge)
     where id = p_matter;
  else
    update matters set next_event_at = null, next_event_note = null, awaiting_date = (p_outcome = 'adjourned_sine_die'),
                       court_id = coalesce(v_court.id, court_id),
                       judicial_division = coalesce(p_judicial_division, judicial_division),
                       judge = coalesce(p_judge, judge)
     where id = p_matter;
  end if;

  return v_update;
end $function$;
revoke execute on function public.post_court_update(uuid, text, timestamptz, text, text, timestamptz, text, text, text, uuid, text, boolean, text, text, text, text, text, text, boolean, date, uuid) from public, anon;
grant  execute on function public.post_court_update(uuid, text, timestamptz, text, text, timestamptz, text, text, text, uuid, text, boolean, text, text, text, text, text, text, boolean, date, uuid) to authenticated;

-- A request has a reference too, for the same reason. The guides say a form that lost its reply
-- can be sent again safely; that was true of a court update and of a message, and not of a
-- request for a document, which had no reference at all and so was asked twice — with a second
-- notification to the client. The reference is per firm, because a request is on a matter or on
-- a consultation and the two live in one table.
alter table public.document_requests add column client_ref uuid;
create unique index document_requests_client_ref_idx on public.document_requests (firm_id, client_ref) where client_ref is not null;
comment on column public.document_requests.client_ref is 'Minted by the form for one request; the same reference in the same firm is the same request, so a retry after a lost reply lands once.';
-- Narrowed while we are here, the way 33 narrowed the update: insert was blanket, so a column
-- added later would have been writable by the API by omission. fulfilled_document_id and
-- fulfilled_at are fulfil_document_request()'s to write, never the caller's.
revoke insert on public.document_requests from authenticated;
grant  insert (id, firm_id, matter_id, appointment_id, title, why, due_on, requested_by, client_ref) on public.document_requests to authenticated;

-- ---------------------------------------------------------------- 2. a document with no file answers nothing, and can be retired
create or replace function public.fulfil_document_request(p_request uuid, p_document uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_r document_requests%rowtype; v_d documents%rowtype; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_r from document_requests where id = p_request;
  if not found or not (matter_row_r(v_r.firm_id, v_r.matter_id) or is_matter_party(v_r.matter_id) or is_appointment_client(v_r.appointment_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_r.cancelled_at is not null then raise exception 'this request was withdrawn'; end if;
  if v_r.fulfilled_at is not null then raise exception 'this request has already been answered'; end if;
  select * into v_d from documents where id = p_document and deleted_at is null;
  -- A document with no bytes yet (an upload that stopped) answers nothing (migration 36).
  if found and v_d.current_version_id is null then raise exception 'that document has no file yet — finish the upload first'; end if;
  if not found or not ((v_r.matter_id is not null and v_d.matter_id = v_r.matter_id)
                    or (v_r.appointment_id is not null and v_d.appointment_id = v_r.appointment_id)) then
    raise exception 'that document is not on this %', case when v_r.matter_id is not null then 'matter' else 'consultation' end;
  end if;
  update document_requests set fulfilled_document_id = v_d.id, fulfilled_at = now() where id = v_r.id;
  perform audit('document_request.fulfilled', 'document_requests', v_r.id, v_r.firm_id,
                jsonb_build_object('document_id', v_d.id, 'title', v_r.title, 'matter_id', v_r.matter_id));
  if v_r.requested_by is not null and v_r.requested_by <> v_uid then
    perform enqueue_notification(v_r.requested_by, v_r.firm_id, 'document_received',
      jsonb_build_object('request_id', v_r.id, 'matter_id', v_r.matter_id, 'appointment_id', v_r.appointment_id, 'title', v_r.title, 'document_id', v_d.id, 'name', v_d.name));
  end if;
end $$;

-- Retire a documents row that never received a version: the person who made it, or the firm's
-- staff who can see the matter or the appointment. A row with a version is a record and stays.
create or replace function public.retire_empty_document(p_document uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d documents%rowtype; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into d from documents where id = p_document and deleted_at is null;
  if not found then raise exception 'document not found'; end if;
  if not (d.uploaded_by = v_uid or matter_row_w(d.firm_id, d.matter_id)) then raise exception 'not permitted' using errcode = '42501'; end if;
  if d.current_version_id is not null or exists (select 1 from document_versions v where v.document_id = d.id) then
    raise exception 'this document has a file and stays';
  end if;
  update documents set deleted_at = now() where id = d.id;
  perform audit('document.retired', 'document', d.id, d.firm_id, jsonb_build_object('name', d.name, 'matter_id', d.matter_id, 'appointment_id', d.appointment_id));
end $$;
revoke execute on function public.retire_empty_document(uuid) from public, anon;
grant  execute on function public.retire_empty_document(uuid) to authenticated;

-- ---------------------------------------------------------------- 3. the orphan is counted
create or replace function public.storage_integrity()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_objects bigint := 0; v_row_only bigint := 0; v_storage boolean := to_regclass('storage.objects') is not null; v_empty bigint := 0;
        v_ok bigint; v_missing bigint; v_mismatch bigint; v_error bigint; v_stale bigint; v_last timestamptz; v_manifest bigint;
begin
  if not (is_platform_admin() and mfa_ok()) then raise exception 'not permitted' using errcode = '42501'; end if;

  if v_storage then
    execute $q$select count(*) from storage.objects where bucket_id in ('documents', 'intake-uploads')$q$ into v_objects;
    -- The failure the runbook warns of: a version row whose bytes the store does not have at all.
    execute $q$select count(*) from public.document_versions dv
                where not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = dv.storage_path)$q$
      into v_row_only;
  end if;

  select count(*) filter (where status = 'ok'), count(*) filter (where status = 'missing'),
         count(*) filter (where status = 'mismatch'), count(*) filter (where status = 'error'),
         count(*) filter (where verified_at < now() - interval '7 days'), max(verified_at), count(*)
    into v_ok, v_missing, v_mismatch, v_error, v_stale, v_last, v_manifest
    from storage_manifest;

  -- The other orphan (migration 36): a documents row that never received a version — an upload
  -- that stopped between the row and the bytes. Listed as a document, counted as an upload to
  -- review, and answering nothing.
  select count(*) into v_empty from documents d where d.deleted_at is null and d.current_version_id is null
     and not exists (select 1 from document_versions v where v.document_id = d.id);
  return jsonb_build_object(
    'documents_without_version', v_empty,
    'storage_present',   v_storage,
    'objects',           v_objects,
    'manifest_rows',     v_manifest,
    'unverified',        greatest(v_objects - v_manifest, 0),
    'ok',                v_ok,
    'missing',           v_missing,
    'mismatch',          v_mismatch,
    'error',             v_error,
    'stale',             v_stale,
    'row_only_versions', v_row_only,
    'last_run_at',       v_last
  );
end $$;
