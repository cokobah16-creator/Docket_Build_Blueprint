// Court dates: every sitting across every matter and every firm, in one
// column. It is reached from the home footer rather than from a tab, so it is
// a pushed screen — a sticky sub-header back to home, then two cards, what is
// coming and what has been.
//
// The row leads with the date, because that is what the screen is for, and
// carries the matter under it with the firm's own reference in mono. The suit
// number is not here: the canonical identifier in Nigerian practice lives on
// matters.suit_number, but the lookup below selects id, reference and title
// only, and widening a query is not a design change.

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { clientTimezone, firmNamesFor } from "@/lib/portal-data";
import {
  AppCard,
  AppCardHeader,
  AppCardList,
  AppEmpty,
  AppPill,
  Footnote,
  PushedScreen,
  SubHeader,
  SubHeaderTitle,
  appButtonClass,
} from "@/components/app";
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

  // One row. The whole row is the tap target when the matter is readable;
  // when it is not, the same block renders without a link rather than as a
  // dead one.
  const row = (e: CourtEventRow) => {
    const m = matters.get(e.matter_id);
    const body = (
      <>
        <div className="flex items-start justify-between gap-2.5">
          <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">
            {fmt.format(new Date(e.scheduled_at))}
          </p>
          {e.outcome_update_id && <AppPill kind="completed">Update posted</AppPill>}
        </div>
        <p className="mt-1 text-[13px] leading-snug text-dk-pri">
          {m ? m.title : "Your matter"}
          {e.purpose ? <span className="text-dk-soft"> · {e.purpose}</span> : null}
        </p>
        <p className="mt-[3px] text-[12px] leading-snug text-dk-muted">
          {e.court_name ?? "Court to be confirmed"} · {firmNames[e.firm_id] ?? "Your firm"}
          {m ? <> · <span className="font-mono">{m.reference}</span></> : null}
        </p>
      </>
    );
    return m ? (
      <Link key={e.id} href={`/app/matters/${m.id}`} className="block px-4 py-3.5">
        {body}
      </Link>
    ) : (
      <div key={e.id} className="px-4 py-3.5">
        {body}
      </div>
    );
  };

  return (
    <PushedScreen
      header={
        <SubHeader backHref="/app" backLabel="Back to home">
          <SubHeaderTitle>Court dates</SubHeaderTitle>
        </SubHeader>
      }
    >
      {/* The sub-header carries the name, so the heading the page owes a
          screen reader is announced rather than drawn a second time. */}
      <h1 className="sr-only">Court dates</h1>

      <AppCard>
        <AppCardHeader title="Upcoming" />
        {upcoming.length === 0 ? (
          <AppEmpty
            title="No upcoming court dates"
            hint="Your lawyer posts the next date after each sitting, and it appears here and on your phone calendar."
          />
        ) : (
          <AppCardList>{upcoming.map(row)}</AppCardList>
        )}
      </AppCard>

      <div className="flex">
        <a href="/app/court-dates/ics" className={appButtonClass("ghost")}>
          Add to calendar (.ics)
        </a>
      </div>

      {past.length > 0 && (
        <AppCard>
          <AppCardHeader title="Past" />
          <AppCardList>{past.map(row)}</AppCardList>
        </AppCard>
      )}

      <Footnote>
        Every court date across your matters and firms, shown in {tz}. Dates move — your
        lawyer&rsquo;s posted update is the one that counts.
      </Footnote>
    </PushedScreen>
  );
}
