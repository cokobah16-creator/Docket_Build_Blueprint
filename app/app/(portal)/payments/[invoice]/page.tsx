import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { formatMoneyMinor } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";

export const metadata = { title: "Invoice" };

interface Invoice { id: string; firm_id: string; number: string; status: string; currency: string; subtotal_minor: number; vat_minor: number; total_minor: number; paid_minor: number; issued_at: string | null; due_at: string | null }
interface Item { id: string; description: string; quantity: number; unit_minor: number }
interface Payment { id: string; provider: string; provider_ref: string; status: string; amount_minor: number; paid_at: string | null }

export default async function InvoicePage({ params }: { params: Promise<{ invoice: string }> }) {
  const { invoice: id } = await params;
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

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-brand">{inv.status === "paid" ? "Receipt" : "Invoice"} {inv.number}</h1>
          <p className="text-sm text-gray-600">{firm?.legal_name ?? firm?.name ?? "Your firm"}</p>
        </div>
        <StatusPill status={inv.status as Status} />
      </header>

      <Card>
        <CardHeader title="Items" />
        <CardBody>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="py-2 pr-4 text-gray-800">{it.description}{Number(it.quantity) !== 1 ? ` × ${it.quantity}` : ""}</td>
                  <td className="py-2 text-right font-medium text-gray-900">{fmt(Math.round(it.unit_minor * Number(it.quantity)))}</td>
                </tr>
              ))}
              <tr><td className="pt-3 text-gray-500">Subtotal</td><td className="pt-3 text-right text-gray-900">{fmt(inv.subtotal_minor)}</td></tr>
              <tr><td className="py-1 text-gray-500">VAT</td><td className="py-1 text-right text-gray-900">{fmt(inv.vat_minor)}</td></tr>
              <tr><td className="py-1 font-semibold text-gray-900">Total</td><td className="py-1 text-right font-semibold text-gray-900">{fmt(inv.total_minor)}</td></tr>
              <tr><td className="py-1 text-gray-500">Paid</td><td className="py-1 text-right text-gray-900">{fmt(inv.paid_minor)}</td></tr>
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Payments" />
        <CardBody>
          {payments.length === 0 ? (
            <p className="text-sm text-gray-600">No payments recorded yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-4 py-2">
                  <span className="text-gray-700">{p.provider} · {p.provider_ref}{p.paid_at ? ` · ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(p.paid_at))}` : ""}</span>
                  <span className="font-medium text-gray-900">{fmt(p.amount_minor)} · {p.status}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-3">
        <a href={`/app/payments/${inv.id}/pdf`} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-on hover:opacity-90">Download PDF</a>
        <Link href="/app/payments" className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-brand hover:bg-black/5">All payments</Link>
      </div>
    </div>
  );
}
