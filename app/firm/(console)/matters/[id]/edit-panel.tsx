"use client";

// The face of the file: what it is called, where it is, who has conduct of it,
// and whether it is still open.
//
// Rules enforced here: updateMatter() and setMatterLawyers() run as the
// signed-in staff member — the matters and matter_lawyers policies (staff_w)
// are the authorization, never this form, and no service key is used. The court
// comes from the directory through CourtPicker (a firm may add its own court,
// and the registry's suit-number shape is the placeholder). Closing a matter is
// a dated act: matters.closed_at holds the day, in the firm's own zone.

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { setMatterLawyers, updateMatter } from "@/lib/actions/matters";
import { CourtPicker } from "@/components/firm/court-picker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { CourtRow, MatterStatus } from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

export interface MatterEditInitial {
  reference: string;
  title: string;
  causeTitle: string;
  description: string;
  nextAction: string;
  statusId: string;
  courtId: string | null;
  courtName: string;
  suitNumber: string;
  judicialDivision: string;
  handlingLawyerId: string;
  originatingLawyerId: string;
  leadLawyerId: string;
  alsoOn: string[];
  closedAt: string | null;
}

/** Today as the firm's own calendar day — matters.closed_at is a date, not an instant. */
function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function EditPanel({
  matterId, firmId, timezone, initial, statuses, courts, staff,
}: {
  matterId: string;
  firmId: string;
  timezone: string;
  initial: MatterEditInitial;
  statuses: MatterStatus[];
  courts: CourtRow[];
  staff: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();

  const [title, setTitle] = useState(initial.title);
  const [causeTitle, setCauseTitle] = useState(initial.causeTitle);
  const [description, setDescription] = useState(initial.description);
  const [nextAction, setNextAction] = useState(initial.nextAction);
  const [statusId, setStatusId] = useState(initial.statusId);
  const [courtId, setCourtId] = useState<string | null>(initial.courtId);
  const [courtName, setCourtName] = useState(initial.courtName);
  const [suitNumber, setSuitNumber] = useState(initial.suitNumber);
  const [division, setDivision] = useState(initial.judicialDivision);
  const [handling, setHandling] = useState(initial.handlingLawyerId);
  const [originating, setOriginating] = useState(initial.originatingLawyerId);
  const [lead, setLead] = useState(initial.leadLawyerId);
  const [alsoOn, setAlsoOn] = useState<string[]>(initial.alsoOn);

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);

  const selectedCourt = useMemo(() => courts.find((c) => c.id === courtId) ?? null, [courtId, courts]);

  function toggleAlsoOn(userId: string) {
    setAlsoOn((cur) => (cur.includes(userId) ? cur.filter((id) => id !== userId) : [...cur, userId]));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (title.trim().length < 2) { setError("Give the matter a working title."); return; }
    setBusy(true);

    const patch = await updateMatter(matterId, {
      title: title.trim(),
      causeTitle: causeTitle.trim() || null,
      description: description.trim() || null,
      nextAction: nextAction.trim() || null,
      statusId: statusId || null,
      courtId: courtId || null,
      courtName: courtName.trim() || null,
      suitNumber: suitNumber.trim() || null,
      judicialDivision: division.trim() || null,
      handlingLawyerId: handling || null,
      originatingLawyerId: originating || null,
    });
    if (patch?.error) { setBusy(false); setError(patch.error); return; }

    const others = alsoOn.filter((id) => id !== lead);
    const before = [...initial.alsoOn].filter((id) => id !== initial.leadLawyerId).sort().join(",");
    const after = [...others].sort().join(",");
    const lawyersChanged = lead !== initial.leadLawyerId || before !== after;
    if (lead && lawyersChanged) {
      const result = await setMatterLawyers(matterId, firmId, lead, others);
      if (result?.error) { setBusy(false); setError(result.error); return; }
    }

    setBusy(false);
    setSaved(true);
    router.refresh();
  }

  async function setClosed(close: boolean) {
    setError(null);
    setSaved(false);
    setClosing(true);
    const result = await updateMatter(matterId, { closedAt: close ? todayIn(timezone) : null });
    setClosing(false);
    setConfirmClose(false);
    if (result?.error) { setError(result.error); return; }
    router.refresh();
  }

  return (
    <div className="divide-y divide-gray-100">
      <form onSubmit={save} className="space-y-4 px-4 py-4 sm:px-5">
        {error && <Alert kind="error" title="That was refused">{error}</Alert>}
        {saved && <Alert kind="success">Saved. Your client sees the new details on their next look.</Alert>}

        <div>
          <label htmlFor="matter-title" className="text-sm font-medium text-gray-900">Working title <span className="text-red-700">*</span></label>
          <p className="text-xs text-gray-500">What the firm calls this file. The reference {initial.reference} never changes.</p>
          <input id="matter-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} className={field} />
        </div>

        <div>
          <label htmlFor="matter-cause-title" className="text-sm font-medium text-gray-900">Cause title</label>
          <p className="text-xs text-gray-500">The caption as it appears on the face of the process, e.g. Okonkwo v Eze &amp; 3 Ors.</p>
          <input id="matter-cause-title" value={causeTitle} onChange={(e) => setCauseTitle(e.target.value)} maxLength={300} className={field} />
        </div>

        <div>
          <label htmlFor="matter-status" className="text-sm font-medium text-gray-900">Status</label>
          <select id="matter-status" value={statusId} onChange={(e) => setStatusId(e.target.value)} className={field}>
            <option value="">No status</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="matter-next-action" className="text-sm font-medium text-gray-900">Next action</label>
          <p className="text-xs text-gray-500">One line, in plain language — your client reads this in their app.</p>
          <input id="matter-next-action" value={nextAction} onChange={(e) => setNextAction(e.target.value)} maxLength={500} className={field} />
        </div>

        <div>
          <label htmlFor="matter-description" className="text-sm font-medium text-gray-900">What the matter is about</label>
          <textarea id="matter-description" rows={4} maxLength={8000} value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
        </div>

        <div className="rounded-lg border border-gray-200 p-3">
          <CourtPicker
            courts={courts}
            firmId={firmId}
            value={courtId}
            onChange={(id, court) => {
              setCourtId(id);
              if (court) setCourtName(court.name);
              if (court?.division) setDivision(court.division);
            }}
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="matter-suit-number" className="text-sm font-medium text-gray-900">Suit number</label>
              <input
                id="matter-suit-number"
                value={suitNumber}
                onChange={(e) => setSuitNumber(e.target.value)}
                maxLength={120}
                placeholder={selectedCourt?.suit_number_hint ?? "As the registry wrote it"}
                className={field}
              />
              {selectedCourt?.suit_number_hint && (
                <p className="mt-1 text-xs text-gray-500">This registry writes them like {selectedCourt.suit_number_hint}.</p>
              )}
            </div>
            <div>
              <label htmlFor="matter-division" className="text-sm font-medium text-gray-900">Judicial division</label>
              <input id="matter-division" value={division} onChange={(e) => setDivision(e.target.value)} maxLength={120} placeholder="Ikeja" className={field} />
            </div>
          </div>
          <div className="mt-3">
            <label htmlFor="matter-court-name" className="text-sm font-medium text-gray-900">Court, as it should read</label>
            <p className="text-xs text-gray-500">What your client and every cause list see. Choosing a court above fills this in.</p>
            <input id="matter-court-name" value={courtName} onChange={(e) => setCourtName(e.target.value)} maxLength={200} className={field} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="matter-handling" className="text-sm font-medium text-gray-900">Handling lawyer</label>
            <p className="text-xs text-gray-500">Who is doing the work.</p>
            <select id="matter-handling" value={handling} onChange={(e) => setHandling(e.target.value)} className={field}>
              <option value="">Not recorded</option>
              {staff.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="matter-originating" className="text-sm font-medium text-gray-900">Originating lawyer</label>
            <p className="text-xs text-gray-500">Who brought the client in — this drives partner attribution.</p>
            <select id="matter-originating" value={originating} onChange={(e) => setOriginating(e.target.value)} className={field}>
              <option value="">Not recorded</option>
              {staff.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <fieldset className="rounded-lg border border-gray-200 p-3">
          <legend className="px-1 text-sm font-medium text-gray-900">Who is on the file</legend>
          <div>
            <label htmlFor="matter-lead" className="text-sm font-medium text-gray-900">Conduct of the matter</label>
            <select id="matter-lead" value={lead} onChange={(e) => setLead(e.target.value)} className={field}>
              <option value="">Not recorded</option>
              {staff.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            {!lead && <p className="mt-1 text-xs text-gray-500">Choose a lawyer here to record who else is on the file.</p>}
          </div>
          {staff.length > 1 && (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-medium text-gray-900">Also on the file</p>
              {staff.filter((m) => m.id !== lead).map((m) => (
                <label key={m.id} className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800">
                  <input type="checkbox" className="h-5 w-5" checked={alsoOn.includes(m.id)} onChange={() => toggleAlsoOn(m.id)} />
                  {m.label}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <Button type="submit" size="lg" disabled={busy}>{busy ? "Saving…" : "Save the matter"}</Button>
      </form>

      <section className="px-4 py-4 sm:px-5">
        <h3 className="font-heading text-base font-semibold text-gray-900">{initial.closedAt ? "This matter is closed" : "Close the matter"}</h3>
        {initial.closedAt ? (
          <>
            <p className="mt-1 text-sm text-gray-600">
              Closed on {new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${initial.closedAt}T00:00:00Z`))}.
              Everything on it stays readable to your client; nothing is deleted.
            </p>
            <Button className="mt-3" variant="ghost" disabled={closing} onClick={() => setClosed(false)}>
              {closing ? "Reopening…" : "Reopen the matter"}
            </Button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-gray-600">
              Closing takes the file off the open list and out of the firm&rsquo;s open-matter count. The client keeps the timeline, the documents you shared and their invoices.
            </p>
            {confirmClose ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="danger" disabled={closing} onClick={() => setClosed(true)}>
                  {closing ? "Closing…" : `Close it as at today, ${todayIn(timezone)}`}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmClose(false)}>Keep it open</Button>
              </div>
            ) : (
              <Button className="mt-3" variant="ghost" onClick={() => setConfirmClose(true)}>Close the matter</Button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
