// Supabase Edge Function — notification dispatcher. pg_cron calls it every minute with the x-cron-secret header (migration 9).
// Drains `notifications` rows with status 'queued' for email / sms / push. WhatsApp is Phase 2 (marked 'skipped').
// Templates are minimal and branded by firm name; move them to firms.brand once the design system lands.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:ops@docket.app', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

type Row = { id: string; user_id: string; firm_id: string | null; channel: string; event: string; payload: Record<string, any> };

function fmt(iso: string | undefined, tz: string) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(iso));
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
    case 'payment_confirmed':        return { subject: `${firm}: payment received`, text: `We received your payment for invoice ${p.invoice_number}. Your receipt is in the app.`, url: `/app/payments` };
    case 'matter_update':            return { subject: `${firm}: update on your matter`, text: `${p.title}. Open the app for details.`, url: `/app/matters/${p.matter_id}` };
    case 'court_date_t3':            return { subject: `${firm}: court date in 3 days`, text: `Your matter comes up on ${when}${p.purpose ? ` for ${p.purpose}` : ''}.`, url: `/app/matters/${p.matter_id}` };
    case 'court_date_t1':            return { subject: `${firm}: court date tomorrow`, text: `Your matter comes up tomorrow, ${when}${p.court_name ? ` at ${p.court_name}` : ''}.`, url: `/app/matters/${p.matter_id}` };
    case 'new_message':              return { subject: `${firm}: new message`, text: `You have a new message from ${firm}.`, url: p.matter_id ? `/app/matters/${p.matter_id}` : `/app/messages` };
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
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('unauthorized', { status: 401 });
  const { data: rows, error } = await supabase
    .from('notifications')
    .select('id, user_id, firm_id, channel, event, payload, profiles!inner(email, phone, timezone, full_name), firms(name)')
    .eq('status', 'queued').lte('send_after', new Date().toISOString())
    .in('channel', ['email', 'sms', 'push', 'whatsapp'])
    .order('created_at').limit(50);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0, failed = 0, skipped = 0;
  for (const r of rows ?? []) {
    const prof: any = (r as any).profiles; const firm = (r as any).firms?.name ?? 'Docket';
    const { subject, text, url } = render(r as any, firm, prof?.timezone ?? 'Africa/Lagos');
    const appUrl = (Deno.env.get('APP_URL') ?? '') + url;
    try {
      if (r.channel === 'whatsapp') { await supabase.from('notifications').update({ status: 'skipped', error: 'whatsapp is phase 2' }).eq('id', r.id); skipped++; continue; }
      if (r.channel === 'email') { if (!prof?.email) throw new Error('no email'); await sendEmail(prof.email, subject, `${text}\n\n${appUrl}`, firm); }
      if (r.channel === 'sms')   { if (!prof?.phone) throw new Error('no phone'); await sendSms(prof.phone, `${text} ${appUrl}`); }
      if (r.channel === 'push')  { await sendPush(r.user_id, subject, text, url); }
      await supabase.from('notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', r.id); sent++;
    } catch (e: any) {
      await supabase.from('notifications').update({ status: 'failed', error: String(e?.message ?? e).slice(0, 500) }).eq('id', r.id); failed++;
    }
  }
  return new Response(JSON.stringify({ sent, failed, skipped }), { headers: { 'Content-Type': 'application/json' } });
});
