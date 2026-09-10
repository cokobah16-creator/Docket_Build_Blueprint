-- Docket — migration 18 (slice 4): what the staff console needs that RLS alone cannot give.
--
-- Everything else the console does is a plain table write under an existing policy
-- (matters, tasks, documents, availability, matter_counsel …). Three things are not:
--
--   1. Numbering. next_reference() is service-only, so a manual invoice cannot be
--      numbered from the app. create_invoice() issues the number, applies the firm's
--      VAT rate, writes the items and (optionally) issues + notifies in one transaction.
--   2. Invites. The console must show the accept link for WhatsApp/SMS, and the token
--      must never be guessable from the client side: invite_matter_party() creates it,
--      refuses a party who is already on the matter, and audits.
--   3. Firm-wide reads. firm_overview and firm_sittings_due are definer views so the
--      Today screen and the Overview are one round trip each, not a dozen.

-- ---------------------------------------------------------------- manual invoices
create or replace function public.create_invoice(
  p_firm uuid, p_client uuid, p_items jsonb,
  p_matter uuid default null, p_currency currency default null,
  p_due_on date default null, p_issue bool default true, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_firm firms%rowtype; v_cur currency; v_item jsonb; v_sub bigint := 0; v_vat bigint := 0;
        v_total bigint; v_no text; v_id uuid; v_qty numeric; v_unit bigint; v_n int := 0;
begin
  select * into v_firm from firms where id = p_firm;
  if not found then raise exception 'firm not found'; end if;
  if not staff_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'an invoice needs at least one item';
  end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'too many items'; end if;
  if not exists (select 1 from profiles where id = p_client) then raise exception 'client account not found'; end if;
  if p_matter is not null and not exists (select 1 from matters where id = p_matter and firm_id = p_firm and deleted_at is null) then
    raise exception 'matter not found in this firm';
  end if;
  v_cur := coalesce(p_currency, v_firm.default_currency);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty  := coalesce((v_item ->> 'quantity')::numeric, 1);
    v_unit := (v_item ->> 'unit_minor')::bigint;
    if v_unit is null or v_unit < 0 then raise exception 'each item needs a unit amount of zero or more'; end if;
    if v_qty <= 0 then raise exception 'each item needs a quantity above zero'; end if;
    if length(trim(coalesce(v_item ->> 'description', ''))) = 0 then raise exception 'each item needs a description'; end if;
    v_sub := v_sub + round(v_unit * v_qty);
    v_n := v_n + 1;
  end loop;
  if v_sub <= 0 then raise exception 'an invoice must come to more than zero'; end if;

  v_vat   := round(v_sub * coalesce(v_firm.vat_rate, 0) / 100.0);
  v_total := v_sub + v_vat;
  v_no    := next_reference(p_firm, 'invoice');

  insert into invoices (firm_id, number, client_id, matter_id, currency, subtotal_minor, vat_minor, total_minor,
                        status, issued_at, due_at)
  values (p_firm, v_no, p_client, p_matter, v_cur, v_sub, v_vat, v_total,
          case when p_issue then 'issued'::invoice_status else 'draft'::invoice_status end,
          case when p_issue then now() end, p_due_on)
  returning id into v_id;

  insert into invoice_items (invoice_id, description, quantity, unit_minor)
  select v_id, trim(i ->> 'description'), coalesce((i ->> 'quantity')::numeric, 1), (i ->> 'unit_minor')::bigint
  from jsonb_array_elements(p_items) i;

  if p_issue then
    perform enqueue_notification(p_client, p_firm, 'invoice_issued',
      jsonb_build_object('invoice_id', v_id, 'invoice_number', v_no, 'amount_minor', v_total,
                         'currency', v_cur, 'due_at', p_due_on, 'matter_id', p_matter, 'note', p_note));
    if p_matter is not null then
      insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by)
      values (p_matter, p_firm, 'fee', 'client', format('Invoice %s issued', v_no), p_note,
              jsonb_build_object('invoice_id', v_id, 'amount_minor', v_total, 'currency', v_cur), now(), auth.uid());
    end if;
  end if;

  perform audit('invoice.created', 'invoice', v_id, p_firm,
                jsonb_build_object('number', v_no, 'total_minor', v_total, 'currency', v_cur, 'items', v_n, 'issued', p_issue));
  return jsonb_build_object('invoice_id', v_id, 'number', v_no, 'subtotal_minor', v_sub,
                            'vat_minor', v_vat, 'total_minor', v_total, 'currency', v_cur,
                            'status', case when p_issue then 'issued' else 'draft' end);
end $$;
revoke execute on function public.create_invoice(uuid,uuid,jsonb,uuid,currency,date,bool,text) from public, anon;
grant  execute on function public.create_invoice(uuid,uuid,jsonb,uuid,currency,date,bool,text) to authenticated;

-- draft → issued (the client only ever sees issued invoices: invoices_select)
create or replace function public.issue_invoice(p_invoice uuid, p_due_on date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype;
begin
  select * into v_inv from invoices where id = p_invoice for update;
  if not found then raise exception 'invoice not found'; end if;
  if not staff_w(v_inv.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_inv.status <> 'draft' then raise exception 'invoice %s is already %', v_inv.number, v_inv.status; end if;
  update invoices set status = 'issued', issued_at = now(), due_at = coalesce(p_due_on, due_at)
   where id = p_invoice returning * into v_inv;
  perform enqueue_notification(v_inv.client_id, v_inv.firm_id, 'invoice_issued',
    jsonb_build_object('invoice_id', v_inv.id, 'invoice_number', v_inv.number, 'amount_minor', v_inv.total_minor,
                       'currency', v_inv.currency, 'due_at', v_inv.due_at, 'matter_id', v_inv.matter_id));
  perform audit('invoice.issued', 'invoice', p_invoice, v_inv.firm_id, jsonb_build_object('number', v_inv.number));
  return jsonb_build_object('invoice_id', p_invoice, 'number', v_inv.number, 'status', 'issued');
end $$;
revoke execute on function public.issue_invoice(uuid,date) from public, anon;
grant  execute on function public.issue_invoice(uuid,date) to authenticated;

-- an unpaid invoice can be cancelled; a paid one never is (the receipt is the client's record)
create or replace function public.cancel_invoice(p_invoice uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype;
begin
  select * into v_inv from invoices where id = p_invoice for update;
  if not found then raise exception 'invoice not found'; end if;
  if not admin_w(v_inv.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_inv.paid_minor > 0 then raise exception 'a part-paid or paid invoice cannot be cancelled — raise a credit note'; end if;
  if v_inv.appointment_id is not null then raise exception 'cancel the appointment instead; its invoice follows'; end if;
  update invoices set status = 'cancelled' where id = p_invoice;
  perform audit('invoice.cancelled', 'invoice', p_invoice, v_inv.firm_id, jsonb_build_object('number', v_inv.number, 'reason', p_reason));
end $$;
revoke execute on function public.cancel_invoice(uuid,text) from public, anon;
grant  execute on function public.cancel_invoice(uuid,text) to authenticated;

-- ---------------------------------------------------------------- invite a client onto a matter
create or replace function public.invite_matter_party(
  p_matter uuid, p_phone text default null, p_email text default null,
  p_role party_role default 'client', p_expires_days int default 14)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m matters%rowtype; v_id uuid; v_token text; v_existing uuid;
begin
  select * into v_m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  if not staff_w(v_m.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_role not in ('client','contact') then raise exception 'only a client or a contact can be invited to a matter'; end if;
  if coalesce(trim(p_phone), '') = '' and coalesce(trim(p_email), '') = '' then
    raise exception 'give a phone number or an email address to send the invitation to';
  end if;
  if p_expires_days < 1 or p_expires_days > 60 then raise exception 'an invitation lasts between 1 and 60 days'; end if;

  -- already a party? (matched on the profile behind the phone/email)
  select mp.user_id into v_existing
    from matter_parties mp join profiles p on p.id = mp.user_id
   where mp.matter_id = p_matter
     and ((p_phone is not null and p.phone = trim(p_phone))
       or (p_email is not null and lower(p.email) = lower(trim(p_email))));
  if v_existing is not null then raise exception 'that person is already on this matter'; end if;

  insert into invites (firm_id, matter_id, phone, email, role, created_by, expires_at)
  values (v_m.firm_id, p_matter, nullif(trim(p_phone), ''), nullif(lower(trim(p_email)), ''), p_role, auth.uid(),
          now() + make_interval(days => p_expires_days))
  returning id, token into v_id, v_token;

  perform audit('invite.created', 'invite', v_id, v_m.firm_id,
                jsonb_build_object('matter_id', p_matter, 'role', p_role, 'phone', p_phone, 'email', p_email));
  return jsonb_build_object('invite_id', v_id, 'token', v_token, 'matter_id', p_matter,
                            'matter_reference', v_m.reference, 'matter_title', v_m.title,
                            'firm_id', v_m.firm_id, 'role', p_role,
                            'expires_at', now() + make_interval(days => p_expires_days));
end $$;
revoke execute on function public.invite_matter_party(uuid,text,text,party_role,int) from public, anon;
grant  execute on function public.invite_matter_party(uuid,text,text,party_role,int) to authenticated;

create or replace function public.revoke_matter_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_inv invites%rowtype;
begin
  select * into v_inv from invites where id = p_invite for update;
  if not found then raise exception 'invitation not found'; end if;
  if not staff_w(v_inv.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_inv.accepted_by is not null then raise exception 'that invitation has already been accepted'; end if;
  update invites set expires_at = now() - interval '1 second' where id = p_invite;
  perform audit('invite.revoked', 'invite', p_invite, v_inv.firm_id, jsonb_build_object('matter_id', v_inv.matter_id));
end $$;
revoke execute on function public.revoke_matter_invite(uuid) from public, anon;
grant  execute on function public.revoke_matter_invite(uuid) to authenticated;

-- ---------------------------------------------------------------- firm-wide reads for Today and Overview
-- Sittings whose day has passed with no update posted: the console's standing chase list.
create view public.firm_sittings_due with (security_invoker = true) as
  select ce.id as court_event_id, ce.firm_id, ce.matter_id, m.reference, coalesce(m.cause_title, m.title) as cause_title,
         m.suit_number, ce.scheduled_at, coalesce(c.name, ce.court_name) as court, ce.purpose, ce.purpose_kind,
         ml.user_id as lawyer_id
  from public.court_events ce
  join public.matters m on m.id = ce.matter_id and m.deleted_at is null
  left join public.courts c on c.id = ce.court_id
  left join public.matter_lawyers ml on ml.matter_id = ce.matter_id and ml.is_lead
  where ce.outcome_update_id is null and ce.vacated_at is null
    and ce.scheduled_at < now() - interval '4 hours';
grant select on public.firm_sittings_due to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.firm_sittings_due from anon, authenticated;

-- One row per firm the caller belongs to: the Overview totals.
create view public.firm_overview with (security_invoker = true) as
  select f.id as firm_id, f.name, f.status,
         (select count(*) from public.matters m where m.firm_id = f.id and m.deleted_at is null and m.closed_at is null) as open_matters,
         (select count(*) from public.appointments a where a.firm_id = f.id and a.status in ('confirmed','rescheduled') and a.starts_at >= now()) as upcoming_appointments,
         (select count(*) from public.court_events ce join public.matters m2 on m2.id = ce.matter_id and m2.deleted_at is null
           where ce.firm_id = f.id and ce.outcome_update_id is null and ce.vacated_at is null
             and ce.scheduled_at between now() and now() + interval '30 days') as court_dates_30d,
         (select count(*) from public.firm_sittings_due s where s.firm_id = f.id) as sittings_due,
         (select coalesce(sum(i.total_minor - i.paid_minor), 0) from public.invoices i
           where i.firm_id = f.id and i.status in ('issued','partially_paid','overdue')) as outstanding_minor,
         (select coalesce(sum(p.amount_minor), 0) from public.payments p join public.invoices i2 on i2.id = p.invoice_id
           where i2.firm_id = f.id and p.status = 'succeeded' and p.paid_at >= date_trunc('month', now())) as collected_this_month_minor,
         (select count(*) from public.messages msg where msg.firm_id = f.id and msg.read_at is null
             and msg.sender_id is distinct from auth.uid()
             and not exists (select 1 from public.firm_members fm where fm.firm_id = f.id and fm.user_id = msg.sender_id)) as unread_messages,
         (select count(*) from public.tasks t where t.firm_id = f.id and t.status = 'open' and t.due_at < now()) as overdue_tasks,
         (select count(*) from public.documents d where d.firm_id = f.id and d.deleted_at is null
             and d.category = 'client_upload' and not exists (
               select 1 from public.firm_members fm2 where fm2.user_id = d.uploaded_by and fm2.firm_id = f.id)) as client_uploads,
         (select count(*) from public.process_service ps where ps.served_firm_id = f.id and ps.revoked_at is null and ps.acknowledged_at is null) as service_to_acknowledge
  from public.firms f
  where public.is_firm_member(f.id);
grant select on public.firm_overview to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.firm_overview from anon, authenticated;
