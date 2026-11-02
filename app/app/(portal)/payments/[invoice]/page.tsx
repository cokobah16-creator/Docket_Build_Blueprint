// One invoice, as its client reads it: who is paid, what for and how the total is made, then the
// one button that pays it (docs/VOICE.md, rules 6 and 15). The payments list, the matter page and
// the consultation page all send a client here to pay an invoice, so this is the screen that shows
// the breakdown before Paystack opens.
//
// The register is built by buildBreakdown(), and startInvoicePayment() charges amountToCharge()
// from the same invoice row, so the amount on the button is the amount Paystack asks for.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { clientTimezone } from "@/lib/portal-data";
import { safeNotice } from "@/lib/user-error-message";
import { startInvoicePayment } from "@/lib/actions/portal";
import { breakdownMoney, buildBreakdown } from "@/lib/payment-breakdown";
import { clientStatusLabel, paymentStatusLabel } from "@/lib/client-words";
import { calendarDayWords, dayWords, whenWords } from "@/lib/notifications-copy";
import { publishedPolicyText } from "@/lib/policy-text";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { StatusPill, isStatus, type Status } from "@/components/ui/badge";
import { Screen, ScreenHeader } from "@/components/portal/screen";
import { PayPanel } from "@/components/portal/pay-panel";
import { BeforeYouPay } from "@/components/portal/before-you-pay";
import type { PaymentChannel } from "@/lib/providers/payments";
import { firmPageHref } from "../../firm-href";
import {
  INVOICE_COLUMNS,
  PAYABLE_STATUSES,
  invoiceBreakdownInput,
  invoiceContext,
  invoiceIssuer,
  vatTinSentence,
  type ClientInvoice,
  type InvoiceLine,
} from "../invoice-data";

export const metadata = { title: "Invoice" };

interface Payment {
  id: string;
  provider: string;
  provider_ref: string;
  status: string;
  amount_minor: number;
  paid_at: string | null;
  created_at: string | null;
}

/**
 * A payment's pill. A payment is not an invoice, so each of its statuses borrows the pill that
 * means the same thing; the words are paymentStatusLabel()'s.
 */
const PAYMENT_PILL: Record<string, Status> = {
  succeeded: "paid",
  failed: "rejected",
  initiated: "pending",
  refunded: "closed",
};

/** Paystack by name, never the column's code (docs/VOICE.md, rules 4 and 18). */
const PROVIDER_NAMES: Record<string, string> = { paystack: "Paystack", flutterwave: "Flutterwave" };

/** The consultation statuses in which paying is paying for a time still to come. */
const UPCOMING = ["awaiting_payment", "pending", "confirmed", "rescheduled"];

const quietLink =
  "inline-flex min-h-11 items-center self-start rounded-control text-13 font-semibold text-brand underline underline-offset-2 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ invoice: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { invoice: id } = await params;
  const { error: actionError } = await searchParams;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));

  const { data } = await supabase.from("invoices").select(INVOICE_COLUMNS).eq("id", id).maybeSingle();
  const inv = (data ?? null) as ClientInvoice | null;
  if (!inv) notFound();

  // The firm that sent this invoice, which is not always the one the portal has selected: the
  // payment, the receipt and any refund are that firm's.
  const firmRow = firmById(inv.firm_id);
  const [{ data: itemRows }, { data: paymentRows }, firm, context, tz, issuer] = await Promise.all([
    supabase.from("invoice_items").select("description, quantity, unit_minor").eq("invoice_id", inv.id),
    // Newest first. created_at, because paid_at is written only when a charge succeeds.
    supabase
      .from("payments")
      .select("id, provider, provider_ref, status, amount_minor, paid_at, created_at")
      .eq("invoice_id", inv.id)
      .order("created_at", { ascending: false }),
    firmRow,
    invoiceContext(supabase, inv),
    clientTimezone(supabase, user.id),
    // The TIN on a VAT invoice, and who the firm is when its public row cannot be read.
    invoiceIssuer(supabase, inv, firmRow),
  ]);
  const items = (itemRows ?? []) as InvoiceLine[];
  const payments = (paymentRows ?? []) as Payment[];
  const consultation = context.consultation;
  const b = buildBreakdown(invoiceBreakdownInput(inv, items, firm, context.purpose, issuer));
  const tin = issuer?.tin ?? null;

  // The firm by name wherever only the firm can act (docs/VOICE.md, rule 2), and "your firm" only
  // when neither its public row nor invoice_issuer() can say who it is.
  const firmName = firm?.name ?? issuer?.name ?? null;
  const firmWords = firmName ?? "your firm";
  const paidMinor = Math.max(0, Number(inv.paid_minor));

  // invoice_status has no 'void' today. It is named so that one added later reads as cancelled,
  // as startInvoicePayment() reads it.
  const cancelled = inv.status === "cancelled" || inv.status === "void";
  const settled = !cancelled && (inv.status === "paid" || b.settled);
  // release_expired_holds() and cancel_appointment() cancel an unpaid invoice with its booking but
  // leave a part-paid one as it is, so the booking is asked as well, as startInvoicePayment() asks.
  const consultationCancelled = consultation?.status === "cancelled";
  const closed = !settled && (cancelled || consultationCancelled);
  const payable = !closed && !settled && PAYABLE_STATUSES.includes(inv.status) && b.chargeMinor > 0;
  // The fifteen-minute hold, only while the booking waits for this payment. A matter's invoice
  // holds nothing and must not pretend to.
  const holdExpiresAt = payable && consultation?.status === "awaiting_payment" ? consultation.hold_expires_at : null;
  const bookHref = holdExpiresAt && firm ? await firmPageHref(firm, "/book") : null;
  // The firm's own cancellation text, read before paying for a time still to come, and only once
  // the firm has published it.
  const policyText = consultation && UPCOMING.includes(consultation.status) ? publishedPolicyText(firm?.policies?.cancellation) : null;

  const messageHref = inv.matter_id
    ? `/app/matters/${inv.matter_id}?tab=messages`
    : inv.appointment_id
      ? `/app/messages/appointment/${inv.appointment_id}`
      : "/app/messages";
  const contextLink = inv.matter_id
    ? { href: `/app/matters/${inv.matter_id}?tab=invoices`, label: "See the matter" }
    : inv.appointment_id
      ? { href: `/app/appointments/${inv.appointment_id}`, label: "See the consultation" }
      : null;
  const pdfHref = `/app/payments/${inv.id}/pdf`;

  // A consultation's invoice is due the day it is booked, which says nothing a client can use: its
  // hold, or its consultation page, says when to pay. A matter's invoice has a real due date.
  const due = payable && !inv.appointment_id && inv.due_at ? calendarDayWords(inv.due_at) : "";
  const facts = [
    inv.issued_at ? `Sent on ${dayWords(inv.issued_at, tz)}.` : "",
    due ? (inv.status === "overdue" ? `It was due on ${due}.` : `Please pay by ${due}.`) : "",
    // A VAT invoice says whose TIN the VAT was charged under, as its PDF does.
    tin ? vatTinSentence(tin) : "",
    // The number last, with its label (docs/VOICE.md, rule 5).
    `Invoice ${inv.number}.`,
  ].filter(Boolean);

  const invoiceId = inv.id;
  const pay = async (channel: PaymentChannel) => {
    "use server";
    // Every refusal is one of PAYMENT_NOTICES, written for the client, so it is shown as it is.
    const r = await startInvoicePayment(invoiceId, channel);
    if (r?.error) return r;
  };

  return (
    <>
      <ScreenHeader back="/app/payments" backLabel="Back to payments" title={settled ? "Your receipt" : "Your invoice"} />
      <Screen>
        <header className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-heading text-21 font-semibold leading-tight tracking-[-0.015em] text-brand">
              {settled ? "Receipt" : "Invoice"} from {firmWords}
            </h1>
            {isStatus(inv.status) && <StatusPill status={inv.status} label={clientStatusLabel(inv.status)} />}
          </div>
          {settled && <p className="text-15 text-ink">Thank you. This invoice is paid in full.</p>}
          <p className="text-13 text-ink-muted">{facts.join(" ")}</p>
        </header>

        {actionError && <Alert kind="error" title="That did not go through">{safeNotice(actionError)}</Alert>}

        {payable && (
          <PayPanel
            amount={breakdownMoney(b, b.chargeMinor)}
            summary={<BeforeYouPay breakdown={b} policyText={policyText} />}
            holdExpiresAt={holdExpiresAt}
            rebookHref={bookHref}
            onPay={pay}
          />
        )}

        {settled && <BeforeYouPay breakdown={b} variant="receipt" />}

        {settled && consultationCancelled && (
          // A paid consultation can be cancelled afterwards, and record_payment() also records a
          // payment that lands after its booking was cancelled. Either way the money is with the firm.
          <Alert kind="info" title="The consultation this was for was cancelled">
            A cancelled booking is not refunded automatically. Any refund is {firmWords}&apos;s to make. Message {firmWords} about
            it, with your bank reference.
          </Alert>
        )}

        {closed && (
          <Card>
            <CardHeader title="This invoice can no longer be paid" />
            <CardBody className="flex flex-col gap-2">
              <p className="text-15 leading-relaxed text-ink">
                {cancelled ? "This invoice was cancelled." : "The consultation this invoice is for was cancelled."}
              </p>
              {paidMinor > 0 ? (
                <>
                  <p className="text-15 leading-relaxed text-ink">You paid {breakdownMoney(b, paidMinor)} towards it.</p>
                  <p className="text-15 leading-relaxed text-ink">
                    {cancelled ? "A cancelled invoice" : "A cancelled booking"} is not refunded automatically. Any refund is{" "}
                    {firmWords}&apos;s to make.
                  </p>
                  <p className="text-15 leading-relaxed text-ink">Message {firmWords} about it, with your bank reference.</p>
                </>
              ) : (
                <p className="text-15 leading-relaxed text-ink">
                  If money left your account for it, message {firmWords} with your bank reference.
                </p>
              )}
            </CardBody>
          </Card>
        )}

        {/* Neither payable, paid nor closed: an invoice for nothing, or a status this screen does
            not know. The register still says who it is from and what it is for. */}
        {!payable && !settled && !closed && <BeforeYouPay breakdown={b} variant="pay" title="What this invoice is for" />}

        {/* The one filled button. While the invoice can be paid it is the pay panel's, so
            everything here steps back to a ghost. */}
        {closed || (settled && consultationCancelled) ? (
          <div className="flex flex-col gap-2.5">
            <Link href={messageHref} className={buttonClasses("primary", "lg", "w-full")}>
              Message {firmWords}
            </Link>
            <a href={pdfHref} className={buttonClasses("ghost", "lg", "w-full")}>
              {settled ? "Download receipt (PDF)" : "Download invoice (PDF)"}
            </a>
          </div>
        ) : (
          <a href={pdfHref} className={buttonClasses(payable ? "ghost" : "primary", "lg", "w-full")}>
            {settled ? "Download receipt (PDF)" : "Download invoice (PDF)"}
          </a>
        )}

        {payments.length > 0 && (
          <Disclosure
            summary="Payments on this invoice"
            hint={payments.length === 1 ? "1 payment" : `${payments.length} payments`}
          >
            <ul className="flex flex-col divide-y divide-hairline">
              {payments.map((p) => (
                <li key={p.id} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-15 font-semibold tabular-nums text-ink">{breakdownMoney(b, Number(p.amount_minor))}</p>
                    <StatusPill status={PAYMENT_PILL[p.status] ?? "closed"} label={paymentStatusLabel(p.status)} />
                  </div>
                  {(p.paid_at ?? p.created_at) && <p className="text-13 text-ink-muted">{whenWords(p.paid_at ?? p.created_at, tz)}</p>}
                  <p className="break-words text-13 text-ink-muted">
                    {PROVIDER_NAMES[p.provider] ?? "Payment"} reference {p.provider_ref}
                  </p>
                  {p.status === "failed" && (
                    <p className="text-13 leading-relaxed text-ink">
                      If money left your account for this payment, message {firmWords} with your bank reference, so they
                      can find it and put it right.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}

        {contextLink && (
          <Link href={contextLink.href} className={quietLink}>
            {contextLink.label}
          </Link>
        )}
      </Screen>
    </>
  );
}
