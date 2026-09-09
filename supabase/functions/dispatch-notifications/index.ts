// dispatch-notifications: drains the outbox (public.notifications rows with
// status 'queued', scheduled_for <= now, channel email/sms/push) and delivers
// via Resend (email), Termii or Twilio (SMS) and Web Push (VAPID). in_app
// rows are not dispatched — the client reads them straight from the table.
//
// Driven by Supabase Cron every minute (see README). Callable only with the
// service-role key (or CRON_SECRET as a bearer token).

import { json, select, update } from "../_shared/db.ts";
import { type PushSubscription, sendWebPush } from "../_shared/webpush.ts";

const BATCH = 50;
const MAX_ATTEMPTS = 5;
const APP_BASE_URL = (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/$/, "");

interface NotificationRow {
  id: string;
  user_id: string;
  channel: "email" | "sms" | "push";
  event: string;
  title: string;
  body: string | null;
  url: string | null;
  attempts: number;
}

interface ProfileRow {
  id: string;
  email: string | null;
  phone: string | null;
  quiet_hours: { start?: string; end?: string } | null;
  timezone: string;
}

function authorized(req: Request): boolean {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const cronSecret = Deno.env.get("CRON_SECRET");
  return (
    bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    (!!cronSecret && bearer === cronSecret)
  );
}

// --- email: Resend ----------------------------------------------------------

async function sendEmail(to: string, title: string, body: string, url: string | null) {
  const link = url ? `${APP_BASE_URL}${url}` : APP_BASE_URL;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("EMAIL_FROM") ?? "Docket <notifications@docket.app>",
      to: [to],
      subject: title,
      text: `${body}\n\n${link}`,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}

// --- SMS: Termii (Nigeria, DND-safe) with Twilio fallback -------------------

async function sendSms(to: string, text: string) {
  const termiiKey = Deno.env.get("TERMII_API_KEY");
  if (termiiKey) {
    const res = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: termiiKey,
        to,
        from: Deno.env.get("TERMII_SENDER_ID") ?? "Docket",
        sms: text,
        type: "plain",
        channel: "dnd",
      }),
    });
    if (!res.ok) throw new Error(`termii ${res.status}: ${await res.text()}`);
    return;
  }

  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM");
  if (!sid || !token || !from) throw new Error("no SMS provider configured");
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: text }),
    },
  );
  if (!res.ok) throw new Error(`twilio ${res.status}: ${await res.text()}`);
}

// --- push -------------------------------------------------------------------

async function sendPush(userId: string, n: NotificationRow): Promise<void> {
  const subs = await select<
    { id: string; endpoint: string; p256dh: string; auth: string }
  >("push_subscriptions", `user_id=eq.${userId}&select=id,endpoint,p256dh,auth`);
  if (subs.length === 0) throw new Error("no push subscriptions");

  let delivered = 0;
  for (const sub of subs) {
    const result = await sendWebPush(sub as PushSubscription, {
      title: n.title,
      body: n.body ?? "",
      url: n.url ?? "/",
      event: n.event,
    });
    if (result.gone) {
      // Dead endpoint: forget it.
      await fetch(
        `${Deno.env.get("SUPABASE_URL")}/rest/v1/push_subscriptions?id=eq.${sub.id}`,
        {
          method: "DELETE",
          headers: {
            apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
          },
        },
      ).catch(() => {});
    } else if (result.ok) {
      delivered++;
    }
  }
  if (delivered === 0) throw new Error("no push endpoint accepted the message");
}

// --- quiet hours ------------------------------------------------------------

function inQuietHours(profile: ProfileRow): boolean {
  const qh = profile.quiet_hours;
  if (!qh?.start || !qh?.end) return false;
  const now = new Date().toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    timeZone: profile.timezone || "Africa/Lagos",
  });
  return qh.start <= qh.end
    ? now >= qh.start && now < qh.end
    : now >= qh.start || now < qh.end; // window crosses midnight
}

// --- the drain --------------------------------------------------------------

Deno.serve(async (req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);

  const due = await select<NotificationRow>(
    "notifications",
    "status=eq.queued&channel=in.(email,sms,push)" +
      `&scheduled_for=lte.${encodeURIComponent(new Date().toISOString())}` +
      `&select=id,user_id,channel,event,title,body,url,attempts` +
      `&order=scheduled_for.asc&limit=${BATCH}`,
  );
  if (due.length === 0) return json({ dispatched: 0 });

  const userIds = [...new Set(due.map((n) => n.user_id))];
  const profiles = await select<ProfileRow>(
    "profiles",
    `id=in.(${userIds.join(",")})&select=id,email,phone,quiet_hours,timezone`,
  );
  const byUser = new Map(profiles.map((p) => [p.id, p]));

  let sent = 0;
  let failed = 0;
  let deferred = 0;

  for (const n of due) {
    const profile = byUser.get(n.user_id);

    // Respect quiet hours for interruptive channels (email queues quietly).
    if (profile && (n.channel === "sms" || n.channel === "push") && inQuietHours(profile)) {
      await update("notifications", `id=eq.${n.id}`, {
        scheduled_for: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      });
      deferred++;
      continue;
    }

    await update("notifications", `id=eq.${n.id}`, {
      status: "sending",
      attempts: n.attempts + 1,
    });

    try {
      const text = n.body ?? n.title;
      if (n.channel === "email") {
        if (!profile?.email) throw new Error("profile has no email");
        await sendEmail(profile.email, n.title, text, n.url);
      } else if (n.channel === "sms") {
        if (!profile?.phone) throw new Error("profile has no phone");
        await sendSms(profile.phone, `${n.title}. ${text}`.slice(0, 320));
      } else {
        await sendPush(n.user_id, n);
      }
      await update("notifications", `id=eq.${n.id}`, {
        status: "sent",
        sent_at: new Date().toISOString(),
        error: null,
      });
      sent++;
    } catch (err) {
      const attempts = n.attempts + 1;
      await update("notifications", `id=eq.${n.id}`, {
        status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
        error: String(err).slice(0, 500),
        // linear backoff: 2 minutes per attempt
        scheduled_for: new Date(Date.now() + attempts * 2 * 60 * 1000).toISOString(),
      });
      failed++;
    }
  }

  return json({ dispatched: sent, failed, deferred, batch: due.length });
});
