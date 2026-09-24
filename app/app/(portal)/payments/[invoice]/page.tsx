import Link from "next/link";
import { safeNotice } from "@/lib/user-error-message";
import { notFound, redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { formatMoneyMinor } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { startInvoicePayment } from "@/lib/actions/portal";
import { Screen } from "@/components/portal/screen";
import { PayPanel } from "@/components/portal/pay-panel";
import type { PaymentChannel } from "@/lib/providers/payments";

export const metadata = { title: "Invoice" };

interface Invoice { id: string; firm_id: string; number: string; status: string; currency: string; subtotal_minor: number; vat_minor: number; total_minor: number; paid_minor: number; issued_at: string | null; due_at: string | null }
interface Item { id: string; description: string; quantity: number; unit_minor: number }
interface Payment { id: string; provider: string; provider_ref: string; status: string; amount_minor: number; paid_at: string | null }

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ invoice: string }>; searchParams: Promise<{ error?: string }> }) {
  const { invoice: id } = await params;
  const { error: actionError } = await searchParams;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));

  const invoiceResult = await supabase
    .from("invoices")
    .select("id, firm_id, number, status, currency, subtotal_minor, vat_minor, total_minor, paid_minor, issued_at, due_at")
    .eq("id", id)
    .maybeSingle();
  if (invoiceResult.error) throw new Error(`Invoice could not be loaded: ${invoiceResult.error.message}`);
  const inv = (invoiceResult.data ?? null) as Invoice | null;
  if (!inv) notFound();

  const [itemResult, paymentResult, firm, appointmentResult] = await Promise.all([
    supabase.from("invoice_items").select("id, description, quantity, unit_minor").eq("invoice_id", inv.id),
    supabase.from("payments").select("id, provider, provider_ref, status, amount_minor, paid_at").eq("invoice_id", inv.id).order("paid_at", { ascending: false }),
    firmById(inv.firm_id),
    supabase.from("appointments").select("hold_expires_at").eq("invoice_id", inv.id).maybeSingle(),
  ]);
  if (itemResult.error) throw new Error(`Invoice items could not be loaded: ${itemResult.error.message}`);
  if (paymentResult.error) throw new Error(`Payment history could not be loaded: ${paymentResult.error.message}`);
  if (appointmentResult.error) throw new Error(`Consultation hold could not be loaded: ${appointmentResult.error.message}`);
  const items = (itemResult.data ?? []) as Item[];
  const payments = (paymentResult.data ?? []) as Payment[];
  const appointment = appointmentResult.data;
  const fmt = (m: number) => formatMoneyMinor(m, inv.currency);
  const outstanding = Math.max(0, inv.total_minor - inv.paid_minor);
  const payable = ["issued", "partially_paid", "overdue"].includes(inv.status) && outstanding > 0;
  const invoiceId = inv.id;
  const pay = async (channel: PaymentChannel) => {
    "use server";
    const r = await startInvoicePayment(invoiceId, channel);
    if (r?.error) return r;
  };

  // A consultation invoice carries the fifteen-minute hold; a matter invoice
  // does not, and must not pretend to.
  const holdExpiresAt = (appointment as { hold_expires_at: string | null } | null)?.hold_expires_at ?? null;

  return (
    <Screen>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-21 font-semibold leading-tight tracking-[-0.015em] text-brand">{inv.status === "paid" ? "Receipt" : "Invoice"} {inv.number}</h1>
          <p className="mt-1 text-13 text-ink-muted">{firm?.legal_name ?? firm?.name ?? "Your firm"}</p>
        </div>
        <StatusPill status={inv.status as Status} />
      </header>

      {actionError && <Alert kind="error" title="Not completed">{safeNotice(actionError)}</Alert>}
      {payable && (
        <PayPanel
          amount={fmt(outstanding)}
          invoiceNumber={inv.number}
          description={items[0]?.description ?? "Legal services"}
          holdExpiresAt={holdExpiresAt}
          firmName={firm?.name ?? "your firm"}
          onPay={pay}
        />
      )}

      <Card>
        <CardHeader title="Items" />
        <CardBody>
          <table className="w-full text-15">
            <tbody className="divide-y divide-hairline">
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="py-2 pr-4 text-ink">{it.description}{Number(it.quantity) !== 1 ? ` × ${it.quantity}` : ""}</td>
                  <td className="py-2 text-right font-medium text-ink">{fmt(Math.round(it.unit_minor * Number(it.quantity)))}</td>
                </tr>
              ))}
              <tr><td className="pt-3 text-ink-muted">Subtotal</td><td className="pt-3 text-right text-ink">{fmt(inv.subtotal_minor)}</td></tr>
              <tr><td className="py-1 text-ink-muted">VAT</td><td className="py-1 text-right text-ink">{fmt(inv.vat_minor)}</td></tr>
              <tr><td className="py-1 font-semibold text-ink">Total</td><td className="py-1 text-right font-semibold text-ink">{fmt(inv.total_minor)}</td></tr>
              <tr><td className="py-1 text-ink-muted">Paid</td><td className="py-1 text-right text-ink">{fmt(inv.paid_minor)}</td></tr>
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Payments" />
        <CardBody>
          {payments.length === 0 ? (
            <p className="text-15 text-ink-muted">No payments recorded yet.</p>
          ) : (
            <ul className="divide-y divide-hairline text-15">
              {payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-4 py-2">
                  <span className="text-ink">{p.provider} · {p.provider_ref}{p.paid_at ? ` · ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(p.paid_at))}` : ""}</span>
                  <span className="font-medium text-ink">{fmt(p.amount_minor)} · {p.status}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-3">
        <a href={`/app/payments/${inv.id}/pdf`} className="rounded-lg bg-brand px-4 py-2.5 text-15 font-medium text-brand-on hover:opacity-90">Download PDF</a>
        <Link href="/app/payments" className="rounded-lg border border-edge px-4 py-2.5 text-15 font-medium text-brand hover:bg-hover">All payments</Link>
      </div>
    </Screen>
  );
}
