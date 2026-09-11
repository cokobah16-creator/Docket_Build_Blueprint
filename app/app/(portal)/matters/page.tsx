import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { clientMatters, clientTimezone } from "@/lib/portal-data";
import { selectedFirm } from "@/lib/portal-firm";
import { Card, EmptyState } from "@/components/ui/card";
import { Screen, ScreenTitle } from "@/components/portal/screen";

export const metadata = { title: "Matters" };

export default async function MattersPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");
  const firm = await selectedFirm(supabase);
  const [matters, tz] = await Promise.all([
    clientMatters(supabase, 50, firm?.id),
    clientTimezone(supabase, user.id),
  ]);
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: tz });

  return (
    <Screen>
      <ScreenTitle>Matters</ScreenTitle>
      <Card>
        {matters.length === 0 ? (
          <EmptyState title="No matters yet" hint="When your firm opens a matter for you, it appears here with its timeline, documents, messages and invoices." />
        ) : (
          <ul>
            {matters.map((m) => (
              <li key={m.id}>
                <Link href={`/app/matters/${m.id}`} className="block border-t border-gray-100 px-4 py-3.5 first:border-t-0 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-2.5">
                    <p className="text-sm font-semibold leading-snug text-gray-900">{m.title}</p>
                    {m.status && (
                      <span
                        className="shrink-0 whitespace-nowrap rounded-full border border-brand-accent px-2.5 py-0.5 text-[11.5px] font-semibold text-brand-accent"
                        style={m.status.colour ? { borderColor: m.status.colour, color: m.status.colour } : undefined}
                      >
                        {m.status.label}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    <span className="font-mono">{m.reference}</span> · {m.firm_name}
                    {m.lawyer_names.length ? ` · ${m.lawyer_names.join(", ")}` : ""}
                  </p>
                  {/* Court, suit number and the next date read the same way on
                      every matter, so a client learns the shape once. */}
                  {m.last_update && (
                    <p className="mt-1.5 truncate text-xs text-gray-600">
                      Latest: {m.last_update.title} · {fmt.format(new Date(m.last_update.occurred_at))}
                    </p>
                  )}
                  {m.court_name ? (
                    <p className="mt-0.5 text-xs text-gray-600">
                      {m.court_name}
                      {m.suit_number ? <> · <span className="font-mono">{m.suit_number}</span></> : null}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-gray-600">No court — transactional</p>
                  )}
                  {m.next_event_at && (
                    <p className="mt-1 text-xs font-semibold text-brand">
                      Next court date: {fmt.format(new Date(m.next_event_at))}
                      {m.next_event_note ? ` · ${m.next_event_note}` : ""}
                    </p>
                  )}
                  {m.next_action && <p className="mt-1 text-xs font-semibold text-brand">Next: {m.next_action}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-[11.5px] leading-relaxed text-gray-500">
        Timeline, documents, messages and invoices sit inside each matter. Court dates are
        also on <Link href="/app/court-dates" className="underline underline-offset-2">your phone calendar</Link>.
      </p>
    </Screen>
  );
}
