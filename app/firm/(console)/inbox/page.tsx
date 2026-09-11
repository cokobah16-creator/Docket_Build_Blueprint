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

import type { ReactNode } from "react";
import { staffContext, requestedFirmId, firmMatters } from "@/lib/firm-data";
import { Alert } from "@/components/ui/alert";
import {
  AppCard,
  AppCardHeader,
  AppCardList,
  AppEmpty,
  AppLink,
  AppPill,
  Footnote,
  ScreenTitle,
} from "@/components/app";
import { DocumentIcon, ShieldIcon } from "@/components/ui/icons";
import { formatWhen, zonedDayRange } from "@/lib/time";
import { cn } from "@/lib/cn";
import type { ServiceInboxRow } from "@/lib/db/types";
import { AcknowledgeButton } from "./acknowledge-button";
import { FileServiceForm, OpenProcessButton, RevokeServiceForm, type FileableMatter } from "./inbox-actions";

export const metadata = { title: "Service inbox" };

/** The quiet grey chip that marks a process as originating or substituted. */
function MetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="ml-2 inline-flex flex-none items-center rounded-full bg-dk-rule px-2 py-px align-middle text-[10px] font-bold uppercase tracking-[0.03em] text-dk-soft">
      {children}
    </span>
  );
}

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
      <div className="dk-rise flex flex-col gap-3.5">
        <ScreenTitle>Service inbox</ScreenTitle>
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
    <div className="dk-rise flex flex-col gap-3.5">
      <header>
        <ScreenTitle>Service inbox</ScreenTitle>
        <p className="mt-[3px] text-[12.5px] leading-snug text-dk-soft">
          Processes served on {myFirmIds.size > 1 ? "your firms" : ctx.firmName} through Docket, and the ones
          they served. Times in {timezone}.
        </p>
      </header>

      {/* This screen is evidence: a served process and its acknowledgement are
          what an affidavit of service is built on, so every timestamp, name and
          checksum below is kept, spelled out, and left legible. */}
      <AppCard>
        <AppCardHeader title="Response diary" />
        {diary.length === 0 ? (
          <AppEmpty
            title="Nothing is diarised"
            hint={
              unfiled.length > 0
                ? `${unfiled.length} process${unfiled.length === 1 ? "" : "es"} served on you ${unfiled.length === 1 ? "has" : "have"} not been filed yet. File one below with the date your response falls due and it appears here.`
                : "When you file a process into one of your matters with a response date, it appears here — first due, first listed."
            }
          />
        ) : (
          <>
            <AppCardList>
              {diary.map((r) => {
                const due = r.response_due_on as string;
                const overdue = due < today;
                const dueToday = due === today;
                return (
                  <div key={`diary-${r.id}`} className="flex items-start justify-between gap-3 px-[15px] py-[13px]">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">{r.process_title}</p>
                      <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-soft">
                        {r.recipient_matter_id ? matterLabels.get(r.recipient_matter_id) ?? "one of your matters" : "not filed against a matter"}
                        {" · from "}{firmName(r.serving_firm_id)}
                      </p>
                    </div>
                    {/* Late and due-today carry the console's two inks, and both
                        say which they are in words. */}
                    <p
                      className={cn(
                        "flex-none text-right text-[11.5px] leading-[1.4]",
                        overdue
                          ? "font-semibold text-[#B42318]"
                          : dueToday
                            ? "font-semibold text-[#92400E]"
                            : "text-dk-soft",
                      )}
                    >
                      {overdue ? "Overdue — was due " : dueToday ? "Due today, " : "Due "}
                      {dayLabel(due)}
                    </p>
                  </div>
                );
              })}
            </AppCardList>
            {unfiled.length > 0 && (
              <div className="border-t border-dk-rule px-[17px] py-[13px]">
                <Footnote>
                  {unfiled.length} process{unfiled.length === 1 ? "" : "es"} below {unfiled.length === 1 ? "has" : "have"} not been filed against a matter yet.
                </Footnote>
              </div>
            )}
          </>
        )}
      </AppCard>

      <AppCard>
        <AppCardHeader title={`Served on your firm (${received.length})`} />
        {received.length === 0 ? (
          <AppEmpty
            title="Nothing served on you through Docket"
            hint="Processes served by other firms on Docket appear here for acknowledgement, filing and your response date."
            action={<AppLink href="/firm/matters">Open your matters</AppLink>}
          />
        ) : (
          <AppCardList>
            {received.map((r) => {
              const due = r.response_due_on;
              const overdue = Boolean(due && due < today);
              const matters = mattersByFirm.get(r.served_firm_id) ?? [];
              return (
                <div key={r.id} className="flex flex-col gap-2 px-[15px] py-[15px]">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-[14px] font-bold leading-[1.35] text-dk-strong">
                      {r.process_title}
                      {r.is_originating && <MetaChip>originating</MetaChip>}
                      {r.substituted_by_order && <MetaChip>substituted service</MetaChip>}
                    </p>
                    {/* When it was served. The instant is the evidence, so it is
                        kept in full rather than shortened to "2 days ago". */}
                    <p className="flex-none text-right text-[11.5px] leading-[1.4] text-dk-soft">{fmt(r.served_at)}</p>
                  </div>

                  <p className="text-[12.5px] leading-[1.45] text-dk-body">
                    {r.case_title ?? "—"}{r.suit_number ? ` · ${r.suit_number}` : ""}{r.court_name ? ` · ${r.court_name}` : ""}
                    {r.served_for_party ? ` · for ${r.served_for_party}` : ""}
                  </p>

                  {/* Who served it, on whom, and when it is deemed served: the
                      names an affidavit of service is sworn on. */}
                  <p className="text-[11.5px] leading-[1.5] text-dk-soft">
                    From {firmName(r.serving_firm_id)} · served by {r.served_by_name ?? "counsel"}
                    {r.served_by_scn ? ` (${r.served_by_scn})` : ""}
                    {r.served_on_name ? ` · served on ${r.served_on_name}` : ""}
                    {r.deemed_served_on ? ` · deemed served ${dayLabel(r.deemed_served_on)}` : ""}
                  </p>

                  {/* The document and its checksum. The checksum is what proves
                      the copy you opened is the copy that was served, so it gets
                      its own line, monospaced and unabridged. */}
                  <div className="rounded-[9px] border border-dk-line bg-dk-tint px-3 py-2.5">
                    <p className="flex items-start gap-2 text-[12.5px] font-semibold leading-[1.4] text-dk-strong">
                      <DocumentIcon size={15} className="mt-px flex-none text-dk-soft" />
                      <span className="min-w-0 break-all">
                        {r.document_name}
                        {r.document_size_bytes ? ` · ${fileSize(r.document_size_bytes)}` : ""}
                      </span>
                    </p>
                    {r.checksum && (
                      <p className="mt-1.5 flex items-start gap-2 text-[11px] leading-[1.45] text-dk-soft">
                        <ShieldIcon size={13} className="mt-px flex-none" />
                        <span className="min-w-0">
                          <span className="font-semibold">Checksum</span>{" "}
                          <span className="break-all font-mono text-dk-body">{r.checksum}</span>
                        </span>
                      </p>
                    )}
                  </div>

                  <OpenProcessButton versionId={r.document_version_id} documentName={r.document_name} />

                  {r.recipient_matter_id ? (
                    <p className="text-[12.5px] leading-[1.45]">
                      <span className="text-dk-body">
                        Filed against {matterLabels.get(r.recipient_matter_id) ?? "one of your matters"}
                      </span>
                      {due ? (
                        <span className={overdue ? "font-semibold text-[#B42318]" : "text-dk-body"}>
                          {" · "}{overdue ? "response was due " : "response due "}{dayLabel(due)}
                        </span>
                      ) : (
                        <span className="text-dk-muted">{" · no response date set"}</span>
                      )}
                    </p>
                  ) : (
                    <p className="text-[12.5px] leading-[1.45] text-dk-muted">Not filed against a matter yet.</p>
                  )}

                  <FileServiceForm
                    serviceId={r.id}
                    matters={matters}
                    filedMatterId={r.recipient_matter_id}
                    responseDueOn={r.response_due_on}
                  />

                  {r.acknowledged_at ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <AppPill kind="confirmed">Acknowledged</AppPill>
                      <span className="text-[11.5px] leading-[1.4] text-dk-soft">
                        {fmt(r.acknowledged_at)}{r.acknowledged_by_name ? ` by ${r.acknowledged_by_name}` : ""}
                      </span>
                    </div>
                  ) : (
                    <AcknowledgeButton serviceId={r.id} />
                  )}
                </div>
              );
            })}
          </AppCardList>
        )}
      </AppCard>

      <AppCard>
        <AppCardHeader title={`Served by your firm through Docket (${sent.length})`} />
        {sent.length === 0 ? (
          <AppEmpty
            title="No platform service yet"
            hint="Record counsel on a matter and serve a process; acknowledgements show here."
            action={<AppLink href="/firm/matters">Go to a matter</AppLink>}
          />
        ) : (
          <AppCardList>
            {sent.map((r) => (
              <div key={r.id} className="flex flex-col gap-2 px-[15px] py-[15px]">
                <div className="min-w-0">
                  <p className="text-[14px] font-bold leading-[1.35] text-dk-strong">
                    {r.process_title}
                    {r.is_originating && <MetaChip>originating</MetaChip>}
                  </p>
                  <p className="mt-[3px] text-[12.5px] leading-[1.45] text-dk-body">
                    {r.case_title ?? "—"}{r.suit_number ? ` · ${r.suit_number}` : ""}
                    {r.served_for_party ? ` · served for ${r.served_for_party}` : ""}
                  </p>
                  <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-soft">On {firmName(r.served_firm_id)}</p>
                </div>

                {/* Served at, and acknowledged at — the pair an affidavit of
                    service needs. Waiting on the other firm is the console's
                    amber, and the pill says "awaiting" as well. */}
                <div className="flex flex-wrap items-center gap-2">
                  <AppPill kind={r.acknowledged_at ? "confirmed" : "awaiting"}>
                    {r.acknowledged_at ? "Acknowledged" : "Awaiting acknowledgement"}
                  </AppPill>
                  <span className="text-[11.5px] leading-[1.4] text-dk-soft">
                    Served {fmt(r.served_at)}
                    {r.acknowledged_at ? ` · acknowledged ${fmt(r.acknowledged_at)}` : ""}
                    {r.acknowledged_by_name ? ` by ${r.acknowledged_by_name}` : ""}
                  </span>
                </div>

                {adminFirmIds.has(r.serving_firm_id) ? (
                  <RevokeServiceForm serviceId={r.id} />
                ) : (
                  <Footnote>
                    Served in error? An owner or admin of your firm can withdraw it — the database allows nobody else.
                  </Footnote>
                )}
              </div>
            ))}
          </AppCardList>
        )}
      </AppCard>
    </div>
  );
}
