-- Docket — migration 19: three defects found reviewing the staff console (slice 4).
--
-- 1. An invoice raised against a matter could name a client who is not a party to it.
--    create_invoice() checked that the matter belonged to the firm and stopped there, so
--    issuing posted a CLIENT-VISIBLE 'Invoice N issued' entry, carrying the amount, onto a
--    matter whose actual parties had nothing to do with that invoice — and the person billed
--    could not open the matter it was filed against. The pairing is now required.
--
-- 2. firm_overview added minor units across currencies. Kobo and cents are not the same
--    unit, so a firm billing in both was shown a total that was neither, under one currency
--    sign. Saying underneath that currencies were mixed does not make the number true. The
--    two money columns are now a jsonb amount per currency.
--
-- 3. "Client uploads to review" counted every client upload the firm had ever received and
--    could never return to zero, because nothing recorded that a file had been looked at.
--    documents gains reviewed_at / reviewed_by, the count is of what is still unreviewed,
--    and the console can clear one.

-- ---------------------------------------------------------------- 1. bill the right client
create or replace function public.create_invoice(
  p_firm uuid, p_client uuid, p_items jsonb, p_matter uuid default null,
  p_currency currency default null, p_due_on date default null,
  p_issue boolean default false, p_note text default null)
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
  if p_matter is not null then
    if not exists (select 1 from matters where id = p_matter and firm_id = p_firm and deleted_at is null) then
      raise exception 'matter not found in this firm';
    end if;
    -- Issuing files a client-visible fee entry on the matter, so the person billed has to be
    -- on it: otherwise the matter's parties read another client's invoice, and the client
    -- billed is sent to a file they cannot open.
    if not exists (select 1 from matter_parties mp where mp.matter_id = p_matter and mp.user_id = p_client) then
      raise exception 'the client billed must be a party to that matter — invite them to it first, or raise the invoice without a matter';
    end if;
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

-- An invoice already attached to a matter must still name a party to it when it is issued,
-- because that is the moment the client-visible entry would be filed. It never files one
-- here (create_invoice does), but a party removed after a draft was raised should not be
-- notified about a matter they have left.
create or replace function public.issue_invoice(p_invoice uuid, p_due_on date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype;
begin
  select * into v_inv from invoices where id = p_invoice for update;
  if not found then raise exception 'invoice not found'; end if;
  if not staff_w(v_inv.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_inv.status <> 'draft' then raise exception 'invoice %s is already %', v_inv.number, v_inv.status; end if;
  if v_inv.matter_id is not null
     and not exists (select 1 from matter_parties mp where mp.matter_id = v_inv.matter_id and mp.user_id = v_inv.client_id) then
    raise exception 'the client billed is no longer a party to that matter — put them back on it, or cancel this draft and raise it without a matter';
  end if;
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

-- ---------------------------------------------------------------- 3. a counter that can reach zero
alter table public.documents
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

comment on column public.documents.reviewed_at is
  'When firm staff marked a client upload as looked at. Null means it is still on the "to review" counter.';

create index if not exists documents_unreviewed_idx
  on public.documents (firm_id) where deleted_at is null and reviewed_at is null and category = 'client_upload';

-- ---------------------------------------------------------------- 2. money, per currency
drop view if exists public.firm_overview;
create view public.firm_overview with (security_invoker = true) as
  select f.id as firm_id, f.name, f.status,
         (select count(*) from public.matters m where m.firm_id = f.id and m.deleted_at is null and m.closed_at is null) as open_matters,
         (select count(*) from public.appointments a where a.firm_id = f.id and a.status in ('confirmed','rescheduled') and a.starts_at >= now()) as upcoming_appointments,
         (select count(*) from public.court_events ce join public.matters m2 on m2.id = ce.matter_id and m2.deleted_at is null
           where ce.firm_id = f.id and ce.outcome_update_id is null and ce.vacated_at is null
             and ce.scheduled_at between now() and now() + interval '30 days') as court_dates_30d,
         (select count(*) from public.firm_sittings_due s where s.firm_id = f.id) as sittings_due,
         -- Minor units of one currency cannot be added to minor units of another, so each is
         -- kept apart: {"NGN": 22575000, "USD": 50000}. A firm that bills in one currency
         -- gets a one-key object, and a firm owed nothing gets an empty one.
         (select coalesce(jsonb_object_agg(x.currency, x.minor), '{}'::jsonb)
            from (select i.currency::text as currency, sum(i.total_minor - i.paid_minor) as minor
                    from public.invoices i
                   where i.firm_id = f.id and i.status in ('issued','partially_paid','overdue')
                   group by i.currency
                  having sum(i.total_minor - i.paid_minor) <> 0) x) as outstanding_by_currency,
         (select coalesce(jsonb_object_agg(y.currency, y.minor), '{}'::jsonb)
            from (select i2.currency::text as currency, sum(p.amount_minor) as minor
                    from public.payments p join public.invoices i2 on i2.id = p.invoice_id
                   where i2.firm_id = f.id and p.status = 'succeeded' and p.paid_at >= date_trunc('month', now())
                   group by i2.currency
                  having sum(p.amount_minor) <> 0) y) as collected_this_month_by_currency,
         (select count(*) from public.messages msg where msg.firm_id = f.id and msg.read_at is null
             and msg.sender_id is distinct from auth.uid()
             and not exists (select 1 from public.firm_members fm where fm.firm_id = f.id and fm.user_id = msg.sender_id)) as unread_messages,
         (select count(*) from public.tasks t where t.firm_id = f.id and t.status = 'open' and t.due_at < now()) as overdue_tasks,
         -- Only what nobody has looked at yet, so the number can come back down.
         (select count(*) from public.documents d where d.firm_id = f.id and d.deleted_at is null
             and d.category = 'client_upload' and d.reviewed_at is null and not exists (
               select 1 from public.firm_members fm2 where fm2.user_id = d.uploaded_by and fm2.firm_id = f.id)) as client_uploads,
         (select count(*) from public.process_service ps where ps.served_firm_id = f.id and ps.revoked_at is null and ps.acknowledged_at is null) as service_to_acknowledge
  from public.firms f
  where public.is_firm_member(f.id);
grant select on public.firm_overview to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.firm_overview from anon, authenticated;
