"use server";

// Booking server actions. Payment is initialised server-side with the
// provider secret and the client is redirected to checkout; NOTHING here
// marks anything paid — only the provider webhook → record_payment() does.
//
// TWO THINGS SLICE 5 ADDED, AND WHY THEY ARE BOTH HERE
//
// 1. THE RATE LIMITS (migration 21's rate_limit_hit, via src/lib/rate-limit.ts). Both buckets
//    protect something that costs: a booking takes a slot out of a lawyer's diary, and a
//    checkout creates a live transaction at Paystack. A limit is only worth having where the
//    caller cannot walk around it, which means server-side — a browser calling the RPC directly
//    can simply not call rate_limit_hit first. So bookAppointment() below wraps the RPC and asks
//    the bucket first. Said plainly, because it matters: the booking wizard
//    (app/(public)/[firm]/book/booking-wizard.tsx) still calls supabase.rpc("book_appointment")
//    from the browser, and until that one call becomes bookAppointment(), the booking bucket
//    counts nothing and booking_started is emitted for nobody. The checkout bucket in
//    startPayment() below is live now, because the wizard already calls that action.
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
 * action adds exactly two things around it — the booking rate limit before, and the funnel event
 * after — and passes every refusal back in the database's own words.
 */
export async function bookAppointment(input: BookAppointmentInput): Promise<BookAppointmentResult> {
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  // Keyed on auth.uid() inside the function, where it cannot be forged.
  if (!(await allow(supabase, "booking", true))) return { error: tooFast("booking") };

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

  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, reference, status, invoice_id, currency")
    .eq("id", appointmentId)
    .maybeSingle();
  const appt = appointment as
    | { id: string; reference: string; status: string; invoice_id: string | null; currency: Currency | null }
    | null;
  if (!appt) return { error: "Appointment not found." };

  const resultPath = `/app/appointments/${appt.id}/payment-result`;
  if (appt.status === "confirmed" || !appt.invoice_id) redirect(resultPath);

  const { data: invoiceRow } = await supabase
    .from("invoices")
    .select("id, number, total_minor, currency, status")
    .eq("id", appt.invoice_id)
    .maybeSingle();
  const invoice = invoiceRow as
    | { id: string; number: string; total_minor: number; currency: Currency; status: string }
    | null;
  if (!invoice) return { error: "Invoice not found." };
  if (invoice.status === "paid") redirect(resultPath);

  let email = user.email ?? null;
  if (!email) {
    const { data: profile } = await supabase.from("profiles").select("email").eq("id", user.id).maybeSingle();
    email = (profile as { email: string | null } | null)?.email ?? null;
  }
  if (!email) return { error: "We need an email address to send your receipt. Add one and try again." };

  // Fees settle to the firm's own Paystack subaccount. Only the invoice's client (or the
  // firm) can ask for it, and the database refuses to record a payment settled anywhere else.
  const { data: settlement } = await supabase.rpc("invoice_settlement", { p_invoice: invoice.id });
  const subaccount = (settlement as { paystack_subaccount: string | null } | null)?.paystack_subaccount ?? null;
  if (!subaccount) return { error: "This firm is not yet set up to receive payments. Please contact the firm." };

  // Everything above this line is a read or a redirect. From here a real transaction is created
  // at the provider, so the checkout bucket is asked last — a client sent back to a result page
  // they have already paid for has not spent a checkout.
  if (!(await allow(supabase, "checkout", true))) return { error: tooFast("checkout") };

  const origin = await siteOrigin();
  let checkoutUrl: string;
  try {
    const provider = paymentProviderFor(invoice.currency);
    const result = await provider.initialize({
      invoiceNumber: invoice.number,
      amountMinor: invoice.total_minor,
      currency: invoice.currency,
      email,
      description: `Consultation ${appt.reference}`,
      callbackUrl: `${origin}${resultPath}`,
      cancelUrl: `${origin}/app/appointments/${appt.id}`,
      subaccount,
      channel: channel ?? null,
    });
    checkoutUrl = result.checkoutUrl;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start payment.";
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
  if (error) return { error: error.message };
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
  if (error) return { error: error.message };
  return undefined;
}
