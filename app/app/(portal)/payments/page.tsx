// Client invoices list (design/pwa artboard, the CLIENT · PAY family):
// one card of rows — the amount, the mono invoice reference and when it was
// issued, and the status pill that says where each one stands.

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { formatMoneyMinor } from "@/lib/money";
import {
  AppScreen,
  ScreenTitle,
  AppCard,
  AppCardList,
  AppEmpty,
  AppStatusPill,
} from "@/components/app";
import type { Status } from "@/components/ui/badge";

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

  const issued = (at: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Africa/Lagos",
    }).format(new Date(at));

  return (
    <AppScreen>
      <ScreenTitle>Payments</ScreenTitle>

      <AppCard>
        {invoices.length === 0 ? (
          <AppEmpty
            title="No invoices yet"
            hint="Consultation fees and matter invoices appear here with receipts."
          />
        ) : (
          <AppCardList>
            {invoices.map((inv) => (
              <Link
                key={inv.id}
                href={`/app/payments/${inv.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3.5 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-dk-strong">
                    {formatMoneyMinor(inv.total_minor, inv.currency)}
                  </span>
                  <span className="mt-[3px] block text-[12px] text-dk-muted">
                    <span className="font-mono">{inv.number}</span>
                    {inv.issued_at ? ` · ${issued(inv.issued_at)}` : ""}
                  </span>
                </span>
                <AppStatusPill status={inv.status as Status} />
              </Link>
            ))}
          </AppCardList>
        )}
      </AppCard>
    </AppScreen>
  );
}
