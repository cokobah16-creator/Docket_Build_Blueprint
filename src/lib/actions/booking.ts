"use server";

// Booking server actions. Payment is initialised server-side with the
// provider secret and the client is redirected to checkout; NOTHING here
// marks anything paid — only the provider webhook → record_payment() does.
//
// TWO THINGS SLICE 5 ADDED, AND WHY THEY ARE BOTH HERE
//
// 1. THE RATE LIMITS. Booking is enforced INSIDE book_appointment() (migration 23), so a caller
//    using Supabase directly cannot walk around it. Do not call allow(..., "booking") here too:
//    rate_limit_hit increments the bucket, and doing both would make one real booking consume two
//    attempts. Checkout is different: this server action is the only door to the provider secret,
//    so its limit lives here.
//
// 2. STEP TWO OF THE FUNNEL, booking_started, emitted after book_appointment() returns — a
//    booking the database refused is not a booking that started. The distinct id is the same
//    visitor cookie the tenant site counted on arrival, so the two steps join up without this
//    file needing to know who the person is; identify() at /auth/callback ties that id to the
//    account. Properties are facts about the booking (firm, service, amount, currency), never
//    a name, phone or email. Step three, booking_paid, is NOT emitted anywhere in app/ or src/:
//    the only honest source is the Paystack webhook after record_payment() succeeds.
//
// Nothing here decides anything. book_appointment() checks the firm, the service, the slot and
// the lawyer, and its refusal is returned word for word (law 1).

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/site";
import { paymentProviderFor, type Currency, type PaymentChannel } from "@/lib/providers/payments";
import { allow, tooFast } from "@/lib/rate-limit";
import { FUNNEL, VISITOR_COOKIE, capture } from "@/lib/observability";
import type { BookingResult } from "@/lib/db/types";
import { after } from "next/server";
import { userError } from "@/lib/user-error";
import { claimPaymentCheckout, completePaymentCheckout, failPaymentCheckout } from "@/lib/payment-checkout";

/** The appointment_mode enum in migration 1. The database is what refuses anything else. */
export type BookingMode = "virtual" | "in_person" | "phone";

/** The anonymous id the tenant site was counted under, so the funnel stays one chain. */
async function visitorId(): Promise<string | null> {
  const jar = await cookies();
  return jar.getAll().find((c) => c.name === VISITOR_COOKIE)?.value ?? null;
}

export interface BookAppointmentInput {
  firmId: string;
  /** Carried for the funnel only — the database identifies the firm by id. */
  firmSlug: string;
  serviceId: string;
  lawyerId: string;
  /** UTC instant of the slot, exactly as available_slots() offered it. */
  startsAt: string;
  mode: BookingMode;
  /** The visitor's own zone, so reminders and the diary read in it (law 4). */
  clientTimezone: string;
  intake: Record<string, unknown> | null;
  intakeFormId: string | null;
}

export type BookAppointmentResult = { error: string } | { booking: BookingResult };

/**
 * Take the slot.
 *
 * book_appointment() is a security-definer function that runs as the signed-in client: it
 * re-checks the service, the lawyer's availability and the slot, mints the reference, raises the
 * invoice and decides whether the appointment is confirmed outright or awaiting payment. This
 * action adds the funnel event after it succeeds. The booking rate limit is already inside the
 * RPC itself, where it cannot be bypassed, and every refusal is passed back in the database's own words.
 */
export async function bookAppointment(input: BookAppointmentInput): Promise<BookAppointmentResult> {
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  // book_appointment() itself owns the booking bucket. Calling allow() here as well would
  // increment the same counter twice for one booking.
  const { data, error } = await supabase.rpc("book_appointment", {
    p_firm: input.firmId,
    p_service: input.serviceId,
    p_lawyer: input.lawyerId,
    p_starts_at: input.startsAt,
    p_mode: input.mode,
    p_client_timezone: input.clientTimezone,
    p_intake: input.intake,
    p_intake_form: input.intakeFormId,
  });
  if (error) return { error: error.message };

  const booking = (data ?? null) as BookingResult | null;
  if (!booking?.appointment_id) return { error: "The booking could not be completed. Try again." };

  const visitor = await visitorId();
  if (visitor) {
    // after() so the event survives the response. An un-awaited fetch in a serverless function
    // can be cut off the instant the response flushes.
    after(() =>
      capture(FUNNEL.bookingStarted, visitor, {
        firm_id: input.firmId,
        firm_slug: input.firmSlug,
        service_id: input.serviceId,
        amount_minor: booking.amount_minor,
        currency: booking.currency,
      }).catch(() => undefined),
    );
  }

  return { booking };
}

export async function startPayment(
  appointmentId: string,
  channel?: PaymentChannel | null,
): Promise<{ error: string } | undefined> {
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Payments are not configured yet." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/app/login`);

  const appointmentResult = await supabase
    .from("appointments")
    .select("id, reference, status, hold_expires_at, invoice_id, currency")
    .eq("id", appointmentId)
    .maybeSingle();
  if (appointmentResult.error) {
    return { error: await userError(appointmentResult.error, "The booking", "booking: load appointment for payment") };
  }
  const appt = appointmentResult.data as
    | { id: string; reference: string; status: string; hold_expires_at: string | null; invoice_id: string | null; currency: Currency | null }
    | null;
  if (!appt) return { error: "Appointment not found." };

  const resultPath = `/app/appointments/${appt.id}/payment-result`;
  if (appt.status === "confirmed" || !appt.invoice_id) redirect(resultPath);
  if (!['pending', 'awaiting_payment'].includes(appt.status)
      || (appt.hold_expires_at && new Date(appt.hold_expires_at).getTime() <= Date.now())) {
    return { error: "This booking is no longer open for payment. Contact the firm if you were charged." };
  }

  const invoiceResult = await supabase
    .from("invoices")
    .select("id, number, total_minor, currency, status")
    .eq("id", appt.invoice_id)
    .maybeSingle();
  if (invoiceResult.error) {
    return { error: await userError(invoiceResult.error, "The invoice", "booking: load invoice for payment") };
  }
  const invoice = invoiceResult.data as
    | { id: string; number: string; total_minor: number; currency: Currency; status: string }
    | null;
  if (!invoice) return { error: "Invoice not found." };
  if (invoice.status === "paid") redirect(resultPath);

  let email = user.email ?? null;
  if (!email) {
    const profileResult = await supabase.from("profiles").select("email").eq("id", user.id).maybeSingle();
    if (profileResult.error) {
      return { error: await userError(profileResult.error, "Your profile", "booking: load receipt email") };
    }
    email = (profileResult.data as { email: string | null } | null)?.email ?? null;
  }
  if (!email) return { error: "We need an email address to send your receipt. Add one and try again." };

  // Fees settle to the firm's own Paystack subaccount. Only the invoice's client (or the
  // firm) can ask for it, and the database refuses to record a payment settled anywhere else.
  const settlementResult = await supabase.rpc("invoice_settlement", { p_invoice: invoice.id });
  if (settlementResult.error) {
    return { error: await userError(settlementResult.error, "The payment", "booking: load settlement account") };
  }
  const subaccount = (settlementResult.data as { paystack_subaccount: string | null } | null)?.paystack_subaccount ?? null;
  if (!subaccount) return { error: "This firm is not yet set up to receive payments. Please contact the firm." };

  // Reserve the invoice before creating a provider transaction. Two simultaneous requests now
  // line up on the invoice row: one creates the Paystack reference, the other reuses it (or waits
  // while the first request is still obtaining its checkout URL).
  const claim = await claimPaymentCheckout(supabase, invoice.id, channel ?? null);
  if ("error" in claim) return { error: claim.error };
  if (claim.state === "paid") redirect(resultPath);
  if (claim.state === "reuse") redirect(claim.checkoutUrl);
  if (claim.state === "busy") {
    return { error: "A payment checkout is already being opened for this invoice. Use that window, or try again in a few minutes." };
  }

  // Only a genuinely new provider transaction spends the checkout rate-limit bucket.
  if (!(await allow(supabase, "checkout", true))) {
    await failPaymentCheckout(supabase, claim.attemptId, "checkout rate limit");
    return { error: tooFast("checkout") };
  }

  const origin = await siteOrigin();
  let checkoutUrl: string;
  try {
    const provider = paymentProviderFor(claim.currency);
    const result = await provider.initialize({
      invoiceNumber: invoice.number,
      providerRef: claim.providerRef,
      amountMinor: claim.amountMinor,
      currency: claim.currency,
      email,
      description: `Consultation ${appt.reference}`,
      callbackUrl: `${origin}${resultPath}`,
      cancelUrl: `${origin}/app/appointments/${appt.id}`,
      subaccount,
      channel: channel ?? null,
    });
    checkoutUrl = result.checkoutUrl;

    // If this bookkeeping write fails, still send the client to the one transaction that was
    // created. The five-minute "initializing" lease continues to block a duplicate retry.
    const completeError = await completePaymentCheckout(supabase, claim.attemptId, checkoutUrl);
    if (completeError) {
      await userError(new Error(completeError), "The payment checkout", "booking: save checkout lease");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start payment.";
    await failPaymentCheckout(supabase, claim.attemptId, message);
    return { error: message.includes("PAYSTACK_SECRET_KEY") || message.includes("initialize failed")
      ? `Could not start payment: ${message}`
      : "Could not start payment. Please try again." };
  }
  redirect(checkoutUrl);
}

export async function cancelAppointment(appointmentId: string): Promise<{ error: string } | undefined> {
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("cancel_appointment", { p_appointment: appointmentId, p_reason: "cancelled by client" });
  if (error) {
    // cancel_appointment() raises short developer phrases; these two are the ones a client can
    // cause by ordinary use, and each gets its own sentence. Anything else is reported and worded.
    if (/already started/i.test(error.message)) return { error: "This consultation has already started, so it can no longer be cancelled here. Message the firm instead." };
    if (/appointment already/i.test(error.message)) return { error: "This consultation is already closed, so there is nothing to cancel." };
    return { error: await userError(error, "The cancellation", "booking: cancel appointment") };
  }
  revalidatePath(`/app/appointments/${appointmentId}`);
  revalidatePath("/app/appointments");
  return undefined;
}

/** Store the email a phone-only client gives at checkout (receipts go there). */
export async function saveContactEmail(email: string): Promise<{ error: string } | undefined> {
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { error: "That email address doesn't look right." };
  const { error } = await supabase.from("profiles").update({ email: trimmed }).eq("id", user.id);
  if (error) return { error: await userError(error, "Your email address", "booking: save contact email") };
  return undefined;
}
