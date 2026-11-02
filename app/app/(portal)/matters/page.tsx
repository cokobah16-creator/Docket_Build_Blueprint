import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { clientMatters, clientTimezone } from "@/lib/portal-data";
import { selectedFirm } from "@/lib/portal-firm";
import { shortDayWords, whenWords } from "@/lib/notifications-copy";
import { Card, EmptyState } from "@/components/ui/card";
import { MatterStatusChip } from "@/components/ui/badge";
import { Screen, ScreenTitle } from "@/components/portal/screen";

export const metadata = { title: "Matters" };

// ?for=documents or ?for=messages turns the list into a chooser: the home screen sends a client
// here when they have more than one matter and tap Upload or Message, so the file they mean is a
// choice they make, never a guess the screen makes for them.
type Pick = "documents" | "messages";

/** "Ada Obi", "Ada Obi and Chidi Eze", "Ada Obi, Chidi Eze and Bola Ade". */
function andList(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
}

export default async function MattersPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const { for: forParam } = await searchParams;
  const pick: Pick | null = forParam === "documents" || forParam === "messages" ? forParam : null;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));
  const firm = await selectedFirm(supabase);
  const [matters, tz] = await Promise.all([
    clientMatters(supabase, 50, firm?.id),
    clientTimezone(supabase, user.id),
  ]);

  return (
    <Screen>
      <ScreenTitle>{pick === "documents" ? "Upload to which matter?" : pick === "messages" ? "Message about which matter?" : "Matters"}</ScreenTitle>
      {pick && (
        <p className="-mt-2 text-13 text-ink-muted">
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
                {/* The row is the link: tests/integration/journeys.spec.ts opens the first
                    a[href^='/app/matters/'] on this screen as a matter. */}
                <Link href={pick ? `/app/matters/${m.id}?tab=${pick}` : `/app/matters/${m.id}`} className="block border-t border-hairline px-4 py-3.5 transition duration-fast first:border-t-0 hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand">
                  <div className="flex items-start justify-between gap-2.5">
                    <p className="text-15 font-semibold leading-snug text-ink">{m.title}</p>
                    {m.status && <MatterStatusChip status={m.status} />}
                  </div>
                  <p className="mt-1 text-13 text-ink-muted">
                    {m.lawyer_names.length ? `${andList(m.lawyer_names)}, ${m.firm_name}` : m.firm_name}
                  </p>
                  {/* Court, suit number and the next date read the same way on
                      every matter, so a client learns the shape once. */}
                  {m.last_update && (
                    <p className="mt-1.5 truncate text-13 text-ink-muted">
                      Latest update: {m.last_update.title}, {shortDayWords(m.last_update.occurred_at, tz)}
                    </p>
                  )}
                  {/* No court name is not proof of a transaction: a dispute may simply not be filed
                      yet. "Not in court" is true either way. */}
                  <p className="mt-0.5 text-13 text-ink-muted">
                    {m.court_name ? <>{m.court_name}{m.suit_number ? <>. Suit number <span className="font-mono">{m.suit_number}</span></> : null}</> : "Not in court"}
                  </p>
                  {m.next_event_at && (
                    <p className="mt-1 text-13 font-semibold text-brand">
                      Next court date: {whenWords(m.next_event_at, tz)}
                      {m.next_event_note ? `. ${m.next_event_note}` : ""}
                    </p>
                  )}
                  {m.last_update?.next_step && <p className="mt-1 text-13 font-semibold text-brand">What happens next: {m.last_update.next_step}</p>}
                  {/* The reference last, with its label (docs/VOICE.md, rule 5). */}
                  <p className="mt-1 text-13 text-ink-muted">Reference <span className="font-mono">{m.reference}</span></p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {!pick && matters.length > 0 && (
        <p className="text-13 leading-relaxed text-ink-muted">
          Each matter holds its updates, documents, messages and invoices.{" "}
          <Link href="/app/court-dates" className="inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">See all your court dates</Link>
        </p>
      )}
    </Screen>
  );
}
