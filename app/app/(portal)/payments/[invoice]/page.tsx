// The pay screen (design/pwa artboard, CLIENT · PAY): a pushed screen whose
// sub-header says what is being asked of you, then the amount in the firm's
// heading face, what it covers, the one button that starts the payment, and
// the small print about where the money actually goes.
//
// The artboard's card-number and bank-transfer panels are not here on purpose:
// the button hands off to Paystack's hosted checkout, and the method — card,
// transfer, USSD — is chosen there, on Paystack's own page. Nothing in this
// codebase takes a card number.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { formatMoneyMinor } from "@/lib/money";
import {
  AppScreen,
  SubHeader,
  SubHeaderTitle,
  Footnote,
  AppCard,
  AppCardBody,
  AppCardHeader,
  AppCardList,
  AppDetail,
  AppButton,
  AppPill,
  AppStatusPill,
  appButtonClass,
} from "@/components/app";
import { ShieldIcon } from "@/components/ui/icons";
import type { Status } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { startInvoicePayment } from "@/lib/actions/portal";

export const metadata = { title: "Invoice" };

interface Invoice { id: string; firm_id: string; number: string; status: string; currency: string; subtotal_minor: number; vat_minor: number; total_minor: number; paid_minor: number; issued_at: string | null; due_at: string | null }
interface Item { id: string; description: string; quantity: number; unit_minor: number }
interface Payment { id: string; provider: string; provider_ref: string; status: string; amount_minor: number; paid_at: string | null }

// A payment attempt's own status is not an invoice status — payment_status is
// initiated | succeeded | failed | refunded — so it gets its own pill. Each one
// still carries an icon and a word, never a colour on its own.
const PAYMENT_PILLS: Record<string, { kind: "confirmed" | "awaiting" | "completed" | "danger"; label: string }> = {
  succeeded: { kind: "confirmed", label: "Succeeded" },
  initiated: { kind: "awaiting", label: "Initiated" },
  failed: { kind: "danger", label: "Failed" },
  refunded: { kind: "completed", label: "Refunded" },
};
function paymentPill(status: string): { kind: "confirmed" | "awaiting" | "completed" | "danger"; label: string } {
  return PAYMENT_PILLS[status] ?? { kind: "completed", label: status.replace(/_/g, " ") };
}

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ invoice: string }>; searchParams: Promise<{ error?: string }> }) {
  const { invoice: id } = await params;
  const { error: actionError } = await searchParams;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  const { data } = await supabase
    .from("invoices")
    .select("id, firm_id, number, status, currency, subtotal_minor, vat_minor, total_minor, paid_minor, issued_at, due_at")
    .eq("id", id)
    .maybeSingle();
  const inv = (data ?? null) as Invoice | null;
  if (!inv) notFound();

  const [{ data: itemRows }, { data: paymentRows }, firm] = await Promise.all([
    supabase.from("invoice_items").select("id, description, quantity, unit_minor").eq("invoice_id", inv.id),
    supabase.from("payments").select("id, provider, provider_ref, status, amount_minor, paid_at").eq("invoice_id", inv.id).order("paid_at", { ascending: false }),
    firmById(inv.firm_id),
  ]);
  const items = (itemRows ?? []) as Item[];
  const payments = (paymentRows ?? []) as Payment[];
  const fmt = (m: number) => formatMoneyMinor(m, inv.currency);
  const outstanding = Math.max(0, inv.total_minor - inv.paid_minor);
  const payable = ["issued", "partially_paid", "overdue"].includes(inv.status) && outstanding > 0;
  const invoiceId = inv.id;
  const pay = async () => {
    "use server";
    const r = await startInvoicePayment(invoiceId);
    if (r?.error) redirect(`/app/payments/${invoiceId}?error=${encodeURIComponent(r.error)}`);
  };

  const settled = inv.status === "paid";
  const firmName = firm?.legal_name ?? firm?.name ?? "the firm";
  // The line under the amount: the mono reference, what it covers, when it was
  // issued. Each half is dropped rather than faked when the invoice has none.
  const covers = items[0]?.description ?? null;
  const issued = inv.issued_at
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "Africa/Lagos" }).format(new Date(inv.issued_at))
    : null;

  return (
    <>
      <SubHeader backHref="/app/payments" backLabel="Back to payments">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2.5">
          <SubHeaderTitle>
            {payable ? "Pay to confirm" : settled ? "Receipt" : "Invoice"}
          </SubHeaderTitle>
          <AppStatusPill status={inv.status as Status} />
        </div>
      </SubHeader>

      <AppScreen className="pb-2">
        {/* The design gives the screen no visible title — the sub-header carries
            the intent and the amount card carries the reference — so the heading
            the page needs is announced rather than drawn. */}
        <h1 className="sr-only">
          {settled ? "Receipt" : "Invoice"} {inv.number}
        </h1>

        {actionError && <Alert kind="error">{actionError}</Alert>}

        <AppCard>
          <AppCardBody className="flex flex-col gap-1">
            <p className="text-[12px] uppercase tracking-[0.07em] text-dk-muted">
              {payable ? "Amount due" : settled ? "Amount paid" : "Amount"}
            </p>
            <p className="font-app-head text-[34px] font-semibold leading-[1.1] tracking-[-0.02em] text-dk-pri">
              {fmt(payable ? outstanding : inv.total_minor)}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-[1.5] text-dk-soft">
              <span className="font-mono">{inv.number}</span>
              {covers ? ` · ${covers}` : ""}
              {issued ? ` · ${issued}` : ""}
            </p>
            {/* The firm is the one party a receipt has to identify, and it was
                being named only in the Paystack footnote — which renders only
                while the invoice is still payable, so a settled receipt named
                nobody. */}
            <p className="mt-1 text-[13px] font-semibold text-dk-strong">
              {settled ? "Paid to" : "Payable to"} {firmName}
            </p>
          </AppCardBody>
        </AppCard>

        {payable && (
          <>
            <form action={pay}>
              <AppButton type="submit">Pay {fmt(outstanding)}</AppButton>
            </form>
            <Footnote className="flex items-start gap-2.5">
              <ShieldIcon size={15} className="mt-px flex-none" />
              <span>
                Paystack takes the payment and settles it to {firmName}&rsquo;s own
                subaccount. Docket never holds client money.
              </span>
            </Footnote>
          </>
        )}

        <AppCard>
          <AppCardHeader title="What this covers" />
          <AppCardBody className="flex flex-col gap-3">
            {items.length === 0 ? (
              <p className="text-[13.5px] text-dk-muted">No line items on this invoice.</p>
            ) : (
              items.map((it) => (
                <div key={it.id} className="flex justify-between gap-4 text-[13.5px]">
                  <span className="min-w-0 leading-[1.4] text-dk-body">
                    {it.description}
                    {Number(it.quantity) !== 1 ? ` × ${it.quantity}` : ""}
                  </span>
                  <span className="flex-none font-semibold text-dk-strong">
                    {fmt(Math.round(it.unit_minor * Number(it.quantity)))}
                  </span>
                </div>
              ))
            )}
          </AppCardBody>
          <div className="flex flex-col gap-3 border-t border-dk-rule px-[17px] py-[15px]">
            <AppDetail label="Subtotal">{fmt(inv.subtotal_minor)}</AppDetail>
            <AppDetail label="VAT">{fmt(inv.vat_minor)}</AppDetail>
            <div className="flex justify-between gap-4 text-[13.5px] font-semibold text-dk-strong">
              <span className="flex-none">Total</span>
              <span className="text-right">{fmt(inv.total_minor)}</span>
            </div>
            <AppDetail label="Paid">{fmt(inv.paid_minor)}</AppDetail>
          </div>
        </AppCard>

        <AppCard>
          <AppCardHeader title="Payments" />
          {payments.length === 0 ? (
            <AppCardBody>
              <p className="text-[13.5px] text-dk-muted">No payments recorded yet.</p>
            </AppCardBody>
          ) : (
            <AppCardList>
              {payments.map((p) => (
                <div key={p.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold text-dk-strong">
                      {fmt(p.amount_minor)}
                    </span>
                    <span className="mt-[3px] block text-[12px] leading-[1.4] text-dk-muted">
                      {p.provider} · <span className="font-mono">{p.provider_ref}</span>
                      {p.paid_at
                        ? ` · ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(p.paid_at))}`
                        : ""}
                    </span>
                  </span>
                  <AppPill kind={paymentPill(p.status).kind}>
                    {paymentPill(p.status).label}
                  </AppPill>
                </div>
              ))}
            </AppCardList>
          )}
        </AppCard>

        <div className="flex gap-3">
          <a href={`/app/payments/${inv.id}/pdf`} className={appButtonClass("ghost")}>
            {settled ? "Download receipt" : "Download PDF"}
          </a>
          <Link href="/app/payments" className={appButtonClass("ghost")}>
            All payments
          </Link>
        </div>
      </AppScreen>
    </>
  );
}
