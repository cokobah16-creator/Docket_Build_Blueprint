// Service inbox: court processes served on this firm through Docket, and those it
// served. The service_inbox view is the served firm's only read path — it carries
// the process, the document and its checksum, and nothing else about the other
// firm's matter (never its notes, never a later version of the document).
//
// Slice 4 adds the two things a chambers actually does with a process that has
// landed: file it against one of our own matters with the date the response falls
// due (link_service_to_matter — an INTERNAL entry on our matter, invisible to the
// firm that served it), and, on the other side, withdraw a process served in error
// (revoke_service — owner or admin of the serving firm only). The response diary
// at the top is the same data, ordered by what is due first, overdue in red.
//
// Rules enforced here: the database is the authorization layer — every read and
// write runs as the signed-in staff member and its refusals are shown verbatim;
// timestamps are UTC in the database and rendered in the viewer's zone; nothing
// is firm-specific, the firm comes from context.

import Link from "next/link";
import { staffContext, requestedFirmId, firmMatters } from "@/lib/firm-data";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { formatWhen, zonedDayRange } from "@/lib/time";
import type { ServiceInboxRow } from "@/lib/db/types";
import { AcknowledgeButton } from "./acknowledge-button";
import { FileServiceForm, OpenProcessButton, RevokeServiceForm, type FileableMatter } from "./inbox-actions";

export const metadata = { title: "Service inbox" };

/** A date column is a calendar day, not an instant: render it as the day it is. */
function dayLabel(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
}

function fileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function ServiceInboxPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const params = await searchParams;
  const ctx = await staffContext(await requestedFirmId(params));

  if (!ctx) {
    return (
      <div className="space-y-5">
        <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Service inbox</h1>
        <Alert kind="warning" title="Nothing to show yet">
          This account is not a member of a firm on Docket, so no process can have been served on it.
        </Alert>
      </div>
    );
  }

  const { supabase, timezone } = ctx;
  const myFirmIds = new Set(ctx.memberships.map((m) => m.firm_id));
  const adminFirmIds = new Set(
    ctx.memberships.filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.firm_id),
  );

  const [{ data: inbox }, { data: directory }] = await Promise.all([
    supabase.from("service_inbox").select("*").order("served_at", { ascending: false }).limit(100),
    supabase.from("firm_service_directory").select("id, name"),
  ]);
  const rows = (inbox ?? []) as ServiceInboxRow[];
  const firmNames = new Map<string, string>(
    ((directory ?? []) as Array<{ id: string; name: string }>).map((f): [string, string] => [f.id, f.name]),
  );
  const firmName = (id: string) => firmNames.get(id) ?? "a firm on Docket";

  const received = rows.filter((r) => myFirmIds.has(r.served_firm_id));
  const sent = rows.filter((r) => myFirmIds.has(r.serving_firm_id) && !myFirmIds.has(r.served_firm_id));

  // The matters a received process can be filed against belong to the firm it was
  // served on — which is one of ours, but not always the one currently in view.
  const servedFirmIds = Array.from(new Set(received.map((r) => r.served_firm_id)));
  const matterLists = await Promise.all(servedFirmIds.map((id) => firmMatters(supabase, id, { limit: 200 })));
  const mattersByFirm = new Map<string, FileableMatter[]>(
    servedFirmIds.map((id, i): [string, FileableMatter[]] => [
      id,
      matterLists[i].map((m) => ({ id: m.id, reference: m.reference, title: m.title, closed: Boolean(m.closed_at) })),
    ]),
  );
  const matterLabels = new Map<string, string>(
    matterLists.flat().map((m): [string, string] => [m.id, `${m.reference} · ${m.title}`]),
  );

  const { ymd: today } = zonedDayRange(timezone);
  const fmt = (iso: string) => formatWhen(iso, timezone);
  const diary = received
    .filter((r) => r.response_due_on)
    .sort((a, b) => (a.response_due_on ?? "").localeCompare(b.response_due_on ?? ""));
  const unfiled = received.filter((r) => !r.recipient_matter_id);

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Service inbox</h1>
      <p className="text-sm text-gray-600">
        Processes served on {myFirmIds.size > 1 ? "your firms" : ctx.firmName} through Docket, and the ones
        they served. Times in {timezone}.
      </p>

      <Card>
        <CardHeader title="Response diary" />
        {diary.length === 0 ? (
          <EmptyState
            title="Nothing is diarised"
            hint={
              unfiled.length > 0
                ? `${unfiled.length} process${unfiled.length === 1 ? "" : "es"} served on you ${unfiled.length === 1 ? "has" : "have"} not been filed yet. File one below with the date your response falls due and it appears here.`
                : "When you file a process into one of your matters with a response date, it appears here — first due, first listed."
            }
          />
        ) : (
          <CardBody className="p-0">
            <ul className="divide-y divide-gray-100">
              {diary.map((r) => {
                const due = r.response_due_on as string;
                const overdue = due < today;
                const dueToday = due === today;
                return (
                  <li key={`diary-${r.id}`} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{r.process_title}</p>
                      <p className="text-xs text-gray-500">
                        {r.recipient_matter_id ? matterLabels.get(r.recipient_matter_id) ?? "one of your matters" : "not filed against a matter"}
                        {" · from "}{firmName(r.serving_firm_id)}
                      </p>
                    </div>
                    <p className={overdue ? "text-sm font-semibold text-red-700" : dueToday ? "text-sm font-semibold text-amber-800" : "text-sm text-gray-700"}>
                      {overdue ? "Overdue — was due " : dueToday ? "Due today, " : "Due "}
                      {dayLabel(due)}
                    </p>
                  </li>
                );
              })}
            </ul>
            {unfiled.length > 0 && (
              <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
                {unfiled.length} process{unfiled.length === 1 ? "" : "es"} below {unfiled.length === 1 ? "has" : "have"} not been filed against a matter yet.
              </p>
            )}
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Served on your firm" />
        {received.length === 0 ? (
          <EmptyState
            title="Nothing served on you through Docket"
            hint="Processes served by other firms on Docket appear here for acknowledgement, filing and your response date."
            action={<Link href="/firm/matters" className="text-sm font-medium text-brand underline">Open your matters</Link>}
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {received.map((r) => {
              const due = r.response_due_on;
              const overdue = Boolean(due && due < today);
              const matters = mattersByFirm.get(r.served_firm_id) ?? [];
              return (
                <li key={r.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-gray-900">
                      {r.process_title}
                      {r.is_originating && <Badge className="ml-2">originating</Badge>}
                      {r.substituted_by_order && <Badge className="ml-2">substituted service</Badge>}
                    </p>
                    <p className="text-sm text-gray-500">{fmt(r.served_at)}</p>
                  </div>
                  <p className="text-sm text-gray-700">
                    {r.case_title ?? "—"}{r.suit_number ? ` · ${r.suit_number}` : ""}{r.court_name ? ` · ${r.court_name}` : ""}
                    {r.served_for_party ? ` · for ${r.served_for_party}` : ""}
                  </p>
                  <p className="text-sm text-gray-500">
                    From {firmName(r.serving_firm_id)} · served by {r.served_by_name ?? "counsel"}
                    {r.served_by_scn ? ` (${r.served_by_scn})` : ""}
                    {r.served_on_name ? ` · served on ${r.served_on_name}` : ""}
                    {r.deemed_served_on ? ` · deemed served ${dayLabel(r.deemed_served_on)}` : ""}
                  </p>
                  <p className="text-sm text-gray-500">
                    {r.document_name}
                    {r.document_size_bytes ? ` · ${fileSize(r.document_size_bytes)}` : ""}
                    {r.checksum ? ` · ${r.checksum}` : ""}
                  </p>
                  <OpenProcessButton versionId={r.document_version_id} documentName={r.document_name} />

                  {r.recipient_matter_id ? (
                    <p className="text-sm">
                      <span className="text-gray-700">
                        Filed against {matterLabels.get(r.recipient_matter_id) ?? "one of your matters"}
                      </span>
                      {due ? (
                        <span className={overdue ? "font-semibold text-red-700" : "text-gray-700"}>
                          {" · "}{overdue ? "response was due " : "response due "}{dayLabel(due)}
                        </span>
                      ) : (
                        <span className="text-gray-500">{" · no response date set"}</span>
                      )}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-500">Not filed against a matter yet.</p>
                  )}

                  <FileServiceForm
                    serviceId={r.id}
                    matters={matters}
                    filedMatterId={r.recipient_matter_id}
                    responseDueOn={r.response_due_on}
                  />

                  {r.acknowledged_at ? (
                    <p className="text-sm text-green-800">
                      Acknowledged {fmt(r.acknowledged_at)}{r.acknowledged_by_name ? ` by ${r.acknowledged_by_name}` : ""}
                    </p>
                  ) : (
                    <AcknowledgeButton serviceId={r.id} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Served by your firm through Docket" />
        {sent.length === 0 ? (
          <EmptyState
            title="No platform service yet"
            hint="Record counsel on a matter and serve a process; acknowledgements show here."
            action={<Link href="/firm/matters" className="text-sm font-medium text-brand underline">Go to a matter</Link>}
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {sent.map((r) => (
              <li key={r.id} className="space-y-2 px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      {r.process_title}
                      {r.is_originating && <Badge className="ml-2">originating</Badge>}
                    </p>
                    <p className="text-sm text-gray-600">
                      {r.case_title ?? "—"}{r.suit_number ? ` · ${r.suit_number}` : ""}
                      {r.served_for_party ? ` · served for ${r.served_for_party}` : ""}
                    </p>
                    <p className="text-sm text-gray-500">On {firmName(r.served_firm_id)}</p>
                  </div>
                  <p className="text-sm text-gray-500">
                    {fmt(r.served_at)} · {r.acknowledged_at ? `acknowledged ${fmt(r.acknowledged_at)}` : "awaiting acknowledgement"}
                    {r.acknowledged_by_name ? ` by ${r.acknowledged_by_name}` : ""}
                  </p>
                </div>
                {adminFirmIds.has(r.serving_firm_id) ? (
                  <RevokeServiceForm serviceId={r.id} />
                ) : (
                  <p className="text-xs text-gray-500">
                    Served in error? An owner or admin of your firm can withdraw it — the database allows nobody else.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
