"use server";

// Booking server actions. Payment is initialised server-side with the
// provider secret and the client is redirected to checkout; NOTHING here
// marks anything paid — only the provider webhook → record_payment() does.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/site";
import { paymentProviderFor, type Currency, type PaymentChannel } from "@/lib/providers/payments";

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
