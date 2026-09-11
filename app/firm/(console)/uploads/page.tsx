// What clients have sent in that nobody has looked at yet, oldest first.
//
// firm_overview counts these and Today showed the number with a link to the matters list, where
// nothing said which matter. This is the destination: each row names the client and the matter,
// says how long it has waited, opens at the document itself on the matter's Documents tab, and
// can be marked as reviewed here — the mark the client sees as "Seen by your firm".

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, EmptyState } from "@/components/ui/card";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import { relativeLabel } from "@/lib/relative";
import type { DocumentRow } from "@/lib/db/types";
import { ReviewButton } from "./review-button";

export const metadata = { title: "Uploads to review" };

const LIMIT = 100;

export default async function FirmUploads({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));
  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
      </Alert>
    );
  }
  const { supabase, firmId, timezone: tz } = ctx;

  const { data, error } = await supabase
    .from("documents")
    .select("id, firm_id, matter_id, appointment_id, name, category, client_visible, current_version_id, uploaded_by, reviewed_at, reviewed_by, created_at")
    .eq("firm_id", firmId)
    .eq("category", "client_upload")
    .is("reviewed_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(LIMIT);
  const docs = (data ?? []) as DocumentRow[];

  const matterIds = Array.from(new Set(docs.map((d) => d.matter_id).filter((x): x is string => Boolean(x))));
  const uploaderIds = Array.from(new Set(docs.map((d) => d.uploaded_by).filter((x): x is string => Boolean(x))));
  const matters = matterIds.length
    ? (((await supabase.from("matters").select("id, title").in("id", matterIds)).data ?? []) as Array<{ id: string; title: string }>)
    : [];
  const people = uploaderIds.length
    ? (((await supabase.from("profiles").select("id, full_name").in("id", uploaderIds)).data ?? []) as Array<{ id: string; full_name: string | null }>)
    : [];
  const matterTitle = new Map(matters.map((m) => [m.id, m.title]));
  const personName = new Map(people.map((p) => [p.id, p.full_name ?? "A client"]));
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz });
  const nowMs = Date.now();
  const target = (d: DocumentRow) =>
    d.matter_id ? `/firm/matters/${d.matter_id}?tab=documents#doc-${d.id}` : `/firm/appointments/${d.appointment_id}`;

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Uploads to review</h1>
        <p className="mt-0.5 text-[12.5px] text-[#57534E]">
          {ctx.firmName} · {docs.length === 0 ? "nothing waiting" : `${docs.length}${docs.length === LIMIT ? "+" : ""} waiting, oldest first`}
        </p>
      </div>

      {error && <Alert kind="error" title="This screen could not read the uploads">{error.message}</Alert>}

      <Card>
        {docs.length === 0 ? (
          <EmptyState title="Every upload has been looked at" hint="When a client sends a document in, it appears here until someone marks it as reviewed." />
        ) : (
          <ul>
            {docs.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 border-t border-[#F0EEEA] px-[15px] py-3.5 first:border-t-0">
                <span className="min-w-0">
                  <Link href={target(d)} className="block truncate text-[13.5px] font-semibold text-[#141414] underline underline-offset-2">{d.name}</Link>
                  <span className="mt-0.5 block truncate text-[12.5px] text-[#57534E]">
                    From {d.uploaded_by ? personName.get(d.uploaded_by) ?? "a client" : "a client"}
                    {d.matter_id && <> · {matterTitle.get(d.matter_id) ?? "a matter"}</>}
                  </span>
                  <span className="mt-1 block text-[11.5px] text-[#92400E]">
                    Waiting {relativeLabel(d.created_at, nowMs).replace(/^just now$/, "since just now")} · {fmt.format(new Date(d.created_at))}
                  </span>
                </span>
                <ReviewButton documentId={d.id} userId={ctx.userId} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
