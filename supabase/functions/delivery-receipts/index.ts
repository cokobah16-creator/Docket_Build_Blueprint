// Supabase Edge Function — delivery receipts from the messaging providers.
//
// One function, three doors, chosen by the last path segment:
//   /functions/v1/delivery-receipts/resend   Resend's email events, signed by Svix
//   /functions/v1/delivery-receipts/twilio   Twilio's status callback, signed with the auth token
//   /functions/v1/delivery-receipts/termii   Termii's delivery report, which carries no signature —
//                                            the door is a secret token in the URL instead
//
// The order of business is the paystack-webhook's, and for the same reasons:
//  1. VERIFY FIRST, in constant time. Nothing is read from the database before that.
//  2. RATE-LIMIT ONLY WHAT DID NOT VERIFY, so a flood cannot fill webhook_events.
//  3. WRITE DOWN EVERY DELIVERY in webhook_events, verified or not, with the outcome.
//  4. APPLY ONLY A VERIFIED RECEIPT, through record_delivery_receipt() (migration 37), which finds
//     the notification by the provider's own message id and writes delivered / bounced /
//     undelivered — or a note that decides nothing. An unverified delivery is recorded and never
//     applied: a 'delivered' that nobody signed is not a fact.
//
// 200 for anything a retry cannot fix, 401 for a failed verification, 500 only where a retry might
// genuinely work. The service role is used here, which is allowed in an Edge Function and nowhere else.
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// The same allowance as src/lib/rate-limit.ts LIMITS.webhook_bad and the paystack function.
const BAD_LIMIT = 60;
const BAD_WINDOW = '1 minute';

type Provider = 'resend' | 'twilio' | 'termii';
type Outcome = 'processed' | 'ignored' | 'unverified' | 'unreadable' | 'error';
type Verdict = 'delivered' | 'bounced' | 'undelivered' | 'note';

interface Delivery {
  provider: Provider;
  eventType?: string | null;
  providerRef?: string | null;
  signatureOk: boolean;
  outcome: Outcome;
  error?: string | null;
  notificationId?: string | null;
}

/** Every delivery, verified or not, gets a row. Failing to write the row never fails the call. */
async function record(d: Delivery): Promise<void> {
  const { error } = await supabase.from('webhook_events').insert({
    provider: d.provider,
    event_type: d.eventType ?? null,
    provider_ref: d.providerRef ?? null,
    signature_ok: d.signatureOk,
    outcome: d.outcome,
    error: d.error ? String(d.error).slice(0, 1000) : null,
    notification_id: d.notificationId ?? null,
  });
  if (error) console.error('webhook_events insert failed', error.message);
}

const enc = new TextEncoder();

async function hmac(algorithm: 'SHA-1' | 'SHA-256', key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: algorithm }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
function toBase64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function fromBase64(s: string): Uint8Array { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

/** Walks both strings whole, so the time taken says nothing about where they differ. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** Secrets of unequal length are compared as digests, so not even the length leaks. */
async function secretMatches(provided: string | null, expected: string | undefined): Promise<boolean> {
  if (!provided || !expected) return false;
  const [a, b] = await Promise.all([sha256Hex(provided), sha256Hex(expected)]);
  return timingSafeEqual(a, b);
}

/** A key for the rate limiter that is not a stored IP address: a digest, as the Next.js side does. */
async function callerKey(req: Request): Promise<string | null> {
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  const ip = fwd.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '';
  if (!ip) return null;
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`docket:${ip}`));
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** Fails OPEN on an error: a limiter that breaks must not become the reason nothing is written down. */
async function badDeliveryAllowed(key: string | null): Promise<boolean> {
  const { data, error } = await supabase.rpc('rate_limit_hit', { p_bucket: 'webhook_bad', p_limit: BAD_LIMIT, p_window: BAD_WINDOW, p_key: key });
  if (error) { console.error('rate_limit_hit failed', error.message); return true; }
  return data !== false;
}

async function unverified(req: Request, provider: Provider, why: string): Promise<Response> {
  if (await badDeliveryAllowed(await callerKey(req))) await record({ provider, signatureOk: false, outcome: 'unverified', error: why });
  return new Response('unverified', { status: 401 });
}

/** A verified receipt is applied; the row says what became of it. */
async function apply(provider: Provider, eventType: string | null, ref: string | null, verdict: Verdict | null, at: string | null, note: string | null): Promise<Response> {
  if (!ref) {
    await record({ provider, eventType, signatureOk: true, outcome: 'unreadable', error: 'no message id in the receipt' });
    return new Response('no message id', { status: 200 });
  }
  if (!verdict) {
    await record({ provider, eventType, providerRef: ref, signatureOk: true, outcome: 'ignored', error: `${eventType ?? 'event'} changes nothing` });
    return new Response('ignored', { status: 200 });
  }
  const { data, error } = await supabase.rpc('record_delivery_receipt', { p_provider: provider, p_provider_ref: ref, p_status: verdict, p_at: at, p_note: note });
  if (error) {
    await record({ provider, eventType, providerRef: ref, signatureOk: true, outcome: 'error', error: error.message });
    return new Response('could not apply', { status: 500 });
  }
  if (!data) {
    await record({ provider, eventType, providerRef: ref, signatureOk: true, outcome: 'ignored', error: 'no notification carries that message id' });
    return new Response('unknown message', { status: 200 });
  }
  await record({ provider, eventType, providerRef: ref, signatureOk: true, outcome: 'processed', notificationId: String(data) });
  return new Response('ok', { status: 200 });
}

// ---------------------------------------------------------------- Resend (Svix signatures)
// svix-id, svix-timestamp and svix-signature; the signed content is `${id}.${timestamp}.${body}`,
// the key is the secret after its `whsec_` prefix, base64-decoded; the header may carry several
// `v1,<base64>` signatures and any one matching is enough. A timestamp more than five minutes off
// is a replay, or a clock nobody set.
async function handleResend(req: Request, body: string): Promise<Response> {
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  const id = req.headers.get('svix-id'); const ts = req.headers.get('svix-timestamp'); const sigs = req.headers.get('svix-signature');
  if (!secret || !id || !ts || !sigs) return unverified(req, 'resend', 'no svix headers, or no RESEND_WEBHOOK_SECRET on this deployment');
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return unverified(req, 'resend', 'svix timestamp outside five minutes');
  const key = fromBase64(secret.replace(/^whsec_/, ''));
  const expected = toBase64(await hmac('SHA-256', key, `${id}.${ts}.${body}`));
  const ok = sigs.split(' ').some((part) => { const [v, sig] = part.split(','); return v === 'v1' && sig && timingSafeEqual(sig, expected); });
  if (!ok) return unverified(req, 'resend', 'svix signature did not match');

  let event: { type?: string; created_at?: string; data?: Record<string, any> };
  try { event = JSON.parse(body); } catch (e) {
    await record({ provider: 'resend', signatureOk: true, outcome: 'unreadable', error: `body was not JSON: ${String((e as Error)?.message ?? e)}` });
    return new Response('unreadable body', { status: 200 });
  }
  const type = event.type ?? null; const ref = event.data?.email_id ?? null; const at = event.created_at ?? null;
  const verdict: Verdict | null =
    type === 'email.delivered' ? 'delivered'
    : type === 'email.bounced' ? 'bounced'
    : type === 'email.delivery_delayed' ? 'note'
    : type === 'email.complained' ? 'note'
    : null;
  const note = type === 'email.bounced' ? (event.data?.bounce?.message ?? event.data?.bounce?.type ?? 'bounced')
             : type === 'email.delivery_delayed' ? 'delivery delayed'
             : type === 'email.complained' ? 'marked as spam by the recipient'
             : null;
  return apply('resend', type, ref ? String(ref) : null, verdict, at, note);
}

// ---------------------------------------------------------------- Twilio (X-Twilio-Signature)
// base64(HMAC-SHA1(auth token, url + every POST parameter, sorted by name, as name then value)).
// The url must be exactly the one Twilio was given as StatusCallback, which the dispatcher reads
// from the same TWILIO_STATUS_CALLBACK_URL this function verifies against.
async function handleTwilio(req: Request, body: string): Promise<Response> {
  const token = Deno.env.get('TWILIO_AUTH_TOKEN'); const url = Deno.env.get('TWILIO_STATUS_CALLBACK_URL');
  const sig = req.headers.get('x-twilio-signature');
  if (!token || !url || !sig) return unverified(req, 'twilio', 'no x-twilio-signature, or TWILIO_AUTH_TOKEN / TWILIO_STATUS_CALLBACK_URL missing on this deployment');
  const params = new URLSearchParams(body);
  const keys = [...params.keys()].sort();
  const signed = url + keys.map((k) => k + (params.get(k) ?? '')).join('');
  const expected = toBase64(await hmac('SHA-1', enc.encode(token), signed));
  if (!timingSafeEqual(sig, expected)) return unverified(req, 'twilio', 'x-twilio-signature did not match');

  const status = (params.get('MessageStatus') ?? '').toLowerCase(); const ref = params.get('MessageSid');
  const errorCode = params.get('ErrorCode');
  const verdict: Verdict | null =
    status === 'delivered' ? 'delivered'
    : status === 'undelivered' || status === 'failed' ? 'undelivered'
    : status === 'sent' || status === 'queued' || status === 'accepted' || status === 'sending' ? 'note'
    : null;
  const note = verdict === 'undelivered' ? `${status}${errorCode ? ` (error ${errorCode})` : ''}` : verdict === 'note' ? status : null;
  return apply('twilio', status || null, ref, verdict, null, note);
}

// ---------------------------------------------------------------- Termii (a token in the URL)
// Termii signs nothing. The door is ?token=<TERMII_WEBHOOK_TOKEN>, compared as a digest; the
// URL with the token is what is entered in Termii's dashboard, and the token is rotated there.
async function handleTermii(req: Request, body: string): Promise<Response> {
  const token = new URL(req.url).searchParams.get('token');
  if (!(await secretMatches(token, Deno.env.get('TERMII_WEBHOOK_TOKEN')))) return unverified(req, 'termii', 'token did not match, or TERMII_WEBHOOK_TOKEN missing on this deployment');
  let event: Record<string, any>;
  try { event = JSON.parse(body); } catch (e) {
    await record({ provider: 'termii', signatureOk: true, outcome: 'unreadable', error: `body was not JSON: ${String((e as Error)?.message ?? e)}` });
    return new Response('unreadable body', { status: 200 });
  }
  const status = String(event?.status ?? ''); const ref = event?.message_id ?? event?.id ?? null;
  const lower = status.toLowerCase();
  const verdict: Verdict | null =
    lower === 'delivered' ? 'delivered'
    : /fail|expired|rejected|dnd|undeliver|blacklist/.test(lower) ? 'undelivered'
    : lower === 'sent' || lower === 'submitted' ? 'note'
    : null;
  return apply('termii', status || null, ref != null ? String(ref) : null, verdict, null, verdict ? status : null);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const provider = new URL(req.url).pathname.split('/').filter(Boolean).pop();
  const body = await req.text();
  if (provider === 'resend') return handleResend(req, body);
  if (provider === 'twilio') return handleTwilio(req, body);
  if (provider === 'termii') return handleTermii(req, body);
  return new Response('unknown provider', { status: 404 });
});
