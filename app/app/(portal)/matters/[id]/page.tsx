import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { clientTimezone } from "@/lib/portal-data";
import { formatMoneyMinor } from "@/lib/money";
import { amountToCharge } from "@/lib/payment-breakdown";
import { clientStatusLabel } from "@/lib/client-words";
import { calendarDayWords, dayWords, whenWords } from "@/lib/notifications-copy";
import { Card, EmptyState } from "@/components/ui/card";
import { MatterStatusChip, StatusPill, isStatus } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Icon } from "@/components/ui/icon";
import { Timeline } from "@/components/portal/timeline";
import { DocumentsTab, type DocumentWithVersion } from "@/components/portal/documents-tab";
import { MessagesThread } from "@/components/portal/messages-thread";
import { Screen, ScreenHeader } from "@/components/portal/screen";
import { cn } from "@/lib/cn";
import type { DocumentRow, DocumentSignatureRow, DocumentVersionRow, MatterRow, MatterStatus, MessageRow, UpdateRow, DocumentRequestRow } from "@/lib/db/types";

export const metadata = { title: "Matter" };

type Tab = "timeline" | "documents" | "messages" | "invoices";
const TABS: Array<[Tab, string]> = [["timeline", "Timeline"], ["documents", "Documents"], ["messages", "Messages"], ["invoices", "Invoices"]];

/** What a client can pay now: the same test the invoice page makes before it shows Pay. */
const PAYABLE = ["issued", "partially_paid", "overdue"];

interface MatterInvoice {
  id: string; number: string; status: string; currency: string; total_minor: number; paid_minor: number;
  issued_at: string | null; due_at: string | null;
  /** What the invoice is for, from its items, in the order the database returns them. */
  items: string[];
}

/** What is still owed: amountToCharge() is what the invoice page and the pay action charge. */
const owed = (inv: MatterInvoice) => amountToCharge({ totalMinor: Number(inv.total_minor), paidMinor: Number(inv.paid_minor) });
const isPayable = (inv: MatterInvoice) => PAYABLE.includes(inv.status) && owed(inv) > 0;

/** A firm's own words, closed with a full stop so another sentence can follow them. */
function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export default async function MatterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = (TABS.map((t) => t[0]) as string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "timeline";
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));

  const { data } = await supabase
    .from("matters")
    // Only what a client is meant to read. description and next_action are the firm's own
    // working notes (migration 26 made next_action a staff work item with an owner and a due
    // day); "what happens next" for the client comes from the update the lawyer wrote for them.
    .select("id, firm_id, reference, title, type, status_id, court_name, suit_number, next_event_at, next_event_note, opened_at, closed_at")
    .eq("id", id)
    .maybeSingle();
  const matter = (data ?? null) as MatterRow | null;
  if (!matter) notFound();

  const [firm, tz, { data: statusRow }, { data: lawyerRows }, { data: latestRows }, { data: requestRows }, { data: signRows }] = await Promise.all([
    firmById(matter.firm_id),
    clientTimezone(supabase, user.id),
    matter.status_id ? supabase.from("matter_statuses").select("id, firm_id, key, label, colour, is_terminal").eq("id", matter.status_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("matter_lawyers").select("user_id, is_lead").eq("matter_id", matter.id),
    // RLS returns a party only client-visible updates; the filter says so anyway.
    supabase.from("updates").select("title, occurred_at, next_step, client_action, action_required").eq("matter_id", id).eq("visibility", "client").order("occurred_at", { ascending: false }).limit(1),
    // Every request on the matter, read once: the open ones decide this screen's main action, and
    // the Documents tab lists them all.
    supabase.from("document_requests").select("id, firm_id, matter_id, title, why, due_on, requested_by, requested_at, fulfilled_document_id, fulfilled_at, cancelled_at").eq("matter_id", matter.id).order("requested_at", { ascending: false }).limit(50),
    // Documents the firm has asked its clients to sign. Whether THIS client still has to is below.
    supabase.from("documents").select("id, current_version_id, locked_version_id").eq("matter_id", matter.id).is("deleted_at", null).not("signature_requested_at", "is", null).limit(50),
  ]);
  const latest = ((latestRows ?? []) as Array<Pick<UpdateRow, "title" | "occurred_at" | "next_step" | "client_action" | "action_required">>)[0] ?? null;
  const status = statusRow as MatterStatus | null;
  const lawyerIds = ((lawyerRows ?? []) as Array<{ user_id: string }>).map((l) => l.user_id);
  const { data: lawyerPublic } = lawyerIds.length ? await supabase.from("lawyer_public").select("id, full_name, title").in("id", lawyerIds) : { data: [] };
  const lawyers = (lawyerPublic ?? []) as Array<{ id: string; full_name: string | null; title: string | null }>;
  const senderNames = Object.fromEntries(lawyers.map((l) => [l.id, l.full_name ?? l.title ?? firm?.name ?? "Your lawyer"]));
  const firmName = firm?.name ?? "Your firm";
  const firmMid = firm?.name ?? "your firm";

  // Asked for, not yet sent: the nearest due date first, then the longest waiting. The Documents
  // tab lists them in the same order, so its first "Upload this" is the one this screen points to.
  const requests = (requestRows ?? []) as DocumentRequestRow[];
  const openRequests = requests
    .filter((r) => !r.fulfilled_at && !r.cancelled_at)
    .sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") || a.requested_at.localeCompare(b.requested_at));

  // Still to sign, by this client, on the version now current. The same test DocumentsTab makes
  // before it shows "Read and sign" (see toSign there): not a version executed on paper, not one
  // superseded by a version already signed, and not one this client has signed already.
  const signDocs = (signRows ?? []) as Array<{ id: string; current_version_id: string | null; locked_version_id: string | null }>;
  let toSignCount = 0;
  if (signDocs.length > 0) {
    const versionIds = signDocs.map((d) => d.current_version_id).filter((v): v is string => Boolean(v));
    const [{ data: kindRows }, { data: mineRows }] = await Promise.all([
      versionIds.length ? supabase.from("document_versions").select("id, kind").in("id", versionIds) : Promise.resolve({ data: [] }),
      supabase.from("document_signatures").select("version_id").eq("signer_id", user.id).in("document_id", signDocs.map((d) => d.id)),
    ]);
    const kinds = new Map(((kindRows ?? []) as Array<{ id: string; kind: string | null }>).map((v) => [v.id, v.kind]));
    const signed = new Set(((mineRows ?? []) as Array<{ version_id: string }>).map((s) => s.version_id));
    toSignCount = signDocs.filter((d) => {
      const v = d.current_version_id;
      return Boolean(v) && kinds.get(v as string) !== "executed_paper" && (!d.locked_version_id || d.locked_version_id === v) && !signed.has(v as string);
    }).length;
  }

  const invoices = tab === "invoices" ? await matterInvoices(supabase, matter.id) : [];

  /*
   * ONE MAIN ACTION. The one thing this matter needs from the client right now, in this order:
   * a document the firm asked for, a document to sign, otherwise a word with the lawyer. Its
   * button is the screen's one filled button only where the open tab has none of its own. The
   * Documents tab carries "Upload this", "Read and sign" or "Upload a document", the Messages tab
   * carries Send, and the Invoices tab carries "See and pay" when something is owed. There it is a
   * ghost, and on the tab it points to it is not repeated at all.
   *
   * No label here may match /download|open|view/i: tests/integration/journeys.spec.ts clicks the
   * first such link on this page and expects a document to load (the default tab has no document
   * link today, so that journey skips). So no label carries a document name either, which is the
   * firm's text and could say anything.
   */
  const base = `/app/matters/${matter.id}`;
  const main: { label: string; href: string; tab: Tab } =
    openRequests.length > 0
      ? { label: openRequests.length === 1 ? "Upload the document" : "Upload the documents", href: `${base}?tab=documents#requests`, tab: "documents" }
      : toSignCount > 0
        ? { label: toSignCount === 1 ? "Read and sign the document" : "Read and sign the documents", href: `${base}?tab=documents`, tab: "documents" }
        : { label: "Message your lawyer", href: `${base}?tab=messages`, tab: "messages" };
  const tabHasPrimary = tab === "documents" || tab === "messages" || (tab === "invoices" && invoices.some(isPayable));

  // What the lawyer is waiting for, one sentence each: what the latest update asked, then the
  // documents asked for, then the signatures.
  const firstDue = openRequests[0] ? calendarDayWords(openRequests[0].due_on) : "";
  const needs = [
    latest?.action_required ? sentence(latest.client_action ?? latest.title) : null,
    openRequests.length === 1
      ? `Your lawyer has asked you for this document: ${sentence(openRequests[0].title)}${firstDue ? ` It is needed by ${firstDue}.` : ""}`
      : openRequests.length > 1
        ? `Your lawyer has asked you for ${openRequests.length} documents.${firstDue ? ` The first is needed by ${firstDue}.` : ""}`
        : null,
    toSignCount === 1 ? "Your lawyer has asked you to sign a document." : toSignCount > 1 ? `Your lawyer has asked you to sign ${toSignCount} documents.` : null,
  ].filter((n): n is string => Boolean(n));

  const label = "text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted";
  const lawyerLine = lawyers.map((l) => l.full_name ?? l.title).filter(Boolean).join(", ");
  // A court date row only where there is a court or a date: a contract has neither, and a row that
  // says "none" on every transactional matter reads as if something were missing.
  const courtRow = Boolean(matter.next_event_at || matter.court_name);

  /* Where the matter stands, in plain words: the answers a client wants before any tab. */
  const summary = (
    <Card>
      {needs.length > 0 && (
        // The icon is half of the status signal (DESIGN.md: never colour alone).
        <div className="flex items-start gap-2.5 border-b border-waiting-line bg-waiting-bg px-4 py-3 text-waiting-ink">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          <div className="min-w-0 space-y-1 text-15">
            <p className="font-semibold">Your lawyer needs something from you</p>
            {needs.map((n) => <p key={n}>{n}</p>)}
          </div>
        </div>
      )}
      <dl className="divide-y divide-hairline">
        <div className="px-4 py-2.5">
          <dt className={label}>What happens next</dt>
          <dd className="mt-0.5 text-15 text-ink">{latest?.next_step ?? "Your lawyer will post the next update here."}</dd>
        </div>
        {courtRow && (
          <div className="px-4 py-2.5">
            <dt className={label}>Next court date</dt>
            <dd className="mt-0.5 text-15 text-ink">
              {matter.next_event_at ? whenWords(matter.next_event_at, tz) : "None fixed yet."}
              {matter.next_event_at && matter.next_event_note ? <span className="block text-13 text-ink-muted">{matter.next_event_note}</span> : null}
            </dd>
          </div>
        )}
      </dl>
      {main.tab !== tab && (
        <div className="border-t border-hairline px-4 py-3">
          <Link href={main.href} className={buttonClasses(tabHasPrimary ? "ghost" : "primary", "md", "w-full")}>{main.label}</Link>
        </div>
      )}
      <Disclosure framed={false} summary="About this matter" className="border-t border-hairline px-4 pb-1">
        <dl className="space-y-3">
          <div>
            <dt className={label}>Latest update</dt>
            <dd className="mt-0.5 text-ink">{latest ? <>{latest.title}<span className="block text-13 text-ink-muted">{dayWords(latest.occurred_at, tz)}</span></> : "No update yet."}</dd>
          </div>
          <div>
            <dt className={label}>Court</dt>
            <dd className="mt-0.5 text-ink">
              {matter.court_name ?? "Not in court"}
              {matter.suit_number ? <span className="block text-13 text-ink-muted">Suit number <span className="font-mono">{matter.suit_number}</span></span> : null}
            </dd>
          </div>
          <div>
            <dt className={label}>{lawyers.length === 1 ? "Your lawyer" : "Your lawyers"}</dt>
            <dd className="mt-0.5 text-ink">{lawyerLine || firmName}</dd>
          </div>
          <div>
            <dt className={label}>Firm</dt>
            <dd className="mt-0.5 text-ink">{firmName}</dd>
          </div>
        </dl>
      </Disclosure>
    </Card>
  );

  return (
    <>
      <ScreenHeader back="/app/matters" backLabel="Back to matters" title="Your matter" subtitle={`Reference ${matter.reference}`} />
      <Screen>
        <header className="flex flex-col gap-1.5">
          <h1 className="font-heading text-21 font-semibold leading-tight tracking-[-0.015em] text-brand md:text-26">{matter.title}</h1>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {status && <MatterStatusChip status={status} />}
            <p className="text-13 text-ink-muted">{firmName}</p>
          </div>
        </header>

        {/* The summary comes first in the page, so a phone reads it, and its one action, before
            the tabs and a timeline that can run to a hundred entries. From 1280px the grid moves it
            into the second column, where it stays while the tabs scroll. Not WithAside: that puts
            its companion SECOND in the page, which is the right order for a feed and the wrong one
            here. top-20 clears the sticky command bar above it. */}
        <div className="grid grid-cols-1 gap-4 md:gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-20 xl:col-start-2 xl:row-start-1 xl:self-start">{summary}</div>
          <div className="flex min-w-0 flex-col gap-4 xl:col-start-1 xl:row-start-1">
            <nav aria-label="Matter sections" className="-mx-4 flex gap-1 overflow-x-auto border-b border-hairline px-4 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8 xl:mx-0 xl:px-0">
              {TABS.map(([key, tabLabel]) => (
                <Link key={key} href={`${base}?tab=${key}`} aria-current={tab === key ? "page" : undefined}
                  className={cn("-mb-px flex min-h-11 shrink-0 items-center border-b-2 px-3 text-13 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand", tab === key ? "border-brand font-semibold text-ink-strong" : "border-transparent text-ink-muted hover:text-ink")}>
                  {tabLabel}
                </Link>
              ))}
            </nav>

            <Card>
              {tab === "timeline" && <TimelineTab supabase={supabase} matterId={matter.id} tz={tz} />}
              {tab === "documents" && <DocumentsSection supabase={supabase} matter={matter} tz={tz} userId={user.id} requests={requests} />}
              {tab === "messages" && <MessagesSection supabase={supabase} matter={matter} userId={user.id} tz={tz} senderNames={senderNames} firmName={firmName} />}
              {tab === "invoices" && <InvoicesSection invoices={invoices} firmMid={firmMid} />}
            </Card>
          </div>
        </div>
      </Screen>
    </>
  );
}

type SB = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

async function TimelineTab({ supabase, matterId, tz }: { supabase: SB; matterId: string; tz: string }) {
  const { data } = await supabase
    .from("updates")
    .select("id, matter_id, firm_id, kind, title, body, payload, occurred_at, created_at, meaning, next_step, client_action, action_required, next_update_by")
    .eq("matter_id", matterId)
    .order("occurred_at", { ascending: false })
    .limit(100);
  return <Timeline matterId={matterId} initial={(data ?? []) as UpdateRow[]} timezone={tz} />;
}

async function DocumentsSection({ supabase, matter, tz, userId, requests }: { supabase: SB; matter: MatterRow; tz: string; userId: string; requests: DocumentRequestRow[] }) {
  const { data: docRows } = await supabase
    .from("documents")
    .select("id, firm_id, matter_id, appointment_id, name, category, client_visible, current_version_id, uploaded_by, reviewed_at, reviewed_by, created_at, locked_version_id, locked_at, signature_requested_at, signature_requested_by")
    .eq("matter_id", matter.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  const docs = (docRows ?? []) as DocumentRow[];
  const [{ data: versionRows }, { data: signatureRows }, { data: me }] = await Promise.all([
    docs.length ? supabase.from("document_versions").select("id, document_id, storage_path, mime, size_bytes, uploaded_by, created_at, checksum, kind, executed_on").in("document_id", docs.map((d) => d.id)) : Promise.resolve({ data: [] as DocumentVersionRow[] }),
    docs.length ? supabase.from("document_signatures").select("*").in("document_id", docs.map((d) => d.id)).order("signed_at") : Promise.resolve({ data: [] as DocumentSignatureRow[] }),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  const versions = (versionRows ?? []) as DocumentVersionRow[];
  const withVersion: DocumentWithVersion[] = docs.map((d) => ({
    ...d,
    version: versions.find((v) => v.id === d.current_version_id) ?? versions.filter((v) => v.document_id === d.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null,
    version_count: versions.filter((v) => v.document_id === d.id).length,
  }));
  return <DocumentsTab firmId={matter.firm_id} matterId={matter.id} appointmentId={null} documents={withVersion} timezone={tz} requests={requests} userId={userId} signatures={(signatureRows ?? []) as DocumentSignatureRow[]} profileName={(me as { full_name: string | null } | null)?.full_name ?? null} />;
}

async function MessagesSection({ supabase, matter, userId, tz, senderNames, firmName }: { supabase: SB; matter: MatterRow; userId: string; tz: string; senderNames: Record<string, string>; firmName: string }) {
  const { data } = await supabase
    .from("messages")
    .select("id, firm_id, matter_id, appointment_id, sender_id, body, attachments, read_at, created_at")
    .eq("matter_id", matter.id)
    .order("created_at", { ascending: true })
    .limit(200);
  return <MessagesThread firmId={matter.firm_id} matterId={matter.id} appointmentId={null} userId={userId} initial={(data ?? []) as MessageRow[]} timezone={tz} senderNames={senderNames} firmName={firmName} audience="client" />;
}

/** The matter's invoices, each with the words of its items, so a row can say what it is for. */
async function matterInvoices(supabase: SB, matterId: string): Promise<MatterInvoice[]> {
  const { data } = await supabase
    .from("invoices")
    .select("id, number, status, currency, total_minor, paid_minor, issued_at, due_at")
    .eq("matter_id", matterId)
    .order("issued_at", { ascending: false });
  const rows = (data ?? []) as Array<Omit<MatterInvoice, "items">>;
  if (rows.length === 0) return [];
  const { data: itemRows } = await supabase.from("invoice_items").select("invoice_id, description").in("invoice_id", rows.map((r) => r.id));
  const items = (itemRows ?? []) as Array<{ invoice_id: string; description: string }>;
  return rows.map((r) => ({ ...r, items: items.filter((i) => i.invoice_id === r.id).map((i) => i.description) }));
}

/*
 * Every invoice links to its own page, and nothing here opens a checkout. That page shows "Before
 * you pay" (who is paid, for what, and how the total is made) above the one button that starts
 * Paystack, so no payment on a matter skips the breakdown (docs/VOICE.md, rule 6).
 */
function InvoicesSection({ invoices, firmMid }: { invoices: MatterInvoice[]; firmMid: string }) {
  if (invoices.length === 0) {
    return <EmptyState title="No invoices on this matter yet" hint={`When ${firmMid} sends you an invoice for this matter, it shows here with what it is for.`} />;
  }
  // The first invoice still owed is the tab's one filled button; any others are ghosts.
  const firstPayable = invoices.find(isPayable)?.id ?? null;
  return (
    <ul className="divide-y divide-hairline">
      {invoices.map((inv) => {
        const money = (minor: number) => formatMoneyMinor(minor, inv.currency);
        const payable = isPayable(inv);
        const paid = Number(inv.paid_minor);
        const due = payable ? calendarDayWords(inv.due_at) : "";
        // What it is for first; the number last, with its label (docs/VOICE.md, rule 5).
        const what = inv.items.length === 0
          ? `Invoice ${inv.number}`
          : inv.items.length === 1 ? inv.items[0] : `${inv.items[0]}, and ${inv.items.length - 1} more ${inv.items.length === 2 ? "item" : "items"}`;
        const total = Number(inv.total_minor);
        const facts = [
          // Never a ₦0 figure (docs/VOICE.md, rule 7).
          total > 0 ? `${money(total)} in total${paid > 0 && payable ? `, ${money(paid)} paid so far` : ""}.` : "Nothing to pay.",
          due ? (inv.status === "overdue" ? `It was due by ${due}.` : `It is due by ${due}.`) : "",
          inv.items.length > 0 ? `Invoice ${inv.number}.` : "",
        ].filter(Boolean).join(" ");
        // None of these labels may match /download|open|view/i: see the note above MatterPage's main action.
        const cta = payable ? `See and pay ${money(owed(inv))}` : inv.status === "paid" ? "See the receipt" : "See the invoice";
        return (
          <li key={inv.id} className="px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-15 font-medium text-ink">{what}</p>
                <p className="mt-0.5 text-13 text-ink-muted">{facts}</p>
              </div>
              {isStatus(inv.status) && <StatusPill status={inv.status} label={clientStatusLabel(inv.status)} />}
            </div>
            <Link href={`/app/payments/${inv.id}`} className={buttonClasses(inv.id === firstPayable ? "primary" : "ghost", "sm", "mt-2.5")}>{cta}</Link>
          </li>
        );
      })}
    </ul>
  );
}
