// Payment callback page. Displays state only — the Paystack webhook and
// record_payment() are the only things that confirm an appointment.

import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { currentFirm } from "@/lib/firm";
import { PaymentResult } from "./payment-result";

export const metadata = { title: "Payment" };

export default async function PaymentResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  const { data } = await supabase
    .from("appointments")
    .select("id, reference, status, starts_at, hold_expires_at, client_timezone, invoice_id")
    .eq("id", id)
    .maybeSingle();
  const appt = data as {
    id: string; reference: string; status: string; starts_at: string;
    hold_expires_at: string | null; client_timezone: string | null; invoice_id: string | null;
  } | null;
  if (!appt) notFound();

  const firm = await currentFirm();

  return (
    <PaymentResult
      appointmentId={appt.id}
      reference={appt.reference}
      initialStatus={appt.status}
      holdExpiresAt={appt.hold_expires_at}
      startsAt={appt.starts_at}
      timezone={appt.client_timezone ?? "Africa/Lagos"}
      invoiceId={appt.invoice_id}
      bookHref={firm ? `/${firm.slug}/book` : "/app"}
    />
  );
}
