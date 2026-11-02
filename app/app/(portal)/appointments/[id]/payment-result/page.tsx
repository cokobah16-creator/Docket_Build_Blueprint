// Where Paystack sends the client back to. This page only reads: Paystack's webhook and
// record_payment() are the only things that mark a payment or confirm a booking, so the client
// part (payment-result.tsx) waits for the database to say what happened rather than taking the
// redirect itself as proof of anything.

import { notFound, redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { whenWords } from "@/lib/notifications-copy";
import type { BreakdownInput } from "@/lib/payment-breakdown";
import type { InvoiceItemRow, InvoiceRow } from "@/lib/db/types";
import { Screen } from "@/components/portal/screen";
import { firmPageHref } from "../../../firm-href";
import { PaymentResult } from "./payment-result";

export const metadata = { title: "Payment" };

interface Appt {
  id: string; firm_id: string; status: string; starts_at: string; hold_expires_at: string | null;
  client_timezone: string | null; invoice_id: string | null; service_id: string | null;
  lawyer_id: string | null; cancellation_reason: string | null;
}

type Invoice = Pick<InvoiceRow, "id" | "currency" | "subtotal_minor" | "vat_minor" | "total_minor" | "paid_minor">;

export default async function PaymentResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));

  const { data } = await supabase
    .from("appointments")
    .select("id, firm_id, status, starts_at, hold_expires_at, client_timezone, invoice_id, service_id, lawyer_id, cancellation_reason")
    .eq("id", id)
    .maybeSingle();
  const appt = (data ?? null) as Appt | null;
  if (!appt) notFound();

  const [owner, { data: invoiceRow }, { data: itemRows }, { data: service }, { data: lawyer }] = await Promise.all([
    // The firm that owns this booking, not whichever firm the portal has selected: the payment,
    // the receipt and any refund are that firm's, and so is the booking page to choose a new time on.
    firmById(appt.firm_id),
    appt.invoice_id
      ? supabase.from("invoices").select("id, currency, subtotal_minor, vat_minor, total_minor, paid_minor").eq("id", appt.invoice_id).maybeSingle()
      : Promise.resolve({ data: null }),
    appt.invoice_id ? supabase.from("invoice_items").select("description, quantity, unit_minor").eq("invoice_id", appt.invoice_id) : Promise.resolve({ data: [] }),
    appt.service_id ? supabase.from("services").select("name").eq("id", appt.service_id).maybeSingle() : Promise.resolve({ data: null }),
    appt.lawyer_id ? supabase.from("lawyer_public").select("full_name").eq("id", appt.lawyer_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const inv = invoiceRow as Invoice | null;
  const items = (itemRows ?? []) as Array<Pick<InvoiceItemRow, "description" | "quantity" | "unit_minor">>;
  const serviceName = (service as { name: string } | null)?.name ?? "Consultation";
  const lawyerName = (lawyer as { full_name: string | null } | null)?.full_name ?? null;
  // The consultation's time in the zone it was booked in, as on the consultation page.
  const when = whenWords(appt.starts_at, appt.client_timezone ?? "Africa/Lagos");
  const firmName = owner?.name ?? null;

  // The same figures the pay panel showed, so the receipt below says what was paid in the rows the
  // client read before paying. The client part rebuilds it as paid_minor moves.
  const breakdown: BreakdownInput | null = inv
    ? {
        currency: inv.currency,
        payee: { name: firmName ?? "your firm", legalName: owner?.legal_name, rcNumber: owner?.rc_number },
        purpose: `${serviceName}${lawyerName ? ` with ${lawyerName}` : ""}, ${when}`,
        lines: items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unitMinor: Number(i.unit_minor) })),
        subtotalMinor: Number(inv.subtotal_minor),
        vatMinor: Number(inv.vat_minor),
        vatRatePercent: owner?.vat_rate ?? null,
        totalMinor: Number(inv.total_minor),
        paidMinor: Number(inv.paid_minor),
      }
    : null;

  return (
    <Screen>
      <PaymentResult
        appointmentId={appt.id}
        initialStatus={appt.status}
        holdExpiresAt={appt.hold_expires_at}
        cancellationReason={appt.cancellation_reason}
        invoiceId={inv?.id ?? null}
        breakdown={breakdown}
        when={when}
        firmName={firmName}
        bookHref={owner ? await firmPageHref(owner, "/book") : null}
        renderedAt={Date.now()}
      />
    </Screen>
  );
}
