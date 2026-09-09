// Paystack webhook (NGN). Trust chain, in order:
//   1. HMAC-SHA512 of the raw body with PAYSTACK_SECRET_KEY must match
//      x-paystack-signature.
//   2. The transaction is RE-VERIFIED against the Paystack API — the webhook
//      body is never the source of truth for money.
//   3. record_payment() (service role, idempotent on the Paystack reference)
//      settles the invoice and confirms the appointment.
//
// Point Paystack's webhook URL at /functions/v1/paystack-webhook.

import {
  hmacHex,
  json,
  logWebhookEvent,
  rpc,
  timingSafeEqual,
} from "../_shared/db.ts";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;

interface PaystackVerification {
  status: boolean;
  data?: {
    status: string;
    reference: string;
    amount: number; // kobo
    currency: string;
    metadata?: { invoice_number?: string } | null;
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const body = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";
  const expected = await hmacHex("SHA-512", PAYSTACK_SECRET_KEY, body);
  if (!timingSafeEqual(signature, expected)) {
    await logWebhookEvent({
      provider: "paystack",
      status: "failed",
      error: "bad signature",
    });
    return json({ error: "invalid signature" }, 401);
  }

  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(body);
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const reference = event.data?.reference;
  if (event.event !== "charge.success" || !reference) {
    await logWebhookEvent({
      provider: "paystack",
      event_type: event.event,
      provider_ref: reference,
      status: "ignored",
    });
    return json({ received: true });
  }

  try {
    // Re-verify with Paystack before touching the database.
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } },
    );
    const verification = (await verifyRes.json()) as PaystackVerification;
    const tx = verification.data;
    if (!verifyRes.ok || !verification.status || !tx) {
      throw new Error(`verification failed: ${verifyRes.status}`);
    }

    const invoiceNumber = tx.metadata?.invoice_number;
    if (!invoiceNumber) {
      await logWebhookEvent({
        provider: "paystack",
        event_type: event.event,
        provider_ref: reference,
        status: "ignored",
        error: "no invoice_number in metadata",
      });
      return json({ received: true });
    }

    const result = await rpc("record_payment", {
      p_provider: "paystack",
      p_ref: tx.reference,
      p_invoice_number: invoiceNumber,
      p_amount: tx.amount / 100, // kobo → naira
      p_currency: tx.currency,
      p_status: tx.status, // 'success' when verified paid
      p_raw: tx,
    });

    await logWebhookEvent({
      provider: "paystack",
      event_type: event.event,
      provider_ref: reference,
      status: "processed",
      payload: result,
    });
    return json({ received: true });
  } catch (err) {
    await logWebhookEvent({
      provider: "paystack",
      event_type: event.event,
      provider_ref: reference,
      status: "failed",
      error: String(err),
    });
    // 500 so Paystack retries.
    return json({ error: "processing failed" }, 500);
  }
});
