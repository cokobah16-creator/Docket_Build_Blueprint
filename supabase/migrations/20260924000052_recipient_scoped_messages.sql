-- Recipient-scoped lawyer/client messages and private message attachments.
-- Legacy rows are preserved. Where the historical counterparty is unambiguous we backfill it;
-- ambiguous old matter messages keep recipient_id = null and become staff-only instead of being
-- guessed across multiple clients.

alter table public.messages
  add column if not exists recipient_id uuid references public.profiles(id) on delete restrict;
create index if not exists messages_recipient_idx
  on public.messages (recipient_id, created_at desc);

alter table public.documents
  add column if not exists private_recipient_id uuid references public.profiles(id) on delete restrict;
create index if not exists documents_private_recipient_idx
  on public.documents (private_recipient_id)
  where private_recipient_id is not null;

comment on column public.messages.recipient_id is
  'The client or lawyer this correspondence is addressed to. New messages always have one; ambiguous legacy matter messages remain null and are staff-only.';
comment on column public.documents.private_recipient_id is
  'For category=message_attachment only: the one counterparty who may read this attachment besides its uploader and authorised firm staff.';

-- ---------------------------------------------------------------- historical routing
-- Appointments have exactly one client and one lawyer, so their counterparty is knowable.
update public.messages msg
   set recipient_id = case
     when msg.sender_id = a.client_id then a.lawyer_id
     else a.client_id
   end
  from public.appointments a
 where msg.recipient_id is null
   and msg.appointment_id = a.id
   and (
     (msg.sender_id = a.client_id and a.lawyer_id is not null)
     or exists (
       select 1 from public.firm_members fm
        where fm.firm_id = a.firm_id and fm.user_id = msg.sender_id
     )
   );

-- A client's old matter message can safely route to the handling/lead lawyer.
update public.messages msg
   set recipient_id = coalesce(
     m.handling_lawyer_id,
     (select ml.user_id
        from public.matter_lawyers ml
       where ml.matter_id = m.id
       order by ml.is_lead desc, ml.user_id
       limit 1)
   )
  from public.matters m
 where msg.recipient_id is null
   and msg.matter_id = m.id
   and exists (
     select 1 from public.matter_parties mp
      where mp.matter_id = m.id
        and mp.user_id = msg.sender_id
        and mp.role in ('client','contact')
   )
   and not exists (
     select 1 from public.firm_members fm
      where fm.firm_id = m.firm_id and fm.user_id = msg.sender_id
   );

-- A staff message on a matter is safe to backfill only where there was one client/contact.
with one_party as (
  select mp.matter_id, min(mp.user_id::text)::uuid as user_id
    from public.matter_parties mp
   where mp.role in ('client','contact')
   group by mp.matter_id
  having count(*) = 1
)
update public.messages msg
   set recipient_id = op.user_id
  from one_party op
 where msg.recipient_id is null
   and msg.matter_id = op.matter_id
   and exists (
     select 1 from public.firm_members fm
      where fm.firm_id = msg.firm_id and fm.user_id = msg.sender_id
   );

-- ---------------------------------------------------------------- one routing rule used by rows and attachments
create or replace function public.resolve_message_recipient(
  p_firm uuid,
  p_matter uuid,
  p_appointment uuid,
  p_sender uuid,
  p_requested uuid default null
) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_sender_staff boolean;
  v_thread_firm uuid;
  v_client uuid;
  v_lawyer uuid;
  v_candidate uuid := p_requested;
  v_count integer;
begin
  if p_sender is null then
    raise exception 'a message needs a sender' using errcode = '23514';
  end if;
  if auth.uid() is not null and auth.uid() <> p_sender then
    raise exception 'you cannot send as another user' using errcode = '42501';
  end if;
  if (p_matter is null) = (p_appointment is null) then
    raise exception 'a message belongs to exactly one matter or consultation' using errcode = '23514';
  end if;

  select exists (
    select 1 from public.firm_members fm
     where fm.firm_id = p_firm and fm.user_id = p_sender
  ) into v_sender_staff;

  if p_appointment is not null then
    select a.firm_id, a.client_id, a.lawyer_id
      into v_thread_firm, v_client, v_lawyer
      from public.appointments a
     where a.id = p_appointment;
    if not found or v_thread_firm <> p_firm then
      raise exception 'consultation not found in this firm' using errcode = '42501';
    end if;

    if v_sender_staff then
      if v_candidate is null then v_candidate := v_client; end if;
      if v_candidate is distinct from v_client then
        raise exception 'consultation messages from the firm go only to the consultation client'
          using errcode = '42501';
      end if;
    elsif p_sender = v_client then
      if v_lawyer is null then
        raise exception 'this consultation has no lawyer to receive a message yet'
          using errcode = '23514';
      end if;
      if v_candidate is null then v_candidate := v_lawyer; end if;
      if v_candidate is distinct from v_lawyer then
        raise exception 'consultation messages from the client go only to the assigned lawyer'
          using errcode = '42501';
      end if;
    else
      raise exception 'you are not part of this consultation' using errcode = '42501';
    end if;

  else
    select m.firm_id, m.handling_lawyer_id
      into v_thread_firm, v_lawyer
      from public.matters m
     where m.id = p_matter and m.deleted_at is null;
    if not found or v_thread_firm <> p_firm then
      raise exception 'matter not found in this firm' using errcode = '42501';
    end if;

    if v_sender_staff then
      -- A reply follows the latest client who wrote into the thread. If there is no
      -- conversation yet, one client/contact is unambiguous; more than one needs a
      -- future recipient picker rather than a guess.
      if v_candidate is null then
        select mm.sender_id
          into v_candidate
          from public.messages mm
         where mm.matter_id = p_matter
           and mm.sender_id is not null
           and not exists (
             select 1 from public.firm_members fm
              where fm.firm_id = p_firm and fm.user_id = mm.sender_id
           )
         order by mm.created_at desc, mm.id desc
         limit 1;
      end if;
      if v_candidate is null then
        select count(*), min(mp.user_id::text)::uuid
          into v_count, v_candidate
          from public.matter_parties mp
         where mp.matter_id = p_matter and mp.role in ('client','contact');
        if v_count <> 1 then
          raise exception 'choose which client or contact should receive this message'
            using errcode = '23514';
        end if;
      end if;
      if not exists (
        select 1 from public.matter_parties mp
         where mp.matter_id = p_matter
           and mp.user_id = v_candidate
           and mp.role in ('client','contact')
      ) then
        raise exception 'the recipient is not a client or contact on this matter'
          using errcode = '42501';
      end if;

    else
      if not exists (
        select 1 from public.matter_parties mp
         where mp.matter_id = p_matter
           and mp.user_id = p_sender
           and mp.role in ('client','contact')
      ) then
        raise exception 'you are not a client or contact on this matter'
          using errcode = '42501';
      end if;

      if v_candidate is null then
        -- Prefer the lawyer who most recently addressed this client.
        select mm.sender_id
          into v_candidate
          from public.messages mm
         where mm.matter_id = p_matter
           and mm.recipient_id = p_sender
           and exists (
             select 1 from public.firm_members fm
              where fm.firm_id = p_firm and fm.user_id = mm.sender_id
           )
         order by mm.created_at desc, mm.id desc
         limit 1;
      end if;
      if v_candidate is null then
        v_candidate := v_lawyer;
      end if;
      if v_candidate is null then
        select ml.user_id
          into v_candidate
          from public.matter_lawyers ml
         where ml.matter_id = p_matter
         order by ml.is_lead desc, ml.user_id
         limit 1;
      end if;
      if v_candidate is null then
        raise exception 'this matter has no lawyer to receive a message yet'
          using errcode = '23514';
      end if;
      if not (
        exists (
          select 1 from public.matter_lawyers ml
           where ml.matter_id = p_matter and ml.user_id = v_candidate
        )
        or v_candidate = v_lawyer
      ) or not exists (
        select 1 from public.firm_members fm
         where fm.firm_id = p_firm and fm.user_id = v_candidate
      ) then
        raise exception 'the recipient is not a lawyer on this matter'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if v_candidate is null or v_candidate = p_sender then
    raise exception 'a message needs a different recipient' using errcode = '23514';
  end if;
  return v_candidate;
end $$;
revoke execute on function public.resolve_message_recipient(uuid,uuid,uuid,uuid,uuid)
  from public, anon;
grant execute on function public.resolve_message_recipient(uuid,uuid,uuid,uuid,uuid)
  to authenticated;

create or replace function public.route_message_recipient() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.recipient_id := public.resolve_message_recipient(
    new.firm_id, new.matter_id, new.appointment_id, new.sender_id, new.recipient_id
  );
  return new;
end $$;
drop trigger if exists messages_route_recipient on public.messages;
create trigger messages_route_recipient
  before insert on public.messages
  for each row execute function public.route_message_recipient();
revoke execute on function public.route_message_recipient() from public, anon, authenticated;

-- Message attachments use the same counterparty rule. Ordinary matter documents keep their
-- existing visibility model; only this category is private to sender + recipient + authorised staff.
create or replace function public.route_message_attachment_recipient() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.category = 'message_attachment' then
    if new.uploaded_by is null then
      raise exception 'a message attachment needs an uploader' using errcode = '23514';
    end if;
    new.client_visible := false;
    new.private_recipient_id := public.resolve_message_recipient(
      new.firm_id, new.matter_id, new.appointment_id, new.uploaded_by, new.private_recipient_id
    );
  elsif new.private_recipient_id is not null then
    raise exception 'private_recipient_id is only for message attachments' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists documents_route_message_attachment on public.documents;
create trigger documents_route_message_attachment
  before insert or update of category, private_recipient_id, matter_id, appointment_id, uploaded_by
  on public.documents
  for each row execute function public.route_message_attachment_recipient();
revoke execute on function public.route_message_attachment_recipient() from public, anon, authenticated;

-- ---------------------------------------------------------------- immutable correspondence
create or replace function public.messages_immutable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.id             is distinct from old.id
  or new.firm_id        is distinct from old.firm_id
  or new.matter_id      is distinct from old.matter_id
  or new.appointment_id is distinct from old.appointment_id
  or new.sender_id      is distinct from old.sender_id
  or new.recipient_id   is distinct from old.recipient_id
  or new.body           is distinct from old.body
  or new.attachments    is distinct from old.attachments
  or new.created_at     is distinct from old.created_at
  or new.reads_tracked  is distinct from old.reads_tracked then
    raise exception 'a message cannot be altered once it is sent — only its read state may change'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.messages_immutable() from public, anon, authenticated;

-- ---------------------------------------------------------------- RLS: staff see the matters they may work; clients see only correspondence
-- where they are sender or recipient. An ambiguous legacy row (recipient_id null) is staff-only
-- unless the client themselves sent it.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select using (
  (matter_id is not null and public.matter_row_r(firm_id, matter_id))
  or (appointment_id is not null and public.is_firm_member(firm_id))
  or (
    (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
    and (
      (matter_id is not null and public.is_matter_party(matter_id))
      or (appointment_id is not null and public.is_appointment_client(appointment_id))
    )
  )
);

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert with check (
  sender_id = (select auth.uid())
  and recipient_id is not null
  and (
    (matter_id is not null and (public.matter_row_w(firm_id, matter_id) or public.is_matter_party(matter_id)))
    or (appointment_id is not null and (public.staff_w(firm_id) or public.is_appointment_client(appointment_id)))
  )
);

drop policy if exists messages_mark_read on public.messages;
create policy messages_mark_read on public.messages for update
  using (
    (matter_id is not null and public.matter_row_r(firm_id, matter_id))
    or (appointment_id is not null and public.is_firm_member(firm_id))
    or (
      (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
      and (
        (matter_id is not null and public.is_matter_party(matter_id))
        or (appointment_id is not null and public.is_appointment_client(appointment_id))
      )
    )
  )
  with check (
    (matter_id is not null and public.matter_row_r(firm_id, matter_id))
    or (appointment_id is not null and public.is_firm_member(firm_id))
    or (
      (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
      and (
        (matter_id is not null and public.is_matter_party(matter_id))
        or (appointment_id is not null and public.is_appointment_client(appointment_id))
      )
    )
  );

-- ---------------------------------------------------------------- document doors, including the bytes
create or replace function public.can_access_document(d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.documents doc
     where doc.id = d and doc.deleted_at is null
       and (
         public.matter_row_r(doc.firm_id, doc.matter_id)
         or (
           doc.category = 'message_attachment'
           and (doc.uploaded_by = auth.uid() or doc.private_recipient_id = auth.uid())
         )
         or (
           coalesce(doc.category, '') <> 'message_attachment'
           and doc.client_visible
           and (public.is_matter_party(doc.matter_id) or public.is_appointment_client(doc.appointment_id))
         )
       )
  )
$$;

create or replace function public.can_upload_document(d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.documents doc
     where doc.id = d and doc.deleted_at is null
       and (
         public.matter_row_w(doc.firm_id, doc.matter_id)
         or (
           doc.category = 'message_attachment'
           and doc.uploaded_by = auth.uid()
         )
         or (
           coalesce(doc.category, '') <> 'message_attachment'
           and doc.client_visible
           and (public.is_matter_party(doc.matter_id) or public.is_appointment_client(doc.appointment_id))
         )
       )
  )
$$;

create or replace function public.can_access_document_version(v uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.document_versions dv
      join public.documents doc on doc.id = dv.document_id
     where dv.id = v
       and doc.deleted_at is null
       and (
         public.matter_row_r(doc.firm_id, doc.matter_id)
         or (
           doc.category = 'message_attachment'
           and (doc.uploaded_by = auth.uid() or doc.private_recipient_id = auth.uid())
         )
         or (
           coalesce(doc.category, '') <> 'message_attachment'
           and doc.client_visible
           and (
             public.party_may_see_docs(doc.matter_id)
             or public.acts_for_matter(doc.matter_id, 'docs')
             or public.is_appointment_client(doc.appointment_id)
           )
         )
         or exists (
           select 1 from public.process_service ps
            where ps.document_version_id = dv.id
              and ps.document_id = doc.id
              and ps.firm_id = doc.firm_id
              and public.is_served_firm(ps.id)
         )
         or exists (
           select 1
             from public.collaboration_documents cd
             join public.matter_collaborations mc on mc.id = cd.collaboration_id
            where cd.document_version_id = dv.id
              and cd.document_id = doc.id
              and mc.firm_id = doc.firm_id
              and mc.matter_id = doc.matter_id
              and cd.withdrawn_at is null
              and public.is_collaborating_firm(mc.id)
         )
       )
  )
$$;

drop policy if exists documents_client_insert on public.documents;
create policy documents_client_insert on public.documents for insert with check (
  uploaded_by = (select auth.uid())
  and (
    (
      category = 'message_attachment'
      and not client_visible
      and private_recipient_id is not null
      and (public.is_matter_party(matter_id) or public.is_appointment_client(appointment_id))
    )
    or (
      coalesce(category, '') <> 'message_attachment'
      and client_visible
      and (public.is_matter_party(matter_id) or public.is_appointment_client(appointment_id))
    )
  )
);

drop policy if exists document_versions_insert on public.document_versions;
create policy document_versions_insert on public.document_versions for insert
  with check (
    uploaded_by = (select auth.uid())
    and public.can_upload_document(document_id)
  );

-- ---------------------------------------------------------------- read receipts: a client can mark only their own direct correspondence.
create or replace function public.mark_thread_read(
  p_matter uuid default null,
  p_appointment uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_firm uuid;
  v_member boolean;
  n integer := 0;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_matter is null and p_appointment is null then return 0; end if;

  if p_matter is not null then
    select firm_id into v_firm from public.matters where id = p_matter and deleted_at is null;
    if v_firm is null or not (public.can_see_matter(p_matter) or public.is_matter_party(p_matter)) then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  else
    select firm_id into v_firm from public.appointments where id = p_appointment;
    if v_firm is null or not (public.is_firm_member(v_firm) or public.is_appointment_client(p_appointment)) then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  end if;
  v_member := public.is_firm_member(v_firm);

  insert into public.message_reads (message_id, user_id)
  select m.id, v_uid
    from public.messages m
   where m.firm_id = v_firm
     and ((p_matter is not null and m.matter_id = p_matter)
       or (p_appointment is not null and m.appointment_id = p_appointment))
     and (v_member or m.sender_id = v_uid or m.recipient_id = v_uid)
     and m.reads_tracked
     and m.sender_id is distinct from v_uid
     and public.msg_from_firm(m.firm_id, m.sender_id) <> v_member
  on conflict do nothing;
  get diagnostics n = row_count;

  update public.messages m
     set read_at = now()
   where m.firm_id = v_firm
     and ((p_matter is not null and m.matter_id = p_matter)
       or (p_appointment is not null and m.appointment_id = p_appointment))
     and (v_member or m.sender_id = v_uid or m.recipient_id = v_uid)
     and m.read_at is null
     and m.sender_id is distinct from v_uid
     and public.msg_from_firm(m.firm_id, m.sender_id) <> v_member;

  return n;
end $$;
revoke execute on function public.mark_thread_read(uuid,uuid) from public, anon;
grant execute on function public.mark_thread_read(uuid,uuid) to authenticated;

-- One message, one counterparty notification. The previous trigger fanned a staff message out to
-- every client/contact on a matter, which both leaked the existence of the message and lied about
-- who it was for.
create or replace function public.notify_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.recipient_id is not null then
    perform public.enqueue_notification(
      new.recipient_id,
      new.firm_id,
      'new_message',
      jsonb_strip_nulls(jsonb_build_object(
        'message_id', new.id,
        'matter_id', new.matter_id,
        'appointment_id', new.appointment_id
      ))
    );
  end if;
  return new;
end $$;
revoke execute on function public.notify_message() from public, anon, authenticated;
