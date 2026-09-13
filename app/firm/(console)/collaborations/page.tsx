// Work another firm has asked this firm to take on: referrals, joint retainers, agency.
//
// Everything here comes from collaboration_inbox (migration 45) — a definer view with a fixed
// column list, the collaborating firm's ONLY read path into the arrangement. The titles are the
// snapshot taken when it was proposed, not the other firm's live matter, which this firm cannot
// read and will not be able to read after accepting either.

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import { todayIn } from "@/lib/days";
import { CollaborationInbox } from "@/components/firm/collaboration-inbox";
import type { CollaborationInboxRow, CollaborationNoteRow } from "@/lib/db/types";

export const metadata = { title: "Work from other firms" };

export default async function FirmCollaborations({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
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
    .from("collaboration_inbox")
    .select("*")
    .eq("with_firm_id", firmId)
    .order("proposed_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as CollaborationInboxRow[];

  const ids = rows.map((r) => r.id);
  const { data: noteRows } = ids.length
    ? await supabase.from("collaboration_notes").select("*").in("collaboration_id", ids).order("created_at", { ascending: true }).limit(500)
    : { data: [] };
  const notes = (noteRows ?? []) as CollaborationNoteRow[];

  const awaiting = rows.filter((r) => !r.accepted_at && !r.declined_at && !r.ended_at);
  const live = rows.filter((r) => r.accepted_at && !r.ended_at && (!r.ends_on || r.ends_on >= todayIn(tz)));
  const over = rows.filter((r) => !awaiting.includes(r) && !live.includes(r));

  return (
    <div className="flex flex-col gap-3.5">
      <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Work from other firms</h1>

      {error && (
        <Alert kind="error" title="This did not load">
          Nothing is shown because nothing could be read — not because nothing was sent. Try again.
        </Alert>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No firm has asked you to take anything on"
            hint="When another firm on Docket refers a matter, brings you in as joint counsel, or asks you to appear for them, it arrives here."
          />
        </Card>
      ) : (
        <>
          {awaiting.length > 0 && (
            <Card>
              <CardHeader title={`Waiting on your answer (${awaiting.length})`} />
              <CollaborationInbox rows={awaiting} notes={notes} firmId={firmId} today={todayIn(tz)} side="receiving" />
            </Card>
          )}
          {live.length > 0 && (
            <Card>
              <CardHeader title={`On your desk (${live.length})`} />
              <CollaborationInbox rows={live} notes={notes} firmId={firmId} today={todayIn(tz)} side="receiving" />
            </Card>
          )}
          {over.length > 0 && (
            <Card>
              <CardHeader title="Finished, declined and expired" />
              <CollaborationInbox rows={over} notes={notes} firmId={firmId} today={todayIn(tz)} side="receiving" />
            </Card>
          )}
        </>
      )}

      <Card>
        <CardBody className="text-xs text-[#57534E]">
          <p>
            What you can see of another firm&rsquo;s matter is what they handed over and nothing else: named versions of
            named documents, and — only where they switched it on — the updates they write for their own client. You
            cannot read their file, their internal notes or their client&rsquo;s messages, before or after accepting.
          </p>
          <p className="mt-2">
            When an arrangement ends, every one of those doors closes at once. A document you already downloaded is on
            your own disk and stays there: ending an arrangement has never recalled a copy, here or anywhere.{" "}
            <Link href="/firm/inbox" className="underline underline-offset-2">Process served on this firm</Link> is a
            different list.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
