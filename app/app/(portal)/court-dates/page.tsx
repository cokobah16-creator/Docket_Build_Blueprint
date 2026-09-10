import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { clientTimezone, firmNamesFor } from "@/lib/portal-data";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import type { CourtEventRow } from "@/lib/db/types";

export const metadata = { title: "Court dates" };

export default async function CourtDatesPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  const [{ data: rows }, tz] = await Promise.all([
    supabase.from("court_events").select("id, matter_id, firm_id, scheduled_at, court_name, purpose, outcome_update_id").order("scheduled_at", { ascending: true }).limit(200),
    clientTimezone(supabase, user.id),
  ]);
  const events = (rows ?? []) as CourtEventRow[];
  const matterIds = Array.from(new Set(events.map((e) => e.matter_id)));
  const [{ data: matterRows }, firmNames] = await Promise.all([
    matterIds.length ? supabase.from("matters").select("id, reference, title").in("id", matterIds) : Promise.resolve({ data: [] }),
    firmNamesFor(events.map((e) => e.firm_id)),
  ]);
  const matters = new Map(((matterRows ?? []) as Array<{ id: string; reference: string; title: string }>).map((m) => [m.id, m]));
  const now = Date.now();
  const upcoming = events.filter((e) => new Date(e.scheduled_at).getTime() >= now);
  const past = events.filter((e) => new Date(e.scheduled_at).getTime() < now).reverse();
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: tz });

  const list = (items: CourtEventRow[]) => (
    <ul className="divide-y divide-gray-100">
      {items.map((e) => {
        const m = matters.get(e.matter_id);
        return (
          <li key={e.id} className="px-5 py-4">
            <p className="text-sm font-medium text-gray-900">{fmt.format(new Date(e.scheduled_at))}</p>
            <p className="text-sm text-gray-700">{m ? <Link href={`/app/matters/${m.id}`} className="underline">{m.title}</Link> : "Matter"}{e.purpose ? ` · ${e.purpose}` : ""}</p>
            <p className="text-xs text-gray-500">{e.court_name ?? "Court to be confirmed"} · {firmNames[e.firm_id] ?? "Your firm"}{e.outcome_update_id ? " · update posted" : ""}</p>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold text-brand">Court dates</h1>
        <a href="/app/court-dates/ics" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-brand hover:bg-black/5">Add to calendar (.ics)</a>
      </div>
      <p className="text-sm text-gray-600">Every court date across your matters and firms, shown in {tz}.</p>
      <Card>
        <CardHeader title="Upcoming" />
        {upcoming.length === 0 ? <EmptyState title="No upcoming court dates" hint="Your lawyer posts the next date after each sitting." /> : list(upcoming)}
      </Card>
      {past.length > 0 && (
        <Card>
          <CardHeader title="Past" />
          <CardBody className="p-0">{list(past)}</CardBody>
        </Card>
      )}
    </div>
  );
}
