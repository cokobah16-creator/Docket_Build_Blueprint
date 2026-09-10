// Service inbox: court processes served on this firm through Docket, and those it served.
// The view is the served firm's only read path (never the serving firm's notes or later
// document versions). Slice 4 adds filing into a matter and the response-date diary.

import { supabaseServer } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ServiceInboxRow } from "@/lib/db/types";
import { AcknowledgeButton } from "./acknowledge-button";

export const metadata = { title: "Service inbox" };

export default async function ServiceInboxPage() {
  const supabase = await supabaseServer();
  let rows: ServiceInboxRow[] = [];
  let myFirmIds = new Set<string>();
  if (supabase) {
    const [{ data: inbox }, { data: memberships }] = await Promise.all([
      supabase.from("service_inbox").select("*").order("served_at", { ascending: false }).limit(100),
      supabase.from("firm_members").select("firm_id"),
    ]);
    rows = (inbox ?? []) as ServiceInboxRow[];
    myFirmIds = new Set(((memberships ?? []) as Array<{ firm_id: string }>).map((m) => m.firm_id));
  }
  const received = rows.filter((r) => myFirmIds.has(r.served_firm_id));
  const sent = rows.filter((r) => myFirmIds.has(r.serving_firm_id) && !myFirmIds.has(r.served_firm_id));
  const fmt = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(iso));

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold text-brand">Service inbox</h1>

      <Card>
        <CardHeader title="Served on your firm" />
        {received.length === 0 ? (
          <EmptyState title="Nothing served on you through Docket" hint="Processes served by other firms on Docket appear here for acknowledgement." />
        ) : (
          <ul className="divide-y divide-gray-100">
            {received.map((r) => (
              <li key={r.id} className="space-y-2 px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-gray-900">{r.process_title}{r.is_originating && <Badge className="ml-2">originating</Badge>}</p>
                  <p className="text-sm text-gray-500">{fmt(r.served_at)}</p>
                </div>
                <p className="text-sm text-gray-700">
                  {r.case_title ?? "—"}{r.suit_number ? ` · ${r.suit_number}` : ""}{r.court_name ? ` · ${r.court_name}` : ""}
                  {r.served_for_party ? ` · for ${r.served_for_party}` : ""}
                </p>
                <p className="text-sm text-gray-500">
                  {r.document_name} · served by {r.served_by_name ?? "counsel"}{r.checksum ? ` · ${r.checksum}` : ""}
                </p>
                {r.acknowledged_at ? (
                  <p className="text-sm text-green-800">Acknowledged {fmt(r.acknowledged_at)}{r.acknowledged_by_name ? ` by ${r.acknowledged_by_name}` : ""}</p>
                ) : (
                  <AcknowledgeButton serviceId={r.id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Served by your firm through Docket" />
        {sent.length === 0 ? (
          <EmptyState title="No platform service yet" hint="Record counsel on a matter and serve a process; acknowledgements show here." />
        ) : (
          <ul className="divide-y divide-gray-100">
            {sent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4">
                <div>
                  <p className="font-medium text-gray-900">{r.process_title}</p>
                  <p className="text-sm text-gray-600">{r.case_title ?? "—"}{r.suit_number ? ` · ${r.suit_number}` : ""}</p>
                </div>
                <p className="text-sm text-gray-500">
                  {fmt(r.served_at)} · {r.acknowledged_at ? `acknowledged ${fmt(r.acknowledged_at)}` : "awaiting acknowledgement"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
