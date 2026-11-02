// Where Paystack sends the client back to after paying an invoice that is not a booking's. This
// page only reads: Paystack's webhook and record_payment() are the only things that mark a payment,
// so the client part (invoice-result.tsx) waits for the database to say what happened rather than
// taking the redirect itself as proof of anything.
//
// A booking's invoice has its own result page, which also says what happens to the booking, so
// one that arrives here is sent there.

import { notFound, redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { Screen } from "@/components/portal/screen";
import { INVOICE_COLUMNS, invoiceBreakdownInput, invoiceContext, type ClientInvoice, type InvoiceLine } from "../../invoice-data";
import { InvoiceResult } from "./invoice-result";

export const metadata = { title: "Payment" };

export default async function InvoicePaymentResult({ params }: { params: Promise<{ invoice: string }> }) {
  const { invoice: id } = await params;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));

  const { data } = await supabase.from("invoices").select(INVOICE_COLUMNS).eq("id", id).maybeSingle();
  const inv = (data ?? null) as ClientInvoice | null;
  if (!inv) notFound();
  if (inv.appointment_id) redirect(`/app/appointments/${inv.appointment_id}/payment-result`);

  const [{ data: itemRows }, firm, context] = await Promise.all([
    supabase.from("invoice_items").select("description, quantity, unit_minor").eq("invoice_id", inv.id),
    // The firm that sent the invoice: the payment, the receipt and any refund are that firm's.
    firmById(inv.firm_id),
    invoiceContext(supabase, inv),
  ]);
  const items = (itemRows ?? []) as InvoiceLine[];

  return (
    <Screen>
      <InvoiceResult
        invoiceId={inv.id}
        initialStatus={inv.status}
        breakdown={invoiceBreakdownInput(inv, items, firm, context.purpose)}
        firmName={firm?.name ?? null}
        matterId={inv.matter_id}
        renderedAt={Date.now()}
      />
    </Screen>
  );
}
