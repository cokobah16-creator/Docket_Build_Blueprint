import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Screen } from "@/components/portal/screen";
import { InvoiceResult } from "./invoice-result";

export const metadata = { title: "Payment" };

export default async function InvoicePaymentResult({ params }: { params: Promise<{ invoice: string }> }) {
  const { invoice: id } = await params;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/app/login?next=/app/payments/${id}/payment-result`);
  const { data } = await supabase.from("invoices").select("id, number, status, total_minor, paid_minor, currency, matter_id, appointment_id").eq("id", id).maybeSingle();
  const inv = data as { id: string; number: string; status: string; total_minor: number; paid_minor: number; currency: string; matter_id: string | null; appointment_id: string | null } | null;
  if (!inv) notFound();
  if (inv.appointment_id) redirect(`/app/appointments/${inv.appointment_id}/payment-result`);
  return (
    <Screen>
      <InvoiceResult invoiceId={inv.id} number={inv.number} initialStatus={inv.status} totalMinor={inv.total_minor} paidMinor={inv.paid_minor} currency={inv.currency} matterId={inv.matter_id} />
    </Screen>
  );
}
