// Supabase Edge Function — Paystack webhook.
// 1) verify the HMAC-SHA512 signature  2) re-verify the transaction with Paystack  3) record_payment() with the service role.
// The frontend callback page never marks anything paid; this function is the only path to a paid invoice.
import { createClient } from 'npm:@supabase/supabase-js@2';

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')!;

async function hmacSha512Hex(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const body = await req.text();
  const signature = req.headers.get('x-paystack-signature') ?? '';
  if (!signature || signature !== (await hmacSha512Hex(PAYSTACK_SECRET, body))) {
    return new Response('invalid signature', { status: 401 });
  }

  const event = JSON.parse(body);
  if (event.event !== 'charge.success') return new Response('ignored', { status: 200 });

  // never trust the webhook body for money — ask Paystack directly
  const reference: string = event.data.reference;
  const vres = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
  });
  const v = await vres.json();
  if (!vres.ok || !v.status || v.data?.status !== 'success') {
    console.warn('paystack verify did not confirm', reference, v?.message);
    return new Response('not verified', { status: 200 });
  }
  const invoiceNumber = v.data.metadata?.invoice_number;
  if (!invoiceNumber) {
    console.error('charge without invoice_number metadata', reference);
    return new Response('missing invoice metadata', { status: 200 });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await supabase.rpc('record_payment', {
    p_provider: 'paystack',
    p_provider_ref: reference,
    p_invoice_number: invoiceNumber,
    p_amount_minor: v.data.amount,
    p_currency: v.data.currency,
    p_status: 'succeeded',
    p_raw: { id: v.data.id, channel: v.data.channel, paid_at: v.data.paid_at, customer: v.data.customer?.email },
  });
  if (error) {
    console.error('record_payment failed', error);
    return new Response('db error', { status: 500 });   // non-2xx makes Paystack retry
  }
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
