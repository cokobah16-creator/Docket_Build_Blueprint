"use client";

// What happened after Paystack, said plainly: whether money moved, what happens to the booking
// now, and the one thing to do next (docs/VOICE.md, rules 9 and 15).
//
// It reads and never writes. Being sent back here proves nothing on its own: record_payment(),
// run by Paystack's webhook, is what adds to the invoice's paid_minor and moves the booking on. So
// this waits for those two rows, by Realtime with a poll behind it, and says what they say.
//
// While it waits it never offers a checkout. A client who has paid by bank transfer and then sees
// a pay button pays twice, so the only way back to paying is a link to the screen that shows the
// breakdown first, worded for someone who left Paystack without paying.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { breakdownMoney, buildBreakdown, type BreakdownInput } from "@/lib/payment-breakdown";
import { buttonClasses } from "@/components/ui/button";
import { BeforeYouPay } from "@/components/portal/before-you-pay";
import { ScreenTitle } from "@/components/portal/screen";

/**
 *   paid           paid in full, and the booking is confirmed (or has taken place)
 *   paid-held      paid in full; the firm confirms the booking next
 *   free           nothing to pay, and the booking is confirmed
 *   free-held      nothing to pay; the firm confirms the booking next
 *   confirming     Paystack has not told Docket about a payment yet
 *   part-paid      some of it is paid and the rest is still to pay
 *   hold-ended     the hold ran out before a payment was confirmed, so the time was released
 *   paid-released  money arrived for a booking that is cancelled
 *   cancelled      cancelled for another reason, with nothing paid
 *   missed         marked as missed
 */
type Outcome =
  | "paid"
  | "paid-held"
  | "free"
  | "free-held"
  | "confirming"
  | "part-paid"
  | "hold-ended"
  | "paid-released"
  | "cancelled"
  | "missed";

/** The statuses of a booking that is in place, or whose consultation has taken place. */
const BOOKED = ["confirmed", "rescheduled", "completed"];

/**
 * How long a wait for Paystack runs before the page says so. A card payment confirms in seconds
 * and a transfer in minutes; past this, the client is told who can look into it.
 */
const SLOW_AFTER_MS = 10 * 60 * 1000;

interface AppointmentChange {
  status?: string;
  hold_expires_at?: string | null;
  cancellation_reason?: string | null;
}

interface InvoiceChange {
  paid_minor?: number | string | null;
}

function outcomeOf(a: {
  status: string;
  reason: string | null;
  holdEnded: boolean;
  totalMinor: number | null;
  paidMinor: number;
}): Outcome {
  const free = a.totalMinor === null || a.totalMinor <= 0;
  if (a.status === "cancelled") {
    // release_expired_holds() leaves a paid invoice as it is, and record_payment() still records a
    // payment that lands after the booking was cancelled. Either way the money is with the firm.
    if (a.paidMinor > 0) return "paid-released";
    return a.reason === "payment_timeout" ? "hold-ended" : "cancelled";
  }
  if (a.status === "no_show") return "missed";
  if (free) return BOOKED.includes(a.status) ? "free" : "free-held";
  if (a.totalMinor !== null && a.paidMinor >= a.totalMinor) {
    if (BOOKED.includes(a.status)) return "paid";
    if (a.status === "pending") return "paid-held";
    // record_payment() marks the invoice paid and moves the booking in one transaction, but the
    // two rows reach this page one after the other. Until the booking's own row arrives, say that
    // Paystack is confirming rather than guess which of the two outcomes is coming.
    return "confirming";
  }
  // The clock running out is not the hold ending. release_expired_holds() cancels the booking on its
  // next run, and a payment that lands before then still confirms it (record_payment() does not look
  // at the clock). Until the row says which, this is still confirming; the cancelled branch above
  // says "hold-ended" once the database does.
  if (a.status === "awaiting_payment" && a.holdEnded) return "confirming";
  if (a.paidMinor > 0) return "part-paid";
  return "confirming";
}

/** "12:04" */
function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

interface Next {
  href: string;
  label: string;
}

export function PaymentResult({
  appointmentId,
  initialStatus,
  holdExpiresAt,
  cancellationReason = null,
  invoiceId,
  breakdown = null,
  when,
  firmName = null,
  bookHref = null,
  renderedAt,
}: {
  appointmentId: string;
  initialStatus: string;
  holdExpiresAt: string | null;
  /** appointments.cancellation_reason: says why a cancelled booking was cancelled. */
  cancellationReason?: string | null;
  invoiceId: string | null;
  /** The invoice as buildBreakdown() takes it. Null: there is no invoice, so nothing to pay. */
  breakdown?: BreakdownInput | null;
  /** "Wednesday 4 November 2026 at 10:00 WAT" */
  when: string;
  /** The firm by name, for the client's words. Null reads "your firm". */
  firmName?: string | null;
  /** The firm's booking page, to choose a new time on. */
  bookHref?: string | null;
  /**
   * When the server drew the page. The first render on the client uses the same instant, so the
   * hold countdown it draws matches the server's, and the clock only starts after that.
   */
  renderedAt: number;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [expiresAt, setExpiresAt] = useState(holdExpiresAt);
  const [reason, setReason] = useState(cancellationReason);
  const [paidMinor, setPaidMinor] = useState(breakdown?.paidMinor ?? 0);
  const [now, setNow] = useState(renderedAt);

  // One way of reading each row, so a Realtime change and a polled one are applied alike.
  const applyAppointment = useCallback((row: AppointmentChange | null) => {
    if (!row?.status) return;
    setStatus(row.status);
    if ("hold_expires_at" in row) setExpiresAt(row.hold_expires_at ?? null);
    if ("cancellation_reason" in row) setReason(row.cancellation_reason ?? null);
  }, []);
  const applyInvoice = useCallback((row: InvoiceChange | null) => {
    const paid = Number(row?.paid_minor);
    if (row && Number.isFinite(paid)) setPaidMinor(paid);
  }, []);

  const holdLeftMs = expiresAt ? new Date(expiresAt).getTime() - now : 0;
  const holdLive = status === "awaiting_payment" && Boolean(expiresAt) && holdLeftMs > 0;
  const holdEnded = Boolean(expiresAt) && holdLeftMs <= 0;
  const outcome = outcomeOf({ status, reason, holdEnded, totalMinor: breakdown?.totalMinor ?? null, paidMinor });
  // Still waiting on Paystack or on the hold: keep reading. Once the booking has an outcome the
  // client can act on, Realtime alone carries anything after it, such as the firm confirming.
  const waiting = status === "awaiting_payment" || outcome === "confirming";

  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    // Both rows are scoped to this client by RLS, and both tables are in the Realtime publication.
    const channel = supabase
      .channel(`payment-result-${appointmentId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "appointments", filter: `id=eq.${appointmentId}` },
        (payload) => applyAppointment(payload.new as AppointmentChange),
      );
    if (invoiceId) {
      channel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "invoices", filter: `id=eq.${invoiceId}` },
        (payload) => applyInvoice(payload.new as InvoiceChange),
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [appointmentId, invoiceId, applyAppointment, applyInvoice]);

  useEffect(() => {
    if (!waiting) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const supabase = supabaseBrowser();
    // The poll is there for when Realtime is not: a dropped socket on mobile data says nothing.
    const poll = supabase
      ? setInterval(async () => {
          const [{ data: a }, { data: i }] = await Promise.all([
            supabase.from("appointments").select("status, hold_expires_at, cancellation_reason").eq("id", appointmentId).maybeSingle(),
            invoiceId ? supabase.from("invoices").select("paid_minor").eq("id", invoiceId).maybeSingle() : Promise.resolve({ data: null }),
          ]);
          applyAppointment(a as AppointmentChange | null);
          applyInvoice(i as InvoiceChange | null);
        }, 5000)
      : null;
    return () => {
      clearInterval(tick);
      if (poll) clearInterval(poll);
    };
  }, [waiting, appointmentId, invoiceId, applyAppointment, applyInvoice]);

  const firm = firmName ?? "your firm";
  const b = breakdown ? buildBreakdown({ ...breakdown, paidMinor }) : null;
  const paidWords = b ? breakdownMoney(b, paidMinor) : "";
  const consultation: Next = { href: `/app/appointments/${appointmentId}`, label: "See your consultation" };
  const message: Next = { href: `/app/messages/appointment/${appointmentId}`, label: `Message ${firm}` };
  const receipt: Next | null = invoiceId ? { href: `/app/payments/${invoiceId}`, label: "See your receipt" } : null;
  // The screen this booking is paid from, which shows who is paid and for what before its button:
  // the consultation page while the payment holds the time, otherwise the invoice's own page.
  const payScreen = status === "awaiting_payment" || !invoiceId ? consultation.href : `/app/payments/${invoiceId}`;
  const rebook: Next | null = bookHref ? { href: bookHref, label: "Choose a new time" } : null;
  const bookAgain: Next | null = bookHref ? { href: bookHref, label: "Book again" } : null;

  const because =
    reason === "payment_timeout"
      ? "Your hold ended before Paystack confirmed a payment, so the time was released."
      : reason === "not_confirmed"
        ? "It was not confirmed before its start time."
        : reason === "cancelled by client"
          ? "You cancelled it."
          : null;

  let title: string;
  let lines: string[];
  let showReceipt = false;
  let main: Next | null;
  let quiet: Array<Next | null> = [];

  switch (outcome) {
    case "paid":
      title = status === "completed" ? "Your payment is confirmed" : "Your consultation is booked";
      lines = [
        `Thank you. Paystack confirmed your payment of ${paidWords}.`,
        ...(status === "completed" ? [] : [`It is on ${when}.`]),
      ];
      showReceipt = true;
      main = consultation;
      quiet = [receipt];
      break;
    case "paid-held":
      title = "Your time is held";
      lines = [
        `Thank you. Paystack confirmed your payment of ${paidWords}.`,
        `${firmName ?? "Your firm"} will confirm your booking.`,
        `Your consultation page shows anything ${firm} still needs from you.`,
      ];
      showReceipt = true;
      main = consultation;
      quiet = [receipt];
      break;
    case "free":
      title = "Your consultation is booked";
      lines = [`It is on ${when}.`, "There is nothing to pay for this consultation."];
      main = consultation;
      break;
    case "free-held":
      title = "Your time is held";
      lines = [
        "There is nothing to pay for this consultation.",
        `${firmName ?? "Your firm"} will confirm your booking.`,
        `Your consultation page shows anything ${firm} still needs from you.`,
      ];
      main = consultation;
      break;
    case "part-paid": {
      const left = b ? breakdownMoney(b, b.chargeMinor) : "";
      title = "Part of the fee is paid";
      lines = [
        `Paystack confirmed a payment of ${paidWords}.`,
        status === "awaiting_payment" ? `${left} is still to pay to confirm your booking.` : `${left} is still to pay.`,
      ];
      main = { href: payScreen, label: `See and pay ${left}` };
      quiet = [message];
      break;
    }
    case "hold-ended":
      title = "Your hold has ended";
      lines = [
        "Paystack did not confirm a payment before your hold ended, so the time was released for someone else to book.",
        `If money left your account, message ${firm} with your bank reference.`,
      ];
      main = rebook ?? message;
      quiet = rebook ? [message] : [];
      break;
    case "paid-released":
      title = "This booking was cancelled";
      lines = [
        ...(because ? [because] : []),
        `Paystack confirmed a payment of ${paidWords} for it.`,
        `A cancelled booking is not refunded automatically. Any refund is ${firm}'s to make.`,
        `Message ${firm} about it, with your bank reference.`,
      ];
      main = message;
      quiet = [receipt];
      break;
    case "cancelled":
      title = "This booking was cancelled";
      lines = [
        ...(because ? [because] : []),
        ...(invoiceId ? [`If money left your account for it, message ${firm} with your bank reference.`] : []),
      ];
      main = bookAgain ?? message;
      quiet = bookAgain ? [message] : [];
      break;
    case "missed":
      title = "This consultation was missed";
      lines = [`If you think that is wrong, message ${firm}.`];
      main = bookAgain ?? message;
      quiet = bookAgain ? [message] : [];
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

  const links = quiet.filter((q): q is Next => q !== null);

  return (
    <div className="flex flex-col gap-4 pt-3">
      {/* The outcome is announced when it changes. The countdown below it is not, or a screen
          reader would read the clock out every second. */}
      <div aria-live="polite" className="flex flex-col gap-2">
        <ScreenTitle>{title}</ScreenTitle>
        {lines.map((line) => (
          <p key={line} className="text-15 leading-relaxed text-ink">{line}</p>
        ))}
      </div>

      {holdLive && (outcome === "confirming" || outcome === "part-paid") && (
        <p className="text-15 text-ink">
          Your time is held for another <span className="font-mono font-semibold tabular-nums">{mmss(holdLeftMs)}</span>.
        </p>
      )}

      {showReceipt && b && <BeforeYouPay breakdown={b} variant="receipt" />}
      {showReceipt && receipt && <p className="text-13 text-ink-muted">Your receipt is under Payments.</p>}

      {main && (
        <Link href={main.href} className={buttonClasses("primary", "lg", "w-full")}>
          {main.label}
        </Link>
      )}

      {links.length > 0 && (
        <div className="flex flex-col gap-2.5 sm:flex-row">
          {links.map((q) => (
            <Link key={q.href} href={q.href} className={buttonClasses("ghost", "lg", "w-full sm:flex-1")}>
              {q.label}
            </Link>
          ))}
        </div>
      )}

      {outcome === "confirming" && invoiceId && (
        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <p className="text-13 leading-relaxed text-ink-muted">If you left Paystack without paying, you can go back to the payment page.</p>
          <Link href={payScreen} className={buttonClasses("ghost", "lg", "w-full")}>
            Go back to the payment page
          </Link>
        </div>
      )}
    </div>
  );
}
