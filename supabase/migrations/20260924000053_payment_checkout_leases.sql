-- One active provider checkout per invoice.
--
-- The payment webhook remains the only authority that records money. This layer only prevents
-- two browser requests from creating two independent Paystack references for the same unpaid
-- balance. An invoice row lock serializes claims; the partial unique index is the second line
-- of defence if a future caller forgets to use the claim RPC.

create table public.payment_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete restrict,
  provider text not null default 'paystack',
  provider_ref text not null unique,
  channel text,
  amount_minor bigint not null check (amount_minor > 0),
  currency public.currency not null,
  status text not null check (status in ('initializing','ready','failed','expired','settled')),
  checkout_url text,
  error text,
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (channel is null or channel in ('card','bank_transfer','ussd')),
  check ((status = 'ready' and checkout_url is not null) or status <> 'ready')
);

create unique index payment_checkout_one_active_per_invoice
  on public.payment_checkout_attempts (invoice_id)
  where status in ('initializing','ready');
create index payment_checkout_provider_ref_idx
  on public.payment_checkout_attempts (provider_ref);
create index payment_checkout_invoice_created_idx
  on public.payment_checkout_attempts (invoice_id, created_at desc);

alter table public.payment_checkout_attempts enable row level security;
revoke all on public.payment_checkout_attempts from public, anon, authenticated;

comment on table public.payment_checkout_attempts is
  'Provider checkout leases. They prevent duplicate transaction creation; they never mark an invoice paid. Only record_payment() may record money.';

create or replace function public.claim_payment_checkout(
  p_invoice uuid,
  p_channel text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invoices%rowtype;
  v_appt public.appointments%rowtype;
  v_open public.payment_checkout_attempts%rowtype;
  v_id uuid;
  v_ref text;
  v_outstanding bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_channel is not null and p_channel not in ('card','bank_transfer','ussd') then
    raise exception 'unsupported payment channel' using errcode = '22023';
  end if;

  -- This is the lock that makes two simultaneous clicks line up rather than both reaching
  -- the payment provider. record_payment() also locks this invoice, so a payment arriving
  -- at the same instant is serialized against the claim.
  select * into v_inv
    from public.invoices
   where id = p_invoice
   for update;

  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if not (v_inv.client_id = v_uid or public.staff_w(v_inv.firm_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_inv.status = 'paid' then
    return jsonb_build_object('state', 'paid');
  end if;
  if v_inv.status = 'cancelled' then
    raise exception 'this invoice was cancelled' using errcode = '23514';
  end if;
  if v_inv.status = 'draft' then
    raise exception 'this invoice has not been issued' using errcode = '23514';
  end if;

  if v_inv.appointment_id is not null then
    select * into v_appt from public.appointments where id = v_inv.appointment_id;
    if not found
       or v_appt.status not in ('pending','awaiting_payment')
       or (v_appt.hold_expires_at is not null and v_appt.hold_expires_at <= now()) then
      raise exception 'this booking is no longer open for payment' using errcode = '23514';
    end if;
  end if;

  v_outstanding := v_inv.total_minor - v_inv.paid_minor;
  if v_outstanding <= 0 then
    return jsonb_build_object('state', 'paid');
  end if;

  -- Retire a stale lease or one for an amount that is no longer the invoice balance.
  update public.payment_checkout_attempts
     set status = 'expired', updated_at = now()
   where invoice_id = v_inv.id
     and status in ('initializing','ready')
     and (lease_expires_at <= now()
          or amount_minor <> v_outstanding
          or currency <> v_inv.currency);

  select * into v_open
    from public.payment_checkout_attempts
   where invoice_id = v_inv.id
     and status in ('initializing','ready')
   order by created_at desc
   limit 1
   for update;

  if found then
    if v_open.status = 'ready' and v_open.checkout_url is not null then
      return jsonb_build_object(
        'state', 'reuse',
        'attempt_id', v_open.id,
        'provider_ref', v_open.provider_ref,
        'checkout_url', v_open.checkout_url,
        'amount_minor', v_open.amount_minor,
        'currency', v_open.currency,
        'channel', v_open.channel,
        'lease_expires_at', v_open.lease_expires_at
      );
    end if;
    return jsonb_build_object(
      'state', 'busy',
      'attempt_id', v_open.id,
      'lease_expires_at', v_open.lease_expires_at
    );
  end if;

  v_id := gen_random_uuid();
  v_ref := regexp_replace(v_inv.number, '[^A-Za-z0-9.=-]', '-', 'g')
           || '-' || substr(replace(v_id::text, '-', ''), 1, 16);

  insert into public.payment_checkout_attempts (
    id, invoice_id, firm_id, client_id, provider, provider_ref, channel,
    amount_minor, currency, status, lease_expires_at
  ) values (
    v_id, v_inv.id, v_inv.firm_id, v_inv.client_id, 'paystack', v_ref, p_channel,
    v_outstanding, v_inv.currency, 'initializing', now() + interval '5 minutes'
  );

  return jsonb_build_object(
    'state', 'create',
    'attempt_id', v_id,
    'provider_ref', v_ref,
    'amount_minor', v_outstanding,
    'currency', v_inv.currency,
    'channel', p_channel,
    'lease_expires_at', now() + interval '5 minutes'
  );
end $$;
revoke execute on function public.claim_payment_checkout(uuid,text) from public, anon;
grant execute on function public.claim_payment_checkout(uuid,text) to authenticated;

create or replace function public.complete_payment_checkout(
  p_attempt uuid,
  p_checkout_url text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_try public.payment_checkout_attempts%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_checkout_url, '')), '') is null then
    raise exception 'checkout URL is required' using errcode = '22023';
  end if;

  select * into v_try
    from public.payment_checkout_attempts
   where id = p_attempt
   for update;
  if not found then raise exception 'checkout attempt not found' using errcode = 'P0002'; end if;
  if not (v_try.client_id = v_uid or public.staff_w(v_try.firm_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_try.status = 'ready' then return; end if;
  if v_try.status <> 'initializing' then
    raise exception 'checkout attempt is no longer active' using errcode = '23514';
  end if;

  update public.payment_checkout_attempts
     set status = 'ready',
         checkout_url = p_checkout_url,
         error = null,
         lease_expires_at = now() + interval '30 minutes',
         updated_at = now()
   where id = p_attempt;
end $$;
revoke execute on function public.complete_payment_checkout(uuid,text) from public, anon;
grant execute on function public.complete_payment_checkout(uuid,text) to authenticated;

create or replace function public.fail_payment_checkout(
  p_attempt uuid,
  p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_try public.payment_checkout_attempts%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_try
    from public.payment_checkout_attempts
   where id = p_attempt
   for update;
  if not found then return; end if;
  if not (v_try.client_id = v_uid or public.staff_w(v_try.firm_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_try.status = 'initializing' then
    update public.payment_checkout_attempts
       set status = 'failed',
           error = left(coalesce(p_error, 'checkout initialization failed'), 1000),
           updated_at = now()
     where id = p_attempt;
  end if;
end $$;
revoke execute on function public.fail_payment_checkout(uuid,text) from public, anon;
grant execute on function public.fail_payment_checkout(uuid,text) to authenticated;

-- Reconcile the lease when the authoritative payment row is written. A failed provider payment
-- frees the invoice for a new checkout; a successful one records that this attempt settled.
create or replace function public.sync_payment_checkout_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'succeeded' then
    update public.payment_checkout_attempts
       set status = 'settled', updated_at = now()
     where provider_ref = new.provider_ref
       and status in ('initializing','ready');
  elsif new.status = 'failed' then
    update public.payment_checkout_attempts
       set status = 'failed',
           error = coalesce(error, 'provider reported a failed payment'),
           updated_at = now()
     where provider_ref = new.provider_ref
       and status in ('initializing','ready');
  end if;
  return new;
end $$;
drop trigger if exists payments_sync_checkout on public.payments;
create trigger payments_sync_checkout
  after insert on public.payments
  for each row execute function public.sync_payment_checkout_status();
revoke execute on function public.sync_payment_checkout_status() from public, anon, authenticated;
