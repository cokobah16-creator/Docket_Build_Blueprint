// One box across the whole firm: matters, updates, messages, document names, notes, tasks,
// deadlines, sittings, invoices, people and the adverse-party register.
//
// Everything here comes from search_docket() (migration 43), which runs as the caller and reads
// every table under that caller's own RLS. So this screen holds no access logic of its own and
// could not widen anything if it tried: a walled matter is not in the result because it is not in
// `matters` for this reader, and an internal note is absent for the same reason. That is why there
// is no firm_id filter written here beyond the one the console is already scoped to.
//
// A plain GET form, on purpose. It works with no JavaScript, every result page is a link a lawyer
// can send to a colleague, and the back button behaves.

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import type { SearchHit, SearchKind } from "@/lib/db/types";

export const metadata = { title: "Search" };

const LIMIT = 60;

/** The kinds a staff search offers, in the order a lawyer thinks of them. */
const KINDS: Array<[SearchKind, string]> = [
  ["matter", "Matters"],
  ["document", "Documents"],
  ["update", "Updates"],
  ["message", "Messages"],
  ["person", "People"],
  ["adverse_party", "Other side"],
  ["deadline", "Deadlines"],
  ["court_event", "Sittings"],
  ["task", "Tasks"],
  ["note", "Consultation notes"],
  ["internal_note", "Internal notes"],
  ["invoice", "Invoices"],
  ["appointment", "Consultations"],
];
const KIND_LABEL = new Map<string, string>(KINDS.map(([k, l]) => [k, l]));

/** Where a hit lives. A person is a client record; everything else hangs off its matter. */
function hrefFor(hit: SearchHit): string {
  switch (hit.kind) {
    case "matter":        return `/firm/matters/${hit.matter_id}`;
    case "document":      return `/firm/matters/${hit.matter_id}?tab=documents`;
    case "update":        return `/firm/matters/${hit.matter_id}`;
    case "message":       return `/firm/matters/${hit.matter_id}?tab=messages`;
    case "task":          return `/firm/matters/${hit.matter_id}?tab=tasks`;
    case "deadline":      return `/firm/matters/${hit.matter_id}?tab=deadlines`;
    case "court_event":   return `/firm/matters/${hit.matter_id}`;
    case "adverse_party": return `/firm/matters/${hit.matter_id}`;
    case "person":        return `/firm/clients/${hit.id}`;
    case "invoice":       return `/firm/invoices/${hit.id}`;
    case "appointment":   return `/firm/appointments/${hit.id}`;
    case "note":
    case "internal_note": return hit.matter_id ? `/firm/matters/${hit.matter_id}` : "/firm/appointments";
    default:              return "/firm";
  }
}

/**
 * The snippet arrives with the matched words wrapped in << >> by ts_headline. Rendered as marks
 * rather than as HTML: the text is a client's message or a lawyer's note and is never trusted to
 * carry markup.
 */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(<<[^>]*?>>)/g);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith("<<") && p.endsWith(">>")
          ? <mark key={i} className="rounded bg-[#FEF3C7] px-0.5 text-[#141414]">{p.slice(2, -2)}</mark>
          : <span key={i}>{p}</span>,
      )}
    </span>
  );
}

export default async function FirmSearch({ searchParams }: { searchParams: Promise<{ firm?: string; q?: string; kind?: string }> }) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));
  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
      </Alert>
    );
  }
  const { supabase, firmId } = ctx;
  const q = (sp.q ?? "").trim();
  const kind = KINDS.some(([k]) => k === sp.kind) ? (sp.kind as SearchKind) : null;

  let hits: SearchHit[] = [];
  let failed = false;
  if (q.length >= 2) {
    const { data, error } = await supabase.rpc("search_docket", {
      p_q: q, p_firm: firmId, p_kinds: kind ? [kind] : null, p_limit: LIMIT,
    });
    // A read that did not come back is said, never shown as "nothing found" — the difference
    // between "there is none" and "we could not look" matters most on a search screen.
    failed = Boolean(error);
    hits = (data ?? []) as SearchHit[];
  }

  const keep = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams();
    if (sp.firm) p.set("firm", sp.firm);
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(extra)) { if (v === null) p.delete(k); else p.set(k, v); }
    return `/firm/search?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-3.5">
      <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Search</h1>

      <Card>
        <form method="GET" action="/firm/search" className="flex flex-col gap-2 p-[15px]">
          {sp.firm && <input type="hidden" name="firm" value={sp.firm} />}
          {kind && <input type="hidden" name="kind" value={kind} />}
          <label className="text-[13px] font-semibold text-[#141414]" htmlFor="q">
            A name, a word, a suit number, a reference
          </label>
          <div className="flex gap-2">
            <input
              id="q" name="q" type="search" defaultValue={q} autoFocus minLength={2} maxLength={200}
              placeholder="Okonkwo · LD/4521/2026 · quicksilver covenant"
              className="min-h-11 w-full rounded-lg border border-gray-300 px-3 text-[15px] text-gray-900 focus:border-[#141414] focus:outline-none"
            />
            <button type="submit" className="min-h-11 shrink-0 rounded-lg bg-[#141414] px-4 text-[14px] font-medium text-white">
              Search
            </button>
          </div>
          {/* Said here rather than discovered later. */}
          <p className="text-[11.5px] leading-[1.45] text-[#57534E]">
            Docket searches what it holds as text — matters, updates, messages, notes and the
            <em> names</em> of documents. It does not read inside an uploaded file, so a clause in a
            scanned agreement is not findable yet.
          </p>
        </form>
      </Card>

      {q.length > 0 && q.length < 2 && (
        <Alert kind="info">Two characters or more, or the answer is most of the firm.</Alert>
      )}

      {failed && (
        <Alert kind="error" title="The search did not come back">
          Nothing was found because nothing could be looked at — this is not an empty result. Try again.
        </Alert>
      )}

      {q.length >= 2 && !failed && (
        <>
          <div className="flex flex-wrap gap-2">
            <Link
              href={keep({ kind: null })}
              className={cn("min-h-9 rounded-full border px-3 py-1.5 text-[12.5px]",
                kind === null ? "border-[#141414] bg-[#141414] text-white" : "border-gray-300 bg-white text-gray-700 hover:border-[#141414]")}
            >
              Everything
            </Link>
            {KINDS.map(([k, label]) => (
              <Link
                key={k}
                href={keep({ kind: k })}
                className={cn("min-h-9 rounded-full border px-3 py-1.5 text-[12.5px]",
                  kind === k ? "border-[#141414] bg-[#141414] text-white" : "border-gray-300 bg-white text-gray-700 hover:border-[#141414]")}
              >
                {label}
              </Link>
            ))}
          </div>

          <Card>
            <CardHeader
              title={hits.length === 0
                ? "Nothing matched"
                : `${hits.length}${hits.length === LIMIT ? "+" : ""} result${hits.length === 1 ? "" : "s"}`}
            />
            {hits.length === 0 ? (
              <EmptyState
                title="Nothing matched that"
                hint="Try a shorter word, a suit number, or a client's surname. The contents of uploaded files are not searched."
              />
            ) : (
              <ul>
                {hits.map((hit) => (
                  <li key={`${hit.kind}:${hit.id}`}>
                    <Link
                      href={hrefFor(hit)}
                      className="flex flex-col gap-1 border-t border-[#F0EEEA] px-[15px] py-3 first:border-t-0 hover:bg-gray-50"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 text-[13.5px] font-semibold text-[#141414]">{hit.title}</span>
                        <span className="shrink-0 text-[11px] uppercase tracking-wide text-[#57534E]">
                          {KIND_LABEL.get(hit.kind) ?? hit.kind}
                        </span>
                      </span>
                      {hit.snippet && (
                        <span className="text-[12.5px] leading-[1.5] text-[#57534E]">
                          <Snippet text={hit.snippet} />
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {hits.length === LIMIT && (
            <p className="px-1 text-[11.5px] text-[#57534E]">
              The first {LIMIT} are shown, best match first. Narrow it with a kind above, or add a word.
            </p>
          )}
        </>
      )}
    </div>
  );
}
