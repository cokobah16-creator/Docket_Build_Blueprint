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
//    can simply not call rate_limit_hit first. The booking wizard
//    (app/(public)/[firm]/book/booking-wizard.tsx) calls bookAppointment() below, never the RPC
//    itself, and bookAppointment() asks the booking bucket before it calls book_appointment().
//    That check is the front door, not the rule: book_appointment() asks the same bucket again
//    inside the database (migration 23), where a caller holding the anon key cannot skip it.
//    Both asks count, so a booking that goes through counts twice and one the database refuses
//    counts once. The checkout bucket is asked in startInvoicePayment()
//    (src/lib/actions/portal.ts), the one door every payment goes through, startPayment()'s
//    included.
//
// 2. STEP TWO OF THE FUNNEL, booking_started, emitted after book_appointment() returns — a
//    booking the database refused is not a booking that started. The distinct id is the same
//    visitor cookie the tenant site counted on arrival, so the two steps join up without this
//    file needing to know who the person is; identify() at /auth/callback ties that id to the
//    account. Properties are facts about the booking (firm, service, amount, currency), never
//    a name, phone or email. It is sent only when this browser chose "Allow analytics"
//    (consentedVisitorId()). Step three, booking_paid, is NOT emitted anywhere in app/ or src/:
//    the only honest source is the Paystack webhook after record_payment() succeeds.
//
// PAYING FOR A BOOKING. startPayment() hands the booking's invoice to startInvoicePayment(), so a
// booking is paid with the same checks, and for the same amount (the one "Before you pay" puts on
// the button), as any other invoice. There were two copies of that code once, and they drifted:
// this one charged the whole total after a part payment, and opened a checkout for a hold that had
// already been released.
//
// Nothing here decides whether a booking can be made. book_appointment() checks the firm, the
// service, the slot and the lawyer, and its refusal is returned word for word (law 1).

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import type { PaymentChannel } from "@/lib/providers/payments";
import { startInvoicePayment } from "@/lib/actions/portal";
import { CANCEL_NOTICES, PAYMENT_NOTICES } from "@/lib/user-error-message";
import { allow, tooFast } from "@/lib/rate-limit";
import { FUNNEL, capture } from "@/lib/observability";
import { consentedVisitorId } from "@/lib/observability/consent";
import type { BookingResult } from "@/lib/db/types";
import { after } from "next/server";
import { z } from "zod";
import { userError } from "@/lib/user-error";
import { recordFirmConsent } from "@/lib/consent";

/** The appointment_mode enum in migration 1. The database is what refuses anything else. */
export type BookingMode = "virtual" | "in_person" | "phone";

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

export interface BookingConsentInput {
  firmId: string;
  /** The two boxes on the review step. Both must be ticked; neither is ticked for the client. */
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  /** The versions shown beside the boxes. record_consent() refuses them unless they are the firm's. */
  termsVersion: string;
  privacyVersion: string;
}

const bookingConsentSchema = z.object({
  firmId: z.string().uuid(),
  acceptTerms: z.literal(true),
  acceptPrivacy: z.literal(true),
  termsVersion: z.string().min(1).max(64),
  privacyVersion: z.string().min(1).max(64),
});

/**
 * Record the client's acceptance of the firm's terms and privacy notice before anything is
 * booked or uploaded (legal readiness item 6). The wizard calls this first on confirm, so a
 * refusal stops the booking before a file is sent or a slot is taken.
 *
 * record_consent() (migration 52) is given the versions shown beside the boxes. It writes both rows
 * for auth.uid() only when those are the versions the firm has published, and otherwise refuses
 * and writes nothing (see src/lib/consent.ts). book_appointment() does not yet refuse a booking
 * without them: that step waits until no deployed code writes consent_records directly.
 */
export async function recordBookingConsent(input: BookingConsentInput): Promise<{ error: string } | undefined> {
  const parsed = bookingConsentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Tick both boxes: one to accept the terms of service, one to say you have read the privacy notice." };
  }

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first, then book." };

  const error = await recordFirmConsent(supabase, parsed.data.firmId, {
    terms: parsed.data.termsVersion,
    privacy: parsed.data.privacyVersion,
  });
  return error ? { error } : undefined;
}

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

  // The anonymous id the tenant site was counted under, so the funnel stays one chain. Null
  // without consent, and then nothing is sent.
  const visitor = await consentedVisitorId();
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

/**
 * Pay for a booking: open Paystack's checkout for what is still due on its invoice.
 *
 * This finds the booking's invoice and hands it to startInvoicePayment(), which decides everything
 * else: whether the time can still be paid for, the amount (what is left to pay, with no fee
 * added), where Paystack sends the client back to (this booking's result page), and every refusal,
 * each one of PAYMENT_NOTICES and never Paystack's own words. A booking with no invoice costs
 * nothing, so it goes straight to its result page.
 */
export async function startPayment(
  appointmentId: string,
  channel?: PaymentChannel | null,
): Promise<{ error: string } | undefined> {
  const supabase = await supabaseServer();
  if (!supabase) return { error: PAYMENT_NOTICES.unavailable };

  // Asked before the booking is read: signed out, RLS would hide it, and "could not be found"
  // would be the wrong thing to say.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));

  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, invoice_id")
    .eq("id", appointmentId)
    .maybeSingle();
  const appt = appointment as { id: string; invoice_id: string | null } | null;
  if (!appt) return { error: PAYMENT_NOTICES.bookingMissing };
  if (!appt.invoice_id) redirect(`/app/appointments/${appt.id}/payment-result`);

  return startInvoicePayment(appt.invoice_id, channel);
}

export async function cancelAppointment(appointmentId: string): Promise<{ error: string } | undefined> {
  const supabase = await supabaseServer();
  // The consultation page passes this back through its URL, so it is one of CANCEL_NOTICES.
  if (!supabase) return { error: CANCEL_NOTICES.unavailable };
  const { error } = await supabase.rpc("cancel_appointment", { p_appointment: appointmentId, p_reason: "cancelled by client" });
  if (error) {
    // cancel_appointment() raises short developer phrases; these two are the ones a client can
    // cause by ordinary use, and each gets its own sentence. Anything else is reported and worded.
    // "appointment already started" would match both tests, so the first one is asked first.
    if (/already started/i.test(error.message)) return { error: CANCEL_NOTICES.started };
    if (/appointment already/i.test(error.message)) return { error: CANCEL_NOTICES.closed };
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
  // The wizard finds this refusal by "look right" (bookingProblem() in booking-wizard.tsx).
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { error: "That email address does not look right." };
  const { error } = await supabase.from("profiles").update({ email: trimmed }).eq("id", user.id);
  if (error) return { error: await userError(error, "Your email address", "booking: save contact email") };
  return undefined;
}
