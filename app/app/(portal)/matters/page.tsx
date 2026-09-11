// Client matters (design/pwa artboard, CLIENT · MATTERS): one card, one row a
// matter — what it is called, where it is, what happened last and what happens
// next. Everything inside a matter is a tap away, not on this screen.

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { clientMatters, clientTimezone } from "@/lib/portal-data";
import {
  AppAccentPill,
  AppCard,
  AppCardList,
  AppEmpty,
  AppScreen,
  Footnote,
  ScreenTitle,
} from "@/components/app";

export const metadata = { title: "Matters" };


export default async function MattersPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");
  const [matters, tz] = await Promise.all([clientMatters(supabase), clientTimezone(supabase, user.id)]);
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: tz });

  return (
    <AppScreen>
      <ScreenTitle>Matters</ScreenTitle>
      <AppCard>
        {matters.length === 0 ? (
          <AppEmpty title="No matters yet" hint="When your firm opens a matter for you, it appears here with its timeline, documents, messages and invoices." />
        ) : (
          <AppCardList>
            {matters.map((m) => (
              <Link key={m.id} href={`/app/matters/${m.id}`} className="block px-4 py-3.5">
                <div className="flex items-start justify-between gap-2.5">
                  <p className="text-[14px] font-semibold leading-[1.35] text-dk-strong">{m.title}</p>
                  {m.status && (
                    <AppAccentPill colour={m.status.colour}>{m.status.label}</AppAccentPill>
                  )}
                </div>
                <p className="mt-1 text-[12px] leading-snug text-dk-muted">
                  <span className="font-mono">{m.reference}</span> · {m.firm_name}
                  {m.lawyer_names.length ? ` · ${m.lawyer_names.join(", ")}` : ""}
                </p>
                {m.last_update && (
                  <p className="mt-1.5 text-[12px] leading-snug text-dk-soft">
                    Latest: {m.last_update.title} · {fmt.format(new Date(m.last_update.occurred_at))}
                  </p>
                )}
                {m.court_name && (
                  <p className="mt-[3px] text-[12px] leading-snug text-dk-soft">
                    {m.court_name}{m.suit_number ? ` · ${m.suit_number}` : ""}
                  </p>
                )}
                {m.next_event_at && (
                  <p className="mt-[3px] text-[12px] leading-snug text-dk-soft">
                    Next court date: {fmt.format(new Date(m.next_event_at))}{m.next_event_note ? ` · ${m.next_event_note}` : ""}
                  </p>
                )}
                {m.next_action && (
                  <p className="mt-[5px] text-[12px] font-semibold leading-snug text-dk-pri">Next: {m.next_action}</p>
                )}
              </Link>
            ))}
          </AppCardList>
        )}
      </AppCard>
      <Footnote>
        Timeline, documents, messages and invoices sit inside each matter. Court dates are also on{" "}
        <Link href="/app/court-dates" className="font-medium text-dk-pri underline underline-offset-2">
          your phone calendar
        </Link>
        .
      </Footnote>
    </AppScreen>
  );
}
