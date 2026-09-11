import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { formatMoneyMinor } from "@/lib/money";
import { Card, CardBody, EmptyState } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { Screen } from "@/components/portal/screen";

export const metadata = { title: "Payments" };

interface InvoiceRow { id: string; number: string; status: string; total_minor: number; currency: string; issued_at: string | null }

export default async function PaymentsPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  const { data } = await supabase
    .from("invoices")
    .select("id, number, status, total_minor, currency, issued_at")
    .order("issued_at", { ascending: false })
    .limit(50);
  const invoices = (data ?? []) as InvoiceRow[];

  return (
    <Screen>
      <h1 className="font-heading text-2xl font-semibold text-brand">Payments</h1>
      <Card>
        {invoices.length === 0 ? (
          <EmptyState title="No invoices yet" hint="Consultation fees and matter invoices appear here with receipts." />
        ) : (
          <CardBody className="divide-y divide-gray-100 p-0">
            {invoices.map((inv) => (
              <Link key={inv.id} href={`/app/payments/${inv.id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-900">{inv.number}</p>
                  <p className="text-xs text-gray-500">{formatMoneyMinor(inv.total_minor, inv.currency)}</p>
                </div>
                <StatusPill status={inv.status as Status} />
              </Link>
            ))}
          </CardBody>
        )}
      </Card>
    </Screen>
  );
}
