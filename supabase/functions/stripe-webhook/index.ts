// Stripe webhook (USD). Verifies the stripe-signature header (HMAC-SHA256
// over `${timestamp}.${body}` with STRIPE_WEBHOOK_SECRET, 5-minute
// tolerance), then hands the money movement to record_payment() —
// idempotent on the Stripe id, service role only.
//
// Point Stripe's webhook endpoint at /functions/v1/stripe-webhook and
// subscribe it to checkout.session.completed and payment_intent.succeeded.

import {
  hmacHex,
  json,
  logWebhookEvent,
  rpc,
  timingSafeEqual,
} from "../_shared/db.ts";

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const TOLERANCE_SECONDS = 300;

function parseSignatureHeader(header: string): { t: number; v1: string[] } {
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1] ?? 0);
  const v1 = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  return { t, v1 };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const body = await req.text();
  const header = req.headers.get("stripe-signature") ?? "";
  const { t, v1 } = parseSignatureHeader(header);

  const fresh = Math.abs(Date.now() / 1000 - t) <= TOLERANCE_SECONDS;
  const expected = await hmacHex("SHA-256", STRIPE_WEBHOOK_SECRET, `${t}.${body}`);
  const signed = v1.some((sig) => timingSafeEqual(sig, expected));
  if (!fresh || !signed) {
    await logWebhookEvent({
      provider: "stripe",
      status: "failed",
      error: fresh ? "bad signature" : "stale timestamp",
    });
    return json({ error: "invalid signature" }, 401);
  }

  let event: {
    id?: string;
    type?: string;
    data?: {
      object?: {
        id?: string;
        amount_total?: number; // checkout.session, cents
        amount_received?: number; // payment_intent, cents
        currency?: string;
        payment_status?: string;
        status?: string;
        metadata?: { invoice_number?: string };
      };
    };
  };
  try {
    event = JSON.parse(body);
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const type = event.type ?? "";
  const object = event.data?.object;
  const handled =
    type === "checkout.session.completed" || type === "payment_intent.succeeded";
  if (!handled || !object?.id) {
    await logWebhookEvent({
      provider: "stripe",
      event_type: type,
      provider_ref: object?.id,
      status: "ignored",
    });
    return json({ received: true });
  }

  const invoiceNumber = object.metadata?.invoice_number;
  if (!invoiceNumber) {
    await logWebhookEvent({
      provider: "stripe",
      event_type: type,
      provider_ref: object.id,
      status: "ignored",
      error: "no invoice_number in metadata",
    });
    return json({ received: true });
  }

  const cents = object.amount_total ?? object.amount_received ?? 0;
  const paid =
    type === "payment_intent.succeeded" || object.payment_status === "paid";

  try {
    const result = await rpc("record_payment", {
      p_provider: "stripe",
      p_ref: object.id,
      p_invoice_number: invoiceNumber,
      p_amount: cents / 100, // cents → dollars
      p_currency: (object.currency ?? "usd").toUpperCase(),
      p_status: paid ? "success" : "failed",
      p_raw: object,
    });

    await logWebhookEvent({
      provider: "stripe",
      event_type: type,
      provider_ref: object.id,
      status: "processed",
      payload: result,
    });
    return json({ received: true });
  } catch (err) {
    await logWebhookEvent({
      provider: "stripe",
      event_type: type,
      provider_ref: object.id,
      status: "failed",
      error: String(err),
    });
    return json({ error: "processing failed" }, 500); // Stripe retries
  }
});
