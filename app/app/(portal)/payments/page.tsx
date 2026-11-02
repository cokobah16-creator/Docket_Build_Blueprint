// Every invoice the client has, from every firm acting for them: who it is from, what it is for,
// and what is left to pay. Each row opens the invoice, whose page shows who is paid and how the
// total is made before its button. Nothing on this list opens a checkout.

import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { firmNamesFor } from "@/lib/portal-data";
import { selectedFirm } from "@/lib/portal-firm";
import { amountToCharge } from "@/lib/payment-breakdown";
import { formatMoneyMinor } from "@/lib/money";
import { clientStatusLabel } from "@/lib/client-words";
import { Card, EmptyState } from "@/components/ui/card";
import { StatusPill, isStatus } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Screen, ScreenTitle } from "@/components/portal/screen";
import { firmPageHref } from "../firm-href";
import { PAYABLE_STATUSES } from "./invoice-data";

export const metadata = { title: "Payments" };

interface Row {
  id: string;
  firm_id: string;
  number: string;
  status: string;
  currency: string;
  total_minor: number;
  paid_minor: number;
  issued_at: string | null;
  matter_id: string | null;
}

/**
 * What the row says about the money, in one phrase: what is left on a part-paid invoice, what is
 * to pay on an unpaid one, what was paid on a settled one. Kobo on every figure in the phrase once
 * one of them has kobo, as in the breakdown (docs/VOICE.md, rule 8), and never "₦0".
 */
function amountWords(r: Row): string {
  const total = Number(r.total_minor);
  const paid = Math.max(0, Number(r.paid_minor));
  // What the pay actions would charge for it, so the list and the button agree.
  const left = amountToCharge({ totalMinor: total, paidMinor: paid });
  const exact = r.currency === "NGN" && [total, paid, left].some((m) => m % 100 !== 0);
  const money = (m: number) => formatMoneyMinor(m, r.currency, { exact });
  if (total <= 0) return "Nothing to pay";
  if (PAYABLE_STATUSES.includes(r.status) && left > 0) {
    return paid > 0 ? `${money(left)} of ${money(total)} left to pay` : `${money(total)} to pay`;
  }
  if (r.status === "paid" || left === 0) return `${money(total)} paid`;
  return paid > 0 ? `${money(paid)} of ${money(total)} paid` : `${money(total)} in total`;
}

export default async function PaymentsPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));

  // Every firm's invoices, not only the selected firm's: a client of two firms pays both, and
  // each row names the firm it is from. RLS leaves out drafts and other people's invoices.
  const { data } = await supabase
    .from("invoices")
    .select("id, firm_id, number, status, currency, total_minor, paid_minor, issued_at, matter_id")
    .order("issued_at", { ascending: false })
    .limit(50);
  const invoices = (data ?? []) as Row[];

  const ids = invoices.map((i) => i.id);
  const matterIds = Array.from(new Set(invoices.map((i) => i.matter_id).filter((m): m is string => Boolean(m))));
  const [firmNames, { data: itemRows }, { data: matterRows }, firm] = await Promise.all([
    firmNamesFor(invoices.map((i) => i.firm_id)),
    ids.length ? supabase.from("invoice_items").select("invoice_id, description").in("invoice_id", ids) : Promise.resolve({ data: [] }),
    matterIds.length ? supabase.from("matters").select("id, title").in("id", matterIds) : Promise.resolve({ data: [] }),
    // Only for the empty state's door: the firm the portal is showing, to book with.
    invoices.length === 0 ? selectedFirm(supabase) : Promise.resolve(null),
  ]);
  const itemsByInvoice = new Map<string, string[]>();
  for (const it of (itemRows ?? []) as Array<{ invoice_id: string; description: string }>) {
    itemsByInvoice.set(it.invoice_id, [...(itemsByInvoice.get(it.invoice_id) ?? []), it.description]);
  }
  const matterTitles = new Map(((matterRows ?? []) as Array<{ id: string; title: string | null }>).map((m) => [m.id, m.title?.trim() ?? ""]));

  /** What the invoice is for, first (docs/VOICE.md, rule 5): its matter, else its lines. */
  const whatFor = (inv: Row): string => {
    const matter = inv.matter_id ? matterTitles.get(inv.matter_id) : "";
    if (matter) return matter;
    const items = itemsByInvoice.get(inv.id) ?? [];
    if (items.length === 0) return `Invoice ${inv.number}`;
    if (items.length === 1) return items[0];
    return `${items[0]}, and ${items.length - 1} more ${items.length === 2 ? "item" : "items"}`;
  };

  const bookHref = firm ? await firmPageHref(firm, "/book") : null;

  return (
    <Screen>
      <ScreenTitle>Payments</ScreenTitle>
      <Card>
        {invoices.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            hint={`When ${firm?.name ?? "your firm"} sends you an invoice, it appears here with what it is for. Once you pay it, your receipt is here too.`}
            action={
              bookHref ? (
                <Link href={bookHref} className={buttonClasses("primary", "md")}>
                  Book a consultation
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-hairline">
            {invoices.map((inv) => (
              <li key={inv.id}>
                <Link
                  href={`/app/payments/${inv.id}`}
                  className="flex min-h-11 items-start justify-between gap-3 px-4 py-3.5 transition duration-fast hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                >
                  <div className="min-w-0">
                    <p className="break-words text-15 font-semibold text-ink">{whatFor(inv)}</p>
                    <p className="mt-0.5 text-13 text-ink">{amountWords(inv)}</p>
                    {/* Who it is from, and its number last, with its label (rule 5). */}
                    <p className="mt-0.5 break-words text-13 text-ink-muted">
                      From {firmNames[inv.firm_id] ?? "your firm"}. Invoice {inv.number}.
                    </p>
                  </div>
                  {isStatus(inv.status) && <StatusPill status={inv.status} label={clientStatusLabel(inv.status)} />}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Screen>
  );
}
