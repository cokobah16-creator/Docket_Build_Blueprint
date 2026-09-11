import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { clientTimezone } from "@/lib/portal-data";
import { formatDay } from "@/lib/days";
import { formatMoneyMinor } from "@/lib/money";
import { startInvoicePayment } from "@/lib/actions/portal";
import { Card } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Timeline } from "@/components/portal/timeline";
import { DocumentsTab, type DocumentWithVersion } from "@/components/portal/documents-tab";
import { MessagesThread } from "@/components/portal/messages-thread";
import { Screen, ScreenHeader } from "@/components/portal/screen";
import { cn } from "@/lib/cn";
import type { DocumentRow, DocumentVersionRow, MatterRow, MatterStatus, MessageRow, UpdateRow } from "@/lib/db/types";

export const metadata = { title: "Matter" };

type Tab = "timeline" | "documents" | "messages" | "invoices";
const TABS: Array<[Tab, string]> = [["timeline", "Timeline"], ["documents", "Documents"], ["messages", "Messages"], ["invoices", "Invoices"]];

export default async function MatterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; error?: string }> }) {
  const { id } = await params;
  const { tab: rawTab, error: actionError } = await searchParams;
  const tab: Tab = (TABS.map((t) => t[0]) as string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "timeline";
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  const { data } = await supabase
    .from("matters")
    .select("id, firm_id, reference, title, type, status_id, description, next_action, next_action_due, court_name, suit_number, next_event_at, next_event_note, opened_at, closed_at")
    .eq("id", id)
    .maybeSingle();
  const matter = (data ?? null) as MatterRow | null;
  if (!matter) notFound();

  const [firm, tz, { data: statusRow }, { data: lawyerRows }] = await Promise.all([
    firmById(matter.firm_id),
    clientTimezone(supabase, user.id),
    matter.status_id ? supabase.from("matter_statuses").select("id, firm_id, key, label, colour, is_terminal").eq("id", matter.status_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("matter_lawyers").select("user_id, is_lead").eq("matter_id", matter.id),
  ]);
  const status = statusRow as MatterStatus | null;
  const lawyerIds = ((lawyerRows ?? []) as Array<{ user_id: string }>).map((l) => l.user_id);
  const { data: lawyerPublic } = lawyerIds.length ? await supabase.from("lawyer_public").select("id, full_name, title").in("id", lawyerIds) : { data: [] };
  const lawyers = (lawyerPublic ?? []) as Array<{ id: string; full_name: string | null; title: string | null }>;
  const senderNames = Object.fromEntries(lawyers.map((l) => [l.id, l.full_name ?? l.title ?? firm?.name ?? "Your lawyer"]));
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz });

  return (
    <>
      <ScreenHeader back="/app/matters" backLabel="Back to matters" title={matter.reference} titleAs="mono" />
      <Screen>
        <header>
          <h1 className="font-heading text-[22px] font-semibold leading-tight tracking-[-0.015em] text-brand">{matter.title}</h1>
          <p className="mt-1 text-[13px] text-gray-600">{firm?.name ?? "Your firm"}{lawyers.length ? ` · ${lawyers.map((l) => l.full_name ?? l.title).join(", ")}` : ""}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
            {status && <span className="rounded-full border px-2.5 py-0.5 font-semibold" style={status.colour ? { borderColor: status.colour, color: status.colour } : undefined}>{status.label}</span>}
            {matter.court_name && <span>{matter.court_name}{matter.suit_number ? <> · <span className="font-mono">{matter.suit_number}</span></> : null}</span>}
          </div>
          {matter.next_event_at && <p className="mt-2 text-[13px] text-gray-800">Next court date: <strong>{fmt.format(new Date(matter.next_event_at))}</strong>{matter.next_event_note ? ` · ${matter.next_event_note}` : ""}</p>}
          {matter.next_action && (
            <p className="mt-1 text-[13px] font-semibold text-brand">
              Next action: {matter.next_action}
              {matter.next_action_due && <span className="font-normal text-gray-600"> · by {formatDay(matter.next_action_due)}</span>}
            </p>
          )}
        </header>

        {actionError && <Alert kind="error">{actionError}</Alert>}

        <nav aria-label="Matter sections" className="-mx-4 flex gap-2 overflow-x-auto px-4">
          {TABS.map(([key, label]) => (
            <Link key={key} href={`/app/matters/${matter.id}?tab=${key}`} aria-current={tab === key ? "page" : undefined}
              className={cn("flex min-h-10 shrink-0 items-center rounded-full border px-3.5 text-[12.5px] font-medium", tab === key ? "border-brand bg-brand text-brand-on" : "border-gray-300 bg-white text-gray-700")}>
              {label}
            </Link>
          ))}
        </nav>

        <Card>
          {tab === "timeline" && <TimelineTab supabase={supabase} matterId={matter.id} tz={tz} />}
          {tab === "documents" && <DocumentsSection supabase={supabase} matter={matter} tz={tz} />}
          {tab === "messages" && <MessagesSection supabase={supabase} matter={matter} userId={user.id} tz={tz} senderNames={senderNames} firmName={firm?.name ?? "Your firm"} />}
          {tab === "invoices" && <InvoicesSection supabase={supabase} matterId={matter.id} tz={tz} />}
        </Card>
      </Screen>
    </>
  );
}

type SB = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

async function TimelineTab({ supabase, matterId, tz }: { supabase: SB; matterId: string; tz: string }) {
  const { data } = await supabase
    .from("updates")
    .select("id, matter_id, firm_id, kind, title, body, payload, occurred_at, created_at")
    .eq("matter_id", matterId)
    .order("occurred_at", { ascending: false })
    .limit(100);
  return <Timeline matterId={matterId} initial={(data ?? []) as UpdateRow[]} timezone={tz} />;
}

async function DocumentsSection({ supabase, matter, tz }: { supabase: SB; matter: MatterRow; tz: string }) {
  const { data: docRows } = await supabase
    .from("documents")
    .select("id, firm_id, matter_id, appointment_id, name, category, client_visible, current_version_id, uploaded_by, reviewed_at, reviewed_by, created_at")
    .eq("matter_id", matter.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  const docs = (docRows ?? []) as DocumentRow[];
  const { data: versionRows } = docs.length
    ? await supabase.from("document_versions").select("id, document_id, storage_path, mime, size_bytes, uploaded_by, created_at").in("document_id", docs.map((d) => d.id))
    : { data: [] };
  const versions = (versionRows ?? []) as DocumentVersionRow[];
  const withVersion: DocumentWithVersion[] = docs.map((d) => ({
    ...d,
    version: versions.find((v) => v.id === d.current_version_id) ?? versions.filter((v) => v.document_id === d.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null,
    version_count: versions.filter((v) => v.document_id === d.id).length,
  }));
  return <DocumentsTab firmId={matter.firm_id} matterId={matter.id} appointmentId={null} documents={withVersion} timezone={tz} />;
}

async function MessagesSection({ supabase, matter, userId, tz, senderNames, firmName }: { supabase: SB; matter: MatterRow; userId: string; tz: string; senderNames: Record<string, string>; firmName: string }) {
  const { data } = await supabase
    .from("messages")
    .select("id, firm_id, matter_id, appointment_id, sender_id, body, attachments, read_at, created_at")
    .eq("matter_id", matter.id)
    .order("created_at", { ascending: true })
    .limit(200);
  return <MessagesThread firmId={matter.firm_id} matterId={matter.id} appointmentId={null} userId={userId} initial={(data ?? []) as MessageRow[]} timezone={tz} senderNames={senderNames} firmName={firmName} />;
}

async function InvoicesSection({ supabase, matterId, tz }: { supabase: SB; matterId: string; tz: string }) {
  const { data } = await supabase
    .from("invoices")
    .select("id, number, status, currency, total_minor, paid_minor, issued_at, due_at")
    .eq("matter_id", matterId)
    .order("issued_at", { ascending: false });
  const invoices = (data ?? []) as Array<{ id: string; number: string; status: string; currency: string; total_minor: number; paid_minor: number; issued_at: string | null; due_at: string | null }>;
  if (invoices.length === 0) return <p className="px-5 py-8 text-center text-sm text-gray-500">No invoices on this matter.</p>;
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: tz });
  return (
    <ul className="divide-y divide-gray-100">
      {invoices.map((inv) => {
        const outstanding = Math.max(0, inv.total_minor - inv.paid_minor);
        const payable = ["issued", "partially_paid", "overdue"].includes(inv.status) && outstanding > 0;
        const invoiceId = inv.id;
        const pay = async () => {
          "use server";
          const r = await startInvoicePayment(invoiceId);
          if (r?.error) redirect(`/app/matters/${matterId}?tab=invoices&error=${encodeURIComponent(r.error)}`);
        };
        return (
          <li key={inv.id} className="flex items-center justify-between gap-3 px-5 py-4">
            <div>
              <Link href={`/app/payments/${inv.id}`} className="text-sm font-medium text-gray-900 underline">{inv.number}</Link>
              <p className="text-xs text-gray-500">
                {formatMoneyMinor(inv.total_minor, inv.currency)}{inv.paid_minor > 0 && inv.paid_minor < inv.total_minor ? ` · ${formatMoneyMinor(inv.paid_minor, inv.currency)} paid` : ""}
                {inv.due_at ? ` · due ${fmt.format(new Date(inv.due_at))}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill status={inv.status as Status} />
              {payable && <form action={pay}><button type="submit" className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-on hover:opacity-90">Pay {formatMoneyMinor(outstanding, inv.currency)}</button></form>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
