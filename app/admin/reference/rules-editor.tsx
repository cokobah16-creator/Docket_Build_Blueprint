"use client";

// The rules of court, as the platform enters them: name, citation, version, in force from; and
// under each, the periods — how many days, counted how, from which event. Nothing is seeded and
// nothing is guessed: every row here is typed from the Rules by a platform administrator with a
// second factor, and a deadline counted from a provision keeps a snapshot of it.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteRuleProvision, retireCourtRule, saveCourtRule, saveRuleProvision, type ReferenceResult } from "@/lib/actions/reference";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { COURT_LEVEL_LABELS, NG_STATES, NG_STATE_OPTIONS } from "@/lib/nigeria";
import { DEADLINE_TRIGGER_LABELS, DEADLINE_TRIGGERS, type CourtRuleRow, type RuleProvisionRow } from "@/lib/db/types";

export interface RuleView extends CourtRuleRow { provisions: RuleProvisionRow[] }

const field = "mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 focus:border-brand focus:outline focus:outline-2 focus:outline-brand";
const labelClass = "block text-sm font-medium text-gray-800";
const primaryButton = "min-h-[44px] rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50";
const quietButton = "min-h-[44px] rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-black/5 disabled:opacity-50";

const EMPTY_RULE = { level: "", stateCode: "", name: "", citation: "", version: "", effectiveFrom: "", note: "" };
const EMPTY_PROVISION: { key: string; label: string; citation: string; triggerKind: string; period: number; unit: "days" | "months"; countMode: "calendar" | "clear" | "working"; excludesVacation: boolean; rollsForward: boolean; note: string } =
  { key: "", label: "", citation: "", triggerKind: "service_effected", period: 14, unit: "days", countMode: "calendar", excludesVacation: false, rollsForward: true, note: "" };

export function RulesEditor({ rules }: { rules: RuleView[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [result, setResult] = useState<ReferenceResult | null>(null);
  const [ruleDraft, setRuleDraft] = useState<typeof EMPTY_RULE | null>(null);
  const [provisionFor, setProvisionFor] = useState<string | null>(null);
  const [provisionDraft, setProvisionDraft] = useState(EMPTY_PROVISION);
  const [retireFor, setRetireFor] = useState<string | null>(null);
  const [retireOn, setRetireOn] = useState("");

  function done(outcome: ReferenceResult) {
    setResult(outcome);
    if (outcome.ok) { setRuleDraft(null); setProvisionFor(null); setRetireFor(null); setProvisionDraft(EMPTY_PROVISION); router.refresh(); }
  }

  return (
    <Card>
      <CardHeader
        title="Rules of court"
        action={!ruleDraft ? <button type="button" className={quietButton} onClick={() => { setRuleDraft(EMPTY_RULE); setResult(null); }}>Enter a set of rules</button> : undefined}
      />
      <CardBody className="space-y-4">
        <p className="text-sm text-gray-600">
          What a firm&apos;s deadline is counted from. Each set of rules names its court level and state (or every court), its
          citation and version, and the day it came into force; each provision under it is one period. Nothing here is
          seeded — type it from the Rules, and retire a set when a new edition replaces it. A deadline already counted keeps
          the wording it was counted under.
        </p>
        {result?.error && <Alert kind="error">{result.error}</Alert>}
        {result?.ok && result.notice && <Alert kind="success">{result.notice}</Alert>}

        {ruleDraft && (
          <form
            className="grid gap-3 rounded-lg border border-gray-200 p-4 sm:grid-cols-2"
            onSubmit={(e) => { e.preventDefault(); start(async () => done(await saveCourtRule(ruleDraft))); }}
          >
            <div className="sm:col-span-2">
              <label htmlFor="rule-name" className={labelClass}>Name</label>
              <input id="rule-name" type="text" required maxLength={200} value={ruleDraft.name} onChange={(e) => setRuleDraft({ ...ruleDraft, name: e.target.value })} placeholder="High Court of Lagos State (Civil Procedure) Rules" className={field} />
            </div>
            <div>
              <label htmlFor="rule-level" className={labelClass}>Court level</label>
              <select id="rule-level" value={ruleDraft.level} onChange={(e) => setRuleDraft({ ...ruleDraft, level: e.target.value })} className={field}>
                <option value="">Every court</option>
                {Object.entries(COURT_LEVEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rule-state" className={labelClass}>State</label>
              <select id="rule-state" value={ruleDraft.stateCode} onChange={(e) => setRuleDraft({ ...ruleDraft, stateCode: e.target.value })} className={field}>
                <option value="">Every state</option>
                {NG_STATE_OPTIONS.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rule-version" className={labelClass}>Version</label>
              <input id="rule-version" type="text" required maxLength={60} value={ruleDraft.version} onChange={(e) => setRuleDraft({ ...ruleDraft, version: e.target.value })} placeholder="2019" className={field} />
            </div>
            <div>
              <label htmlFor="rule-from" className={labelClass}>In force from</label>
              <input id="rule-from" type="date" required value={ruleDraft.effectiveFrom} onChange={(e) => setRuleDraft({ ...ruleDraft, effectiveFrom: e.target.value })} className={field} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="rule-citation" className={labelClass}>Citation</label>
              <input id="rule-citation" type="text" maxLength={300} value={ruleDraft.citation} onChange={(e) => setRuleDraft({ ...ruleDraft, citation: e.target.value })} className={field} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="rule-note" className={labelClass}>Note</label>
              <input id="rule-note" type="text" maxLength={1000} value={ruleDraft.note} onChange={(e) => setRuleDraft({ ...ruleDraft, note: e.target.value })} className={field} />
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" disabled={busy} className={primaryButton}>{busy ? "Saving…" : "Save the rules"}</button>
              <button type="button" className={quietButton} onClick={() => setRuleDraft(null)}>Cancel</button>
            </div>
          </form>
        )}

        {rules.length === 0 ? (
          <EmptyState title="No rules of court are entered" hint="Until one is, a firm can only give a deadline's day itself. Enter the set a firm's courts use, then its periods." />
        ) : (
          <ul className="divide-y divide-gray-100">
            {rules.map((r) => (
              <li key={r.id} className="py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">
                    {r.name} <span className="font-normal text-gray-600">({r.version})</span>
                    {r.retired_on ? <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">retired {r.retired_on}</span> : null}
                  </p>
                  <p className="text-xs text-gray-600">{r.level ? COURT_LEVEL_LABELS[r.level] ?? r.level : "every court"} · {r.state_code ? NG_STATES[r.state_code] ?? r.state_code : "every state"} · from {r.effective_from}</p>
                </div>
                {r.citation && <p className="text-xs text-gray-600">{r.citation}</p>}
                {r.note && <p className="text-xs text-gray-500">{r.note}</p>}
                {r.provisions.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {r.provisions.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-gray-800">
                        <span>
                          <span className="font-medium">{p.label}</span>
                          <span className="text-gray-600"> — {p.period} {p.unit === "months" ? "calendar months" : `${p.count_mode} days`} from {DEADLINE_TRIGGER_LABELS[p.trigger_kind].toLowerCase()}{p.excludes_vacation ? ", time stopped in vacation" : ""}{!p.rolls_forward ? ", no rolling forward" : ""}{p.citation ? ` · ${p.citation}` : ""}</span>
                          <span className="ml-1 font-mono text-xs text-gray-500">{p.key}</span>
                        </span>
                        <button type="button" className="text-xs text-red-800 underline" disabled={busy} onClick={() => start(async () => done(await deleteRuleProvision(p.id)))}>Remove</button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-amber-800">No provision yet — this set counts nothing until one is entered.</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {provisionFor !== r.id && <button type="button" className={quietButton} onClick={() => { setProvisionFor(r.id); setProvisionDraft(EMPTY_PROVISION); setResult(null); }}>Add a provision</button>}
                  {!r.retired_on && retireFor !== r.id && <button type="button" className={quietButton} onClick={() => { setRetireFor(r.id); setRetireOn(""); setResult(null); }}>Retire…</button>}
                </div>
                {retireFor === r.id && (
                  <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => done(await retireCourtRule(r.id, retireOn))); }}>
                    <div>
                      <label htmlFor={`retire-${r.id}`} className={labelClass}>Retired from</label>
                      <input id={`retire-${r.id}`} type="date" required value={retireOn} onChange={(e) => setRetireOn(e.target.value)} className={field} />
                    </div>
                    <button type="submit" disabled={busy} className={primaryButton}>Retire</button>
                    <button type="button" className={quietButton} onClick={() => setRetireFor(null)}>Cancel</button>
                  </form>
                )}
                {provisionFor === r.id && (
                  <form
                    className="mt-3 grid gap-3 rounded-lg border border-gray-200 p-4 sm:grid-cols-3"
                    onSubmit={(e) => { e.preventDefault(); start(async () => done(await saveRuleProvision({ ...provisionDraft, ruleId: r.id }))); }}
                  >
                    <div>
                      <label htmlFor={`pk-${r.id}`} className={labelClass}>Key</label>
                      <input id={`pk-${r.id}`} type="text" required pattern="[a-z0-9_]{2,60}" value={provisionDraft.key} onChange={(e) => setProvisionDraft({ ...provisionDraft, key: e.target.value })} placeholder="defence_days" className={field} />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor={`pl-${r.id}`} className={labelClass}>What it is for</label>
                      <input id={`pl-${r.id}`} type="text" required maxLength={200} value={provisionDraft.label} onChange={(e) => setProvisionDraft({ ...provisionDraft, label: e.target.value })} placeholder="Statement of defence" className={field} />
                    </div>
                    <div>
                      <label htmlFor={`pt-${r.id}`} className={labelClass}>Counted from</label>
                      <select id={`pt-${r.id}`} value={provisionDraft.triggerKind} onChange={(e) => setProvisionDraft({ ...provisionDraft, triggerKind: e.target.value })} className={field}>
                        {DEADLINE_TRIGGERS.map((t) => <option key={t} value={t}>{DEADLINE_TRIGGER_LABELS[t]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`pp-${r.id}`} className={labelClass}>Period</label>
                      <input id={`pp-${r.id}`} type="number" min={1} max={3660} required value={provisionDraft.period} onChange={(e) => setProvisionDraft({ ...provisionDraft, period: Number(e.target.value) })} className={field} />
                    </div>
                    <div>
                      <label htmlFor={`pu-${r.id}`} className={labelClass}>Unit</label>
                      <select id={`pu-${r.id}`} value={provisionDraft.unit} onChange={(e) => setProvisionDraft({ ...provisionDraft, unit: e.target.value as "days" | "months" })} className={field}>
                        <option value="days">days</option>
                        <option value="months">calendar months</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`pm-${r.id}`} className={labelClass}>Counted how</label>
                      <select id={`pm-${r.id}`} value={provisionDraft.countMode} onChange={(e) => setProvisionDraft({ ...provisionDraft, countMode: e.target.value as "calendar" | "clear" | "working" })} className={field} disabled={provisionDraft.unit === "months"}>
                        <option value="calendar">calendar days</option>
                        <option value="clear">clear days</option>
                        <option value="working">working (sitting) days</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor={`pc-${r.id}`} className={labelClass}>Citation</label>
                      <input id={`pc-${r.id}`} type="text" maxLength={300} value={provisionDraft.citation} onChange={(e) => setProvisionDraft({ ...provisionDraft, citation: e.target.value })} placeholder="Order 17 rule 1" className={field} />
                    </div>
                    <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800">
                      <input type="checkbox" checked={provisionDraft.excludesVacation} onChange={(e) => setProvisionDraft({ ...provisionDraft, excludesVacation: e.target.checked })} className="h-5 w-5" /> Time stops during a vacation
                    </label>
                    <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800">
                      <input type="checkbox" checked={provisionDraft.rollsForward} onChange={(e) => setProvisionDraft({ ...provisionDraft, rollsForward: e.target.checked })} className="h-5 w-5" /> A last day the court does not sit rolls forward
                    </label>
                    <div className="sm:col-span-3">
                      <label htmlFor={`pn-${r.id}`} className={labelClass}>Note</label>
                      <input id={`pn-${r.id}`} type="text" maxLength={1000} value={provisionDraft.note} onChange={(e) => setProvisionDraft({ ...provisionDraft, note: e.target.value })} className={field} />
                    </div>
                    <div className="flex flex-wrap gap-2 sm:col-span-3">
                      <button type="submit" disabled={busy} className={primaryButton}>{busy ? "Saving…" : "Save the provision"}</button>
                      <button type="button" className={quietButton} onClick={() => setProvisionFor(null)}>Cancel</button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
