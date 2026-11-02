import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { clientTimezone, firmNamesFor } from "@/lib/portal-data";
import { zoneLabel } from "@/lib/client-words";
import { whenWords } from "@/lib/notifications-copy";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { courtDateProvenance, type CourtEventRow } from "@/lib/db/types";
import { Screen, ScreenTitle } from "@/components/portal/screen";

export const metadata = { title: "Court dates" };

export default async function CourtDatesPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));

  const [{ data: rows }, tz] = await Promise.all([
    // A vacated date is not a date: the registry took it off. It stays on the timeline as history.
    supabase.from("court_events").select("id, matter_id, firm_id, scheduled_at, court_name, purpose, outcome_update_id, vacated_at, source, source_document_id, source_ref, registry_notice_id, registry_withdrawn_at").is("vacated_at", null).order("scheduled_at", { ascending: true }).limit(200),
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

  // A client of two firms is told which firm each date belongs to; a client of one already knows.
  const manyFirms = new Set(events.map((e) => e.firm_id)).size > 1;

  // Where the date came from, one short sentence each (courtDateProvenance names the four cases).
  const source = (e: CourtEventRow, firm: string) => {
    const p = courtDateProvenance(e);
    if (p === "registry") return "Listed by the court registry and confirmed by your lawyer.";
    if (p === "court") return "Fixed by the court. The notice is on file.";
    return `Recorded by ${firm}.`;
  };

  const list = (items: CourtEventRow[], className?: string) => (
    <ul className={className ?? "divide-y divide-hairline"}>
      {items.map((e) => {
        const m = matters.get(e.matter_id);
        const firm = firmNames[e.firm_id] ?? "your firm";
        return (
          <li key={e.id} className="px-4 py-3.5">
            <p className="text-15 font-semibold text-ink">{whenWords(e.scheduled_at, tz)}</p>
            <p className="text-15 text-ink">
              {m ? (
                <Link href={`/app/matters/${m.id}`} className="font-medium underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">{m.title}</Link>
              ) : "Your matter"}
            </p>
            {manyFirms && <p className="text-13 text-ink-muted">{firmNames[e.firm_id] ?? "Your firm"}</p>}
            {e.purpose && <p className="text-15 text-ink">{e.purpose}</p>}
            <p className="mt-0.5 text-13 text-ink-muted">{e.court_name ?? "Court to be confirmed"}</p>
            <p className="text-13 text-ink-muted">{source(e, firm)}{e.outcome_update_id ? " Your lawyer has posted an update on what happened." : ""}</p>
            {e.registry_withdrawn_at && (
              <Alert kind="warning" className="mt-2">
                The court registry has since withdrawn its notice for this date. Your lawyer will confirm whether it still stands.
              </Alert>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <Screen>
      <ScreenTitle>Court dates</ScreenTitle>
      <p className="-mt-2 text-15 text-ink-muted">Every court date on your matters. Times are in {zoneLabel(tz)}.</p>

      {/* The one action here, and only when there is a date ahead to add. The file is a copy of
          the dates as they stand, so the line under it says how to bring a changed date in. The
          export keeps one id per date, so adding it again updates the event rather than doubling it. */}
      {upcoming.length > 0 && (
        <div className="flex flex-col items-start gap-1.5">
          <a href="/app/court-dates/ics" className={buttonClasses("primary", "md")}>Add these dates to my calendar</a>
          <p className="text-13 text-ink-muted">This adds the dates as they are today. If one changes, add them again.</p>
        </div>
      )}

      <Card>
        <CardHeader title="Coming up" />
        {upcoming.length === 0 ? <EmptyState title="No upcoming court dates" hint="Your lawyer posts the next date after each sitting." /> : list(upcoming)}
      </Card>

      {/* General information, folded away, and cautious on purpose: what a missed date leads to
          depends on the court and the case, so it says "can", and it sends the client to their
          lawyer for their own facts (docs/VOICE.md, rule 17). */}
      {upcoming.length > 0 && (
        <Disclosure summary="Do I need to be in court?" hint="General information, not legal advice.">
          <div className="space-y-2">
            <p>Ask your lawyer whether you need to be there on each date.</p>
            <p>If you are needed and cannot attend, tell your lawyer as early as you can.</p>
            <p>Do not miss a date you are needed at. Missing it can mean a judgment or a warrant against you.</p>
          </div>
        </Disclosure>
      )}

      {past.length > 0 && (
        <Disclosure summary={`Past court dates (${past.length})`}>
          {/* The fold's own padding is cancelled so each date lines up as it does above. */}
          {list(past, "-mx-4 -my-3 divide-y divide-hairline")}
        </Disclosure>
      )}
    </Screen>
  );
}
