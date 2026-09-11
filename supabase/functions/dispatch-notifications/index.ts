// Supabase Edge Function — notification dispatcher. pg_cron calls it every minute with the x-cron-secret header (migration 9).
// Drains `notifications` rows with status 'queued' for email / sms / push. WhatsApp is Phase 2 (marked 'skipped').
//
// THE WORDS ARE THE FIRM'S WHERE THE FIRM HAS WRITTEN THEM. Every sentence below is Docket's,
// and a firm may replace any of them for any event through firms.notification_templates
// (migration 20). An override is used INSTEAD of the built-in copy for that event; every event
// it does not override keeps Docket's words, so an empty object is the normal state and no
// client is ever left without a message. Placeholders in {braces} are filled here.
//
// A RETRY COUNTS, A FAILURE DOES NOT. notifications.attempts (migration 20) belongs to
// retry_notification(): it increments when an operator puts a failed message back in the queue
// and refuses the sixth. This function only marks the row 'failed' — counting the failure here
// as well would make one retry cost two, so a provider outage cannot become an endless loop of
// texts at a client's expense and an operator is never told they have used tries they have not.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:ops@docket.app', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

type Row = { id: string; user_id: string; firm_id: string | null; channel: string; event: string; attempts: number | null; payload: Record<string, any> };

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
    case 'document_received':        return { subject: `${firm}: a requested document arrived`, text: `${p.name ?? 'A document'} was uploaded for: ${p.title}.`, url: `/firm/matters/${p.matter_id}?tab=documents` };
    case 'sitting_without_update':   return { subject: `Docket: sitting without an update`, text: `A court sitting on ${when} has no update posted yet. Post it now — your client is waiting.`, url: `/firm/matters/${p.matter_id}` };
    case 'process_served':           return { subject: `Docket: ${p.process_title} served on your firm`, text: `${p.serving_firm_name} served ${p.process_title} in ${p.case_title ?? 'a matter'}${p.suit_number ? ` (${p.suit_number})` : ''}. Open your service inbox to read and acknowledge it.`, url: `/firm/inbox` };
    case 'service_acknowledged':     return { subject: `Docket: service of ${p.process_title} acknowledged`, text: `${p.by_firm} acknowledged service of ${p.process_title}.`, url: `/firm/inbox` };
    case 'settlement_mismatch':      return { subject: `Docket: payment for ${p.invoice_number} did not settle to your account`, text: `A payment of ${p.currency} ${(Number(p.amount_minor) / 100).toLocaleString('en-NG')} for invoice ${p.invoice_number} was reported against a different Paystack subaccount and has NOT been applied. Check your Paystack subaccount in settings and contact Docket.`, url: `/firm` };
    case 'firm_activated':           return { subject: `Docket: ${firm} is live`, text: `${firm} has been verified and activated on Docket. Your public site and bookings are now open.`, url: `/firm` };
    default:                         return { subject: `${firm}: notification`, text: `You have a new notification from ${firm}. Open the app for details.`, url: '/app' };
  }
}

async function sendEmail(to: string, subject: string, text: string, fromName: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${fromName} <${Deno.env.get('EMAIL_FROM')}>`, to, subject, text, html: `<p>${text}</p>` }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}`);
}

async function sendSms(to: string, text: string) {
  if (to.startsWith('+234')) {
    const r = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: Deno.env.get('TERMII_API_KEY'), to, from: Deno.env.get('TERMII_SENDER_ID') ?? 'Docket', sms: text, type: 'plain', channel: 'dnd' }),
    });
    if (!r.ok) throw new Error(`termii ${r.status}`);
  } else {
    const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${sid}:${Deno.env.get('TWILIO_AUTH_TOKEN')}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: Deno.env.get('TWILIO_FROM')!, Body: text }),
    });
    if (!r.ok) throw new Error(`twilio ${r.status}`);
  }
}

async function sendPush(userId: string, subject: string, text: string, url: string) {
  const { data: subs } = await supabase.from('push_subscriptions').select('id, endpoint, keys').eq('user_id', userId);
  if (!subs?.length) throw new Error('no push subscription');
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys as any }, JSON.stringify({ title: subject, body: text, url }));
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await supabase.from('push_subscriptions').delete().eq('id', s.id);
      else throw e;
    }
  }
}

Deno.serve(async (req: Request) => {
  // Invoked by pg_cron (net.http_post) every minute; the shared secret is the only credential (verify_jwt is off).
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || !(await cronSecretMatches(req.headers.get('x-cron-secret'), secret))) {
    return new Response('unauthorized', { status: 401 });
  }
  const { data: rows, error } = await supabase
    .from('notifications')
    .select('id, user_id, firm_id, channel, event, attempts, payload, profiles!inner(email, phone, timezone, full_name), firms(name, notification_templates)')
    .eq('status', 'queued').lte('send_after', new Date().toISOString())
    .in('channel', ['email', 'sms', 'push', 'whatsapp'])
    .order('created_at').limit(50);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0, failed = 0, skipped = 0;
  for (const r of rows ?? []) {
    const prof: any = (r as any).profiles; const firm = (r as any).firms?.name ?? 'Docket';
    const tz = prof?.timezone ?? 'Africa/Lagos';
    const built = render(r as any, firm, tz);
    const url = built.url;

    // The firm's own words win where the firm has written them.
    const templates = ((r as any).firms?.notification_templates ?? {}) as Record<string, Template>;
    const override = templates[r.event];
    let subject = built.subject;
    let text = built.text;
    if (override && typeof override.text === 'string' && override.text.trim().length > 0) {
      const vars = placeholders(r as any, firm, tz);
      text = fill(override.text, vars);
      // A firm may replace the sentence and leave Docket's subject line alone.
      if (typeof override.subject === 'string' && override.subject.trim().length > 0) {
        subject = fill(override.subject, vars);
      }
    }

    const appUrl = (Deno.env.get('APP_URL') ?? '') + url;
    try {
      if (r.channel === 'whatsapp') { await supabase.from('notifications').update({ status: 'skipped', error: 'whatsapp is phase 2' }).eq('id', r.id); skipped++; continue; }
      if (r.channel === 'email') { if (!prof?.email) throw new Error('no email'); await sendEmail(prof.email, subject, `${text}\n\n${appUrl}`, firm); }
      if (r.channel === 'sms')   { if (!prof?.phone) throw new Error('no phone'); await sendSms(prof.phone, `${text} ${appUrl}`); }
      if (r.channel === 'push')  { await sendPush(r.user_id, subject, text, url); }
      await supabase.from('notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', r.id); sent++;
    } catch (e: any) {
      // attempts is NOT touched here. retry_notification() (migration 20) owns that counter: it
      // increments on every re-queue and refuses the sixth. Counting the send failure as well
      // would make one retry cycle cost two, so an operator would get two tries and be told they
      // had used five.
      await supabase.from('notifications')
        .update({ status: 'failed', error: String(e?.message ?? e).slice(0, 500) })
        .eq('id', r.id);
      failed++;
    }
  }
  return new Response(JSON.stringify({ sent, failed, skipped }), { headers: { 'Content-Type': 'application/json' } });
});
