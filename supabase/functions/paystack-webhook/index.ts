// Supabase Edge Function — Paystack webhook.
//
// The order of business, and why it is this order:
//  1. VERIFY THE SIGNATURE, with a constant-time compare. Nothing else happens first — not a
//     rate-limit check, not a database read. A delivery that Paystack signed is a real charge
//     against a real client's card, and a charge that is dropped is a client who paid and got
//     nothing. So a valid signature is ALWAYS processed: it is never rate-limited, never
//     sampled, never deferred.
//  2. RATE-LIMIT ONLY WHAT DID NOT VERIFY. An unsigned or wrongly signed POST is somebody
//     else's traffic. rate_limit_hit (migration 21) counts it in the webhook_bad bucket, and
//     over the limit we stop writing it down — the point of the limit is that a flood cannot
//     fill webhook_events.
//  3. RE-VERIFY THE MONEY WITH PAYSTACK. The body says what happened; only Paystack's own
//     /transaction/verify says what was actually paid, and that is what reaches record_payment.
//  4. WRITE DOWN EVERY DELIVERY in webhook_events (migration 20). Before this, a charge whose
//     signature failed or whose metadata was unreadable vanished into a log nobody reads.
//
// Status codes are unchanged from the version this replaces: 200 for anything a retry cannot
// fix (Paystack retries on non-2xx, and a retry loop on a permanent problem is noise that
// hides the real ones), 401 for a bad signature, 500 only where a retry genuinely might work.
//
// The service role is used here, which is allowed in an Edge Function and nowhere else.
import { createClient } from 'npm:@supabase/supabase-js@2';

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')!;
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// The same allowance as src/lib/rate-limit.ts LIMITS.webhook_bad. The two runtimes cannot share
// a module, so if that one changes, change this one: 60 unverified deliveries a minute.
const BAD_LIMIT = 60;
const BAD_WINDOW = '1 minute';

type Outcome = 'processed' | 'ignored' | 'unverified' | 'unreadable' | 'error';

interface Delivery {
  eventType?: string | null;
  providerRef?: string | null;
  signatureOk: boolean;
  outcome: Outcome;
  error?: string | null;
  firmId?: string | null;
  invoiceId?: string | null;
}

/** Every delivery, verified or not, gets a row. Failing to write the row never fails the call. */
async function record(d: Delivery): Promise<void> {
  const { error } = await supabase.from('webhook_events').insert({
    provider: 'paystack',
    event_type: d.eventType ?? null,
    provider_ref: d.providerRef ?? null,
    signature_ok: d.signatureOk,
    outcome: d.outcome,
    error: d.error ? String(d.error).slice(0, 1000) : null,
    firm_id: d.firmId ?? null,
    invoice_id: d.invoiceId ?? null,
  });
  if (error) console.error('webhook_events insert failed', error.message);
}

async function hmacSha512Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compare two hex digests without leaking where they first differ.
 *
 * `a !== b` stops at the first differing byte, so the time it takes tells an attacker how much
 * of a guessed signature was right — enough, with enough tries, to forge one. This walks the
 * whole string every time. The LENGTH is allowed to short-circuit: both sides are a
 * fixed-length SHA-512 digest, so the length is not a secret.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * A key for the rate limiter that is not a stored IP address. An IP is personal data under the
 * NDPR and counting does not need one, so only a digest of it is ever sent — the same shape
 * src/lib/rate-limit.ts uses on the Next.js side.
 */
async function callerKey(req: Request): Promise<string | null> {
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  const ip = fwd.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '';
  if (!ip) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`docket:${ip}`));
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when this unverified delivery is still inside its allowance. Fails OPEN on an error:
 *  a limiter that breaks must not become the reason nothing is written down. */
async function badDeliveryAllowed(key: string | null): Promise<boolean> {
  const { data, error } = await supabase.rpc('rate_limit_hit', {
    p_bucket: 'webhook_bad',
    p_limit: BAD_LIMIT,
    p_window: BAD_WINDOW,
    p_key: key,
  });
  if (error) {
    console.error('rate_limit_hit failed', error.message);
    return true;
  }
  return data !== false;
}

/** The invoice this delivery is about, so webhook_events can be read by firm. */
async function invoiceRef(invoiceNumber: string): Promise<{ invoiceId: string | null; firmId: string | null }> {
  const { data, error } = await supabase.from('invoices').select('id, firm_id').eq('number', invoiceNumber).maybeSingle();
  if (error) console.error('invoice lookup failed', error.message);
  return { invoiceId: data?.id ?? null, firmId: data?.firm_id ?? null };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const body = await req.text();
  const signature = req.headers.get('x-paystack-signature') ?? '';

  // 1. Signature first, constant time.
  const expected = await hmacSha512Hex(PAYSTACK_SECRET, body);
  if (!signature || !timingSafeEqualHex(signature, expected)) {
    // 2. Only now, and only for this branch, is the caller rate-limited.
    if (await badDeliveryAllowed(await callerKey(req))) {
      await record({ signatureOk: false, outcome: 'unverified', error: signature ? 'signature did not match' : 'no x-paystack-signature header' });
    }
    return new Response('invalid signature', { status: 401 });
  }

  // From here the delivery is Paystack's. It is processed, whatever else goes wrong.
  let event: { event?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(body);
  } catch (e) {
    // Signed by Paystack and still not JSON: a retry cannot fix that, so acknowledge it and
    // leave the evidence.
    await record({ signatureOk: true, outcome: 'unreadable', error: `body was not JSON: ${String((e as Error)?.message ?? e)}` });
    return new Response('unreadable body', { status: 200 });
  }

  const eventType = typeof event.event === 'string' ? event.event : null;
  const data = (event.data ?? {}) as Record<string, any>;
  const reference: string | null = typeof data.reference === 'string' ? data.reference : null;

  if (eventType !== 'charge.success') {
    await record({ eventType, providerRef: reference, signatureOk: true, outcome: 'ignored', error: 'not a charge.success event' });
    return new Response('ignored', { status: 200 });
  }
  if (!reference) {
    await record({ eventType, signatureOk: true, outcome: 'unreadable', error: 'charge.success without a reference' });
    return new Response('missing reference', { status: 200 });
  }

  // 3. Never trust the webhook body for money — ask Paystack directly.
  const vres = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
  });
  const v: any = await vres.json().catch(() => ({}));
  if (!vres.ok || !v.status || v.data?.status !== 'success') {
    const why = `paystack verify did not confirm (${vres.status}): ${String(v?.message ?? v?.data?.status ?? 'no reason given')}`;
    console.warn('paystack verify did not confirm', reference, v?.message);
    await record({ eventType, providerRef: reference, signatureOk: true, outcome: 'error', error: why });
    return new Response('not verified', { status: 200 });
  }

  const invoiceNumber = v.data.metadata?.invoice_number;
  if (!invoiceNumber) {
    console.error('charge without invoice_number metadata', reference);
    await record({ eventType, providerRef: reference, signatureOk: true, outcome: 'unreadable', error: 'the transaction carries no invoice_number in its metadata' });
    return new Response('missing invoice metadata', { status: 200 });
  }

  // Which invoice and firm this was, for the webhook_events row. record_payment does its own
  // lookup and its own locking; this read is only so an operator can find the row by firm.
  const { invoiceId, firmId } = await invoiceRef(String(invoiceNumber));

  const { data: result, error } = await supabase.rpc('record_payment', {
    p_provider: 'paystack',
    p_provider_ref: reference,
    p_invoice_number: invoiceNumber,
    p_amount_minor: v.data.amount,
    p_currency: v.data.currency,
    p_status: 'succeeded',
    p_raw: { id: v.data.id, channel: v.data.channel, paid_at: v.data.paid_at, customer: v.data.customer?.email },
    // the firm's settlement subaccount as Paystack reports it; record_payment() refuses a mismatch
    p_subaccount: v.data.subaccount?.subaccount_code ?? null,
  });
  if (error) {
    console.error('record_payment failed', error);
    await record({ eventType, providerRef: reference, signatureOk: true, outcome: 'error', error: error.message, firmId, invoiceId });
    // record_payment() refuses two things permanently: an invoice number that matches nothing,
    // and a charge in a currency the invoice was not raised in. Neither becomes true on a retry,
    // so a 500 would put Paystack into its backoff loop and write another 'error' row on every
    // delivery — burying the failures that a retry WOULD fix. Acknowledge those and keep the 500
    // for a genuine database or connection failure, which is what a retry is for.
    const permanent = /^(unknown invoice|currency mismatch)/i.test(error.message ?? '');
    if (permanent || !invoiceId) return new Response('permanently unprocessable', { status: 200 });
    return new Response('db error', { status: 500 });   // non-2xx makes Paystack retry
  }

  const r = (result ?? {}) as { duplicate?: boolean; settlement_mismatch?: boolean };
  if (r.settlement_mismatch) {
    // The charge went to a subaccount that is not this firm's. record_payment has already
    // written it as a FAILED payment and told the firm (migration 14), so the invoice is not
    // paid — calling that 'processed' would be a lie, and outcome <> 'processed' is what puts
    // it in front of a platform admin on the webhook health screen.
    await record({ eventType, providerRef: reference, signatureOk: true, outcome: 'error', firmId, invoiceId,
      error: 'settlement account mismatch: recorded as a failed payment and reported to the firm' });
  } else if (r.duplicate) {
    await record({ eventType, providerRef: reference, signatureOk: true, outcome: 'ignored', firmId, invoiceId,
      error: 'this reference was already recorded — Paystack delivered it more than once' });
  } else {
    await record({ eventType, providerRef: reference, signatureOk: true, outcome: 'processed', firmId, invoiceId });
  }

  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
