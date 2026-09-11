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
import { formatMoneyByCurrency, formatMoneyMinor } from "@/lib/money";
import { formatWhen, zonedDayRange } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import {
  AppButtonLink,
  AppCard,
  AppCardHeader,
  AppCardList,
  AppEmpty,
  AppLink,
  AppStatusPill,
  Footnote,
  ScreenTitle,
} from "@/components/app";
import type { Status } from "@/components/ui/badge";
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

  // firm_overview sums every invoice the firm has ever raised, whatever currency
  // it was raised in. Whether that sum mixes currencies cannot be told from the
  // page of invoices scanned below — a firm's only dollar invoices may be older
  // than the window — so ask the database directly.
  const { data: otherCurrencyRows } = await supabase
    .from("invoices")
    .select("currency")
    .eq("firm_id", firmId)
    .neq("currency", firmCurrency)
    .limit(1);

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
  const mixedCurrencies = currencies.size > 1 || (otherCurrencyRows ?? []).length > 0;

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
      "flex min-h-[44px] shrink-0 items-center rounded-full border px-3.5 text-[12.5px] font-medium",
      active ? "border-dk-pri bg-dk-pri text-dk-on-pri" : "border-dk-field bg-white text-dk-soft",
    );

  // The money is what people opened this screen for, so it is set at heading
  // size rather than as a grey subtitle. `ink` is the console's one use of
  // colour — money still owed, and a count that is past its date — and each one
  // says the same thing in words underneath. Every figure stays in the currency
  // it was billed in; nothing is added across currencies.
  const outstandingByCurrency: Record<string, number> = overview?.outstanding_by_currency ?? {};
  const owedSomething = Object.values(outstandingByCurrency).some((minor) => minor !== 0);
  const tiles = overview
    ? [
        {
          label: "Outstanding",
          value: formatMoneyByCurrency(overview.outstanding_by_currency, firmCurrency),
          hint: "Issued, part-paid and overdue",
          ink: owedSomething ? "text-[#92400E]" : "text-dk-strong",
          big: false,
        },
        {
          label: "Collected this month",
          value: formatMoneyByCurrency(overview.collected_this_month_by_currency, firmCurrency),
          hint: "Payments received since the 1st",
          ink: "text-dk-strong",
          big: false,
        },
        {
          label: "Drafts",
          value: String(counts.draft),
          hint: "Raised but not sent to the client",
          ink: "text-dk-strong",
          big: true,
        },
        {
          label: "Overdue",
          value: String(counts.overdue),
          hint: "Past the day they fell due",
          ink: counts.overdue > 0 ? "text-[#B42318]" : "text-dk-strong",
          big: true,
        },
      ]
    : [];

  return (
    <div className="dk-rise flex flex-col gap-3.5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <ScreenTitle>Invoices</ScreenTitle>
          <p className="mt-[3px] text-[12.5px] leading-snug text-dk-soft">
            {ctx.firmName} · fees settle straight to the firm&rsquo;s own account · times in {tz}
          </p>
        </div>
        <AppButtonLink href={raiseHref} variant="primary-sm" className="self-start">
          Raise an invoice
        </AppButtonLink>
      </header>

      {overview ? (
        <section aria-label="Money totals" className="grid grid-cols-2 gap-[9px] lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-[11px] border border-dk-line bg-white p-[13px] shadow-card">
              <p className="text-[10.5px] uppercase leading-[1.35] tracking-[0.06em] text-dk-soft">{t.label}</p>
              <p
                className={cn(
                  "mt-[5px] font-app-head font-bold",
                  t.big ? "text-[24px] leading-none" : "text-[18px] leading-[1.2]",
                  t.ink,
                )}
              >
                {t.value}
              </p>
              <p className="mt-1 text-[11px] leading-[1.35] text-dk-soft">{t.hint}</p>
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
            {label} ({counts[key]})
          </Link>
        ))}
      </nav>

      <AppCard>
        <AppCardHeader
          title={view === "all" ? `All invoices (${matching.length})` : `${VIEWS.find((v) => v[0] === view)?.[1]} (${matching.length})`}
          action={<AppLink href={raiseHref}>Raise an invoice</AppLink>}
        />

        {shown.length === 0 ? (
          view === "all" ? (
            <AppEmpty
              title="Nothing has been billed yet"
              hint="Raise an invoice with your own lines and the firm's VAT rate. Issue it and the client can pay from their app, straight into the firm's account. Consultation fees taken at booking land here on their own."
              action={
                <AppButtonLink href={raiseHref} variant="primary-sm">
                  Raise an invoice
                </AppButtonLink>
              }
            />
          ) : (
            <AppEmpty
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
              action={<AppLink href={query({ view: null })}>Show all invoices</AppLink>}
            />
          )
        ) : (
          <AppCardList>
            {shown.map((inv) => {
              const outstanding = outstandingOf(inv);
              const overdue = isOverdue(inv);
              const owing = isOwing(inv);
              return (
                <Link key={inv.id} href={detailHref(inv.id)} className="block px-[15px] py-[13px]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">
                        <span className="font-mono">{inv.number}</span> · {inv.client_name ?? "Client"}
                      </p>
                      <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-soft">
                        {inv.matter_reference
                          ? `${inv.matter_reference}${inv.matter_title ? ` · ${inv.matter_title}` : ""}`
                          : inv.appointment_id
                            ? "Consultation fee"
                            : "No matter"}
                      </p>
                    </div>
                    {/* The figure the row exists for, at heading size. The
                        second line is the part still owed and carries its own
                        word, so the colour is never doing the work alone. */}
                    <div className="flex-none text-right">
                      <p className="font-app-head text-[16px] font-bold leading-none text-dk-strong">
                        {formatMoneyMinor(Number(inv.total_minor), inv.currency)}
                      </p>
                      {owing && (
                        <p
                          className={cn(
                            "mt-1 text-[11.5px] font-semibold leading-[1.35]",
                            overdue ? "text-[#B42318]" : "text-[#92400E]",
                          )}
                        >
                          {formatMoneyMinor(outstanding, inv.currency)} {overdue ? "overdue" : "outstanding"}
                        </p>
                      )}
                      {inv.status === "paid" && (
                        <p className="mt-1 text-[11.5px] leading-[1.35] text-dk-soft">Paid in full</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <AppStatusPill status={inv.status as Status} />
                    <span className="text-[11.5px] text-dk-soft">
                      {inv.issued_at
                        ? `Issued ${formatWhen(inv.issued_at, tz, { dateStyle: "medium" })}`
                        : `Raised ${formatWhen(inv.created_at, tz, { dateStyle: "medium" })} · not issued`}
                    </span>
                    {inv.due_at && (
                      <span className={cn("text-[11.5px]", overdue ? "font-semibold text-[#B42318]" : "text-dk-soft")}>
                        {overdue ? "was due " : "due "}
                        {dayLabel(inv.due_at)}
                      </span>
                    )}
                    {!inv.due_at && owing && <span className="text-[11.5px] text-dk-muted">no due date</span>}
                  </div>
                </Link>
              );
            })}
          </AppCardList>
        )}

        {shown.length > 0 && (
          <div className="border-t border-dk-rule px-[17px] py-[13px]">
            <Footnote>
              Listed: {moneyLabel(shownTotals) || formatMoneyMinor(0, firmCurrency)} billed
              {shownOutstanding.size > 0 ? `, of which ${moneyLabel(shownOutstanding)} is outstanding` : ", none of it outstanding"}.
              Each figure is in the currency the invoice was raised in.
            </Footnote>
            <Footnote className="mt-1">
              An invoice counts as overdue once the day it fell due has passed in {tz}; the nightly job then marks it
              overdue in the database as well.
              {matching.length > SHOW ? ` Showing the ${SHOW} most recent of ${matching.length}.` : ""}
              {rows.length === SCAN ? ` This screen reads the ${SCAN} most recently raised invoices; an older one may not appear.` : ""}
            </Footnote>
          </div>
        )}
      </AppCard>
    </div>
  );
}
