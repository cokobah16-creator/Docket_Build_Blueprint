// Client home: the one thing to do next, then everything else, quietly.
//
// THE MAIN ACTION is chosen in this order: a booking held until it is paid; a consultation open
// to join now, or about to start; documents the firm has asked for; a booking still waiting on
// the client; something the lawyer has asked the client to do; an invoice to pay. With none of
// those it is booking a consultation. It is the screen's only filled button (docs/VOICE.md, rule
// 15), and it never opens a checkout: money goes to the page that shows "Before you pay" first,
// the consultation's or the invoice's.
//
// Whatever else needs the client is listed under it as quiet rows. The other destinations are
// bordered tiles and text links, and recent documents and notifications fold into a Disclosure.
//
// Everything below the greeting belongs to one firm, the one named under it. A client acting
// with several firms taps that name to switch, and the whole screen repaints
// (src/lib/portal-firm.ts).

import { WorkspaceUnavailable } from "@/components/ui/unavailable";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { clientFirms, selectedFirm } from "@/lib/portal-firm";
import { clientMatters, firmNamesFor, type MatterSummary } from "@/lib/portal-data";
import { formatMoneyMinor } from "@/lib/money";
import { amountToCharge } from "@/lib/payment-breakdown";
import { clientStatusLabel, greeting, modeLabel } from "@/lib/client-words";
import { calendarDayWords, dayWords, shortDayWords, timeWords, whenWords } from "@/lib/notifications-copy";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { MatterStatusChip, StatusPill, isStatus } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Icon, type IconName } from "@/components/ui/icon";
import { NotificationsList } from "@/components/portal/notifications-list";
import { IosInstallHint } from "@/components/portal/pwa-hints";
import { OfflineBanner } from "@/components/portal/offline-banner";
import { FirmSwitcher, type FirmChoice } from "@/components/portal/firm-switcher";
import { Screen } from "@/components/portal/screen";
import { DEFAULT_TOKENS } from "@/lib/brand";
import type { DocumentRow, NotificationRow } from "@/lib/db/types";
import { firmPageHref } from "./firm-href";

export const metadata = { title: "Home" };

interface AppointmentRow {
  id: string; reference: string; starts_at: string; ends_at: string; status: string; mode: string;
  lawyer_id: string | null; hold_expires_at: string | null; invoice_id: string | null;
}
interface InvoiceRow {
  id: string; number: string; currency: string; total_minor: number; paid_minor: number; status: string;
  due_at: string | null; issued_at: string | null; appointment_id: string | null;
}
interface RequestRow { id: string; matter_id: string | null; appointment_id: string | null; title: string; due_on: string | null; requested_at: string }

/** Something the client should do, in the client's words, with the one link that does it. */
interface Need {
  kind: "held" | "live" | "soon" | "documents" | "pending" | "ask" | "pay";
  key: string;
  title: string;
  detail: string;
  meta?: string;
  href: string;
  cta: string;
}

const LIVE = ["confirmed", "rescheduled"];
const MINUTE = 60_000;

// A first word that is a title, not a name: "Chief Ada Obi" is greeted in full, never as "Chief".
const TITLES = new Set([
  "mr", "mrs", "ms", "miss", "mx", "dr", "prof", "chief", "barr", "engr", "arc", "hon", "sir", "lady",
  "dame", "alhaji", "alhaja", "mallam", "pastor", "rev", "revd", "madam", "prince", "princess", "otunba",
]);

/** "Ada" from "Ada Obi". Null when there is no name to use: never an email address or a number. */
function nameToGreet(fullName: string | null | undefined): string | null {
  const name = (fullName ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.includes("@") || /^[+\d]/.test(name)) return null;
  const first = name.split(" ")[0];
  return TITLES.has(first.replace(/\.$/, "").toLowerCase()) ? name : first;
}

/** A lawyer's own words, ended with one full stop. */
function sentence(text: string): string {
  return `${text.trim().replace(/[\s.;:,]+$/, "")}.`;
}

/** Overdue first, then the soonest due, then the oldest. */
function byUrgency(a: InvoiceRow, b: InvoiceRow): number {
  const overdue = Number(b.status === "overdue") - Number(a.status === "overdue");
  if (overdue !== 0) return overdue;
  if (a.due_at !== b.due_at) return !a.due_at ? 1 : !b.due_at ? -1 : a.due_at.localeCompare(b.due_at);
  return (a.issued_at ?? "").localeCompare(b.issued_at ?? "");
}

export default async function ClientDashboard() {
  const supabase = await supabaseServer();
  if (!supabase) {
    return (
      <Screen>
        <WorkspaceUnavailable audience="client" />
      </Screen>
    );
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));
  const firms = await clientFirms(supabase);
  const firm = await selectedFirm(supabase, firms);

  // Consent to this firm's terms is asked for by the layout, on every route, not here.

  // Every read below is narrowed to the firm on screen, so the page tells one
  // firm's story rather than merging several. The builders are constructed
  // first and awaited together — adding a filter must not cost a round trip.
  const firmId = firm?.id ?? null;
  const nowIso = new Date().toISOString();

  let apptQuery = supabase
    .from("appointments")
    .select("id, reference, starts_at, ends_at, status, mode, lawyer_id, hold_expires_at, invoice_id")
    .gte("ends_at", nowIso)
    .in("status", ["pending", "awaiting_payment", "confirmed", "rescheduled"]);
  let docQuery = supabase.from("documents").select("id, firm_id, matter_id, appointment_id, name, category, client_visible, current_version_id, uploaded_by, reviewed_at, reviewed_by, created_at").is("deleted_at", null);
  let invoiceQuery = supabase
    .from("invoices")
    .select("id, number, currency, total_minor, paid_minor, status, due_at, issued_at, appointment_id")
    .in("status", ["issued", "partially_paid", "overdue"]);
  // Open requests only: RLS returns the ones on this client's matters and consultations.
  let requestQuery = supabase
    .from("document_requests")
    .select("id, matter_id, appointment_id, title, due_on, requested_at")
    .is("fulfilled_at", null)
    .is("cancelled_at", null);
  let notifQuery = supabase.from("notifications").select("id, firm_id, channel, event, payload, status, read_at, created_at").eq("channel", "in_app");
  if (firmId) {
    apptQuery = apptQuery.eq("firm_id", firmId);
    docQuery = docQuery.eq("firm_id", firmId);
    invoiceQuery = invoiceQuery.eq("firm_id", firmId);
    requestQuery = requestQuery.eq("firm_id", firmId);
    notifQuery = notifQuery.eq("firm_id", firmId);
  }

  const [{ data: profile }, { data: apptRows }, matters, { data: docRows }, { data: invoiceRows }, { data: requestRows }, { data: notifRows }, bookHref, urgentHref] = await Promise.all([
    supabase.from("profiles").select("full_name, timezone").eq("id", user.id).maybeSingle(),
    apptQuery.order("starts_at", { ascending: true }).limit(10),
    clientMatters(supabase, 5, firmId),
    docQuery.order("created_at", { ascending: false }).limit(5),
    invoiceQuery,
    requestQuery.order("requested_at", { ascending: true }).limit(10),
    notifQuery.order("created_at", { ascending: false }).limit(5),
    firm ? firmPageHref(firm, "/book") : Promise.resolve(null),
    firm ? firmPageHref(firm, "/urgent") : Promise.resolve(null),
  ]);
  const profileRow = (profile ?? null) as { full_name: string | null; timezone: string } | null;
  const upcoming = (apptRows ?? []) as AppointmentRow[];
  const documents = (docRows ?? []) as DocumentRow[];
  const notifications = (notifRows ?? []) as NotificationRow[];
  const firmNames = await firmNamesFor([...notifications.map((n) => n.firm_id ?? ""), ...documents.map((d) => d.firm_id)].filter(Boolean));
  const tz = profileRow?.timezone ?? "Africa/Lagos";
  const unread = notifications.filter((n) => !n.read_at).length;
  // The firm by name wherever only the firm can act (docs/VOICE.md, rule 2).
  const firmName = firm?.name ?? "your firm";
  const FirmName = firm?.name ?? "Your firm";

  // Greeted by first name, never by an email address or a phone number (docs/VOICE.md, rule 3).
  const name = nameToGreet(profileRow?.full_name);
  const hello = `${greeting(new Date(), tz)}${name ? `, ${name}` : ""}`;

  // What is still owed on each invoice is what its page charges: the same amountToCharge() the
  // pay actions call, so the figure on the button here is the figure on the next screen.
  const owed = (i: InvoiceRow) => amountToCharge({ totalMinor: Number(i.total_minor), paidMinor: Number(i.paid_minor) });
  const money = (i: InvoiceRow) => formatMoneyMinor(owed(i), i.currency);
  const invoices = ((invoiceRows ?? []) as InvoiceRow[]).filter((i) => owed(i) > 0);
  const invoiceFor = (a: AppointmentRow) => invoices.find((i) => i.id === a.invoice_id || i.appointment_id === a.id) ?? null;

  const now = Date.now();
  const startOf = (a: AppointmentRow) => Date.parse(a.starts_at);
  const endOf = (a: AppointmentRow) => Date.parse(a.ends_at);
  const held = upcoming.filter((a) => a.status === "awaiting_payment" && (!a.hold_expires_at || Date.parse(a.hold_expires_at) > now));
  // A video call's room is open from 10 minutes before the start to an hour after the end.
  const live = upcoming.filter((a) => a.mode === "virtual" && LIVE.includes(a.status) && now >= startOf(a) - 10 * MINUTE && now <= endOf(a) + 60 * MINUTE);
  // Anything else starting within the hour is worth putting first, with nothing to join.
  const soon = upcoming.filter((a) => a.mode !== "virtual" && LIVE.includes(a.status) && now >= startOf(a) - 60 * MINUTE && now <= endOf(a));
  const pending = upcoming.filter((a) => a.status === "pending");
  // A held booking's invoice is paid on the consultation's own page, so it is not listed twice.
  const bookingInvoices = new Set(upcoming.filter((a) => a.status === "awaiting_payment").map((a) => invoiceFor(a)?.id).filter(Boolean));
  const toPay = invoices.filter((i) => !bookingInvoices.has(i.id)).sort(byUrgency);
  // A request on a consultation that is over, or was cancelled, asks for nothing any more.
  const upcomingIds = new Set(upcoming.map((a) => a.id));
  const requests = ((requestRows ?? []) as RequestRow[])
    .filter((r) => r.matter_id || (r.appointment_id && upcomingIds.has(r.appointment_id)))
    .sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") || a.requested_at.localeCompare(b.requested_at));
  const asks = matters.filter((m) => m.last_update?.action_required);

  const needs: Need[] = [];
  for (const a of held) {
    const inv = invoiceFor(a);
    const hold = timeWords(a.hold_expires_at, tz);
    needs.push({
      kind: "held",
      key: `held-${a.id}`,
      title: "Your booking is not paid yet",
      // What, when, how long it is held, and what keeps it: one idea a sentence (rule 1).
      detail: `Your consultation with ${firmName} is on ${whenWords(a.starts_at, tz)}. ${hold ? `The time is held for you until ${hold}. Pay before then to keep it.` : "The time is held for you. Pay to keep it."}`,
      href: `/app/appointments/${a.id}`,
      cta: inv ? `See and pay ${money(inv)}` : "See your booking",
    });
  }
  for (const a of live) {
    const started = now >= startOf(a);
    needs.push({
      kind: "live",
      key: `live-${a.id}`,
      title: started ? "Your consultation has started" : "Your consultation is open",
      detail: `Your video call with ${firmName} ${started ? "started" : "starts"} at ${timeWords(a.starts_at, tz)}. You can join now.`,
      href: `/app/appointments/${a.id}/waiting-room`,
      cta: "Join your consultation",
    });
  }
  for (const a of soon) {
    const started = now >= startOf(a);
    needs.push({
      kind: "soon",
      key: `soon-${a.id}`,
      title: started ? "Your consultation has started" : "Your consultation starts soon",
      detail: `Your consultation with ${firmName} ${started ? "started" : "starts"} at ${timeWords(a.starts_at, tz)}. ${a.mode === "phone" ? "It is a phone call." : "It is in person."}`,
      href: `/app/appointments/${a.id}`,
      cta: "See your consultation",
    });
  }
  if (requests.length > 0) {
    const first = requests[0];
    const due = calendarDayWords(first.due_on, tz);
    needs.push({
      kind: "documents",
      key: "documents",
      title: requests.length === 1 ? "A document is needed" : `${requests.length} documents are needed`,
      detail:
        requests.length === 1
          ? `${FirmName} has asked you for this document: ${sentence(first.title)}${due ? ` It is needed by ${due}.` : ""}`
          : `${FirmName} has asked you for ${requests.length} documents.${due ? ` The first is needed by ${due}.` : ""}`,
      href: first.matter_id ? `/app/matters/${first.matter_id}?tab=documents` : `/app/appointments/${first.appointment_id}`,
      cta: requests.length === 1 ? "Upload the document" : "Upload the documents",
    });
  }
  for (const a of pending) {
    needs.push({
      kind: "pending",
      key: `pending-${a.id}`,
      title: "Your booking is held",
      detail: `Your consultation with ${firmName} is on ${whenWords(a.starts_at, tz)}. ${FirmName} has not confirmed it yet. See if anything is still needed from you.`,
      href: `/app/appointments/${a.id}`,
      cta: "See what is still needed",
    });
  }
  for (const m of asks) {
    const u = m.last_update;
    if (!u) continue;
    needs.push({
      kind: "ask",
      key: `ask-${m.id}`,
      title: "Your lawyer needs something from you",
      detail: sentence(u.client_action ?? u.title),
      meta: m.title,
      href: `/app/matters/${m.id}`,
      cta: "See what your lawyer needs",
    });
  }
  if (toPay.length > 0) {
    const next = toPay[0];
    const due = calendarDayWords(next.due_at, tz);
    const when = due ? (next.status === "overdue" ? `, and it was due by ${due}` : `, due by ${due}`) : "";
    needs.push({
      kind: "pay",
      key: "pay",
      title: toPay.length === 1 ? "You have an invoice to pay" : `You have ${toPay.length} invoices to pay`,
      detail: `${toPay.length === 1 ? "It is" : "The next one is"} for ${money(next)}${when}. See what it covers before you pay.`,
      href: `/app/payments/${next.id}`,
      cta: `See and pay ${money(next)}`,
    });
  }
  const [main, ...others] = needs;

  // Upload and Message go straight to the matter only when there is exactly one to go to. With
  // several, the client chooses on the matters list — it used to pick the newest, silently, so a
  // client with two files could send a message about one to the other and never know.
  const only = matters.length === 1 ? matters[0] : null;
  const pickOr = (tab: "documents" | "messages", fallback: string | null) =>
    only ? `/app/matters/${only.id}?tab=${tab}` : matters.length > 1 ? `/app/matters?for=${tab}` : fallback;
  const uploadHref = pickOr("documents", upcoming[0] ? `/app/appointments/${upcoming[0].id}` : null);
  const moneyFirst = main?.kind === "held" || main?.kind === "pay";

  // Ghost tiles, never filled: the filled button above is the screen's one main action.
  const tiles: Array<{ label: string; href: string; icon: IconName }> = [
    { label: "Message your lawyer", href: pickOr("messages", "/app/messages") ?? "/app/messages", icon: "mail" },
    ...(uploadHref ? [{ label: "Upload a document", href: uploadHref, icon: "paperclip" as IconName }] : []),
    // Booking is already the main action when nothing else needs the client.
    ...(bookHref && main ? [{ label: "Book a consultation", href: bookHref, icon: "calendar" as IconName }] : []),
    // Money that is not already the main action: a held booking always is, when there is one.
    ...(toPay.length > 0 && !moneyFirst ? [{ label: "Pay an invoice", href: "/app/payments", icon: "card" as IconName }] : []),
  ];
  // Whole class names, so Tailwind sees each one; a computed column count would not be built.
  const tileColumns = ["md:grid-cols-1", "md:grid-cols-2", "md:grid-cols-3", "md:grid-cols-4"][Math.min(tiles.length, 4) - 1];

  const choices: FirmChoice[] = firms.map((f) => ({
    id: f.id,
    name: f.name,
    meta: f.meta,
    primary: f.brand?.colours?.primary ?? DEFAULT_TOKENS.primary,
    heading: f.brand?.fonts?.heading ?? DEFAULT_TOKENS.headingFont,
    initial: f.name.trim().charAt(0).toUpperCase() || "·",
  }));

  const next = upcoming[0] ?? null;
  const quietLink =
    "inline-flex min-h-11 items-center text-13 font-medium text-brand underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
  const rowLink =
    "flex min-h-11 flex-col px-4 py-3 transition duration-fast hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand";

  const places: Array<{ label: string; href: string }> = [
    { label: "Search", href: "/app/search" },
    { label: "Who may act for me", href: "/app/authority" },
    { label: "Court dates", href: "/app/court-dates" },
    { label: "Payments", href: "/app/payments" },
    { label: "Profile", href: "/app/profile" },
    // The firm's own Urgent help page, which is public: someone in trouble may not be signed in.
    ...(urgentHref ? [{ label: "Urgent help", href: urgentHref }] : []),
  ];

  return (
    <Screen className="client-home gap-5">
      <IosInstallHint appName={firm?.name ?? "Docket"} />
      <OfflineBanner />

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="workspace-title">{hello}</h1>
          {/* One firm is a fact, several is a choice: only the second is a button. */}
          {firm && choices.length > 1 ? (
            <FirmSwitcher firms={choices} selectedId={firm.id}>
              <span className="min-w-0 truncate text-15 text-ink-muted">{firm.name}</span>
            </FirmSwitcher>
          ) : firm ? (
            <p className="mt-0.5 text-15 text-ink-muted">{firm.name}</p>
          ) : null}
        </div>
        <Link
          href="/app/notifications"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
          className="relative grid size-11 shrink-0 place-items-center rounded-full border border-edge bg-raised text-brand transition duration-fast hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Icon name="bell" size={20} strokeWidth={1.6} />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 grid h-[19px] min-w-[19px] place-items-center rounded-full bg-brand px-1.5 text-11 font-bold text-brand-on">
              {unread}
            </span>
          )}
        </Link>
      </header>

      {/* The main action: what to do next, in two or three plain sentences, and one button. */}
      <section aria-labelledby="next-step-heading" className="rounded-card border border-hairline bg-raised px-4 py-4">
        {main ? (
          <>
            <h2 id="next-step-heading" className="text-17 font-semibold leading-snug text-ink-strong">{main.title}</h2>
            <p className="mt-1 text-15 text-ink">{main.detail}</p>
            {main.meta && <p className="mt-1 text-13 text-ink-muted">{main.meta}</p>}
            <Link href={main.href} className={buttonClasses("primary", "lg", "mt-3 w-full sm:w-auto")}>
              {main.cta}
            </Link>
          </>
        ) : (
          <>
            <h2 id="next-step-heading" className="text-17 font-semibold leading-snug text-ink-strong">Nothing needs you right now</h2>
            <p className="mt-1 text-15 text-ink">{FirmName} will tell you here when something does.</p>
            {bookHref && (
              <>
                <p className="mt-1 text-15 text-ink-muted">If you need advice on something new, you can book a consultation.</p>
                <Link href={bookHref} className={buttonClasses("primary", "lg", "mt-3 w-full sm:w-auto")}>
                  Book a consultation
                </Link>
              </>
            )}
          </>
        )}
      </section>

      {/* Anything else that needs the client, quietly: a row each, no second filled button. */}
      {others.length > 0 && (
        <section aria-labelledby="also-heading" className="space-y-2">
          <h2 id="also-heading" className="text-13 font-semibold text-ink-strong">Also waiting for you</h2>
          <ul className="divide-y divide-hairline overflow-hidden rounded-card border border-hairline bg-raised">
            {others.map((n) => (
              <li key={n.key}>
                <Link href={n.href} className={rowLink}>
                  <span className="text-15 font-semibold text-ink-strong">{n.title}</span>
                  <span className="mt-0.5 text-13 text-ink-muted">{n.detail}</span>
                  {n.meta && <span className="mt-0.5 text-13 text-ink-muted">{n.meta}</span>}
                  <span className="mt-1 text-13 font-semibold text-brand underline underline-offset-2">{n.cta}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Where each matter stands, in the client's words: status, what happened last, what
          happens next, the next date and who is handling it. */}
      <section aria-labelledby="matters-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="matters-heading" className="text-17 font-semibold text-ink-strong">{matters.length === 1 ? "Your matter" : "Your matters"}</h2>
          {matters.length > 1 && <Link href="/app/matters" className={quietLink}>See all matters</Link>}
        </div>
        {matters.length === 0 ? (
          <div className="rounded-card border border-hairline bg-raised">
            <EmptyState
              title="No matters yet"
              hint={`When ${firmName} opens a matter for you, it appears here with its latest update, its next court date and the lawyer handling it.`}
            />
          </div>
        ) : (
          matters.map((m) => <MatterCard key={m.id} matter={m} tz={tz} />)
        )}
      </section>

      <nav aria-label="Quick actions" className={`grid grid-cols-2 gap-2 ${tileColumns}`}>
        {tiles.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="flex min-h-14 items-center gap-2 rounded-control border border-edge bg-raised px-3 py-2 text-13 font-semibold leading-tight text-ink transition duration-fast hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Icon name={a.icon} size={19} strokeWidth={1.6} className="shrink-0 text-brand" />
            {a.label}
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader
            title="Next consultation"
            action={<Link href="/app/appointments" className="text-13 font-medium text-brand underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">See all consultations</Link>}
          />
          {next ? (
            <CardBody className="space-y-2">
              <p className="text-15 font-semibold leading-snug text-ink">{whenWords(next.starts_at, tz)}</p>
              <p className="text-13 text-ink-muted">{modeLabel(next.mode)} with {firm?.name ?? "your firm"}</p>
              <div className="flex flex-wrap items-center gap-3">
                {isStatus(next.status) && <StatusPill status={next.status} label={clientStatusLabel(next.status)} />}
                <Link href={`/app/appointments/${next.id}`} className={quietLink}>See your consultation</Link>
              </div>
            </CardBody>
          ) : (
            <EmptyState
              align="start"
              title="No upcoming consultations"
              hint={`Consultations you book with ${firmName} appear here. A video call also gets a link to join when it is time.`}
            />
          )}
        </Card>

        {/* Secondary detail, folded away until it is wanted (docs/VOICE.md, rule 15). */}
        <Disclosure summary="Recent activity" hint="The latest documents and notifications">
          <div className="-mx-4 -my-3">
            <h3 className="px-4 pb-1 pt-3 text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted">Documents</h3>
            {documents.length === 0 ? (
              <EmptyState align="start" title="No documents yet" hint="Documents your lawyer shares with you, and ones you upload, appear here." />
            ) : (
              <ul className="divide-y divide-hairline">
                {documents.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={d.matter_id ? `/app/matters/${d.matter_id}?tab=documents` : d.appointment_id ? `/app/appointments/${d.appointment_id}` : "/app/matters"}
                      className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 transition duration-fast hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                    >
                      <span className="min-w-0 truncate text-13 text-ink">{d.name}</span>
                      <span className="shrink-0 text-11 text-ink-muted">{shortDayWords(d.created_at, tz)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="border-t border-hairline px-4 pb-1 pt-3 text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted">Notifications</h3>
            <NotificationsList rows={notifications} firmNames={firmNames} timezone={tz} compact />
            <div className="border-t border-hairline px-4">
              <Link href="/app/notifications" className={quietLink}>See all notifications</Link>
            </div>
          </div>
        </Disclosure>
      </div>

      <nav aria-label="More places" className="flex flex-wrap justify-center gap-x-4">
        {places.map((p) => (
          <Link
            key={p.label}
            href={p.href}
            // min-w-11 as well: "Search" and "Profile" are narrower than a thumb at 13px.
            className="inline-flex min-h-11 min-w-11 items-center justify-center text-13 text-ink-muted underline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {p.label}
          </Link>
        ))}
      </nav>
    </Screen>
  );
}

/** One matter, as the client needs it: where it stands, and quiet ways into it. */
function MatterCard({ matter: m, tz }: { matter: MatterSummary; tz: string }) {
  const label = "text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted";
  return (
    <article className="overflow-hidden rounded-card border border-hairline bg-raised">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-17 font-semibold leading-snug text-ink-strong">
            <Link href={`/app/matters/${m.id}`} className="inline-flex min-h-11 items-center underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              {m.title}
            </Link>
          </h3>
          {/* What and where first; the number last, with its label (docs/VOICE.md, rule 5). */}
          <p className="text-13 text-ink-muted">
            {m.court_name ? <>{m.court_name}. </> : null}
            {m.suit_number ? "Suit number " : "Reference "}
            <span className="font-mono">{m.suit_number ?? m.reference}</span>
          </p>
        </div>
        {m.status && <MatterStatusChip status={m.status} />}
      </header>
      <dl className="grid gap-x-6 gap-y-3 px-4 py-3 text-13 sm:grid-cols-2">
        <div>
          <dt className={label}>Latest update</dt>
          <dd className="mt-0.5 text-ink">
            {m.last_update ? (
              <>
                {m.last_update.title}
                <span className="block text-ink-muted">{dayWords(m.last_update.occurred_at, tz)}</span>
              </>
            ) : (
              "No update yet."
            )}
          </dd>
        </div>
        <div>
          <dt className={label}>What happens next</dt>
          <dd className="mt-0.5 text-ink">{m.last_update?.next_step ?? "Your lawyer will post the next update here."}</dd>
        </div>
        <div>
          <dt className={label}>Next court date</dt>
          <dd className="mt-0.5 text-ink">{m.next_event_at ? whenWords(m.next_event_at, tz) : "None fixed yet."}</dd>
        </div>
        <div>
          <dt className={label}>{m.lawyer_names.length === 1 ? "Your lawyer" : "Your lawyers"}</dt>
          <dd className="mt-0.5 text-ink">{m.lawyer_names.length ? m.lawyer_names.join(", ") : "Not assigned yet."}</dd>
        </div>
      </dl>
      {/* Ghosts only: the screen's one filled button is its main action, above. */}
      <footer className="flex flex-wrap gap-2 border-t border-hairline px-4 py-2.5">
        <Link href={`/app/matters/${m.id}`} className={buttonClasses("ghost", "sm")}>See the matter</Link>
        <Link href={`/app/matters/${m.id}?tab=messages`} className={buttonClasses("ghost", "sm")}>Message your lawyer</Link>
        <Link href={`/app/matters/${m.id}?tab=documents`} className={buttonClasses("ghost", "sm")}>See the documents</Link>
      </footer>
    </article>
  );
}
