// Supabase Edge Function — Stripe webhook (USD on the US entity). Signature-verified, then record_payment().
import Stripe from 'npm:stripe@^17';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const body = await req.text();
  const sig = req.headers.get('stripe-signature') ?? '';
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, Deno.env.get('STRIPE_WEBHOOK_SECRET')!, undefined, cryptoProvider);
  } catch (e) {
    return new Response(`invalid signature: ${(e as Error).message}`, { status: 401 });
  }
  if (event.type !== 'checkout.session.completed') return new Response('ignored', { status: 200 });

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== 'paid') return new Response('not paid', { status: 200 });
  const invoiceNumber = session.metadata?.invoice_number ?? session.client_reference_id;
  if (!invoiceNumber) return new Response('missing invoice metadata', { status: 200 });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await supabase.rpc('record_payment', {
    p_provider: 'stripe',
    p_provider_ref: typeof session.payment_intent === 'string' ? session.payment_intent : session.id,
    p_invoice_number: invoiceNumber,
    p_amount_minor: session.amount_total ?? 0,
    p_currency: (session.currency ?? 'usd').toUpperCase(),
    p_status: 'succeeded',
    p_raw: { session_id: session.id, customer_email: session.customer_details?.email },
  });
  if (error) { console.error('record_payment failed', error); return new Response('db error', { status: 500 }); }
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
