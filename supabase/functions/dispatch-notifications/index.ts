// Supabase Edge Function — notification dispatcher. pg_cron calls it every minute with the x-cron-secret header (migration 9).
// Claims `notifications` rows through claim_notifications() (migration 37: status 'sending', locked, so
// two runs never take the same row), sends each for email / sms / push, and finishes each through
// finish_notification() with what the provider actually said: its message id, the segments, the cost
// at the rate the platform entered, or the failure and whether it is worth trying again.
//
// ACCEPTED IS NOT DELIVERED. A 2xx with a message id means the provider took the message; that is
// recorded as accepted. Delivery is written only by the delivery-receipts function, from a receipt
// the provider signed. Web push has no receipt and stops at accepted.
//
// A FAILURE IS ONE OF TWO KINDS. A 5xx, a 429, a timeout, an unreachable host: transient — the row
// goes back in the queue with a growing delay, five times. A 4xx, a rejected number, no address on
// the profile: permanent — it fails now, and an operator decides.
//
// THE WORDS ARE THE FIRM'S WHERE THE FIRM HAS WRITTEN THEM. Every sentence below is Docket's,
// and a firm may replace any of them for any event through firms.notification_templates
// (migration 20). An override is used INSTEAD of the built-in copy for that event; every event
// it does not override keeps Docket's words, so an empty object is the normal state and no
// client is ever left without a message. Placeholders in {braces} are filled here.
//
// TWO COUNTERS, TWO MEANINGS. notifications.attempts (migration 20) belongs to retry_notification():
// it increments when an operator puts a failed message back in the queue and refuses the sixth.
// notifications.send_attempts (migration 37) counts this function's claims, and the automatic
// backoff stops at five. An operator's retry resets the second and advances the first.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:ops@docket.app', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

/** One claimed row, as claim_notifications() returns it: the row, the recipient, the firm. */
type Row = {
  id: string; user_id: string; firm_id: string | null; channel: string; event: string; payload: Record<string, any>;
  send_attempts: number; attempts: number | null;
  email: string | null; phone: string | null; timezone: string | null; full_name: string | null;
  firm_name: string | null; notification_templates: Record<string, Template> | null;
};

/** A send that did not happen, and whether trying again could change that. */
class SendError extends Error {
  constructor(message: string, public transient: boolean, public provider: string | null) { super(message); }
}
/** Provider answers a retry might change: overloaded, rate-limited, or a server that fell over. */
function transientStatus(status: number): boolean { return status === 408 || status === 429 || status >= 500; }

type Sent = { provider: string; ref: string | null };
type Rate = { unit_minor: number; currency: string; per_segment: boolean };

/**
 * How many SMS an operator is billed for. GSM-7 text fits 160 characters in one message and 153
 * per part after; a single character outside that alphabet makes the whole text UCS-2, at 70 and
 * 67. The extended GSM characters count double. The number the provider bills is what it charges
 * by, so it is computed here, at send time, from the exact text sent.
 */
const GSM7 = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\\[~\]|€]*$/;
function smsSegments(text: string): number {
  const gsm = GSM7.test(text);
  const length = gsm ? text.replace(/[\^{}\\\[~\]|€]/g, 'xx').length : text.length;
  const single = gsm ? 160 : 70;
  const part = gsm ? 153 : 67;
  return length <= single ? 1 : Math.ceil(length / part);
}


/** One firm's override for one event, as validate_notification_templates() leaves it. */
type Template = { subject?: string | null; text?: string | null };

function fmt(iso: string | undefined, tz: string) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(iso));
}

/** A bare YYYY-MM-DD, which is a calendar day and not an instant. */
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A DATE column is the day it says, everywhere. invoices.due_at is a date, and running it through
 * fmt() would parse it as UTC midnight and then shift it — so a client in Lagos reads the right
 * day and a client in New York reads the day before, for the same invoice.
 */
function fmtDay(day: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Walks both strings whole, so the time taken says nothing about where they differ. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The cron secret is the ONLY credential on this function (verify_jwt is off), so comparing it
 * with !== would let a caller learn it a character at a time. Both sides are hashed first: the
 * digests are the same length whatever the secret's length, so not even that leaks.
 */
async function cronSecretMatches(provided: string | null, expected: string): Promise<boolean> {
  if (!provided) return false;
  const [a, b] = await Promise.all([sha256Hex(provided), sha256Hex(expected)]);
  return timingSafeEqualHex(a, b);
}

/**
 * Fill {placeholders} in a firm's own sentence.
 *
 * What a firm can use: {firm}, {when} (the event's time in the recipient's zone) and any key of
 * the notification payload — {reference}, {invoice_number}, {amount}, and so on. A key ending in
 * _at is rendered as a date and time in that same zone; money arrives as {amount}, already
 * carrying its currency, because minor units mean nothing to a reader.
 *
 * A placeholder nobody recognises is LEFT AS IT WAS TYPED. Blanking it would hide the firm's
 * mistake from the only person who can fix it, and inventing a value would be worse.
 */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : whole,
  );
}

function placeholders(n: Row, firm: string, tz: string): Record<string, string> {
  const p = n.payload ?? {};
  const vars: Record<string, string> = { firm, when: fmt(p.starts_at ?? p.scheduled_at, tz) };
  for (const [key, value] of Object.entries(p)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') continue;                       // never paste raw JSON into a message
    const raw = String(value);
    // Shape, not suffix: due_at is a calendar day and starts_at is an instant, and both end _at.
    vars[key] = DAY_ONLY.test(raw) ? fmtDay(raw) : key.endsWith('_at') && typeof value === 'string' ? fmt(value, tz) : raw;
  }
  if (p.amount_minor !== undefined && p.amount_minor !== null) {
    vars.amount = `${p.currency ?? ''} ${(Number(p.amount_minor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`.trim();
  }
  return vars;
}

function render(n: Row, firm: string, tz: string): { subject: string; text: string; url: string } {
  const p = n.payload ?? {};
  const when = fmt(p.starts_at ?? p.scheduled_at, tz);
  switch (n.event) {
    case 'appointment_confirmed':    return { subject: `${firm}: consultation ${p.reference} confirmed`, text: `Your consultation with ${firm} is confirmed for ${when}. Open the app to prepare.`, url: `/app/appointments/${p.appointment_id}` };
    case 'appointment_reminder_24h': return { subject: `${firm}: your consultation is tomorrow`, text: `Your ${firm} consultation is tomorrow at ${when}.`, url: `/app/appointments/${p.appointment_id}` };
    case 'appointment_reminder_1h':  return { subject: `${firm}: consultation in 1 hour`, text: `Your ${firm} consultation begins in 1 hour (${when}).`, url: `/app/appointments/${p.appointment_id}` };
    case 'appointment_reminder_10m': return { subject: `${firm}: consultation in 10 minutes`, text: `Your consultation begins in 10 minutes. Open the app and join the waiting room.`, url: `/app/appointments/${p.appointment_id}/waiting-room` };
    case 'appointment_reminder_now': return { subject: `${firm}: your consultation is ready`, text: `Your consultation is ready. Join now.`, url: `/app/appointments/${p.appointment_id}/waiting-room` };
    case 'appointment_cancelled':    return { subject: `${firm}: consultation ${p.reference} cancelled`, text: `Your consultation scheduled for ${when} has been cancelled.`, url: `/app/appointments/${p.appointment_id}` };
    case 'appointment_rescheduled':  return { subject: `${firm}: consultation rescheduled`, text: `Your consultation has been moved to ${when}.`, url: `/app/appointments/${p.appointment_id}` };
    case 'invoice_issued':           return { subject: `${firm}: invoice ${p.invoice_number}`, text: `${firm} has issued invoice ${p.invoice_number} for ${p.currency} ${(Number(p.amount_minor) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}${p.due_at ? `, due ${fmtDay(String(p.due_at))}` : ''}. Open the app to pay.`, url: `/app/payments/${p.invoice_id}` };
    case 'payment_confirmed':        return { subject: `${firm}: payment received`, text: `We received your payment for invoice ${p.invoice_number}. Your receipt is in the app.`, url: `/app/payments` };
    case 'matter_update':            return { subject: `${firm}: update on your matter`, text: `${p.title}. Open the app for details.`, url: `/app/matters/${p.matter_id}` };
    case 'court_date_t3':            return { subject: `${firm}: court date in 3 days`, text: `Your matter comes up on ${when}${p.purpose ? ` for ${p.purpose}` : ''}.`, url: `/app/matters/${p.matter_id}` };
    case 'court_date_t1':            return { subject: `${firm}: court date tomorrow`, text: `Your matter comes up tomorrow, ${when}${p.court_name ? ` at ${p.court_name}` : ''}.`, url: `/app/matters/${p.matter_id}` };
    case 'new_message':              return { subject: `${firm}: new message`, text: `You have a new message from ${firm}.`, url: p.matter_id ? `/app/matters/${p.matter_id}` : `/app/messages` };
    case 'document_requested':       return { subject: `${firm}: a document is needed`, text: `${firm} has asked you for: ${p.title}${p.due_on ? `, by ${fmtDay(String(p.due_on))}` : ''}. Upload it in the app.`, url: p.appointment_id ? `/app/appointments/${p.appointment_id}` : `/app/matters/${p.matter_id}?tab=documents` };
    case 'appointment_held':         return { subject: `${firm}: your booking is held for ${when}`, text: `Your consultation with ${firm} on ${when} is booked and held. Open the app to see what is still needed before ${firm} confirms it.`, url: `/app/appointments/${p.appointment_id}` };
    case 'appointment_checkin_due':  return { subject: `${firm}: before your consultation on ${when}`, text: `Your consultation with ${firm} is on ${when} and is not yet confirmed. Open the app to finish what is still needed.`, url: `/app/appointments/${p.appointment_id}` };
    case 'appointment_awaiting_confirmation': return { subject: `Docket: a held consultation is due ${when}`, text: `A consultation on ${when} is still held. Confirm it, or it is released when its time comes.`, url: `/firm/appointments/${p.appointment_id}` };
    case 'document_ready_to_sign':   return { subject: `${firm}: ${p.name ?? 'a document'} is ready for your signature`, text: `${firm} has asked you to sign ${p.name ?? 'a document'}. Open it in the app, read it, and sign by typing your name.`, url: `/app/matters/${p.matter_id}?tab=documents` };
    case 'document_signed':          return p.audience === 'client'
      ? { subject: `${firm}: ${p.name ?? 'a document'} signed`, text: `${firm} signed ${p.name ?? 'a document'}. It is on your matter, locked on the version that was signed.`, url: `/app/matters/${p.matter_id}?tab=documents` }
      : { subject: `Docket: ${p.name ?? 'a document'} signed`, text: `${p.signer ?? 'The signer'} signed ${p.name ?? 'a document'}. The document is now locked on the signed version.`, url: `/firm/matters/${p.matter_id}?tab=documents` };
    case 'representation_granted':   return { subject: `${firm}: somebody has been authorised to act for you`, text: `${firm} has recorded that somebody may act for you${p.organisation ? ` for ${p.organisation}` : ''}. Open the app to see what they may do — and to end it if you did not ask for it.`, url: `/app/authority` };
    case 'representation_accepted':  return { subject: `${firm}: that authority has been taken up`, text: `The person ${firm} named can now act on your files. You can end it at any time from the app.`, url: `/app/authority` };
    case 'representation_revoked':   return { subject: `${firm}: an authority has ended`, text: `The authority to act on your files has ended. Nobody is acting under it from now on.`, url: `/app/authority` };
    case 'representation_accepted_staff': return { subject: `Docket: a representative took up their authority`, text: `The person you authorised has taken it up and can now act on the matters you named.`, url: `/firm/clients/${p.principal_id}` };
    case 'client_contact_changed':   return { subject: `Docket: a client changed how they are reached`, text: `A client changed their ${p.phone_changed ? 'phone number' : ''}${p.phone_changed && p.email_changed ? ' and ' : ''}${p.email_changed ? 'email address' : ''}. If you were not expecting it, ring the number you had for them before.`, url: `/firm/clients/${p.client_id}` };
    case 'collaboration_proposed':   return { subject: `Docket: ${p.from_firm_name} has asked you to take something on`, text: `${p.from_firm_name} has proposed ${p.kind === 'referral' ? 'a referral' : p.kind === 'agency' ? 'an agency instruction' : 'a joint retainer'} on ${p.case_title ?? 'a matter'}${p.suit_number ? ` (${p.suit_number})` : ''}. Open your collaborations to accept or decline it.`, url: `/firm/collaborations` };
    case 'collaboration_accepted':   return { subject: `Docket: ${p.with_firm_name} accepted`, text: `${p.with_firm_name} accepted and is on the matter now.`, url: `/firm/matters/${p.matter_id}?tab=working` };
    case 'collaboration_declined':   return { subject: `Docket: ${p.with_firm_name} declined`, text: `${p.with_firm_name} declined. ${p.reason ?? 'No reason was given.'}`, url: `/firm/matters/${p.matter_id}?tab=working` };
    case 'collaboration_document_shared': return { subject: `Docket: a document was shared with you`, text: `${p.name ?? 'A document'} was shared with you on ${p.case_title ?? 'a matter'}.`, url: `/firm/collaborations` };
    case 'collaboration_ended':      return { subject: `Docket: an arrangement between firms has ended`, text: `The arrangement on ${p.case_title ?? 'a matter'} was ended by ${p.by_firm_name ?? 'one of the firms'}. Nothing further is shared.`, url: `/firm/collaborations` };
    case 'collaboration_started':    return { subject: `${firm}: another firm is working on your matter`, text: `${firm} has brought ${p.with_firm_name ?? 'another firm'} onto your matter. Open the app to see what they are doing.`, url: `/app/matters/${p.matter_id}` };
    case 'document_received':        return { subject: `${firm}: a requested document arrived`, text: `${p.name ?? 'A document'} was uploaded for: ${p.title}.`, url: p.appointment_id ? `/firm/appointments/${p.appointment_id}` : `/firm/matters/${p.matter_id}?tab=documents` };
    case 'deadline_due_t7':          return { subject: `Docket: ${p.title} is due in a week`, text: `${p.title} on ${p.reference ?? 'a matter'} falls due on ${fmtDay(String(p.due_on))}.`, url: `/firm/matters/${p.matter_id}?tab=deadlines` };
    case 'deadline_due_t1':          return { subject: `Docket: ${p.title} is due tomorrow`, text: `${p.title} falls due tomorrow, ${fmtDay(String(p.due_on))}.`, url: `/firm/matters/${p.matter_id}?tab=deadlines` };
    case 'deadline_due_t0':          return { subject: `Docket: ${p.title} is due today`, text: `${p.title} falls due today, ${fmtDay(String(p.due_on))}.`, url: `/firm/matters/${p.matter_id}?tab=deadlines` };
    case 'sitting_without_update':   return { subject: `Docket: sitting without an update`, text: `A court sitting on ${when} has no update posted yet. Post it now — your client is waiting.`, url: `/firm/matters/${p.matter_id}` };
    case 'process_served':           return { subject: `Docket: ${p.process_title} served on your firm`, text: `${p.serving_firm_name} served ${p.process_title} in ${p.case_title ?? 'a matter'}${p.suit_number ? ` (${p.suit_number})` : ''}. Open your service inbox to read and acknowledge it.`, url: `/firm/inbox` };
    case 'service_acknowledged':     return { subject: `Docket: service of ${p.process_title} acknowledged`, text: `${p.by_firm} acknowledged service of ${p.process_title}.`, url: `/firm/inbox` };
    case 'settlement_mismatch':      return { subject: `Docket: payment for ${p.invoice_number} did not settle to your account`, text: `A payment of ${p.currency} ${(Number(p.amount_minor) / 100).toLocaleString('en-NG')} for invoice ${p.invoice_number} was reported against a different Paystack subaccount and has NOT been applied. Check your Paystack subaccount in settings and contact Docket.`, url: `/firm` };
    case 'firm_activated':           return { subject: `Docket: ${firm} is live`, text: `${firm} has been verified and activated on Docket. Your public site and bookings are now open.`, url: `/firm` };
    default:                         return { subject: `${firm}: notification`, text: `You have a new notification from ${firm}. Open the app for details.`, url: '/app' };
  }
}

async function readJson(r: Response): Promise<Record<string, any>> {
  try { return await r.json(); } catch { return {}; }
}

/**
 * The HTML part carries no markup the sender did not write. Several events paste text the OTHER
 * party controls into the sentence — document_received renders the uploading client's own file
 * name, document_signed the signer's own profile name — so interpolating it raw put a working,
 * client-chosen link into an email arriving under the firm's own name. Escaped here, and the
 * newlines the plain part relies on become <br> instead of vanishing.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendEmail(to: string, subject: string, text: string, fromName: string): Promise<Sent> {
  let r: Response;
  try {
    r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${fromName} <${Deno.env.get('EMAIL_FROM')}>`, to, subject, text, html: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>` }),
    });
  } catch (e: any) { throw new SendError(`resend unreachable: ${String(e?.message ?? e)}`, true, 'resend'); }
  const j = await readJson(r);
  if (!r.ok) throw new SendError(`resend ${r.status}${j?.message ? `: ${j.message}` : ''}`, transientStatus(r.status), 'resend');
  return { provider: 'resend', ref: typeof j?.id === 'string' ? j.id : null };
}

async function sendSms(to: string, text: string): Promise<Sent> {
  if (to.startsWith('+234')) {
    let r: Response;
    try {
      r = await fetch('https://api.ng.termii.com/api/sms/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: Deno.env.get('TERMII_API_KEY'), to, from: Deno.env.get('TERMII_SENDER_ID') ?? 'Docket', sms: text, type: 'plain', channel: 'dnd' }),
      });
    } catch (e: any) { throw new SendError(`termii unreachable: ${String(e?.message ?? e)}`, true, 'termii'); }
    const j = await readJson(r);
    if (!r.ok) throw new SendError(`termii ${r.status}${j?.message ? `: ${j.message}` : ''}`, transientStatus(r.status), 'termii');
    // Termii answers 200 to a request it did not take; the body says whether it did.
    if (String(j?.code ?? '').toLowerCase() !== 'ok') throw new SendError(`termii: ${j?.message ?? j?.code ?? 'not accepted'}`, false, 'termii');
    return { provider: 'termii', ref: typeof j?.message_id === 'string' ? j.message_id : j?.message_id != null ? String(j.message_id) : null };
  }
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
  const params: Record<string, string> = { To: to, From: Deno.env.get('TWILIO_FROM')!, Body: text };
  // Twilio reports delivery only to a callback it was given at send time; the receipts function
  // verifies that callback against this same URL.
  const callback = Deno.env.get('TWILIO_STATUS_CALLBACK_URL');
  if (callback) params.StatusCallback = callback;
  let r: Response;
  try {
    r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${sid}:${Deno.env.get('TWILIO_AUTH_TOKEN')}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
  } catch (e: any) { throw new SendError(`twilio unreachable: ${String(e?.message ?? e)}`, true, 'twilio'); }
  const j = await readJson(r);
  if (!r.ok) throw new SendError(`twilio ${r.status}${j?.message ? `: ${j.message}` : ''}${j?.code ? ` (${j.code})` : ''}`, transientStatus(r.status), 'twilio');
  return { provider: 'twilio', ref: typeof j?.sid === 'string' ? j.sid : null };
}

/** Returns how many subscriptions took the push. A subscription the browser has withdrawn is deleted. */
async function sendPush(userId: string, subject: string, text: string, url: string): Promise<number> {
  const { data: subs, error } = await supabase.from('push_subscriptions').select('id, endpoint, keys').eq('user_id', userId);
  if (error) throw new SendError(`push subscriptions unreadable: ${error.message}`, true, 'webpush');
  if (!subs?.length) throw new SendError('no push subscription', false, 'webpush');
  let delivered = 0; let transient = false; let last = '';
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys as any }, JSON.stringify({ title: subject, body: text, url }));
      delivered += 1;
    } catch (e: any) {
      const code = Number(e?.statusCode ?? 0);
      if (code === 404 || code === 410) { await supabase.from('push_subscriptions').delete().eq('id', s.id); continue; }
      last = `push ${code || 'error'}: ${String(e?.body ?? e?.message ?? e).slice(0, 120)}`;
      if (code === 0 || transientStatus(code)) transient = true;
    }
  }
  if (delivered === 0) throw new SendError(last || 'every push subscription had been withdrawn', last ? transient : false, 'webpush');
  return delivered;
}

/** The rate in force for a provider and channel, read once per run. Null means the platform has entered none. */
const rates = new Map<string, Rate | null>();
async function rateFor(provider: string, channel: string): Promise<Rate | null> {
  const key = `${provider}:${channel}`;
  if (rates.has(key)) return rates.get(key)!;
  const { data, error } = await supabase.rpc('current_provider_rate', { p_provider: provider, p_channel: channel });
  const row = Array.isArray(data) ? data[0] : data;
  const rate = !error && row && row.unit_minor != null ? { unit_minor: Number(row.unit_minor), currency: String(row.currency), per_segment: Boolean(row.per_segment) } : null;
  if (error) console.error('current_provider_rate failed', error.message);
  rates.set(key, rate);
  return rate;
}

/**
 * Record what the provider said. This is the one call that must not be lost: the message has
 * already gone, and a row left 'sending' is requeued by claim_notifications() after ten minutes
 * and SENT AGAIN. So it is retried rather than logged once, and a failure that survives every
 * attempt is returned to the caller, which counts it and reports it in the run's answer — an
 * operator seeing `unfinalised` above zero is being told a message may go out twice, instead of
 * finding out from the client.
 */
async function finish(id: string, args: Record<string, unknown>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await supabase.rpc('finish_notification', { p_id: id, ...args });
    if (!error) return true;
    console.error(`finish_notification failed (attempt ${attempt + 1})`, id, error.message);
    if (attempt < 2) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  return false;
}

Deno.serve(async (req: Request) => {
  // Invoked by pg_cron (net.http_post) every minute; the shared secret is the only credential (verify_jwt is off).
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || !(await cronSecretMatches(req.headers.get('x-cron-secret'), secret))) {
    return new Response('unauthorized', { status: 401 });
  }
  // The claim is the lock: these rows are 'sending' and no other run can take them.
  const { data: rows, error } = await supabase.rpc('claim_notifications', { p_limit: 50 });
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0, failed = 0, requeued = 0, unfinalised = 0;
  for (const r of (rows ?? []) as Row[]) {
    const firm = r.firm_name ?? 'Docket';
    const tz = r.timezone ?? 'Africa/Lagos';
    try {
      // Rendering is inside the try, and not above it. fmt() asks Intl for the recipient's zone,
      // and an unknown zone throws a RangeError rather than returning nothing — outside the try
      // that exception escaped Deno.serve and killed the whole run, leaving every row already
      // claimed at 'sending' to be re-claimed, poisoned row first, ten minutes later. The zone is
      // now constrained in the database too (migration 37), but one unrenderable row must fail
      // itself through finish_notification, never the batch.
      const built = render(r, firm, tz);
      const url = built.url;

      // The firm's own words win where the firm has written them.
      const templates = (r.notification_templates ?? {}) as Record<string, Template>;
      const override = templates[r.event];
      let subject = built.subject;
      let text = built.text;
      if (override && typeof override.text === 'string' && override.text.trim().length > 0) {
        const vars = placeholders(r, firm, tz);
        text = fill(override.text, vars);
        // A firm may replace the sentence and leave Docket's subject line alone.
        if (typeof override.subject === 'string' && override.subject.trim().length > 0) {
          subject = fill(override.subject, vars);
        }
      }

      const appUrl = (Deno.env.get('APP_URL') ?? '') + url;
      let result: Sent;
      let segments = 1;
      if (r.channel === 'email') {
        if (!r.email) throw new SendError('no email address on the profile', false, 'resend');
        result = await sendEmail(r.email, subject, `${text}\n\n${appUrl}`, firm);
      } else if (r.channel === 'sms') {
        if (!r.phone) throw new SendError('no phone number on the profile', false, null);
        const body = `${text} ${appUrl}`;
        result = await sendSms(r.phone, body);
        segments = smsSegments(body);
      } else if (r.channel === 'push') {
        segments = await sendPush(r.user_id, subject, text, url);
        result = { provider: 'webpush', ref: null };
      } else {
        throw new SendError(`channel ${r.channel} is not sent by this function`, false, null);
      }
      // Priced only at a rate the platform entered. Web push has no provider charge; anything
      // else without a rate is recorded as unpriced, never as free.
      const rate = await rateFor(result.provider, r.channel);
      const cost = rate ? (rate.per_segment ? rate.unit_minor * Math.max(segments, 1) : rate.unit_minor) : result.provider === 'webpush' ? 0 : null;
      const recorded = await finish(r.id, { p_outcome: 'sent', p_provider: result.provider, p_provider_ref: result.ref, p_segments: segments, p_cost_minor: cost, p_cost_currency: rate?.currency ?? null });
      sent++;
      // The message went, but the row still says 'sending' and will be claimed again in ten
      // minutes — so this one may reach the person twice. Counted and returned rather than
      // buried in a log line nobody reads.
      if (!recorded) unfinalised++;
    } catch (e: any) {
      // Anything that is not a classified send failure — a bug here, a provider library throwing —
      // is treated as transient: the row comes back, bounded, rather than dying on a guess.
      const se = e instanceof SendError ? e : new SendError(String(e?.message ?? e), true, null);
      const recorded = await finish(r.id, { p_outcome: 'failed', p_provider: se.provider, p_error: se.message.slice(0, 500), p_failure_kind: se.transient ? 'transient' : 'permanent' });
      if (!recorded) unfinalised++;
      if (se.transient && r.send_attempts < 5) requeued++; else failed++;
    }
  }
  return new Response(JSON.stringify({ sent, failed, requeued, unfinalised }), { headers: { 'Content-Type': 'application/json' } });
});
