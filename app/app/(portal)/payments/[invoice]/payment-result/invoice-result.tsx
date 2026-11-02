"use client";

// What happened after Paystack, for an invoice that is not a booking's: whether money moved, and
// the one thing to do next (docs/VOICE.md, rules 9 and 15).
//
// It reads and never writes. Being sent back here proves nothing on its own: record_payment(), run
// by Paystack's webhook, is what adds to the invoice's paid_minor. So this waits for that row, by
// Realtime with a poll behind it, and says what it says.
//
// While it waits it never offers a checkout. A client who has paid by bank transfer and then sees a
// pay button pays twice, so the only way back to paying is a link to the invoice page, which shows
// the breakdown first, worded for someone who left Paystack without paying.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { breakdownMoney, buildBreakdown, type BreakdownInput } from "@/lib/payment-breakdown";
import { buttonClasses } from "@/components/ui/button";
import { BeforeYouPay } from "@/components/portal/before-you-pay";
import { ScreenTitle } from "@/components/portal/screen";

/**
 *   paid         paid in full
 *   part-paid    a payment arrived while this page was open, and some is still to pay
 *   confirming   Paystack has not told Docket about a payment yet
 *   cancelled    the invoice was cancelled, so it can no longer be paid
 *   nothing      the invoice is for nothing, so there is nothing to pay
 */
type Outcome = "paid" | "part-paid" | "confirming" | "cancelled" | "nothing";

/**
 * How long a wait for Paystack runs before the page says so. A card payment confirms in seconds
 * and a transfer in minutes; past this, the client is told who can look into it.
 */
const SLOW_AFTER_MS = 10 * 60 * 1000;

interface InvoiceChange {
  status?: string;
  paid_minor?: number | string | null;
}

function outcomeOf(a: { status: string; totalMinor: number; paidMinor: number; paidWhenOpened: number }): Outcome {
  if (a.totalMinor <= 0) return "nothing";
  if (a.status === "paid" || a.paidMinor >= a.totalMinor) return "paid";
  // invoice_status has no 'void' today; it is named so that one added later reads as cancelled.
  if (a.status === "cancelled" || a.status === "void") return "cancelled";
  // Money already on the invoice when the page opened says nothing about this checkout. Only a
  // rise while the page is open is a payment Paystack has just confirmed.
  if (a.paidMinor > a.paidWhenOpened) return "part-paid";
  return "confirming";
}

interface Next {
  href: string;
  label: string;
}

export function InvoiceResult({
  invoiceId,
  initialStatus,
  breakdown,
  firmName = null,
  matterId = null,
  renderedAt,
}: {
  invoiceId: string;
  initialStatus: string;
  /** The invoice as buildBreakdown() takes it, as the invoice page built it. */
  breakdown: BreakdownInput;
  /** The firm by name, for the client's words. Null reads "your firm". */
  firmName?: string | null;
  matterId?: string | null;
  /** When the server drew the page, so "taking longer than usual" counts from the same instant. */
  renderedAt: number;
}) {
  const paidWhenOpened = Math.max(0, breakdown.paidMinor ?? 0);
  const [status, setStatus] = useState(initialStatus);
  const [paidMinor, setPaidMinor] = useState(paidWhenOpened);
  const [now, setNow] = useState(renderedAt);

  // One way of reading the row, so a Realtime change and a polled one are applied alike.
  const apply = useCallback((row: InvoiceChange | null) => {
    if (!row) return;
    if (typeof row.status === "string" && row.status) setStatus(row.status);
    const paid = Number(row.paid_minor);
    if (row.paid_minor !== undefined && row.paid_minor !== null && Number.isFinite(paid)) setPaidMinor(paid);
  }, []);

  const outcome = outcomeOf({ status, totalMinor: breakdown.totalMinor, paidMinor, paidWhenOpened });
  const waiting = outcome === "confirming";

  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    // The row is scoped to this client by RLS, and invoices are in the Realtime publication.
    const channel = supabase
      .channel(`invoice-result-${invoiceId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "invoices", filter: `id=eq.${invoiceId}` },
        (payload) => apply(payload.new as InvoiceChange),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [invoiceId, apply]);

  useEffect(() => {
    if (!waiting) return;
    const supabase = supabaseBrowser();
    // The poll is there for when Realtime is not: a dropped socket on mobile data says nothing.
    // The clock moves with it, for "taking longer than usual".
    const poll = setInterval(async () => {
      setNow(Date.now());
      if (!supabase) return;
      const { data } = await supabase.from("invoices").select("status, paid_minor").eq("id", invoiceId).maybeSingle();
      apply(data as InvoiceChange | null);
    }, 5000);
    return () => clearInterval(poll);
  }, [waiting, invoiceId, apply]);

  const firm = firmName ?? "your firm";
  const b = buildBreakdown({ ...breakdown, paidMinor });
  const invoiceHref = `/app/payments/${invoiceId}`;
  const message: Next = { href: matterId ? `/app/matters/${matterId}?tab=messages` : "/app/messages", label: `Message ${firm}` };
  const back: Next = matterId
    ? { href: `/app/matters/${matterId}?tab=invoices`, label: "Back to the matter" }
    : { href: "/app/payments", label: "See all payments" };

  let title: string;
  let lines: string[];
  let showReceipt = false;
  let main: Next | null;
  let quiet: Next[] = [];

  switch (outcome) {
    case "paid":
      title = "Your payment is confirmed";
      lines = ["Thank you. Paystack confirmed your payment.", "This invoice is now paid in full."];
      showReceipt = true;
      main = { href: invoiceHref, label: "See your receipt" };
      quiet = [back];
      break;
    case "part-paid": {
      const left = breakdownMoney(b, b.chargeMinor);
      title = "Part of this invoice is paid";
      lines = [`Paystack confirmed a payment of ${breakdownMoney(b, paidMinor - paidWhenOpened)}.`, `${left} is still to pay.`];
      main = { href: invoiceHref, label: `See and pay ${left}` };
      quiet = [message];
      break;
    }
    case "cancelled":
      title = "This invoice was cancelled";
      lines = [
        "It can no longer be paid.",
        ...(paidMinor > 0
          ? [
              `You paid ${breakdownMoney(b, paidMinor)} towards it.`,
              `A cancelled invoice is not refunded automatically. Any refund is ${firm}'s to make.`,
              `Message ${firm} about it, with your bank reference.`,
            ]
          : [`If money left your account for it, message ${firm} with your bank reference.`]),
      ];
      main = message;
      quiet = [{ href: invoiceHref, label: "See the invoice" }];
      break;
    case "nothing":
      title = "There is nothing to pay";
      lines = [];
      main = { href: invoiceHref, label: "See the invoice" };
      quiet = [back];
      break;
    case "confirming":
    default: {
      const slow = now - renderedAt > SLOW_AFTER_MS;
      title = "Confirming your payment";
      lines = [
        "Paystack is confirming your payment. This page updates by itself, so there is no need to pay again.",
        "A bank transfer can take a few minutes.",
        ...(slow ? [`This is taking longer than usual. If money left your account, message ${firm} with your bank reference.`] : []),
      ];
      // Nothing is filled while Paystack confirms: the one thing to do is wait, and every button
      // here would take the client somewhere they could pay a second time.
      main = null;
      quiet = slow ? [message] : [];
      break;
    }
  }

  return (
    <div className="flex flex-col gap-4 pt-3">
      {/* The outcome is announced when it changes. */}
      <div aria-live="polite" className="flex flex-col gap-2">
        <ScreenTitle>{title}</ScreenTitle>
        {lines.map((line) => (
          <p key={line} className="text-15 leading-relaxed text-ink">{line}</p>
        ))}
      </div>

      {showReceipt && <BeforeYouPay breakdown={b} variant="receipt" />}

      {main && (
        <Link href={main.href} className={buttonClasses("primary", "lg", "w-full")}>
          {main.label}
        </Link>
      )}

      {quiet.length > 0 && (
        <div className="flex flex-col gap-2.5 sm:flex-row">
          {quiet.map((q) => (
            <Link key={q.href} href={q.href} className={buttonClasses("ghost", "lg", "w-full sm:flex-1")}>
              {q.label}
            </Link>
          ))}
        </div>
      )}

      {outcome === "confirming" && (
        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <p className="text-13 leading-relaxed text-ink-muted">If you left Paystack without paying, you can go back to the payment page.</p>
          <Link href={invoiceHref} className={buttonClasses("ghost", "lg", "w-full")}>
            Go back to the payment page
          </Link>
        </div>
      )}
    </div>
  );
}
