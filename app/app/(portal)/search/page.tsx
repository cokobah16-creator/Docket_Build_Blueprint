// A client searching their own matters: the updates their firm wrote for them, their messages,
// the names of the documents on their files, their invoices and consultations.
//
// The same search_docket() the console uses (migration 43), called the same way. It runs as the
// caller, so a client sees exactly what a client may already open — the internal half of a firm's
// work is absent because it is absent from `updates` and the rest for this reader, not because
// this screen filtered anything. No firm is named in the call: a client may be a client of more
// than one firm, and this searches across all of them, saying which firm each result belongs to.

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
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
const KIND_LABEL = new Map<string, string>(KINDS.map(([k, l]) => [k, l]));

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
          ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-gray-900">{p.slice(2, -2)}</mark>
          : <span key={i}>{p}</span>,
      )}
    </span>
  );
}

export default async function PortalSearch({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const sp = await searchParams;
  const supabase = await supabaseServer();
  if (!supabase) {
    return (
      <Screen>
        <Alert kind="warning" title="Not configured">Supabase environment variables are not set.</Alert>
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

  return (
    <Screen>
      <ScreenTitle>Search</ScreenTitle>

      <Card>
        <form method="GET" action="/app/search" className="flex flex-col gap-2 p-4">
          {kind && <input type="hidden" name="kind" value={kind} />}
          <label className="text-sm font-medium text-gray-800" htmlFor="q">Search your matters</label>
          <div className="flex gap-2">
            <input
              id="q" name="q" type="search" defaultValue={q} autoFocus minLength={2} maxLength={200}
              placeholder="A word from an update, a file name, a reference"
              className="min-h-11 w-full rounded-lg border border-gray-300 px-3 text-[15px] text-gray-900 focus:border-brand focus:outline-none"
            />
            <button type="submit" className="min-h-11 shrink-0 rounded-lg bg-brand px-4 text-sm font-medium text-brand-on">
              Search
            </button>
          </div>
          <p className="text-xs leading-relaxed text-gray-500">
            This searches what your firm has written to you and the <em>names</em> of your documents.
            It does not read inside a file you or your firm uploaded.
          </p>
        </form>
      </Card>

      {q.length > 0 && q.length < 2 && <Alert kind="info">Type at least two characters.</Alert>}

      {failed && (
        <Alert kind="error" title="The search did not come back">
          This is not an empty result — nothing could be looked at just now. Try again.
        </Alert>
      )}

      {q.length >= 2 && !failed && (
        <>
          <div className="flex flex-wrap gap-2">
            <Link href={keep(null)}
                  className={cn("min-h-9 rounded-full border px-3 py-1.5 text-xs",
                    kind === null ? "border-brand bg-brand text-brand-on" : "border-gray-300 bg-white text-gray-700")}>
              Everything
            </Link>
            {KINDS.map(([k, label]) => (
              <Link key={k} href={keep(k)}
                    className={cn("min-h-9 rounded-full border px-3 py-1.5 text-xs",
                      kind === k ? "border-brand bg-brand text-brand-on" : "border-gray-300 bg-white text-gray-700")}>
                {label}
              </Link>
            ))}
          </div>

          <Card>
            <CardHeader title={hits.length === 0 ? "Nothing matched" : `${hits.length} result${hits.length === 1 ? "" : "s"}`} />
            {hits.length === 0 ? (
              <EmptyState
                title="Nothing matched that"
                hint="Try a single word, or the reference on a letter from your firm."
              />
            ) : (
              <ul className="divide-y divide-gray-100">
                {hits.map((hit) => (
                  <li key={`${hit.kind}:${hit.id}`}>
                    <Link href={hrefFor(hit)} className="flex flex-col gap-1 px-4 py-3 hover:bg-gray-50">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 text-sm font-medium text-gray-900">{hit.title}</span>
                        <span className="shrink-0 text-[11px] uppercase tracking-wide text-gray-500">
                          {KIND_LABEL.get(hit.kind) ?? hit.kind}
                        </span>
                      </span>
                      {hit.snippet && (
                        <span className="text-xs leading-relaxed text-gray-600"><Snippet text={hit.snippet} /></span>
                      )}
                      {hit.firm_id && firmNames.has(hit.firm_id) && (
                        <span className="text-[11px] text-gray-500">{firmNames.get(hit.firm_id)}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
