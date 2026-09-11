"use client";

// The matter's legal diary: where each court date came from, and the deadlines — counted by the
// database, shown day by day with what the count relied on, confirmed by a lawyer.
//
// Rules enforced here: nothing is computed in the browser. The preview and the saved row are the
// same count_deadline() call; a provision's days, unit and mode are read from the rule the platform
// entered; the refusal of a rule that was not in force, or for another court, is the database's
// sentence shown whole. A calendar day is a string end to end. Deadlines are the firm's own: the
// client never sees this panel's data.

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { attachCourtEventSource, computeDeadline, confirmDeadline, dischargeDeadline, previewDeadline } from "@/lib/actions/deadlines";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatDay, todayIn } from "@/lib/days";
import { formatWhen } from "@/lib/time";
import { COURT_LEVEL_LABELS, NG_STATES } from "@/lib/nigeria";
import {
  courtDateProvenance, DEADLINE_TRIGGER_LABELS, DEADLINE_TRIGGERS,
  type CauseListRow, type CourtRuleRow, type DeadlineCalculation, type DeadlineTrigger, type FirmDeadlineRow, type RuleProvisionRow,
} from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

export interface SittingOption { updateId: string; outcome: string; day: string; label: string }
export interface RuleWithProvisions extends CourtRuleRow { provisions: RuleProvisionRow[] }

const OUTCOME_TRIGGER: Record<string, DeadlineTrigger> = {
  judgment_delivered: "judgment_delivered", ruling_delivered: "ruling_delivered",
  hearing_held: "hearing_held", mention: "hearing_held", adjourned: "hearing_held",
};

const STATUS_TONE: Record<string, string> = {
  proposed: "bg-amber-100 text-amber-900", confirmed: "bg-emerald-100 text-emerald-900",
  discharged: "bg-gray-100 text-gray-700", superseded: "bg-gray-100 text-gray-500",
};

/** The count in words: what was counted, what was skipped, what was rolled, and what it leaned on. */
function CalculationNotes({ calc }: { calc: DeadlineCalculation }) {
  if (calc.count_mode === "manual") return <p className="text-xs text-gray-600">Entered by the firm — no rule was applied.</p>;
  const cov = calc.coverage;
  return (
    <div className="space-y-1 text-xs text-gray-600">
      <p>
        {calc.unit === "months" ? `${calc.period} calendar month${calc.period === 1 ? "" : "s"}` : `${calc.counted_days ?? calc.period} ${calc.count_mode} day${(calc.counted_days ?? calc.period) === 1 ? "" : "s"}`}
        {" "}from {formatDay(String(calc.from))}
        {calc.excludes_vacation ? ", time stopped during vacation" : ""}
        {calc.rolls_forward === false ? ", no rolling forward" : ""}.
      </p>
      {calc.skipped && calc.skipped.length > 0 && (
        <p>Not counted: {calc.skipped.map((s) => `${formatDay(s.day)} (${s.reason})`).join("; ")}.</p>
      )}
      {calc.rolled && calc.rolled.length > 0 && (
        <p>Rolled past: {calc.rolled.map((s) => `${formatDay(s.day)} (${s.reason})`).join("; ")}.</p>
      )}
      {cov && !cov.any_vacation_calendar && (
        <p className="font-medium text-amber-800">No vacation calendar is entered for this court on Docket, so the count assumed time ran throughout. Check the court&apos;s practice direction.</p>
      )}
      {cov && !cov.holidays_entered_for_year && (
        <p className="font-medium text-amber-800">No public holidays are entered for the year the deadline falls in, so none were skipped.</p>
      )}
      {cov && cov.any_vacation_calendar && (
        <p>Reference data consulted: {cov.vacation_rows_in_range} vacation window{cov.vacation_rows_in_range === 1 ? "" : "s"} and {cov.holiday_rows_in_range} holiday{cov.holiday_rows_in_range === 1 ? "" : "s"} in the period.</p>
      )}
    </div>
  );
}

export function DeadlinesPanel({
  matterId, firmId, timezone, court, deadlines, rules, sittings, courtEvents, documents, names, canConfirm,
}: {
  matterId: string;
  firmId: string;
  timezone: string;
  court: { level: string | null; state_code: string | null; name: string | null } | null;
  deadlines: FirmDeadlineRow[];
  rules: RuleWithProvisions[];
  sittings: SittingOption[];
  courtEvents: CauseListRow[];
  documents: Array<{ id: string; name: string }>;
  names: Record<string, string>;
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [supersedes, setSupersedes] = useState<string | null>(null);
  const [sittingId, setSittingId] = useState("");
  const [triggerKind, setTriggerKind] = useState<DeadlineTrigger>("service_effected");
  const [triggerOn, setTriggerOn] = useState(todayIn(timezone));
  const [provisionId, setProvisionId] = useState("");
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<DeadlineCalculation | null>(null);
  const [dischargeFor, setDischargeFor] = useState<string | null>(null);
  const [dischargeNote, setDischargeNote] = useState("");
  const [attachFor, setAttachFor] = useState<string | null>(null);
  const [attachDoc, setAttachDoc] = useState("");
  const [attachRef, setAttachRef] = useState("");
  const [attachSource, setAttachSource] = useState<"hearing_notice" | "cause_list">("hearing_notice");

  // Rules that could apply: for this court's level and state, or for every court; in force on the day.
  const applicable = useMemo(() => rules
    .filter((r) => (!r.level || r.level === court?.level) && (!r.state_code || r.state_code === court?.state_code))
    .filter((r) => r.effective_from <= triggerOn && (!r.retired_on || r.retired_on > triggerOn))
    .map((r) => ({ ...r, provisions: r.provisions.filter((p) => p.trigger_kind === triggerKind) }))
    .filter((r) => r.provisions.length > 0), [rules, court, triggerOn, triggerKind]);
  const provision = useMemo(() => applicable.flatMap((r) => r.provisions).find((p) => p.id === provisionId) ?? null, [applicable, provisionId]);

  function pickSitting(id: string) {
    setSittingId(id);
    const s = sittings.find((x) => x.updateId === id);
    if (!s) return;
    setTriggerOn(s.day);
    setTriggerKind(OUTCOME_TRIGGER[s.outcome] ?? "other");
    setPreview(null);
  }

  async function doPreview() {
    if (!provision) return;
    setBusy("preview"); setError(null);
    try {
      const r = await previewDeadline({
        from: triggerOn, period: provision.period, unit: provision.unit, mode: provision.count_mode,
        level: court?.level ?? null, stateCode: court?.state_code ?? null, excludesVacation: provision.excludes_vacation, rollsForward: provision.rolls_forward,
      });
      if ("error" in r) setError(r.error); else setPreview(r.calculation);
    } catch { setError("The count did not come back — the connection may have dropped."); }
    finally { setBusy(null); }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy("save"); setError(null);
    try {
      const sitting = sittings.find((x) => x.updateId === sittingId);
      const r = await computeDeadline({
        matterId, triggerKind, triggerOn, provisionId: provisionId || null, dueOn: provisionId ? null : dueOn || null, title: title || null,
        triggerRef: sitting ? { update_id: sitting.updateId, outcome: sitting.outcome } : {}, supersedes, note: note || null,
      });
      if ("error" in r) { setError(r.error); return; }
      setOpen(false); setSupersedes(null); setPreview(null); setTitle(""); setDueOn(""); setNote(""); setProvisionId(""); setSittingId("");
      router.refresh();
    } catch { setError("Nothing was saved — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  async function confirm(id: string) {
    setBusy(id); setError(null);
    try { const r = await confirmDeadline(id, matterId); if (r?.error) setError(r.error); else router.refresh(); }
    catch { setError("The confirmation did not go through — try again."); }
    finally { setBusy(null); }
  }

  async function discharge(id: string) {
    setBusy(id); setError(null);
    try { const r = await dischargeDeadline(id, matterId, dischargeNote); if (r?.error) setError(r.error); else { setDischargeFor(null); setDischargeNote(""); router.refresh(); } }
    catch { setError("The discharge did not go through — try again."); }
    finally { setBusy(null); }
  }

  function recompute(d: FirmDeadlineRow) {
    setSupersedes(d.id); setOpen(true); setTriggerKind(d.trigger_kind); setTriggerOn(d.trigger_on);
    setProvisionId(d.provision_id ?? ""); setTitle(d.title); setDueOn(d.calculation.count_mode === "manual" ? d.due_on : ""); setPreview(null);
  }

  async function attach(eventId: string) {
    setBusy(eventId); setError(null);
    try {
      const r = await attachCourtEventSource({ eventId, matterId, documentId: attachDoc || null, ref: attachRef || null, source: attachSource });
      if (r?.error) setError(r.error); else { setAttachFor(null); setAttachDoc(""); setAttachRef(""); router.refresh(); }
    } catch { setError("Nothing was attached — try again."); }
    finally { setBusy(null); }
  }

  const live = deadlines.filter((d) => d.status === "proposed" || d.status === "confirmed");
  const closed = deadlines.filter((d) => d.status === "discharged" || d.status === "superseded");
  const today = todayIn(timezone);

  return (
    <div className="space-y-6">
      {error && <Alert kind="error">{error}</Alert>}

      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">Court dates, and where each came from</h3>
        </div>
        {courtEvents.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-gray-600">No court date is open on this matter.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {courtEvents.map((ev) => {
              const prov = courtDateProvenance(ev);
              return (
                <li key={ev.court_event_id} className="px-5 py-3">
                  <p className="text-sm font-medium text-gray-900">{formatWhen(ev.scheduled_at, timezone, { dateStyle: "full", timeStyle: "short" })}{ev.purpose ? ` · ${ev.purpose}` : ""}</p>
                  <p className="text-xs text-gray-600">
                    {ev.court ?? "Court not recorded"}
                    {prov === "court" ? " · from the court — notice or reference on file" : prov === "claimed" ? " · marked as from a hearing notice, with nothing attached" : " · as recorded by the firm"}
                    {ev.source_ref ? ` · ${ev.source_ref}` : ""}
                    {ev.created_by ? ` · entered by ${names[ev.created_by] ?? "a colleague"}` : ""}
                    {ev.confirmed_by ? ` · confirmed by ${names[ev.confirmed_by] ?? "a colleague"}` : ""}
                  </p>
                  {attachFor === ev.court_event_id ? (
                    <div className="mt-2 space-y-2 rounded-lg border border-gray-200 p-3">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="text-sm text-gray-900">The notice on file
                          <select value={attachDoc} onChange={(e) => setAttachDoc(e.target.value)} className={field}>
                            <option value="">None of the documents</option>
                            {documents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </label>
                        <label className="text-sm text-gray-900">Reference
                          <input type="text" maxLength={200} value={attachRef} onChange={(e) => setAttachRef(e.target.value)} placeholder="Cause list of 4 May, item 12" className={field} />
                        </label>
                        <label className="text-sm text-gray-900">Came as
                          <select value={attachSource} onChange={(e) => setAttachSource(e.target.value as "hearing_notice" | "cause_list")} className={field}>
                            <option value="hearing_notice">A hearing notice</option>
                            <option value="cause_list">The cause list</option>
                          </select>
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" disabled={busy === ev.court_event_id} onClick={() => void attach(ev.court_event_id)}>Attach and confirm the date</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setAttachFor(null)}>Cancel</Button>
                      </div>
                      <p className="text-xs text-gray-500">Attaching the evidence records you as the lawyer who confirmed this date.</p>
                    </div>
                  ) : (
                    <button type="button" className="mt-1 text-xs font-medium text-brand underline" onClick={() => { setAttachFor(ev.court_event_id); setError(null); }}>
                      {prov === "court" ? "Change the evidence" : "Attach the notice or reference"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Deadlines</h3>
            <p className="text-xs text-gray-600">Counted by Docket from the rules the platform has entered, or given by you; a lawyer confirms each. The client never sees these.</p>
          </div>
          {!open && <Button type="button" size="sm" onClick={() => { setOpen(true); setSupersedes(null); setError(null); }}>Add a deadline</Button>}
        </div>

        {open && (
          <form onSubmit={(e) => void save(e)} className="space-y-3 border-t border-gray-100 px-5 py-4">
            {supersedes && <Alert kind="info">This count will supersede the earlier deadline; the old row stays, marked superseded.</Alert>}
            {sittings.length > 0 && (
              <label className="block text-sm text-gray-900">From a sitting on the timeline
                <select value={sittingId} onChange={(e) => pickSitting(e.target.value)} className={field}>
                  <option value="">Not from a sitting</option>
                  {sittings.map((s) => <option key={s.updateId} value={s.updateId}>{s.label}</option>)}
                </select>
              </label>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-gray-900">Triggering event
                <select value={triggerKind} onChange={(e) => { setTriggerKind(e.target.value as DeadlineTrigger); setProvisionId(""); setPreview(null); }} className={field}>
                  {DEADLINE_TRIGGERS.map((t) => <option key={t} value={t}>{DEADLINE_TRIGGER_LABELS[t]}</option>)}
                </select>
              </label>
              <label className="text-sm text-gray-900">On (the court&apos;s calendar day)
                <input type="date" required value={triggerOn} onChange={(e) => { setTriggerOn(e.target.value); setPreview(null); }} className={field} />
              </label>
            </div>
            <label className="block text-sm text-gray-900">Rule
              <select value={provisionId} onChange={(e) => { setProvisionId(e.target.value); setPreview(null); }} className={field}>
                <option value="">No rule — I will give the day</option>
                {applicable.map((r) => (
                  <optgroup key={r.id} label={`${r.name} (${r.version})`}>
                    {r.provisions.map((p) => <option key={p.id} value={p.id}>{p.label} — {p.period} {p.unit === "months" ? "months" : `${p.count_mode} days`}{p.citation ? ` · ${p.citation}` : ""}</option>)}
                  </optgroup>
                ))}
              </select>
              <span className="mt-1 block text-xs text-gray-500">
                {court?.level ? `Rules for ${COURT_LEVEL_LABELS[court.level] ?? court.level}${court.state_code ? ` in ${NG_STATES[court.state_code] ?? court.state_code}` : ""}, in force on the day, counting from this event.` : "This matter has no court in the directory, so only rules for every court are offered."}
                {applicable.length === 0 ? " None is entered on Docket for this event; give the day yourself, or ask Docket to enter the rule." : ""}
              </span>
            </label>
            {provision ? (
              <div className="space-y-2">
                <Button type="button" size="sm" variant="ghost" disabled={busy === "preview"} onClick={() => void doPreview()}>{busy === "preview" ? "Counting…" : "Count it"}</Button>
                {preview && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-sm font-semibold text-gray-900">Falls due {formatDay(preview.due_on)}</p>
                    <CalculationNotes calc={preview} />
                  </div>
                )}
              </div>
            ) : (
              <label className="block text-sm text-gray-900">Falls due on
                <input type="date" required={!provisionId} value={dueOn} onChange={(e) => setDueOn(e.target.value)} className={field} />
              </label>
            )}
            <label className="block text-sm text-gray-900">Title{provision ? " (blank keeps the rule's)" : ""}
              <input type="text" maxLength={200} required={!provision} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={provision?.label ?? "File the written address"} className={field} />
            </label>
            <label className="block text-sm text-gray-900">Note (internal)
              <input type="text" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy === "save"}>{busy === "save" ? "Saving…" : supersedes ? "Save the new count" : "Propose the deadline"}</Button>
              <Button type="button" variant="ghost" onClick={() => { setOpen(false); setSupersedes(null); setPreview(null); }}>Cancel</Button>
            </div>
          </form>
        )}

        {live.length === 0 ? (
          <p className="border-t border-gray-100 px-5 py-4 text-sm text-gray-600">No deadline is open on this matter.</p>
        ) : (
          <ul className="divide-y divide-gray-100 border-t border-gray-100">
            {live.map((d) => (
              <li key={d.id} className={cn("px-5 py-4", d.status === "confirmed" && d.due_on < today && "bg-red-50")}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">{d.title} · due {formatDay(d.due_on)}{d.status === "confirmed" && d.due_on < today ? " — past" : ""}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONE[d.status])}>{d.status}</span>
                </div>
                <p className="text-xs text-gray-600">
                  {DEADLINE_TRIGGER_LABELS[d.trigger_kind]} on {formatDay(d.trigger_on)}
                  {d.rule_name ? ` · ${d.rule_name} (${d.rule_version})${d.provision_citation ? `, ${d.provision_citation}` : ""}` : ""}
                  {d.jurisdiction?.court_name ? ` · ${d.jurisdiction.court_name}` : ""}
                </p>
                <CalculationNotes calc={d.calculation} />
                <p className="mt-1 text-xs text-gray-500">
                  Counted by {d.computed_by ? names[d.computed_by] ?? "a colleague" : "—"} {formatWhen(d.computed_at, timezone)}
                  {d.confirmed_by ? ` · confirmed by ${names[d.confirmed_by] ?? "a colleague"} ${d.confirmed_at ? formatWhen(d.confirmed_at, timezone) : ""}` : " · not yet confirmed by a lawyer"}
                  {d.note ? ` · ${d.note}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {d.status === "proposed" && canConfirm && <Button type="button" size="sm" disabled={busy === d.id} onClick={() => void confirm(d.id)}>Confirm</Button>}
                  <Button type="button" size="sm" variant="ghost" onClick={() => recompute(d)}>Recount</Button>
                  {dischargeFor === d.id ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <input type="text" maxLength={1000} value={dischargeNote} onChange={(e) => setDischargeNote(e.target.value)} placeholder="Why it no longer applies" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                      <Button type="button" size="sm" variant="ghost" disabled={busy === d.id} onClick={() => void discharge(d.id)}>Discharge</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setDischargeFor(null)}>Cancel</Button>
                    </span>
                  ) : (
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setDischargeFor(d.id); setDischargeNote(""); }}>Discharge…</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {closed.length > 0 && (
          <details className="border-t border-gray-100 px-5 py-3">
            <summary className="cursor-pointer text-xs font-medium text-gray-700">{closed.length} discharged or superseded</summary>
            <ul className="mt-2 space-y-2">
              {closed.map((d) => (
                <li key={d.id} className="text-xs text-gray-600">
                  <span className="font-medium text-gray-800">{d.title}</span> · was due {formatDay(d.due_on)} · {d.status}
                  {d.discharge_note ? ` — ${d.discharge_note}` : ""}
                  {d.discharged_by ? ` (${names[d.discharged_by] ?? "a colleague"})` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
