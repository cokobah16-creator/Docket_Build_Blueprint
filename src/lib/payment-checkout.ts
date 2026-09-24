import type { SupabaseClient } from "@supabase/supabase-js";
import type { Currency, PaymentChannel } from "@/lib/providers/payments";

export type PaymentCheckoutClaim =
  | { state: "create"; attemptId: string; providerRef: string; amountMinor: number; currency: Currency }
  | { state: "reuse"; attemptId: string; providerRef: string; checkoutUrl: string; amountMinor: number; currency: Currency }
  | { state: "busy" }
  | { state: "paid" };

type ClaimRow = {
  state?: string;
  attempt_id?: string;
  provider_ref?: string;
  checkout_url?: string;
  amount_minor?: number;
  currency?: Currency;
};

export async function claimPaymentCheckout(
  supabase: SupabaseClient,
  invoiceId: string,
  channel?: PaymentChannel | null,
): Promise<PaymentCheckoutClaim | { error: string }> {
  const { data, error } = await supabase.rpc("claim_payment_checkout", {
    p_invoice: invoiceId,
    p_channel: channel ?? null,
  });
  if (error) return { error: error.message };

  const row = (data ?? {}) as ClaimRow;
  if (row.state === "paid") return { state: "paid" };
  if (row.state === "busy") return { state: "busy" };
  if (
    (row.state === "create" || row.state === "reuse")
    && row.attempt_id
    && row.provider_ref
    && typeof row.amount_minor === "number"
    && row.currency
  ) {
    if (row.state === "reuse" && row.checkout_url) {
      return {
        state: "reuse",
        attemptId: row.attempt_id,
        providerRef: row.provider_ref,
        checkoutUrl: row.checkout_url,
        amountMinor: row.amount_minor,
        currency: row.currency,
      };
    }
    if (row.state === "create") {
      return {
        state: "create",
        attemptId: row.attempt_id,
        providerRef: row.provider_ref,
        amountMinor: row.amount_minor,
        currency: row.currency,
      };
    }
  }
  return { error: "The payment checkout could not be reserved. Please try again." };
}

export async function completePaymentCheckout(
  supabase: SupabaseClient,
  attemptId: string,
  checkoutUrl: string,
): Promise<string | null> {
  const { error } = await supabase.rpc("complete_payment_checkout", {
    p_attempt: attemptId,
    p_checkout_url: checkoutUrl,
  });
  return error?.message ?? null;
}

export async function failPaymentCheckout(
  supabase: SupabaseClient,
  attemptId: string,
  reason: string,
): Promise<void> {
  await supabase.rpc("fail_payment_checkout", {
    p_attempt: attemptId,
    p_error: reason.slice(0, 1000),
  });
}
