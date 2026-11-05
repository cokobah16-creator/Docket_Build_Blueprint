// /admin/network: connections waiting for Docket to check them.
//
// A connection goes to review when the address a firm invited matches nothing the answering firm
// has told Docket about itself: not its official email or website, not a member's email, not its
// custom domain. A person checks the address against the firm's public record and approves or
// ends it. connections_in_review() returns rows to a platform admin alone; review_connection()
// needs a second factor as well, and tells both firms.

import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { platformContext } from "@/lib/admin-data";
import { formatWhen } from "@/lib/time";
import type { ConnectionInReviewRow } from "@/lib/db/types";
import { ReviewControls } from "./review-controls";

export const metadata = { title: "Network review" };

export default async function NetworkReviewPage() {
  const ctx = await platformContext();
  if (!ctx) {
    return <Alert kind="error" title="Platform admins only">This account is not a Docket platform administrator.</Alert>;
  }
  const { supabase, timezone } = ctx;
  const { data, error } = await supabase.rpc("connections_in_review");
  const rows = (data ?? []) as ConnectionInReviewRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-26 font-semibold text-docket-hunter">Network review</h1>
        <p className="mt-1 text-15 text-ink-muted">
          {rows.length === 1 ? "One connection is" : `${rows.length} connections are`} waiting for a check. Neither firm can start work with
          the other until it is settled.
        </p>
      </div>

      {error && <Alert kind="error" title="The queue did not load">{error.message}</Alert>}

      {rows.length === 0 && !error ? (
        <Card>
          <EmptyState title="Nothing to review" hint="Every connection whose invited address matched the answering firm went straight through." />
        </Card>
      ) : (
        rows.map((r) => (
          <Card key={r.connection_id}>
            <CardHeader title={`${r.inviting_firm_name} and ${r.answering_firm_name}`} />
            <CardBody className="space-y-4">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-15 md:grid-cols-2">
                <div><dt className="text-13 text-ink-muted">Address invited</dt><dd className="font-medium text-ink">{r.invited_email}</dd></div>
                <div><dt className="text-13 text-ink-muted">Code entered by</dt><dd className="text-ink">{r.verified_by_email ?? "Not recorded"}</dd></div>
                <div>
                  <dt className="text-13 text-ink-muted">Answering firm</dt>
                  <dd className="text-ink">{r.answering_firm_name}{r.answering_legal_name ? ` (${r.answering_legal_name})` : ""} · {r.answering_jurisdiction}</dd>
                </div>
                <div><dt className="text-13 text-ink-muted">Waiting since</dt><dd className="text-ink">{formatWhen(r.connected_at, timezone)}</dd></div>
                <div><dt className="text-13 text-ink-muted">Its official email</dt><dd className="text-ink">{r.answering_official_email ?? "None given"}</dd></div>
                <div><dt className="text-13 text-ink-muted">Its website</dt><dd className="text-ink">{r.answering_website ?? "None given"}</dd></div>
                <div><dt className="text-13 text-ink-muted">Its custom domain</dt><dd className="text-ink">{r.answering_custom_domain ?? "None"}</dd></div>
                <div className="md:col-span-2"><dt className="text-13 text-ink-muted">Why the inviting firm asked</dt><dd className="whitespace-pre-wrap text-ink">{r.reason}</dd></div>
              </dl>
              <ReviewControls connectionId={r.connection_id} />
            </CardBody>
          </Card>
        ))
      )}
    </div>
  );
}
