// The firm's money: every invoice it has raised — the drafts nobody has sent,
// what is outstanding, what is overdue and what has been paid — with the client
// it was billed to, the matter it belongs to and the day it falls due.
//
// Rules enforced here:
//  · Every read runs as the signed-in staff member. RLS (is_firm_member) is the
//    authorization layer and no service key is used anywhere; the console layout
//    has already proved session + aal2 + membership.
//  · Money is integer minor units, rendered with formatMoneyMinor in the
//    currency each invoice was raised in — never a hard-coded naira sign.
//  · Timestamps are UTC in the database and rendered in ctx.timezone;
//    invoices.due_at is a calendar day and is rendered as the day it is.
//  · Nothing is firm-specific: the firm, its name, its zone and its default
//    currency all come from context.
//  · No dead ends: every empty state names the next action.

import Link from "next/link";
import { firmOverview, requestedFirmId, staffContext } from "@/lib/firm-data";
import { formatMoneyMinor } from "@/lib/money";
import { formatWhen, zonedDayRange } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { InvoiceRow } from "@/lib/db/types";

export const metadata = { title: "Invoices" };

/** How far back the screen reads. A cap that bites is said out loud on the page. */
const SCAN = 400;
const SHOW = 200;

const OWING = new Set(["issued", "partially_paid", "overdue"]);

type View = "all" | "outstanding" | "overdue" | "draft" | "paid";

const VIEWS: Array<[View, string]> = [
  ["all", "All"],
  ["outstanding", "Outstanding"],
  ["overdue", "Overdue"],
  ["draft", "Drafts"],
  ["paid", "Paid"],
];

interface ListInvoice extends InvoiceRow {
  client_name: string | null;
  matter_reference: string | null;
  matter_title: string | null;
}

/** A date column is a calendar day, not an instant: render it as the day it is. */
function dayLabel(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
}

function moneyLabel(byCurrency: Map<string, number>): string {
  return Array.from(byCurrency.entries())
    .filter(([, minor]) => minor > 0)
    .map(([currency, minor]) => formatMoneyMinor(minor, currency))
    .join(" · ");
}

export default async function FirmInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ firm?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));

  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
        See <code>.env.example</code>, or ask a firm owner to add you.
      </Alert>
    );
  }

  const { supabase, firmId, timezone: tz } = ctx;
  const view: View = (VIEWS.map((v) => v[0]) as string[]).includes(sp.view ?? "") ? (sp.view as View) : "all";

  const [overview, { data: firmRow }, { data: invoiceRows }] = await Promise.all([
    firmOverview(supabase, firmId),
    // firm_public excludes any firm that is not active, so the firm's own row is
    // what a pending or suspended firm must be read from — otherwise every money
    // figure on this screen would silently claim naira.
    supabase.from("firms").select("default_currency").eq("id", firmId).maybeSingle(),
    supabase
      .from("invoices")
      .select("id, firm_id, number, client_id, matter_id, appointment_id, currency, subtotal_minor, vat_minor, total_minor, paid_minor, status, issued_at, due_at, created_at")
      .eq("firm_id", firmId)
      .order("created_at", { ascending: false })
      .limit(SCAN),
  ]);

  const firmCurrency = (firmRow as { default_currency: string } | null)?.default_currency ?? "NGN";
  const rows = (invoiceRows ?? []) as InvoiceRow[];

  // The people billed and the matters billed on, so every line names them.
  const clientIds = Array.from(new Set(rows.map((r) => r.client_id)));
  const matterIds = Array.from(new Set(rows.map((r) => r.matter_id).filter((id): id is string => Boolean(id))));
  const { data: profileRows } = clientIds.length
    ? await supabase.from("profiles").select("id, full_name, company_name").in("id", clientIds)
    : { data: [] as Array<{ id: string; full_name: string | null; company_name: string | null }> };
  const { data: matterRows } = matterIds.length
    ? await supabase.from("matters").select("id, reference, title").in("id", matterIds)
    : { data: [] as Array<{ id: string; reference: string; title: string }> };
  const nameById = new Map(
    ((profileRows ?? []) as Array<{ id: string; full_name: string | null; company_name: string | null }>).map(
      (p): [string, string | null] => [p.id, p.full_name?.trim() || p.company_name?.trim() || null],
    ),
  );
  const matterById = new Map(
    ((matterRows ?? []) as Array<{ id: string; reference: string; title: string }>).map(
      (m): [string, { reference: string; title: string }] => [m.id, { reference: m.reference, title: m.title }],
    ),
  );

  const invoices: ListInvoice[] = rows.map((r) => ({
    ...r,
    client_name: nameById.get(r.client_id) ?? null,
    matter_reference: r.matter_id ? matterById.get(r.matter_id)?.reference ?? null : null,
    matter_title: r.matter_id ? matterById.get(r.matter_id)?.title ?? null : null,
  }));

  // The daily job marks an invoice overdue at 00:15; between the due date passing
  // and that run, the date itself is the truth, so both count as overdue here.
  const { ymd: today } = zonedDayRange(tz);
  const outstandingOf = (inv: ListInvoice) => Math.max(0, Number(inv.total_minor) - Number(inv.paid_minor));
  const isOwing = (inv: ListInvoice) => OWING.has(inv.status) && outstandingOf(inv) > 0;
  const isOverdue = (inv: ListInvoice) =>
    isOwing(inv) && (inv.status === "overdue" || Boolean(inv.due_at && inv.due_at < today));

  const counts: Record<View, number> = {
    all: invoices.length,
    outstanding: invoices.filter(isOwing).length,
    overdue: invoices.filter(isOverdue).length,
    draft: invoices.filter((i) => i.status === "draft").length,
    paid: invoices.filter((i) => i.status === "paid").length,
  };

  const matching = invoices.filter((inv) => {
    if (view === "outstanding") return isOwing(inv);
    if (view === "overdue") return isOverdue(inv);
    if (view === "draft") return inv.status === "draft";
    if (view === "paid") return inv.status === "paid";
    return true;
  });
  const shown = matching.slice(0, SHOW);

  // Totals for what is on screen, in the currency each invoice was raised in.
  const shownTotals = new Map<string, number>();
  const shownOutstanding = new Map<string, number>();
  const currencies = new Set<string>();
  for (const inv of matching) {
    currencies.add(inv.currency);
    shownTotals.set(inv.currency, (shownTotals.get(inv.currency) ?? 0) + Number(inv.total_minor));
    if (isOwing(inv)) {
      shownOutstanding.set(inv.currency, (shownOutstanding.get(inv.currency) ?? 0) + outstandingOf(inv));
    }
  }
  for (const inv of invoices) currencies.add(inv.currency);
  const mixedCurrencies = currencies.size > 1;

  const query = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const base: Record<string, string | null> = {
      firm: sp.firm ?? null,
      view: view === "all" ? null : view,
      ...patch,
    };
    for (const [key, value] of Object.entries(base)) if (value) params.set(key, value);
    const qs = params.toString();
    return qs ? `/firm/invoices?${qs}` : "/firm/invoices";
  };

  const raiseHref = `/firm/invoices/new${sp.firm ? `?firm=${sp.firm}` : ""}`;
  const detailHref = (id: string) => `/firm/invoices/${id}${sp.firm ? `?firm=${sp.firm}` : ""}`;

  const chipClass = (active: boolean) =>
    cn(
      "flex min-h-[44px] shrink-0 items-center rounded-full border px-4 text-sm",
      active ? "border-brand bg-brand text-white" : "border-gray-300 bg-white text-gray-700 hover:border-brand",
    );

  const tiles = overview
    ? [
        { label: "Outstanding", value: formatMoneyMinor(overview.outstanding_minor, firmCurrency), hint: "Issued, part-paid and overdue" },
        { label: "Collected this month", value: formatMoneyMinor(overview.collected_this_month_minor, firmCurrency), hint: "Payments received since the 1st" },
        { label: "Drafts", value: String(counts.draft), hint: "Raised but not sent to the client" },
        { label: "Overdue", value: String(counts.overdue), hint: "Past the day they fell due" },
      ]
    : [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold text-brand">Invoices</h1>
          <p className="text-sm text-gray-600">
            {ctx.firmName} · fees settle straight to the firm&rsquo;s own account · times in {tz}
          </p>
        </div>
        <Link
          href={raiseHref}
          className="flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:opacity-90"
        >
          Raise an invoice
        </Link>
      </header>

      {overview ? (
        <section aria-label="Money totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-card border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">{t.label}</p>
              <p className="mt-1 font-heading text-xl font-semibold text-brand">{t.value}</p>
              <p className="mt-1 text-xs text-gray-500">{t.hint}</p>
            </div>
          ))}
        </section>
      ) : (
        <Alert kind="warning" title="Firm totals unavailable">
          The firm summary could not be read for {ctx.firmName}. The invoices below are read straight from the
          firm&rsquo;s own records and still hold.
        </Alert>
      )}

      {overview && mixedCurrencies && (
        <Alert kind="info" title="This firm bills in more than one currency">
          The two totals above are added up and shown in {firmCurrency}, which is how the firm summary keeps them.
          The per-currency figures for the invoices listed below are stated under the list.
        </Alert>
      )}

      <nav aria-label="Filter invoices" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {VIEWS.map(([key, label]) => (
          <Link
            key={key}
            href={query({ view: key === "all" ? null : key })}
            aria-current={view === key ? "page" : undefined}
            className={chipClass(view === key)}
          >
            {label} ({counts[key]})
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader
          title={view === "all" ? `All invoices (${matching.length})` : `${VIEWS.find((v) => v[0] === view)?.[1]} (${matching.length})`}
          action={<Link href={raiseHref} className="text-sm text-brand underline">Raise an invoice →</Link>}
        />

        {shown.length === 0 ? (
          view === "all" ? (
            <EmptyState
              title="Nothing has been billed yet"
              hint="Raise an invoice with your own lines and the firm's VAT rate. Issue it and the client can pay from their app, straight into the firm's account. Consultation fees taken at booking land here on their own."
              action={
                <Link
                  href={raiseHref}
                  className="flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:opacity-90"
                >
                  Raise an invoice
                </Link>
              }
            />
          ) : (
            <EmptyState
              title={
                view === "outstanding"
                  ? "Nothing is outstanding"
                  : view === "overdue"
                    ? "Nothing is overdue"
                    : view === "draft"
                      ? "No drafts waiting"
                      : "Nothing paid yet"
              }
              hint={
                view === "paid"
                  ? "A paid invoice becomes the client's receipt, and its PDF is theirs to download."
                  : "Every invoice the firm has raised is under All."
              }
              action={<Link href={query({ view: null })} className="text-sm text-brand underline">Show all invoices</Link>}
            />
          )
        ) : (
          <ul className="divide-y divide-gray-100">
            {shown.map((inv) => {
              const outstanding = outstandingOf(inv);
              const overdue = isOverdue(inv);
              const owing = isOwing(inv);
              return (
                <li key={inv.id}>
                  <Link href={detailHref(inv.id)} className="block px-5 py-4 hover:bg-gray-50">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {inv.number} · {inv.client_name ?? "Client"}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-600">
                          {inv.matter_reference
                            ? `${inv.matter_reference}${inv.matter_title ? ` · ${inv.matter_title}` : ""}`
                            : inv.appointment_id
                              ? "Consultation fee"
                              : "No matter"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-gray-900">
                          {formatMoneyMinor(Number(inv.total_minor), inv.currency)}
                        </p>
                        {owing && (
                          <p className={cn("text-xs font-medium", overdue ? "text-red-700" : "text-amber-800")}>
                            {formatMoneyMinor(outstanding, inv.currency)} outstanding
                          </p>
                        )}
                        {inv.status === "paid" && (
                          <p className="text-xs text-emerald-800">Paid in full</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusPill status={inv.status as Status} />
                      <span className="text-xs text-gray-600">
                        {inv.issued_at
                          ? `Issued ${formatWhen(inv.issued_at, tz, { dateStyle: "medium" })}`
                          : `Raised ${formatWhen(inv.created_at, tz, { dateStyle: "medium" })} · not issued`}
                      </span>
                      {inv.due_at && (
                        <span className={cn("text-xs", overdue ? "font-semibold text-red-700" : "text-gray-600")}>
                          {overdue ? "was due " : "due "}
                          {dayLabel(inv.due_at)}
                        </span>
                      )}
                      {!inv.due_at && owing && <span className="text-xs text-gray-500">no due date</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {shown.length > 0 && (
          <CardBody className="border-t border-gray-100 text-xs text-gray-500">
            <p>
              Listed: {moneyLabel(shownTotals) || formatMoneyMinor(0, firmCurrency)} billed
              {shownOutstanding.size > 0 ? `, of which ${moneyLabel(shownOutstanding)} is outstanding` : ", none of it outstanding"}.
              Each figure is in the currency the invoice was raised in.
            </p>
            <p className="mt-1">
              An invoice counts as overdue once the day it fell due has passed in {tz}; the nightly job then marks it
              overdue in the database as well.
              {matching.length > SHOW ? ` Showing the ${SHOW} most recent of ${matching.length}.` : ""}
              {rows.length === SCAN ? ` This screen reads the ${SCAN} most recently raised invoices; an older one may not appear.` : ""}
            </p>
          </CardBody>
        )}
      </Card>
    </div>
  );
}
