"use client";

// Post what just happened in court. THE screen of the product: a lawyer
// standing in a corridor, on a phone, in under thirty seconds — outcome
// chips, the next date, submit. Judge, courtroom and the court picker wait
// behind "More" so the common case stays above the fold on a 390px screen.
//
// Rules enforced here:
//  · The internal note is a separate, unmistakably-labelled field.
//    post_court_update() files it as a visibility='internal' entry — it never
//    reaches the client, unlike the note to the client beside it.
//  · Timestamps are UTC in the database. Dates are typed in the viewer's zone
//    and converted to instants before they are sent.
//  · Every refusal from the database is shown verbatim, so the lawyer reads
//    "next date … is a weekend, public holiday or court vacation" and not a
//    shrug.
//  · Nothing firm-specific: the firm, the courts and the zone all arrive as
//    props from context.

import { useEffect, useId, useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { checkNonSittingDay, postCourtUpdate, type NonSittingCheck } from "@/lib/actions/court";
import { CourtPicker } from "@/components/firm/court-picker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ADJOURNMENT_INSTANCES } from "@/lib/nigeria";
import { COURT_OUTCOMES, PURPOSE_KINDS, type CourtRow } from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

const PURPOSE_LABELS: Record<string, string> = {
  mention: "Mention",
  hearing: "Hearing",
  cmc: "Case management",
  pre_trial: "Pre-trial",
  motion: "Motion",
  ruling: "Ruling",
  judgment: "Judgment",
  arraignment: "Arraignment",
  trial: "Trial",
  other: "Other",
};

/**
 * The UTC instant for a wall-clock date and time in `tz` — the database keeps
 * UTC, the lawyer types the court's own calendar date. Two passes because the
 * offset itself depends on the instant.
 */
function zonedInstant(ymd: string, hhmm: string, tz: string): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const wanted = Date.UTC(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, 0);
  let ts = wanted;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ts));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    ts -= asUtc - wanted;
  }
  return new Date(ts).toISOString();
}

/** Today as YYYY-MM-DD in the viewer's zone. */
function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** The calendar day a timestamp falls on in a given zone. */
function dayIn(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function dayLabel(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
}

function chipClass(active: boolean): string {
  return cn(
    "min-h-[44px] rounded-xl border px-3 py-2 text-sm font-medium transition",
    active ? "border-brand bg-brand text-brand-on" : "border-gray-300 bg-white text-gray-800 hover:border-brand",
  );
}

export function CourtUpdateForm({
  matterId, firmId, timezone, courts, currentCourtId, currentCourtName, judicialDivision, autoFocus = false,
  sittingAt = null,
}: {
  matterId: string;
  firmId: string;
  timezone: string;
  courts: CourtRow[];
  currentCourtId: string | null;
  currentCourtName: string | null;
  judicialDivision: string | null;
  autoFocus?: boolean;
  /**
   * The sitting this form is posting against, when it is opened from the chase
   * list. post_court_update() closes the court_event whose scheduled day equals
   * the day of the update, so a backlog sitting posted with today's date closes
   * nothing and stays on the chase list for ever. Given here, the date starts on
   * the day the court actually sat.
   */
  sittingAt?: string | null;
}) {
  const router = useRouter();
  // firm_sittings_due yields a row per court_event, so one matter with two
  // unreported sittings renders two of these forms. Ids scoped by matter would
  // collide and the second form's labels would focus the first form's inputs.
  const uid = useId();
  const today = useMemo(() => todayIn(timezone), [timezone]);
  const satDefault = useMemo(() => (sittingAt ? dayIn(sittingAt, timezone) : today), [sittingAt, timezone, today]);

  const [outcome, setOutcome] = useState("");
  const [satOn, setSatOn] = useState(satDefault);
  const [instance, setInstance] = useState("");
  const [otherInstance, setOtherInstance] = useState(false);

  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("09:00");
  const [purposeKind, setPurposeKind] = useState("");
  const [nextPurpose, setNextPurpose] = useState("");
  const [purposeEdited, setPurposeEdited] = useState(false);
  const [allowNonSitting, setAllowNonSitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<NonSittingCheck | null>(null);

  const [noteToClient, setNoteToClient] = useState("");
  const [internalNote, setInternalNote] = useState("");

  const [showMore, setShowMore] = useState(false);
  const [courtId, setCourtId] = useState<string | null>(currentCourtId);
  const [court, setCourt] = useState<CourtRow | null>(() => courts.find((c) => c.id === currentCourtId) ?? null);
  const [courtName, setCourtName] = useState("");
  const [division, setDivision] = useState(judicialDivision ?? "");
  const [judge, setJudge] = useState("");
  const [courtroom, setCourtroom] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const [pending, startTransition] = useTransition();

  const level = court?.level ?? null;
  const stateCode = court?.state_code ?? null;

  // Warn before the database refuses: is the next date a sitting day at all?
  useEffect(() => {
    if (!nextDate) { setCheck(null); setChecking(false); setAllowNonSitting(false); return; }
    let cancelled = false;
    setChecking(true);
    checkNonSittingDay(nextDate, level, stateCode).then((result) => {
      if (cancelled) return;
      setChecking(false);
      setCheck(result);
      if (!result.nonSitting) setAllowNonSitting(false);
    });
    return () => { cancelled = true; };
  }, [nextDate, level, stateCode]);

  function pickOutcome(value: string) {
    setOutcome(value);
    setPosted(false);
    if (value !== "adjourned") { setInstance(""); setOtherInstance(false); }
  }

  function pickPurpose(kind: string) {
    const next = kind === purposeKind ? "" : kind;
    setPurposeKind(next);
    if (purposeEdited) return;
    if (!next || next === "other") { setNextPurpose(""); return; }
    setNextPurpose((PURPOSE_LABELS[next] ?? next).toLowerCase());
  }

  const needsNextDate = COURT_OUTCOMES.find((o) => o.value === outcome)?.needsNextDate ?? false;
  const missingNextDate = needsNextDate && !nextDate;
  const blockedByCalendar = Boolean(check?.nonSitting) && !allowNonSitting;
  const canSubmit = Boolean(outcome) && !missingNextDate && !pending;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!outcome) { setError("Choose what happened in court."); return; }
    setError(null);
    setPosted(false);

    // A sitting today is stamped now; an older one at midday, so the court day
    // matches whichever way the zones fall.
    const occurredAt = satOn === today ? new Date().toISOString() : zonedInstant(satOn, "12:00", timezone);

    startTransition(async () => {
      const result = await postCourtUpdate({
        matterId,
        outcome,
        occurredAt,
        courtName: courtName.trim() || null,
        adjournedAtInstanceOf: outcome === "adjourned" ? instance.trim() || null : null,
        nextDate: nextDate ? zonedInstant(nextDate, nextTime || "09:00", timezone) : null,
        nextPurpose: nextPurpose.trim() || null,
        noteToClient: noteToClient.trim() || null,
        internalNote: internalNote.trim() || null,
        courtId,
        judicialDivision: division.trim() || null,
        allowNonSitting,
        judge: judge.trim() || null,
        courtroom: courtroom.trim() || null,
        purposeKind: purposeKind || null,
      });
      if ("error" in result) { setError(result.error); return; }
      setPosted(true);
      setOutcome("");
      setInstance("");
      setOtherInstance(false);
      setNextDate("");
      setNextTime("09:00");
      setPurposeKind("");
      setNextPurpose("");
      setPurposeEdited(false);
      setAllowNonSitting(false);
      setNoteToClient("");
      setInternalNote("");
      setJudge("");
      setCourtroom("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert kind="error" title="The court diary refused this">{error}</Alert>}
      {posted && (
        <Alert kind="success" title="Posted">
          It is on the matter timeline and your client can see it now. Post another sitting below if you have one.
        </Alert>
      )}

      <fieldset>
        <legend className="text-sm font-medium text-gray-900">What happened in court?</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {COURT_OUTCOMES.map((o, i) => (
            <button
              key={o.value}
              type="button"
              autoFocus={autoFocus && i === 0}
              aria-pressed={outcome === o.value}
              onClick={() => pickOutcome(o.value)}
              className={chipClass(outcome === o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1">
          <label htmlFor={`cu_sat_${uid}`} className="text-sm font-medium text-gray-900">Date of the sitting</label>
          <input
            id={`cu_sat_${uid}`} type="date" value={satOn} max={today}
            onChange={(e) => setSatOn(e.target.value)} className={field}
          />
        </div>
        <p className="pb-2 text-xs text-gray-500">Times in {timezone}</p>
      </div>

      {outcome === "adjourned" && (
        <fieldset>
          <legend className="text-sm font-medium text-gray-900">At whose instance?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {ADJOURNMENT_INSTANCES.map((who) => (
              <button
                key={who}
                type="button"
                aria-pressed={!otherInstance && instance === who}
                onClick={() => { setOtherInstance(false); setInstance(instance === who && !otherInstance ? "" : who); }}
                className={chipClass(!otherInstance && instance === who)}
              >
                {who.replace(/^the /, "The ")}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={otherInstance}
              onClick={() => { setOtherInstance(!otherInstance); setInstance(""); }}
              className={chipClass(otherInstance)}
            >
              Someone else
            </button>
          </div>
          {otherInstance && (
            <input
              type="text" maxLength={120} value={instance} onChange={(e) => setInstance(e.target.value)}
              placeholder="the 2nd defendant" aria-label="At whose instance" className={field}
            />
          )}
        </fieldset>
      )}

      <div className="space-y-2 rounded-lg border border-gray-200 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[9rem] flex-1">
            <label htmlFor={`cu_next_${uid}`} className="text-sm font-medium text-gray-900">
              Next date {needsNextDate && <span className="text-red-700">*</span>}
            </label>
            <input
              id={`cu_next_${uid}`} type="date" value={nextDate}
              onChange={(e) => setNextDate(e.target.value)} className={field}
            />
          </div>
          <div className="w-28">
            <label htmlFor={`cu_time_${uid}`} className="text-sm font-medium text-gray-900">Time</label>
            <input
              id={`cu_time_${uid}`} type="time" value={nextTime}
              onChange={(e) => setNextTime(e.target.value)} className={field}
            />
          </div>
        </div>

        {missingNextDate && (
          <p role="alert" className="text-sm text-red-700">A hearing notice fixes a date — give the next date before you post.</p>
        )}
        {checking && <p className="text-xs text-gray-500">Checking the court calendar…</p>}
        {check?.error && !checking && (
          <p className="text-xs text-gray-500">
            The court calendar could not be read here. The database still refuses a non-sitting date when you post.
          </p>
        )}
        {check?.nonSitting && !checking && (
          <Alert kind="warning" title="That is not a sitting day">
            <p>{dayLabel(nextDate)} is {check.reason ?? "a weekend, public holiday or court vacation"}.</p>
            <label className="mt-2 flex min-h-[44px] items-center gap-2 font-medium">
              <input
                type="checkbox" checked={allowNonSitting}
                onChange={(e) => setAllowNonSitting(e.target.checked)}
                className="h-5 w-5 shrink-0"
              />
              The vacation judge will sit on this date
            </label>
            {blockedByCalendar && <p className="mt-1 text-xs">Until you confirm that, the database will refuse this date.</p>}
          </Alert>
        )}

        {nextDate && (
          <>
            <p className="text-sm font-medium text-gray-900">Fixed for</p>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {PURPOSE_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={purposeKind === kind}
                  onClick={() => pickPurpose(kind)}
                  className={cn(chipClass(purposeKind === kind), "shrink-0")}
                >
                  {PURPOSE_LABELS[kind] ?? kind}
                </button>
              ))}
            </div>
            <input
              type="text" maxLength={200} value={nextPurpose}
              onChange={(e) => { setNextPurpose(e.target.value); setPurposeEdited(true); }}
              placeholder="adoption of final written addresses"
              aria-label="What the next date is for, in the client's words"
              className={field}
            />
          </>
        )}
      </div>

      <div>
        <label htmlFor={`cu_note_${uid}`} className="text-sm font-medium text-gray-900">Note to the client</label>
        <p className="text-xs text-gray-500">Plain language. This is what your client reads in their app.</p>
        <textarea
          id={`cu_note_${uid}`} rows={3} maxLength={4000} value={noteToClient}
          onChange={(e) => setNoteToClient(e.target.value)} className={field}
        />
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <label htmlFor={`cu_internal_${uid}`} className="text-sm font-medium text-amber-900">
          Internal note (never shown to the client)
        </label>
        <p className="text-xs text-amber-800">Filed as an internal timeline entry. Clients never see internal entries.</p>
        <textarea
          id={`cu_internal_${uid}`} rows={3} maxLength={8000} value={internalNote}
          onChange={(e) => setInternalNote(e.target.value)} className={field}
        />
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          className="min-h-[44px] text-sm font-medium text-brand underline"
        >
          {showMore ? "Hide court, judge and courtroom" : "More — court, judge, courtroom"}
        </button>
        {!showMore && currentCourtName && (
          <p className="text-xs text-gray-500">Filed against {currentCourtName}{judicialDivision ? `, ${judicialDivision}` : ""}.</p>
        )}
        {showMore && (
          <div className="mt-3 space-y-3 rounded-lg border border-gray-200 p-3">
            <CourtPicker
              courts={courts}
              firmId={firmId}
              value={courtId}
              onChange={(id, picked) => { setCourtId(id); setCourt(picked); }}
              label="Court"
            />
            <div>
              <label htmlFor={`cu_division_${uid}`} className="text-sm font-medium text-gray-900">Judicial division</label>
              <input
                id={`cu_division_${uid}`} type="text" maxLength={120} value={division}
                onChange={(e) => setDivision(e.target.value)} placeholder="Ikeja" className={field}
              />
            </div>
            <div>
              <label htmlFor={`cu_courtname_${uid}`} className="text-sm font-medium text-gray-900">
                Court, as it should read on the update
              </label>
              <input
                id={`cu_courtname_${uid}`} type="text" maxLength={200} value={courtName}
                onChange={(e) => setCourtName(e.target.value)}
                placeholder={currentCourtName ?? "Leave blank to use the court above"} className={field}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`cu_judge_${uid}`} className="text-sm font-medium text-gray-900">Judge</label>
                <input
                  id={`cu_judge_${uid}`} type="text" maxLength={160} value={judge}
                  onChange={(e) => setJudge(e.target.value)} placeholder="Hon. Justice…" className={field}
                />
              </div>
              <div>
                <label htmlFor={`cu_room_${uid}`} className="text-sm font-medium text-gray-900">Courtroom</label>
                <input
                  id={`cu_room_${uid}`} type="text" maxLength={80} value={courtroom}
                  onChange={(e) => setCourtroom(e.target.value)} placeholder="Court 4" className={field}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
          {pending ? "Posting…" : "Post the update"}
        </Button>
        {!outcome && <p className="text-center text-xs text-gray-500">Tap what happened in court to begin.</p>}
        {outcome && (
          <p className="text-center text-xs text-gray-500">
            The client sees the update and your note to them, never the internal note.
          </p>
        )}
      </div>
    </form>
  );
}
