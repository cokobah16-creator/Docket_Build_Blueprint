"use client";

// The other side, and whether acting is clear. Two things on one panel because one feeds the
// other: the adverse-party register is what a conflict check searches, on this matter and on
// every later one.
//
// Rules enforced here:
//  · run_conflict_check() searches this firm's own register and records the search;
//    decide_conflict_check() records the lawyer's decision, once. Docket never decides.
//  · Every write runs as the signed-in staff member through a server action: staff_w()
//    and the wall decide, no service key is used, and a refusal is shown word for word.
//  · A restricted matter the viewer cannot see is reported as a match without its identity,
//    with who leads it — that is what the database returns, and the panel says no more.
//  · Nothing here is ever shown to a client: the register and the checks are firm work product.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { addAdverseParty, removeAdverseParty, runConflictCheck } from "@/lib/actions/matters";
import { DecideCheck, MatchList, OUTCOME_LABELS, isCleared } from "@/components/firm/conflict-decision";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatWhen } from "@/lib/time";
import type { AdversePartyRow, ConflictCheckRow, ConflictMatch } from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

const RELATION_LABELS: Record<AdversePartyRow["relation"], string> = {
  adverse: "Adverse party",
  co_party: "Co-party",
  witness: "Witness",
  related: "Related person or body",
};


export function ConflictsPanel({
  matterId, firmId, adverse, checks, names, required, timezone,
}: {
  matterId: string;
  firmId: string;
  adverse: AdversePartyRow[];
  checks: ConflictCheckRow[];
  names: Record<string, string>;
  /** firms.conflict_checks_required */
  required: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AdversePartyRow["kind"]>("person");
  const [relation, setRelation] = useState<AdversePartyRow["relation"]>("adverse");
  const [aliases, setAliases] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);

  const cleared = isCleared(checks);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const r = await addAdverseParty(matterId, firmId, {
      name,
      kind,
      relation,
      aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
      note: note.trim() || null,
    });
    setBusy(false);
    if (r?.error) { setError(r.error); return; }
    setName(""); setAliases(""); setNote("");
    router.refresh();
  }

  async function remove(id: string) {
    setError(null);
    setWorking(id);
    const r = await removeAdverseParty(id, matterId);
    setWorking(null);
    if (r?.error) { setError(r.error); return; }
    router.refresh();
  }

  async function run() {
    setError(null);
    setRunning(true);
    const r = await runConflictCheck(firmId, { matterId });
    setRunning(false);
    if ("error" in r) { setError(r.error); return; }
    setDeciding(r.checkId);
    router.refresh();
  }

  return (
    <div className="divide-y divide-gray-100 border-t border-gray-100">
      {error && <div className="px-4 py-4 sm:px-5"><Alert kind="error" title="That was refused">{error}</Alert></div>}

      <section className="px-4 py-4 sm:px-5">
        <h3 className="font-heading text-base font-semibold text-gray-900">The other side</h3>
        <p className="mt-0.5 text-sm text-gray-600">
          Everyone a conflict check must know about: the opposing party, co-parties, witnesses, related companies.
          Aliases catch the other spellings. The client never sees this list.
        </p>
        {adverse.length > 0 && (
          <ul className="mt-3 divide-y divide-gray-100">
            {adverse.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {p.name}
                    <span className="ml-2 text-xs font-normal text-gray-500">{RELATION_LABELS[p.relation]} · {p.kind === "organisation" ? "organisation" : "person"}</span>
                  </p>
                  {p.aliases.length > 0 && <p className="text-xs text-gray-600">Also known as {p.aliases.join(", ")}</p>}
                  {p.note && <p className="mt-0.5 text-xs text-gray-600">{p.note}</p>}
                </div>
                <Button size="sm" variant="ghost" disabled={working === p.id} onClick={() => remove(p.id)}>
                  {working === p.id ? "Removing…" : "Remove"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="adverse-name" className="text-sm font-medium text-gray-900">Name</label>
              <input id="adverse-name" type="text" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="As it appears on the process" />
            </div>
            <div>
              <label htmlFor="adverse-aliases" className="text-sm font-medium text-gray-900">Also known as</label>
              <input id="adverse-aliases" type="text" maxLength={600} value={aliases} onChange={(e) => setAliases(e.target.value)} className={field} placeholder="Other spellings, separated by commas" />
            </div>
            <div>
              <label htmlFor="adverse-kind" className="text-sm font-medium text-gray-900">Who</label>
              <select id="adverse-kind" value={kind} onChange={(e) => setKind(e.target.value === "organisation" ? "organisation" : "person")} className={field}>
                <option value="person">A person</option>
                <option value="organisation">A company or body</option>
              </select>
            </div>
            <div>
              <label htmlFor="adverse-relation" className="text-sm font-medium text-gray-900">Their part</label>
              <select id="adverse-relation" value={relation} onChange={(e) => setRelation(e.target.value as AdversePartyRow["relation"])} className={field}>
                {(Object.keys(RELATION_LABELS) as Array<AdversePartyRow["relation"]>).map((r) => (
                  <option key={r} value={r}>{RELATION_LABELS[r]}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="adverse-note" className="text-sm font-medium text-gray-900">Note <span className="text-gray-500">(optional)</span></label>
            <input id="adverse-note" type="text" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
          </div>
          <Button type="submit" size="sm" disabled={busy || name.trim().length < 2}>{busy ? "Adding…" : "Add to the other side"}</Button>
        </form>
      </section>

      <section className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-heading text-base font-semibold text-gray-900">Conflict checks</h3>
            <p className="mt-0.5 text-sm text-gray-600">
              A check searches the firm&rsquo;s own register for everyone this matter names — the client, the other side,
              the cause title — against every other matter, and records what it found. You decide; Docket only finds.
            </p>
          </div>
          <Button type="button" size="sm" onClick={() => void run()} disabled={running}>
            {running ? "Searching…" : "Run a check now"}
          </Button>
        </div>

        {required && (
          cleared ? (
            <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Cleared. A client may be joined to this matter.
            </p>
          ) : (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This firm requires a cleared check before a client is joined to a matter. Until the latest decided check here is
              <em> clear</em> or <em>waived</em>, an invitation as client and any other way of adding one will be refused.
            </p>
          )
        )}

        {checks.length === 0 ? (
          <p className="mt-3 text-sm text-gray-600">No check has been run on this matter.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {checks.map((c) => (
              <li key={c.id} className="rounded-lg border border-gray-200 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">
                    {c.outcome ? OUTCOME_LABELS[c.outcome] : "Undecided"}
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {c.matches.length === 1 ? "1 match" : `${c.matches.length} matches`} for {(c.query.names?.length ?? 0) > 0 ? c.query.names!.join(", ") : (c.query.keys ?? []).join(", ")}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500">
                    Run {formatWhen(c.created_at, timezone)}{c.created_by ? ` by ${names[c.created_by] ?? "a colleague"}` : ""}
                  </p>
                </div>
                {c.outcome && (
                  <p className="mt-1 text-xs text-gray-600">
                    Decided {c.reviewed_at ? formatWhen(c.reviewed_at, timezone) : ""}{c.reviewed_by ? ` by ${names[c.reviewed_by] ?? "a colleague"}` : ""}
                    {c.decision_note ? ` — ${c.decision_note}` : ""}
                  </p>
                )}
                <div className="mt-2">
                  <MatchList matches={c.matches} names={names} />
                </div>
                {!c.outcome && (deciding === c.id ? (
                  <DecideCheck checkId={c.id} matterId={matterId} onDone={() => { setDeciding(null); router.refresh(); }} />
                ) : (
                  <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setDeciding(c.id)}>Decide</Button>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
