"use client";

// Waits for the provider webhook → record_payment() to mark the invoice paid.
// Realtime on the invoice row (RLS-scoped) with polling fallback; never writes.

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { formatMoneyMinor } from "@/lib/money";
import { startInvoicePayment } from "@/lib/actions/portal";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export function InvoiceResult({ invoiceId, number, initialStatus, totalMinor, paidMinor, currency, matterId }: {
  invoiceId: string; number: string; initialStatus: string; totalMinor: number; paidMinor: number; currency: string; matterId: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [paid, setPaid] = useState(paidMinor);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    const apply = (row: { status?: string; paid_minor?: number } | null) => {
      if (!row?.status) return;
      setStatus(row.status);
      if (typeof row.paid_minor === "number") setPaid(row.paid_minor);
    };
    const channel = supabase
      .channel(`invoice-${invoiceId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "invoices", filter: `id=eq.${invoiceId}` }, (payload) => apply(payload.new as { status?: string; paid_minor?: number }))
      .subscribe();
    const poll = setInterval(async () => {
      const { data } = await supabase.from("invoices").select("status, paid_minor").eq("id", invoiceId).maybeSingle();
      apply(data as { status?: string; paid_minor?: number } | null);
    }, 5000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [invoiceId]);

  const done = status === "paid";
  const backHref = matterId ? `/app/matters/${matterId}?tab=invoices` : "/app/payments";

  async function retry() {
    setError(null);
    const r = await startInvoicePayment(invoiceId);
    if (r?.error) setError(r.error);
  }

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold text-brand">{done ? "Payment received" : "Confirming your payment"}</h1>
      {error && <Alert kind="error">{error}</Alert>}
      <Card>
        <CardHeader title={`Invoice ${number}`} />
        <CardBody className="space-y-3">
          {done ? (
            <Alert kind="success">Paid in full: {formatMoneyMinor(totalMinor, currency)}. Your receipt is ready.</Alert>
          ) : (
            <Alert kind="info">
              Waiting for your bank to confirm… this page updates by itself. Paid so far: {formatMoneyMinor(paid, currency)} of {formatMoneyMinor(totalMinor, currency)}.
            </Alert>
          )}
          <div className="flex flex-wrap gap-3">
            {done && <a href={`/app/payments/${invoiceId}/pdf`} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-on">Download receipt</a>}
            {!done && <Button variant="ghost" onClick={retry}>Try paying again</Button>}
            <Link href={backHref} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-brand">Back</Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
