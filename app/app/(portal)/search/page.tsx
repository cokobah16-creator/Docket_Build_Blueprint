// A client searching their own matters: the updates their firm wrote for them, their messages,
// the names of the documents on their files, their invoices and consultations.
//
// The same search_docket() the console uses (migration 43), called the same way. It runs as the
// caller, so a client sees exactly what a client may already open. The internal half of a firm's
// work is absent because it is absent from `updates` and the rest for this reader, not because
// this screen filtered anything. No firm is named in the call: a client may be a client of more
// than one firm, and this searches across all of them, saying which firm each result belongs to.
//
// One main action, Search. The kind filter is an underlined strip like the matter tabs
// (docs/VOICE.md, "Tabs"), so it never reads as a second filled button.

import { WorkspaceUnavailable } from "@/components/ui/unavailable";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Input } from "@/components/ui/input";
import { Screen, ScreenTitle } from "@/components/portal/screen";
import { cn } from "@/lib/cn";
import { supabaseServer } from "@/lib/supabase/server";
import type { SearchHit, SearchKind } from "@/lib/db/types";

export const metadata = { title: "Search" };

const LIMIT = 40;

/** Only the kinds a client has any business seeing offered. The database decides the rest. */
const KINDS: Array<[SearchKind, string]> = [
  ["matter", "Matters"],
  ["update", "Updates"],
  ["message", "Messages"],
  ["document", "Documents"],
  ["invoice", "Invoices"],
  ["appointment", "Consultations"],
];

/** What one result is, in a word, on the result itself. */
const KIND_ONE = new Map<string, string>([
  ["matter", "Matter"],
  ["update", "Update"],
  ["message", "Message"],
  ["document", "Document"],
  ["invoice", "Invoice"],
  ["appointment", "Consultation"],
]);

function hrefFor(hit: SearchHit): string {
  switch (hit.kind) {
    case "matter":      return `/app/matters/${hit.matter_id}`;
    case "update":      return `/app/matters/${hit.matter_id}`;
    case "message":     return hit.matter_id ? `/app/matters/${hit.matter_id}?tab=messages` : "/app/messages";
    case "document":    return `/app/matters/${hit.matter_id}?tab=documents`;
    case "invoice":     return `/app/payments/${hit.id}`;
    case "appointment": return `/app/appointments/${hit.id}`;
    default:            return "/app";
  }
}

function Snippet({ text }: { text: string }) {
  const parts = text.split(/(<<[^>]*?>>)/g);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith("<<") && p.endsWith(">>")
          ? <mark key={i} className="rounded-chip bg-waiting-bg px-0.5 font-semibold text-ink">{p.slice(2, -2)}</mark>
          : <span key={i}>{p}</span>,
      )}
    </span>
  );
}

const tabLink = (on: boolean) =>
  cn(
    "-mb-px flex min-h-11 shrink-0 items-center border-b-2 px-3 text-13 font-medium",
    "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
    on ? "border-brand font-semibold text-ink-strong" : "border-transparent text-ink-muted hover:text-ink",
  );

export default async function PortalSearch({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const sp = await searchParams;
  const supabase = await supabaseServer();
  if (!supabase) {
    return (
      <Screen>
        <WorkspaceUnavailable audience="client" />
      </Screen>
    );
  }
  const q = (sp.q ?? "").trim();
  const kind = KINDS.some(([k]) => k === sp.kind) ? (sp.kind as SearchKind) : null;

  let hits: SearchHit[] = [];
  let failed = false;
  if (q.length >= 2) {
    const { data, error } = await supabase.rpc("search_docket", {
      p_q: q, p_firm: null, p_kinds: kind ? [kind] : KINDS.map(([k]) => k), p_limit: LIMIT,
    });
    failed = Boolean(error);
    hits = (data ?? []) as SearchHit[];
  }

  // The firm each result belongs to, named rather than assumed: a client of two firms must never
  // have to guess which one an update came from.
  const firmIds = Array.from(new Set(hits.map((h) => h.firm_id).filter((f): f is string => Boolean(f))));
  const firmNames = new Map<string, string>();
  if (firmIds.length > 1) {
    const { data } = await supabase.from("firms").select("id, name").in("id", firmIds);
    for (const f of (data ?? []) as Array<{ id: string; name: string }>) firmNames.set(f.id, f.name);
  }

  const keep = (k: SearchKind | null) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (k) p.set("kind", k);
    return `/app/search?${p.toString()}`;
  };

  const kindName = kind ? KINDS.find(([k]) => k === kind)?.[1].toLowerCase() : null;

  return (
    <Screen>
      <ScreenTitle>Search</ScreenTitle>

      <Card>
        <form method="GET" action="/app/search" role="search" className="p-4">
          {kind && <input type="hidden" name="kind" value={kind} />}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input
                id="q" name="q" type="search" label="Search your matters" defaultValue={q} autoFocus minLength={2} maxLength={200}
                placeholder="A word, a file name or a reference"
              />
            </div>
            {/* h-12 matches the field beside it, which is 48px with its border. */}
            <Button type="submit" className="h-12 shrink-0">Search</Button>
          </div>
        </form>
        <Disclosure framed={false} summary="What search can find" className="border-t border-hairline px-4">
          <div className="space-y-2 text-13 leading-relaxed text-ink-muted">
            <p>Search looks through what your firm has written to you, the names of your documents, and the words inside the documents your firm has shared with you.</p>
            <p>A scanned or photographed page is a picture of words, not text, so search cannot look inside it.</p>
          </div>
        </Disclosure>
      </Card>

      {q.length > 0 && q.length < 2 && <Alert kind="info">Type at least 2 letters or numbers to search.</Alert>}

      {failed && (
        <Alert kind="error" title="Search did not finish">
          This is not an empty result. Nothing could be searched just now. Try again in a moment.
        </Alert>
      )}

      {q.length >= 2 && !failed && (
        <>
          <nav aria-label="What to search" className="flex gap-1 overflow-x-auto border-b border-hairline">
            <Link href={keep(null)} aria-current={kind === null ? "page" : undefined} className={tabLink(kind === null)}>Everything</Link>
            {KINDS.map(([k, label]) => (
              <Link key={k} href={keep(k)} aria-current={kind === k ? "page" : undefined} className={tabLink(kind === k)}>{label}</Link>
            ))}
          </nav>

          <Card>
            {hits.length === 0 ? (
              <EmptyState
                title={kindName ? `No ${kindName} matched your search` : "Nothing matched your search"}
                hint="Try a single word, or the reference on a letter from your firm."
                action={kind ? (
                  <Link href={keep(null)} className="inline-flex min-h-11 items-center text-13 font-medium text-ink underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                    Search everything instead
                  </Link>
                ) : undefined}
              />
            ) : (
              <>
                {/* The database stops at LIMIT, so a full page is "the first 40", never "40 results". */}
                <CardHeader title={hits.length >= LIMIT ? `The first ${LIMIT} results` : `${hits.length} result${hits.length === 1 ? "" : "s"}`} />
                <ul className="divide-y divide-hairline">
                  {hits.map((hit) => (
                    <li key={`${hit.kind}:${hit.id}`}>
                      <Link
                        href={hrefFor(hit)}
                        className="flex flex-col gap-1 px-4 py-3 transition duration-fast hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                      >
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 text-15 font-medium text-ink">{hit.title}</span>
                          <span className="shrink-0 text-11 uppercase tracking-wide text-ink-muted">
                            {KIND_ONE.get(hit.kind) ?? "Result"}
                          </span>
                        </span>
                        {hit.snippet && (
                          <span className="text-13 leading-relaxed text-ink-muted"><Snippet text={hit.snippet} /></span>
                        )}
                        {hit.firm_id && firmNames.has(hit.firm_id) && (
                          <span className="text-13 text-ink-muted">{firmNames.get(hit.firm_id)}</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
                {hits.length >= LIMIT && (
                  <p className="border-t border-hairline px-4 py-3 text-13 text-ink-muted">Add another word to narrow the search.</p>
                )}
              </>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
