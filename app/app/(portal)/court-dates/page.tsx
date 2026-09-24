import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { clientTimezone, firmNamesFor } from "@/lib/portal-data";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { courtDateProvenance, type CourtEventRow } from "@/lib/db/types";
import { Screen } from "@/components/portal/screen";

export const metadata = { title: "Court dates" };

export default async function CourtDatesPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));

  const [courtResult, tz] = await Promise.all([
    // A vacated date is not a date: the registry took it off. It stays on the timeline as history.
    supabase.from("court_events").select("id, matter_id, firm_id, scheduled_at, court_name, purpose, outcome_update_id, vacated_at, source, source_document_id, source_ref, registry_notice_id, registry_withdrawn_at").is("vacated_at", null).order("scheduled_at", { ascending: true }).limit(200),
    clientTimezone(supabase, user.id),
  ]);
  if (courtResult.error) throw new Error(`Court dates could not be loaded: ${courtResult.error.message}`);
  const events = (courtResult.data ?? []) as CourtEventRow[];
  const matterIds = Array.from(new Set(events.map((e) => e.matter_id)));
  const [matterResult, firmNames] = await Promise.all([
    matterIds.length
      ? supabase.from("portal_matters").select("id, reference, title").in("id", matterIds)
      : Promise.resolve({ data: [] as Array<{ id: string; reference: string; title: string }>, error: null }),
    firmNamesFor(events.map((e) => e.firm_id)),
  ]);
  if (matterResult.error) throw new Error(`Court-date matters could not be loaded: ${matterResult.error.message}`);
  const matters = new Map(((matterResult.data ?? []) as Array<{ id: string; reference: string; title: string }>).map((m) => [m.id, m]));
  const now = Date.now();
  const upcoming = events.filter((e) => new Date(e.scheduled_at).getTime() >= now);
  const past = events.filter((e) => new Date(e.scheduled_at).getTime() < now).reverse();
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: tz });

  const list = (items: CourtEventRow[]) => (
    <ul className="divide-y divide-hairline">
      {items.map((e) => {
        const m = matters.get(e.matter_id);
        return (
          <li key={e.id} className="px-5 py-4">
            <p className="text-15 font-medium text-ink">{fmt.format(new Date(e.scheduled_at))}</p>
            <p className="text-15 text-ink">{m ? <Link href={`/app/matters/${m.id}`} className="underline">{m.title}</Link> : "Matter"}{e.purpose ? ` · ${e.purpose}` : ""}</p>
            <p className="text-13 text-ink-muted">
              {e.court_name ?? "Court to be confirmed"} · {firmNames[e.firm_id] ?? "Your firm"}{e.outcome_update_id ? " · update posted" : ""}
              {courtDateProvenance(e) === "registry" ? " · listed by the court registry, confirmed by your lawyer" : courtDateProvenance(e) === "court" ? " · fixed by the court, notice on file" : " · as recorded by your firm"}
            </p>
            {e.registry_withdrawn_at && (
              <p className="text-13 font-medium text-amber-800">The registry has since withdrawn its notice for this date. Your lawyer will confirm whether it still stands.</p>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <Screen>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-26 font-semibold text-brand">Court dates</h1>
        <a href="/app/court-dates/ics" className="rounded-lg border border-edge px-3 py-1.5 text-15 font-medium text-brand hover:bg-hover">Add to calendar (.ics)</a>
      </div>
      <p className="text-15 text-ink-muted">Every court date across your matters and firms, shown in {tz}.</p>
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
    </Screen>
  );
}
