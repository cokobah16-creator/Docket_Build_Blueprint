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

import { WorkspaceUnavailable } from "@/components/ui/unavailable";
import Link from "next/link";
import { firmOverview, requestedFirmId, staffContext } from "@/lib/firm-data";
import { formatMoneyByCurrency, formatMoneyMinor } from "@/lib/money";
import { formatWhen, zonedDayRange } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { InvoiceRow } from "@/lib/db/types";

export const metadata = { title: "Invoices" };

/** The register totals are database aggregates; only the visible rows are capped. */
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

interface InvoiceSummaryRow {
  view_key: View;
  currency: string;
  invoice_count: number | string;
  billed_minor: number | string;
  outstanding_minor: number | string;
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
      <WorkspaceUnavailable audience="staff" />
    );
  }

  const { supabase, firmId, timezone: tz } = ctx;
  const view: View = (VIEWS.map((v) => v[0]) as string[]).includes(sp.view ?? "") ? (sp.view as View) : "all";
  const { ymd: today } = zonedDayRange(tz);

  // Filter in Postgres BEFORE the display limit. The old screen fetched the newest 400 first and
  // filtered in JavaScript, so an older draft/overdue invoice could disappear even when the filter
  // said it existed.
  let invoiceQuery = supabase
    .from("invoices")
    .select("id, firm_id, number, client_id, matter_id, appointment_id, currency, subtotal_minor, vat_minor, total_minor, paid_minor, status, issued_at, due_at, created_at")
    .eq("firm_id", firmId);
  if (view === "outstanding") invoiceQuery = invoiceQuery.in("status", ["issued", "partially_paid", "overdue"]);
  if (view === "overdue") {
    invoiceQuery = invoiceQuery
      .in("status", ["issued", "partially_paid", "overdue"])
      .or(`status.eq.overdue,due_at.lt.${today}`);
  }
  if (view === "draft") invoiceQuery = invoiceQuery.eq("status", "draft");
  if (view === "paid") invoiceQuery = invoiceQuery.eq("status", "paid");

  const [overview, firmResult, invoiceResult, summaryResult] = await Promise.all([
    firmOverview(supabase, firmId),
    // firm_public excludes any firm that is not active, so the firm's own row is
    // what a pending or suspended firm must be read from — otherwise every money
    // figure on this screen would silently claim naira.
    supabase.from("firms").select("default_currency").eq("id", firmId).maybeSingle(),
    invoiceQuery.order("created_at", { ascending: false }).limit(SHOW),
    supabase.rpc("invoice_register_summary", { p_firm: firmId }),
  ]);
  if (firmResult.error) throw new Error(`Firm currency could not be loaded: ${firmResult.error.message}`);
  if (invoiceResult.error) throw new Error(`Invoices could not be loaded: ${invoiceResult.error.message}`);

  const firmCurrency = (firmResult.data as { default_currency: string } | null)?.default_currency ?? "NGN";
  const rows = (invoiceResult.data ?? []) as InvoiceRow[];
  const summaries = (summaryResult.data ?? []) as InvoiceSummaryRow[];
  const summaryError = summaryResult.error;

  // The people billed and the matters billed on, so every line names them.
  const clientIds = Array.from(new Set(rows.map((r) => r.client_id)));
  const matterIds = Array.from(new Set(rows.map((r) => r.matter_id).filter((id): id is string => Boolean(id))));
  const profileResult = clientIds.length
    ? await supabase.from("profiles").select("id, full_name, company_name").in("id", clientIds)
    : { data: [] as Array<{ id: string; full_name: string | null; company_name: string | null }>, error: null };
  const matterResult = matterIds.length
    ? await supabase.from("matters").select("id, reference, title").in("id", matterIds)
    : { data: [] as Array<{ id: string; reference: string; title: string }>, error: null };
  if (profileResult.error) throw new Error(`Invoice clients could not be loaded: ${profileResult.error.message}`);
  if (matterResult.error) throw new Error(`Invoice matters could not be loaded: ${matterResult.error.message}`);
  const profileRows = profileResult.data;
  const matterRows = matterResult.data;
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
  const outstandingOf = (inv: ListInvoice) => Math.max(0, Number(inv.total_minor) - Number(inv.paid_minor));
  const isOwing = (inv: ListInvoice) => OWING.has(inv.status) && outstandingOf(inv) > 0;
  const isOverdue = (inv: ListInvoice) =>
    isOwing(inv) && (inv.status === "overdue" || Boolean(inv.due_at && inv.due_at < today));

  // The query is already filtered before LIMIT. The small JS checks only defend against a row
  // whose stored status and paid amount disagree; they no longer decide which 200 records exist.
  const shown = invoices.filter((inv) => {
    if (view === "outstanding") return isOwing(inv);
    if (view === "overdue") return isOverdue(inv);
    return true;
  });

  const counts: Record<View, number> = { all: 0, outstanding: 0, overdue: 0, draft: 0, paid: 0 };
  const registerTotals = new Map<string, number>();
  const registerOutstanding = new Map<string, number>();
  const currencies = new Set<string>();
  for (const row of summaries) {
    counts[row.view_key] += Number(row.invoice_count);
    if (row.view_key === "all") currencies.add(row.currency);
    if (row.view_key === view) {
      registerTotals.set(row.currency, Number(row.billed_minor));
      registerOutstanding.set(row.currency, Number(row.outstanding_minor));
    }
  }

  // If the aggregate RPC itself is unavailable, never present the capped page as a complete
  // financial total. We can still show the rows and explicitly label their subtotal as this page.
  const pageTotals = new Map<string, number>();
  const pageOutstanding = new Map<string, number>();
  for (const inv of shown) {
    pageTotals.set(inv.currency, (pageTotals.get(inv.currency) ?? 0) + Number(inv.total_minor));
    if (isOwing(inv)) {
      pageOutstanding.set(inv.currency, (pageOutstanding.get(inv.currency) ?? 0) + outstandingOf(inv));
    }
  }
  const totalLabel = summaryError ? pageTotals : registerTotals;
  const outstandingLabel = summaryError ? pageOutstanding : registerOutstanding;
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

  const raiseHref = `/firm/invoices/new${sp.firm ? `?firm=${encodeURIComponent(sp.firm)}` : ""}`;
  const detailHref = (id: string) => `/firm/invoices/${id}${sp.firm ? `?firm=${encodeURIComponent(sp.firm)}` : ""}`;

  const chipClass = (active: boolean) =>
    cn(
      "flex min-h-[44px] shrink-0 items-center rounded-full border px-4 text-15",
      active ? "border-brand bg-brand text-brand-on" : "border-edge bg-raised text-ink hover:border-brand",
    );

  const tiles = overview
    ? [
        { label: "Outstanding", value: formatMoneyByCurrency(overview.outstanding_by_currency, firmCurrency), hint: "Issued, part-paid and overdue" },
        { label: "Collected this month", value: formatMoneyByCurrency(overview.collected_this_month_by_currency, firmCurrency), hint: "Payments received since the 1st" },
        { label: "Drafts", value: summaryError ? "—" : String(counts.draft), hint: "Raised but not sent to the client" },
        { label: "Overdue", value: summaryError ? "—" : String(counts.overdue), hint: "Past the day they fell due" },
      ]
    : [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-21 font-bold tracking-[-0.02em] text-[#141414]">Invoices</h1>
          <p className="text-15 text-ink-muted">
            {ctx.firmName} · fees settle straight to the firm&rsquo;s own account · times in {tz}
          </p>
        </div>
        <Link
          href={raiseHref}
          className="flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-15 font-medium text-brand-on hover:opacity-90"
        >
          Raise an invoice
        </Link>
      </header>

      {overview ? (
        <section aria-label="Money totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-card border border-hairline bg-raised p-4 shadow-sm">
              <p className="text-13 uppercase tracking-wide text-ink-muted">{t.label}</p>
              <p className="mt-1 font-heading text-21 font-semibold text-brand">{t.value}</p>
              <p className="mt-1 text-13 text-ink-muted">{t.hint}</p>
            </div>
          ))}
        </section>
      ) : (
        <Alert kind="warning" title="Firm totals unavailable">
          The firm summary could not be read for {ctx.firmName}. The invoices below are read straight from the
          firm&rsquo;s own records and still hold.
        </Alert>
      )}

      {summaryError && (
        <Alert kind="warning" title="Register totals unavailable">
          The invoice rows below loaded, but the full-register aggregate did not. Docket is not treating this capped
          page as the firm's complete fee total; retry the page before relying on the counts.
        </Alert>
      )}

      {overview && mixedCurrencies && (
        <Alert kind="info" title="This firm bills in more than one currency">
          The totals above are kept apart, one figure per currency, because minor units of one currency cannot be
          added to another&rsquo;s. The per-currency figures for the invoices listed below are stated under the list.
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
            {label}{summaryError ? "" : ` (${counts[key]})`}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader
          title={summaryError
            ? (view === "all" ? "All invoices" : VIEWS.find((v) => v[0] === view)?.[1] ?? "Invoices")
            : (view === "all" ? `All invoices (${counts.all})` : `${VIEWS.find((v) => v[0] === view)?.[1]} (${counts[view]})`)}
          action={<Link href={raiseHref} className="text-15 text-brand underline">Raise an invoice →</Link>}
        />

        {shown.length === 0 ? (
          view === "all" ? (
            <EmptyState
              title="Nothing has been billed yet"
              hint="Raise an invoice with your own lines and the firm's VAT rate. Issue it and the client can pay from their app, straight into the firm's account. Consultation fees taken at booking land here on their own."
              action={
                <Link
                  href={raiseHref}
                  className="flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-15 font-medium text-brand-on hover:opacity-90"
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
              action={<Link href={query({ view: null })} className="text-15 text-brand underline">Show all invoices</Link>}
            />
          )
        ) : (
          <ul className="divide-y divide-hairline">
            {shown.map((inv) => {
              const outstanding = outstandingOf(inv);
              const overdue = isOverdue(inv);
              const owing = isOwing(inv);
              return (
                <li key={inv.id}>
                  <Link href={detailHref(inv.id)} className="block px-5 py-4 hover:bg-sunken">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-15 font-medium text-ink">
                          {inv.number} · {inv.client_name ?? "Client"}
                        </p>
                        <p className="mt-0.5 text-13 text-ink-muted">
                          {inv.matter_reference
                            ? `${inv.matter_reference}${inv.matter_title ? ` · ${inv.matter_title}` : ""}`
                            : inv.appointment_id
                              ? "Consultation fee"
                              : "No matter"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-15 font-semibold text-ink">
                          {formatMoneyMinor(Number(inv.total_minor), inv.currency)}
                        </p>
                        {owing && (
                          <p className={cn("text-13 font-medium", overdue ? "text-red-700" : "text-amber-800")}>
                            {formatMoneyMinor(outstanding, inv.currency)} outstanding
                          </p>
                        )}
                        {inv.status === "paid" && (
                          <p className="text-13 text-emerald-800">Paid in full</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusPill status={inv.status as Status} />
                      <span className="text-13 text-ink-muted">
                        {inv.issued_at
                          ? `Issued ${formatWhen(inv.issued_at, tz, { dateStyle: "medium" })}`
                          : `Raised ${formatWhen(inv.created_at, tz, { dateStyle: "medium" })} · not issued`}
                      </span>
                      {inv.due_at && (
                        <span className={cn("text-13", overdue ? "font-semibold text-red-700" : "text-ink-muted")}>
                          {overdue ? "was due " : "due "}
                          {dayLabel(inv.due_at)}
                        </span>
                      )}
                      {!inv.due_at && owing && <span className="text-13 text-ink-muted">no due date</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {shown.length > 0 && (
          <CardBody className="border-t border-hairline text-13 text-ink-muted">
            <p>
              {summaryError ? "This page" : "Full register"}: {moneyLabel(totalLabel) || formatMoneyMinor(0, firmCurrency)} billed
              {outstandingLabel.size > 0 ? `, of which ${moneyLabel(outstandingLabel)} is outstanding` : ", none of it outstanding"}.
              Each figure is in the currency the invoice was raised in.
            </p>
            <p className="mt-1">
              An invoice counts as overdue once the day it fell due has passed in {tz}; the nightly job then marks it
              overdue in the database as well.
              {!summaryError && counts[view] > shown.length ? ` Showing the ${shown.length} most recent of ${counts[view]} in this filter.` : ""}
            </p>
          </CardBody>
        )}
      </Card>
    </div>
  );
}
