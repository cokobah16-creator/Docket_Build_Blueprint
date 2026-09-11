import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { clientMatters, clientTimezone } from "@/lib/portal-data";
import { selectedFirm } from "@/lib/portal-firm";
import { Card, EmptyState } from "@/components/ui/card";
import { Screen, ScreenTitle } from "@/components/portal/screen";

export const metadata = { title: "Matters" };

// ?for=documents or ?for=messages turns the list into a chooser: the home screen sends a client
// here when they have more than one matter and tap Upload or Message, so the file they mean is a
// choice they make, never a guess the screen makes for them.
type Pick = "documents" | "messages";

export default async function MattersPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const { for: forParam } = await searchParams;
  const pick: Pick | null = forParam === "documents" || forParam === "messages" ? forParam : null;
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
      <ScreenTitle>{pick === "documents" ? "Upload to which matter?" : pick === "messages" ? "Message about which matter?" : "Matters"}</ScreenTitle>
      {pick && (
        <p className="-mt-2 text-[13px] text-gray-600">
          {pick === "documents" ? "The document goes on the matter you choose, and your firm sees it there." : "Your message goes to the lawyers on the matter you choose."}
        </p>
      )}
      <Card>
        {matters.length === 0 ? (
          <EmptyState title="No matters yet" hint="When your firm opens a matter for you, it appears here with its timeline, documents, messages and invoices." />
        ) : (
          <ul>
            {matters.map((m) => (
              <li key={m.id}>
                <Link href={pick ? `/app/matters/${m.id}?tab=${pick}` : `/app/matters/${m.id}`} className="block border-t border-gray-100 px-4 py-3.5 first:border-t-0 hover:bg-gray-50">
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
      {!pick && (
        <p className="text-[11.5px] leading-relaxed text-gray-500">
          Timeline, documents, messages and invoices sit inside each matter. Court dates are
          also on <Link href="/app/court-dates" className="underline underline-offset-2">your phone calendar</Link>.
        </p>
      )}
    </Screen>
  );
}
