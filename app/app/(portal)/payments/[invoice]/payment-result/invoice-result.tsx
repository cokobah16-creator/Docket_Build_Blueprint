"use client";

// The paid screen (design/pwa artboard, CLIENT · PAID): a medallion, a line of
// reassurance, the three rows that make a receipt, and the two ways onward.
//
// Waits for the provider webhook → record_payment() to mark the invoice paid.
// Realtime on the invoice row (RLS-scoped) with polling fallback; never writes.

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { formatMoneyMinor } from "@/lib/money";
import { startInvoicePayment } from "@/lib/actions/portal";
import { Alert } from "@/components/ui/alert";
import { CheckIcon, ClockIcon } from "@/components/ui/icons";
import {
  AppScreen,
  AppCard,
  AppCardList,
  AppButton,
  appButtonClass,
} from "@/components/app";

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
    <AppScreen>
      <div className="flex flex-col items-center gap-3.5 px-2 pb-1 pt-3 text-center">
        {/* The status colours are the app's own semantic pair (the same green
            and amber the pills use), not the firm's, because this says whether
            money moved — and the glyph and the heading say it without them. */}
        {done ? (
          <span className="grid h-[62px] w-[62px] flex-none place-items-center rounded-full border border-[#A7D8BE] bg-[#ECFDF3] text-[#05603A]">
            <CheckIcon size={30} />
          </span>
        ) : (
          <span className="grid h-[62px] w-[62px] flex-none place-items-center rounded-full border border-[#F3DDA4] bg-[#FFFAEB] text-[#92400E]">
            <ClockIcon size={30} />
          </span>
        )}

        <h1 className="font-app-head text-[22px] font-semibold leading-[1.25] tracking-[-0.015em] text-dk-pri">
          {done ? "Paid in full" : "Confirming your payment"}
        </h1>

        <p className="max-w-[280px] text-[13.5px] leading-[1.5] text-dk-soft">
          {done ? (
            <>
              {formatMoneyMinor(totalMinor, currency)} received against invoice{" "}
              <span className="font-mono">{number}</span>. Your receipt is ready.
            </>
          ) : (
            <>
              Waiting for your bank to confirm — this page updates by itself.
              Paid so far: {formatMoneyMinor(paid, currency)} of{" "}
              {formatMoneyMinor(totalMinor, currency)}.
            </>
          )}
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <AppCard>
        <AppCardList>
          <div className="flex justify-between gap-3 px-4 py-3.5 text-[13px]">
            <span className="flex-none text-dk-muted">Invoice</span>
            <span className="text-right font-mono font-semibold text-dk-strong">{number}</span>
          </div>
          <div className="flex justify-between gap-3 px-4 py-3.5 text-[13px]">
            <span className="flex-none text-dk-muted">Total</span>
            <span className="text-right font-semibold text-dk-strong">
              {formatMoneyMinor(totalMinor, currency)}
            </span>
          </div>
          <div className="flex justify-between gap-3 px-4 py-3.5 text-[13px]">
            <span className="flex-none text-dk-muted">Paid</span>
            <span className="text-right font-bold text-dk-strong">
              {formatMoneyMinor(done ? totalMinor : paid, currency)}
            </span>
          </div>
        </AppCardList>
      </AppCard>

      {done ? (
        <a href={`/app/payments/${invoiceId}/pdf`} className={appButtonClass("primary")}>
          Download receipt
        </a>
      ) : (
        <AppButton onClick={retry}>Try paying again</AppButton>
      )}

      <div className="flex">
        <Link href={backHref} className={appButtonClass("ghost")}>
          {matterId ? "Back to the matter" : "All payments"}
        </Link>
      </div>
    </AppScreen>
  );
}
