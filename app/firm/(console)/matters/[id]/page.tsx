// The matter workbench: one file open in front of the lawyer — what happened
// and what was said, the documents, the money, counsel on the other side, the
// people on it, the tasks and the file's own details, behind ?tab=.
//
// Rules enforced here:
//  · Every read runs as the signed-in staff member. RLS (is_firm_member for
//    reads, staff_w for writes) is the authorization layer; no service key is
//    used anywhere, and the console layout has already proved session + aal2.
//  · Internal timeline entries are staff-only by policy. They are shown on this
//    screen — with an unmistakable badge — and never reach a client.
//  · Timestamps are UTC in the database and rendered in ctx.timezone with
//    Intl.DateTimeFormat. Money is integer minor units through
//    formatMoneyMinor().
//  · Nothing firm-specific: the firm, its courts, its statuses and its people
//    all come from context. A staff member who belongs to more than one firm
//    reads this file in the firm that owns it.
//  · No dead ends: every empty tab names the next action.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  courtsFor, firmStaff, matterStatuses, requestedFirmId, staffContext, staffLabel,
  type StaffContext,
} from "@/lib/firm-data";
import { formatMoneyMinor } from "@/lib/money";
import { formatWhen } from "@/lib/time";
import { issueInvoice } from "@/lib/actions/invoices";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { CounselRoster } from "@/components/firm/counsel-roster";
import { MessagesThread } from "@/components/portal/messages-thread";
import { cn } from "@/lib/cn";
import type {
  DocumentRow, DocumentVersionRow, MatterCounselRow, MatterStatus, MessageRow,
  ServiceDirectoryRow, TaskRow,
} from "@/lib/db/types";
import { CopyButton, MatterTabs, type TabSpec } from "./matter-tabs";
import { StaffTimeline, type StaffUpdate } from "./staff-timeline";
import { StaffDocuments, type StaffDocument } from "./staff-documents";
import { PartiesPanel, type MatterPartyRow, type PendingInvite } from "./parties-panel";
import { TasksPanel } from "./tasks-panel";
import { EditPanel } from "./edit-panel";

export const metadata = { title: "Matter" };

const TABS: TabSpec[] = [
  { key: "timeline", label: "Timeline" },
  { key: "documents", label: "Documents" },
  { key: "messages", label: "Messages" },
  { key: "invoices", label: "Invoices" },
  { key: "counsel", label: "Counsel" },
  { key: "parties", label: "Parties" },
  { key: "tasks", label: "Tasks" },
  { key: "edit", label: "Details" },
];

/** matter_statuses.colour holds a colour name; Tailwind needs whole class names. */
const TONES: Record<string, string> = {
  slate: "border-slate-300 bg-slate-50 text-slate-800",
  gray: "border-gray-300 bg-gray-50 text-gray-700",
  grey: "border-gray-300 bg-gray-50 text-gray-700",
  blue: "border-blue-300 bg-blue-50 text-blue-900",
  sky: "border-sky-300 bg-sky-50 text-sky-900",
  indigo: "border-indigo-300 bg-indigo-50 text-indigo-900",
  violet: "border-violet-300 bg-violet-50 text-violet-900",
  purple: "border-purple-300 bg-purple-50 text-purple-900",
  green: "border-emerald-300 bg-emerald-50 text-emerald-900",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
  teal: "border-teal-300 bg-teal-50 text-teal-900",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  orange: "border-orange-300 bg-orange-50 text-orange-900",
  red: "border-red-300 bg-red-50 text-red-900",
  rose: "border-rose-300 bg-rose-50 text-rose-900",
};

const TYPE_LABELS: Record<string, string> = { ip: "Intellectual property", debt_recovery: "Debt recovery" };
function typeLabel(type: string): string {
  const label = TYPE_LABELS[type] ?? type.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * A server action's refusal, whatever shape it returns. Kept defensive on
 * purpose: the message the database gave is what the lawyer must read.
 */
function refusalMessage(result: unknown): string | null {
  if (result && typeof result === "object" && "error" in result) {
    const message = (result as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) return message;
  }
  return null;
}

interface MatterDetail {
  id: string;
  firm_id: string;
  reference: string;
  title: string;
  cause_title: string | null;
  type: string;
  status_id: string | null;
  description: string | null;
  next_action: string | null;
  court_id: string | null;
  court_name: string | null;
  suit_number: string | null;
  judicial_division: string | null;
  judge: string | null;
  next_event_at: string | null;
  next_event_note: string | null;
  awaiting_date: boolean | null;
  opened_at: string;
  closed_at: string | null;
  originating_lawyer_id: string | null;
  handling_lawyer_id: string | null;
}

const MATTER_COLUMNS =
  "id, firm_id, reference, title, cause_title, type, status_id, description, next_action, court_id, court_name, " +
  "suit_number, judicial_division, judge, next_event_at, next_event_note, awaiting_date, opened_at, closed_at, " +
  "originating_lawyer_id, handling_lawyer_id";

export default async function MatterWorkbench({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; firm?: string; error?: string; issued?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as string) : "timeline";

  let ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));
  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
        See <code>.env.example</code>, or ask a firm owner to add you.
      </Alert>
    );
  }

  const { data: matterRow } = await ctx.supabase
    .from("matters")
    .select(MATTER_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  const matter = (matterRow ?? null) as MatterDetail | null;
  if (!matter) notFound();

  // A member of two firms may arrive here from the other firm's context.
  if (matter.firm_id !== ctx.firmId) {
    const owning = await staffContext(matter.firm_id);
    if (!owning || owning.firmId !== matter.firm_id) notFound();
    ctx = owning;
  }

  const { supabase, firmId, timezone: tz } = ctx;
  const basePath = `/firm/matters/${matter.id}`;
  const extraQuery = sp.firm ? `&firm=${encodeURIComponent(sp.firm)}` : "";

  const [statuses, staff, { data: lawyerRows }, { data: partyRows }] = await Promise.all([
    matterStatuses(supabase, firmId),
    firmStaff(supabase, firmId),
    supabase.from("matter_lawyers").select("user_id, is_lead").eq("matter_id", matter.id),
    supabase.from("matter_parties").select("user_id, role, can_view_docs, can_pay").eq("matter_id", matter.id),
  ]);

  const parties = (partyRows ?? []) as Array<{ user_id: string; role: string; can_view_docs: boolean; can_pay: boolean }>;
  const partyIds = parties.map((p) => p.user_id);
  const { data: partyProfiles } = partyIds.length
    ? await supabase.from("profiles").select("id, full_name, phone, email").in("id", partyIds)
    : { data: [] as Array<{ id: string; full_name: string | null; phone: string | null; email: string | null }> };
  const profiles = (partyProfiles ?? []) as Array<{ id: string; full_name: string | null; phone: string | null; email: string | null }>;

  const staffOptions = staff.map((m) => ({ id: m.user_id, label: staffLabel(m) }));
  const names: Record<string, string> = {};
  for (const m of staff) names[m.user_id] = staffLabel(m);
  for (const p of profiles) names[p.id] = p.full_name?.trim() || p.phone || p.email || "Client";

  const status = matter.status_id ? statuses.find((s) => s.id === matter.status_id) ?? null : null;
  const lawyers = (lawyerRows ?? []) as Array<{ user_id: string; is_lead: boolean }>;
  const leadLawyerId = lawyers.find((l) => l.is_lead)?.user_id ?? "";
  const handling = matter.handling_lawyer_id ? names[matter.handling_lawyer_id] ?? null : null;
  const originating = matter.originating_lawyer_id ? names[matter.originating_lawyer_id] ?? null : null;

  return (
    <div className="space-y-5">
      <p className="text-sm">
        <Link href={`/firm/matters${sp.firm ? `?firm=${encodeURIComponent(sp.firm)}` : ""}`} className="text-brand underline">← Matters</Link>
      </p>

      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-semibold text-brand">{matter.title}</h1>
            <p className="text-sm text-gray-600">
              {matter.reference} · {typeLabel(matter.type)} · opened {formatWhen(`${matter.opened_at}T00:00:00Z`, "UTC", { dateStyle: "medium" })}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {status && <StatusChip status={status} />}
            {matter.closed_at && <StatusPill status="closed" />}
          </div>
        </div>

        {matter.cause_title && <p className="text-sm font-medium text-gray-900">{matter.cause_title}</p>}

        <p className="text-sm text-gray-700">
          {matter.court_name ?? "No court recorded"}
          {matter.judicial_division ? `, ${matter.judicial_division}` : ""}
          {matter.suit_number ? ` · ${matter.suit_number}` : " · no suit number yet"}
          {matter.judge ? ` · ${matter.judge}` : ""}
        </p>

        <p className="text-sm text-gray-800">
          {matter.next_event_at ? (
            <>
              Next in court: <strong>{formatWhen(matter.next_event_at, tz, { dateStyle: "full", timeStyle: "short" })}</strong>
              {matter.next_event_note ? ` · ${matter.next_event_note}` : ""} <span className="text-gray-500">({tz})</span>
            </>
          ) : matter.awaiting_date ? (
            <span className="font-medium text-amber-800">Awaiting a date from the court.</span>
          ) : (
            <span className="text-gray-500">No court date fixed.</span>
          )}
        </p>

        {matter.next_action && <p className="text-sm font-medium text-brand">Next action: {matter.next_action}</p>}

        <p className="text-xs text-gray-600">
          Handling: {handling ?? "not recorded"} · Originating: {originating ?? "not recorded"}
          {leadLawyerId && names[leadLawyerId] ? ` · Conduct: ${names[leadLawyerId]}` : ""}
        </p>
      </header>

      {sp.error && <Alert kind="error" title="That was refused">{sp.error}</Alert>}
      {sp.issued === "1" && <Alert kind="success">Invoice issued. Your client can see it and pay from their app.</Alert>}

      <MatterTabs tabs={TABS} active={tab} basePath={basePath} extraQuery={extraQuery} />

      <Card>
        {tab === "timeline" && <TimelineSection ctx={ctx} matter={matter} names={names} />}
        {tab === "documents" && <DocumentsSection ctx={ctx} matter={matter} names={names} />}
        {tab === "messages" && <MessagesSection ctx={ctx} matter={matter} names={names} />}
        {tab === "invoices" && <InvoicesSection ctx={ctx} matter={matter} basePath={basePath} extraQuery={extraQuery} />}
        {tab === "counsel" && <CounselSection ctx={ctx} matter={matter} />}
        {tab === "parties" && <PartiesSection ctx={ctx} matter={matter} parties={parties} profiles={profiles} />}
        {tab === "tasks" && <TasksSection ctx={ctx} matter={matter} staffOptions={staffOptions} />}
        {tab === "edit" && (
          <EditSection ctx={ctx} matter={matter} statuses={statuses} staffOptions={staffOptions} leadLawyerId={leadLawyerId} alsoOn={lawyers.filter((l) => !l.is_lead).map((l) => l.user_id)} />
        )}
      </Card>
    </div>
  );
}

function StatusChip({ status }: { status: MatterStatus }) {
  const colour = (status.colour ?? "").trim();
  const hex = colour.startsWith("#");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        hex ? "bg-white" : TONES[colour.toLowerCase()] ?? "border-gray-300 bg-gray-50 text-gray-700",
      )}
      style={hex ? { borderColor: colour, color: colour } : undefined}
    >
      {status.label}
    </span>
  );
}

// ---------------------------------------------------------------- timeline
async function TimelineSection({ ctx, matter, names }: { ctx: StaffContext; matter: MatterDetail; names: Record<string, string> }) {
  const [{ data: updateRows }, courts] = await Promise.all([
    ctx.supabase
      .from("updates")
      .select("id, matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by, created_at")
      .eq("matter_id", matter.id)
      .order("occurred_at", { ascending: false })
      .limit(200),
    courtsFor(ctx.supabase, ctx.firmId),
  ]);

  return (
    <StaffTimeline
      matterId={matter.id}
      firmId={matter.firm_id}
      userId={ctx.userId}
      initial={(updateRows ?? []) as StaffUpdate[]}
      timezone={ctx.timezone}
      courts={courts}
      currentCourtId={matter.court_id}
      currentCourtName={matter.court_name}
      judicialDivision={matter.judicial_division}
      names={names}
    />
  );
}

// ---------------------------------------------------------------- documents
async function DocumentsSection({ ctx, matter, names }: { ctx: StaffContext; matter: MatterDetail; names: Record<string, string> }) {
  const { data: docRows } = await ctx.supabase
    .from("documents")
    .select("id, firm_id, matter_id, appointment_id, name, category, client_visible, current_version_id, uploaded_by, reviewed_at, reviewed_by, created_at")
    .eq("matter_id", matter.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  const docs = (docRows ?? []) as DocumentRow[];

  const { data: versionRows } = docs.length
    ? await ctx.supabase
        .from("document_versions")
        .select("id, document_id, storage_path, mime, size_bytes, uploaded_by, created_at")
        .in("document_id", docs.map((d) => d.id))
    : { data: [] as DocumentVersionRow[] };
  const versions = (versionRows ?? []) as DocumentVersionRow[];

  const documents: StaffDocument[] = docs.map((d) => ({
    ...d,
    version:
      versions.find((v) => v.id === d.current_version_id) ??
      versions.filter((v) => v.document_id === d.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ??
      null,
    version_count: versions.filter((v) => v.document_id === d.id).length,
  }));

  return (
    <StaffDocuments
      firmId={matter.firm_id}
      matterId={matter.id}
      userId={ctx.userId}
      documents={documents}
      timezone={ctx.timezone}
      names={names}
    />
  );
}

// ---------------------------------------------------------------- messages
async function MessagesSection({ ctx, matter, names }: { ctx: StaffContext; matter: MatterDetail; names: Record<string, string> }) {
  const { data } = await ctx.supabase
    .from("messages")
    .select("id, firm_id, matter_id, appointment_id, sender_id, body, attachments, read_at, created_at")
    .eq("matter_id", matter.id)
    .order("created_at", { ascending: true })
    .limit(200);

  return (
    <MessagesThread
      firmId={matter.firm_id}
      matterId={matter.id}
      appointmentId={null}
      userId={ctx.userId}
      initial={(data ?? []) as MessageRow[]}
      timezone={ctx.timezone}
      senderNames={names}
      firmName={ctx.firmName}
    />
  );
}

// ---------------------------------------------------------------- invoices
interface MatterInvoice {
  id: string;
  number: string;
  status: string;
  currency: string;
  subtotal_minor: number;
  vat_minor: number;
  total_minor: number;
  paid_minor: number;
  issued_at: string | null;
  due_at: string | null;
  created_at: string;
}

async function InvoicesSection({
  ctx, matter, basePath, extraQuery,
}: {
  ctx: StaffContext;
  matter: MatterDetail;
  basePath: string;
  extraQuery: string;
}) {
  const { data } = await ctx.supabase
    .from("invoices")
    .select("id, number, status, currency, subtotal_minor, vat_minor, total_minor, paid_minor, issued_at, due_at, created_at")
    .eq("matter_id", matter.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const invoices = (data ?? []) as MatterInvoice[];
  const back = `${basePath}?tab=invoices${extraQuery}`;
  // Keep the firm the staff member is working under; the composer resolves its own
  // context and would otherwise fall back to their first membership.
  const raiseHref = `/firm/invoices/new?matter=${matter.id}${extraQuery}`;

  /** Draft → issued. The client only ever sees issued invoices. */
  const issue = async (formData: FormData) => {
    "use server";
    const invoiceId = String(formData.get("invoiceId") ?? "");
    if (!invoiceId) redirect(`${back}&error=${encodeURIComponent("Unknown invoice.")}`);
    const outcome: unknown = await issueInvoice(invoiceId);
    const refused = refusalMessage(outcome);
    redirect(refused ? `${back}&error=${encodeURIComponent(refused)}` : `${back}&issued=1`);
  };

  // Minor units of naira and minor units of dollars are not the same unit, so a
  // matter billed in both is totalled once per currency rather than added up and
  // labelled with whichever invoice happened to come first.
  const outstandingByCurrency = new Map<string, number>();
  for (const i of invoices) {
    if (i.status === "cancelled" || i.status === "draft") continue;
    const owed = Math.max(0, i.total_minor - i.paid_minor);
    if (owed <= 0) continue;
    outstandingByCurrency.set(i.currency, (outstandingByCurrency.get(i.currency) ?? 0) + owed);
  }
  const outstandingLabel = Array.from(outstandingByCurrency)
    .map(([c, minor]) => formatMoneyMinor(minor, c))
    .join(" · ");
  const fmtDay = (iso: string) => formatWhen(iso, ctx.timezone, { dateStyle: "medium" });
  /** due_at is a DATE, not an instant: render the day it is, not the day it becomes. */
  const fmtCalendarDay = (day: string) => formatWhen(`${day}T00:00:00Z`, "UTC", { dateStyle: "medium" });

  if (invoices.length === 0) {
    return (
      <>
        <CardHeader title="Invoices" />
        <EmptyState
          title="Nothing billed on this matter yet"
          hint="Raise an invoice with your own items and VAT; issue it and the client can pay from their app."
          action={<Link href={raiseHref} className="inline-flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-on hover:opacity-90">Raise an invoice</Link>}
        />
      </>
    );
  }

  return (
    <>
      <CardHeader
        title={outstandingLabel ? `Invoices · ${outstandingLabel} outstanding` : "Invoices"}
        action={<Link href={raiseHref} className="inline-flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-on hover:opacity-90">Raise an invoice</Link>}
      />
      <ul className="divide-y divide-gray-100">
        {invoices.map((inv) => {
          const outstanding = Math.max(0, inv.total_minor - inv.paid_minor);
          const payable = inv.status !== "draft" && inv.status !== "cancelled";
          return (
            <li key={inv.id} className="space-y-2 px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-gray-900">{inv.number}</p>
                <StatusPill status={inv.status as Status} />
              </div>
              <p className="text-sm text-gray-700">
                {formatMoneyMinor(inv.total_minor, inv.currency)}
                {inv.vat_minor > 0 ? ` (incl. ${formatMoneyMinor(inv.vat_minor, inv.currency)} VAT)` : ""}
                {inv.paid_minor > 0 ? ` · ${formatMoneyMinor(inv.paid_minor, inv.currency)} paid` : ""}
                {payable && outstanding > 0 ? ` · ${formatMoneyMinor(outstanding, inv.currency)} outstanding` : ""}
              </p>
              <p className="text-xs text-gray-500">
                {inv.issued_at ? `Issued ${fmtDay(inv.issued_at)}` : `Drafted ${fmtDay(inv.created_at)}`}
                {inv.due_at ? ` · due ${fmtCalendarDay(inv.due_at)}` : ""}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {inv.status === "draft" ? (
                  <form action={issue}>
                    <input type="hidden" name="invoiceId" value={inv.id} />
                    <Button type="submit" size="sm">Issue it</Button>
                  </form>
                ) : payable ? (
                  <CopyButton path={`/app/payments/${inv.id}`} label={outstanding > 0 ? "Copy the pay-by-link" : "Copy the receipt link"} />
                ) : (
                  <p className="text-xs text-gray-500">Cancelled — the record stays on the file.</p>
                )}
                {inv.status === "draft" && (
                  <p className="text-xs text-gray-500">A draft is invisible to your client until it is issued.</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------- counsel
async function CounselSection({ ctx, matter }: { ctx: StaffContext; matter: MatterDetail }) {
  const [{ data: counselRows }, { data: directoryRows }, { data: docRows }] = await Promise.all([
    ctx.supabase
      .from("matter_counsel")
      .select("id, firm_id, matter_id, side, party_name, party_side, counsel_firm_id, counsel_name, counsel_firm_name, scn, email, phone, address_for_service, on_record, accepts_service, note, created_at")
      .eq("matter_id", matter.id)
      .order("created_at", { ascending: true }),
    ctx.supabase
      .from("firm_service_directory")
      .select("id, slug, name, legal_name, state_code, accepts_platform_service, address_for_service")
      .order("name", { ascending: true })
      .limit(500),
    ctx.supabase
      .from("documents")
      .select("id, name, current_version_id")
      .eq("matter_id", matter.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  return (
    <CounselRoster
      matterId={matter.id}
      firmId={matter.firm_id}
      counsel={(counselRows ?? []) as MatterCounselRow[]}
      directory={((directoryRows ?? []) as ServiceDirectoryRow[]).filter((f) => f.id !== matter.firm_id)}
      documents={(docRows ?? []) as Array<{ id: string; name: string; current_version_id: string | null }>}
      timezone={ctx.timezone}
    />
  );
}

// ---------------------------------------------------------------- parties
async function PartiesSection({
  ctx, matter, parties, profiles,
}: {
  ctx: StaffContext;
  matter: MatterDetail;
  parties: Array<{ user_id: string; role: string; can_view_docs: boolean; can_pay: boolean }>;
  profiles: Array<{ id: string; full_name: string | null; phone: string | null; email: string | null }>;
}) {
  const { data: inviteRows } = await ctx.supabase
    .from("invites")
    .select("id, phone, email, role, token, expires_at, created_at")
    .eq("matter_id", matter.id)
    .is("accepted_by", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const rows: MatterPartyRow[] = parties.map((p) => ({
    user_id: p.user_id,
    role: p.role,
    full_name: profileById.get(p.user_id)?.full_name ?? null,
    phone: profileById.get(p.user_id)?.phone ?? null,
    email: profileById.get(p.user_id)?.email ?? null,
    can_view_docs: p.can_view_docs,
    can_pay: p.can_pay,
  }));

  return (
    <PartiesPanel
      matterId={matter.id}
      matterReference={matter.reference}
      matterTitle={matter.cause_title ?? matter.title}
      firmName={ctx.firmName}
      parties={rows}
      invites={(inviteRows ?? []) as PendingInvite[]}
      timezone={ctx.timezone}
    />
  );
}

// ---------------------------------------------------------------- tasks
async function TasksSection({
  ctx, matter, staffOptions,
}: {
  ctx: StaffContext;
  matter: MatterDetail;
  staffOptions: Array<{ id: string; label: string }>;
}) {
  const { data } = await ctx.supabase
    .from("tasks")
    .select("id, firm_id, matter_id, assignee_id, title, due_at, status, created_at")
    .eq("matter_id", matter.id)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(200);

  return (
    <TasksPanel
      firmId={matter.firm_id}
      matterId={matter.id}
      tasks={(data ?? []) as TaskRow[]}
      staff={staffOptions}
      timezone={ctx.timezone}
    />
  );
}

// ---------------------------------------------------------------- the file itself
async function EditSection({
  ctx, matter, statuses, staffOptions, leadLawyerId, alsoOn,
}: {
  ctx: StaffContext;
  matter: MatterDetail;
  statuses: MatterStatus[];
  staffOptions: Array<{ id: string; label: string }>;
  leadLawyerId: string;
  alsoOn: string[];
}) {
  const courts = await courtsFor(ctx.supabase, ctx.firmId);
  return (
    <EditPanel
      matterId={matter.id}
      firmId={matter.firm_id}
      timezone={ctx.timezone}
      statuses={statuses}
      courts={courts}
      staff={staffOptions}
      initial={{
        reference: matter.reference,
        title: matter.title,
        causeTitle: matter.cause_title ?? "",
        description: matter.description ?? "",
        nextAction: matter.next_action ?? "",
        statusId: matter.status_id ?? "",
        courtId: matter.court_id,
        courtName: matter.court_name ?? "",
        suitNumber: matter.suit_number ?? "",
        judicialDivision: matter.judicial_division ?? "",
        handlingLawyerId: matter.handling_lawyer_id ?? "",
        originatingLawyerId: matter.originating_lawyer_id ?? "",
        leadLawyerId,
        alsoOn,
        closedAt: matter.closed_at,
      }}
    />
  );
}
