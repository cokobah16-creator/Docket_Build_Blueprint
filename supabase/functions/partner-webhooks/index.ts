// Pushing events to the endpoints firms have registered, signed so they can be trusted.
//
// Invoked by pg_cron every minute, like the notification dispatcher, and shaped the same way: it
// CLAIMS a bounded batch (marking each attempt and setting the next try before it sends, so two
// runs never deliver the same event twice) and FINISHES each one with what happened. Eight attempts
// over roughly a day and a half, then the delivery is failed and visible as failed on the firm's own
// screen — a queue that retries for ever is a queue nobody looks at.
//
// THE SIGNATURE IS THE POINT. A partner must be able to tell a Docket event from anything else that
// can reach their URL. Each delivery carries:
//
//   Docket-Event:     the event's stable id — the same id the pull feed gives, so a partner that
//                     uses both never processes one twice
//   Docket-Timestamp: unix seconds, inside the signed material, so an old body cannot be replayed
//   Docket-Signature: v1=<hex hmac-sha256 of "<timestamp>.<body>" with the endpoint's secret>
//
// The secret was shown to the firm once, when the endpoint was registered, and is readable here
// alone: api_endpoints has no RLS policy at all and no grant to the API roles.

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

interface Delivery {
  delivery_id: string;
  endpoint_url: string;
  signing_secret: string;
  event_id: string;
  event_type: string;
  occurred_at: string;
  seq: number;
  payload: Record<string, unknown>;
  attempts: number;
}

// Web Crypto's BufferSource excludes a view onto a SharedArrayBuffer, so the key has to be typed
// over a plain ArrayBuffer — the same shape the receipts function needs, for the same reason.
type Bytes = Uint8Array<ArrayBuffer>;

function utf8(s: string): Bytes {
  const out = new Uint8Array(new ArrayBuffer(s.length * 3));
  const written = new TextEncoder().encodeInto(s, out).written;
  return out.subarray(0, written) as Bytes;
}

async function sign(secret: string, material: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, utf8(material));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function finish(id: string, ok: boolean, status: number | null, error: string | null): Promise<void> {
  const { error: e } = await supabase.rpc('finish_api_delivery', {
    p_id: id, p_ok: ok, p_status: status, p_error: error,
  });
  // The claim already advanced next_try_at, so a delivery whose outcome could not be written comes
  // back on its own schedule rather than being lost or hammered.
  if (e) console.error('finish_api_delivery failed', id, e.message);
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('CRON_SECRET');
  const presented = req.headers.get('x-cron-secret');
  if (!secret || presented !== secret) return new Response('unauthorized', { status: 401 });

  const { data, error } = await supabase.rpc('claim_api_deliveries', { p_limit: 50 });
  if (error) return new Response(error.message, { status: 500 });

  let delivered = 0, failed = 0;
  for (const d of (data ?? []) as Delivery[]) {
    const body = JSON.stringify({
      id: d.event_id, seq: d.seq, type: d.event_type, occurred_at: d.occurred_at, data: d.payload,
    });
    const ts = Math.floor(Date.parse(d.occurred_at) / 1000) || 0;
    try {
      const signature = await sign(d.signing_secret, `${ts}.${body}`);
      const res = await fetch(d.endpoint_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Docket/1 (+partner-webhooks)',
          'Docket-Event': d.event_id,
          'Docket-Timestamp': String(ts),
          'Docket-Signature': `v1=${signature}`,
        },
        body,
        // A partner's slow endpoint must not hold the batch: ten seconds, then it is a retry.
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) { await finish(d.delivery_id, true, res.status, null); delivered++; }
      else { await finish(d.delivery_id, false, res.status, `endpoint answered ${res.status}`); failed++; }
    } catch (e: unknown) {
      await finish(d.delivery_id, false, null, String((e as { message?: string })?.message ?? e));
      failed++;
    }
  }
  return new Response(JSON.stringify({ delivered, failed }), { headers: { 'Content-Type': 'application/json' } });
});
