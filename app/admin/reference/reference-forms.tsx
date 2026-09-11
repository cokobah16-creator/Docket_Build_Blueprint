"use client";

// The three data-entry forms behind /admin/reference: court vacations, public holidays and the
// shared court directory.
//
// Nothing here decides anything. Each form calls one action in "@/lib/actions/reference", which
// writes the table as the signed-in person; is_platform_admin() and mfa_ok() in the RLS policies
// answer, and whatever the database says — refusal or not — is shown word for word. This file
// only chooses which box comes first and what each one warns you about before you press save.
//
// A date here is a CALENDAR DAY, not an instant. Every value moves as a plain YYYY-MM-DD string
// straight from a <input type="date"> to the action, and every date shown is formatted in UTC,
// so a vacation that starts on 14 July cannot become 13 July for somebody reading in Lagos.
//
// Mobile first: one column at 390px, 44px targets, and the long lists scroll inside their own
// card rather than pushing the page sideways.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteCourtVacation,
  deletePublicHoliday,
  saveCourtVacation,
  savePlatformCourt,
  savePublicHoliday,
  type ReferenceResult,
} from "@/lib/actions/reference";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { COURT_LEVEL_LABELS, NG_STATES, NG_STATE_OPTIONS } from "@/lib/nigeria";

// ---------------------------------------------------------------- shapes the page passes down

export interface VacationView {
  id: string;
  level: string | null;
  stateCode: string | null;
  name: string;
  startsOn: string;
  endsOn: string;
  timeRuns: boolean;
  note: string | null;
}

export interface HolidayView {
  id: string;
  country: string;
  onDate: string;
  name: string;
  stateCode: string | null;
  observedOn: string | null;
  isMovable: boolean;
}

export interface CourtView {
  id: string;
  name: string;
  level: string;
  stateCode: string | null;
  division: string | null;
  city: string | null;
  shortName: string | null;
  suitNumberHint: string | null;
  isActive: boolean;
}

// ---------------------------------------------------------------- shared bits

const field =
  "mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 " +
  "focus:border-brand focus:outline focus:outline-2 focus:outline-brand";
const labelClass = "block text-sm font-medium text-gray-800";
const primaryButton =
  "min-h-[44px] w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 sm:w-auto";
const ghostButton =
  "min-h-[44px] w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-brand hover:bg-black/5 disabled:opacity-50 sm:w-auto";
const dangerButton =
  "min-h-[44px] w-full rounded-lg border border-red-300 px-4 py-2.5 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-50 sm:w-auto";

const COURT_LEVEL_OPTIONS = Object.entries(COURT_LEVEL_LABELS).map(([value, label]) => ({ value, label }));

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day written out, always in UTC so it cannot slide a day either way. */
function dayLabel(ymd: string): string {
  if (!DAY_RE.test(ymd)) return ymd;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${ymd}T00:00:00Z`),
  );
}

function stateLabel(code: string | null): string {
  if (!code) return "every state";
  return NG_STATES[code] ?? code;
}

function levelLabel(level: string | null): string {
  if (!level) return "every court";
  return COURT_LEVEL_LABELS[level] ?? level;
}

function Outcome({ result }: { result: ReferenceResult | null }) {
  if (!result) return null;
  if (result.error) return <Alert kind="error">{result.error}</Alert>;
  if (result.notice) return <Alert kind="success">{result.notice}</Alert>;
  return null;
}

function StateSelect({
  id,
  value,
  onChange,
  blankLabel,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  blankLabel: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={field}>
      <option value="">{blankLabel}</option>
      {NG_STATE_OPTIONS.map((s) => (
        <option key={s.code} value={s.code}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------- court vacations

interface VacationDraft {
  id: string | null;
  level: string;
  stateCode: string;
  name: string;
  startsOn: string;
  endsOn: string;
  timeRuns: boolean;
  note: string;
}

function emptyVacation(): VacationDraft {
  return { id: null, level: "", stateCode: "", name: "", startsOn: "", endsOn: "", timeRuns: false, note: "" };
}

function vacationDraft(v: VacationView): VacationDraft {
  return {
    id: v.id,
    level: v.level ?? "",
    stateCode: v.stateCode ?? "",
    name: v.name,
    startsOn: v.startsOn,
    endsOn: v.endsOn,
    timeRuns: v.timeRuns,
    note: v.note ?? "",
  };
}

export function CourtVacationEditor({ vacations }: { vacations: VacationView[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<VacationDraft | null>(null);
  const [result, setResult] = useState<ReferenceResult | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function open(next: VacationDraft) {
    setDraft(next);
    setResult(null);
  }

  function patch(changes: Partial<VacationDraft>) {
    setDraft((d) => (d ? { ...d, ...changes } : d));
  }

  function save() {
    if (!draft) return;
    start(async () => {
      const outcome = await saveCourtVacation({
        id: draft.id,
        level: draft.level,
        stateCode: draft.stateCode,
        name: draft.name,
        startsOn: draft.startsOn,
        endsOn: draft.endsOn,
        timeRuns: draft.timeRuns,
        note: draft.note,
      });
      setResult(outcome);
      if (outcome.ok) {
        setDraft(null);
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    start(async () => {
      const outcome = await deleteCourtVacation(id);
      setResult(outcome);
      setConfirmId(null);
      if (outcome.ok) router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader
        title="Court vacations"
        action={<Badge>{vacations.length} recorded</Badge>}
      />
      <CardBody className="space-y-4">
        <p className="text-sm text-gray-600">
          A window from a court&apos;s own practice direction — the annual vacation, Christmas,
          Easter. Every day inside it becomes a non-sitting day for the courts it covers, which is
          what a lawyer is warned about before they fix a date. Leave the court blank to cover every
          court, and the state blank to cover every state; both are spelled out again before you save.
        </p>

        <Outcome result={result} />

        {draft ? (
          <div className="space-y-4 rounded-lg border border-gray-200 p-4">
            <div>
              <label className={labelClass} htmlFor="vacation-name">
                What the practice direction calls it
              </label>
              <input
                id="vacation-name"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                maxLength={120}
                placeholder="Annual Vacation"
                className={field}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="vacation-starts">
                  First day
                </label>
                <input
                  id="vacation-starts"
                  type="date"
                  value={draft.startsOn}
                  onChange={(e) => patch({ startsOn: e.target.value })}
                  className={field}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="vacation-ends">
                  Last day
                </label>
                <input
                  id="vacation-ends"
                  type="date"
                  value={draft.endsOn}
                  onChange={(e) => patch({ endsOn: e.target.value })}
                  className={field}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="vacation-level">
                  Which courts
                </label>
                <select
                  id="vacation-level"
                  value={draft.level}
                  onChange={(e) => patch({ level: e.target.value })}
                  className={field}
                >
                  <option value="">Every court</option>
                  {COURT_LEVEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="vacation-state">
                  Which state
                </label>
                <StateSelect
                  id="vacation-state"
                  value={draft.stateCode}
                  onChange={(v) => patch({ stateCode: v })}
                  blankLabel="Every state"
                />
              </div>
            </div>

            <label className="flex items-start gap-3 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={draft.timeRuns}
                onChange={(e) => patch({ timeRuns: e.target.checked })}
                className="mt-1 h-5 w-5"
              />
              <span>
                Time under the rules keeps running during this vacation. Docket records this and
                shows it here; nothing in the product computes a deadline from it yet, so treat it as
                a note to whoever reads the entry, not as a calculation.
              </span>
            </label>

            <div>
              <label className={labelClass} htmlFor="vacation-note">
                Note — the practice direction reference, vacation judge arrangements
              </label>
              <textarea
                id="vacation-note"
                value={draft.note}
                onChange={(e) => patch({ note: e.target.value })}
                maxLength={1000}
                rows={3}
                className={field}
              />
            </div>

            {draft.startsOn && draft.endsOn && (
              <Alert kind="info">
                This will make every day from <strong>{dayLabel(draft.startsOn)}</strong> to{" "}
                <strong>{dayLabel(draft.endsOn)}</strong> a non-sitting day for{" "}
                <strong>{levelLabel(draft.level || null)}</strong> in{" "}
                <strong>{stateLabel(draft.stateCode || null)}</strong>.
              </Alert>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={save} disabled={busy} className={primaryButton}>
                {busy ? "Saving…" : draft.id ? "Save this window" : "Add this window"}
              </button>
              <button type="button" onClick={() => setDraft(null)} disabled={busy} className={ghostButton}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => open(emptyVacation())} className={primaryButton}>
            Add a vacation window
          </button>
        )}

        {vacations.length === 0 ? (
          <EmptyState
            title="No court vacation has been entered"
            hint="Until one is, a date inside the Long Vacation is treated as an ordinary sitting day. Add the first window above, from the court's own practice direction."
          />
        ) : (
          <>
            <p className="text-xs uppercase tracking-wide text-gray-500">Recorded windows, newest first</p>
            <ul className="space-y-3">
              {vacations.map((v) => (
                <li key={v.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">{v.name}</p>
                      <p className="text-sm text-gray-700">
                        {dayLabel(v.startsOn)} to {dayLabel(v.endsOn)}
                      </p>
                      <p className="text-sm text-gray-600">
                        {levelLabel(v.level)} · {stateLabel(v.stateCode)}
                      </p>
                      {v.note && <p className="mt-1 text-sm text-gray-600">{v.note}</p>}
                    </div>
                    <Badge className={v.timeRuns ? "bg-amber-100 text-amber-900" : ""}>
                      {v.timeRuns ? "time runs" : "time suspended"}
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => open(vacationDraft(v))}
                      disabled={busy}
                      className={ghostButton}
                    >
                      Correct this
                    </button>
                    {confirmId === v.id ? (
                      <>
                        <button type="button" onClick={() => remove(v.id)} disabled={busy} className={dangerButton}>
                          {busy ? "Removing…" : "Yes, remove it"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          disabled={busy}
                          className={ghostButton}
                        >
                          Keep it
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmId(v.id)}
                        disabled={busy}
                        className={dangerButton}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {confirmId === v.id && (
                    <p className="mt-2 text-sm text-gray-600">
                      Removing it makes those days ordinary sitting days again for every firm on Docket.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------- public holidays

interface HolidayDraft {
  country: string;
  onDate: string;
  name: string;
  stateCode: string;
  observedOn: string;
  isMovable: boolean;
  /**
   * The key of the entry this draft was opened from, when it was opened from one. A holiday is
   * keyed by country, date and state, so editing any of those three does not move the old row —
   * it writes a second one. The form has to say that before it happens.
   */
  from: { country: string; onDate: string; stateCode: string } | null;
}

function emptyHoliday(): HolidayDraft {
  return { country: "NG", onDate: "", name: "", stateCode: "", observedOn: "", isMovable: false, from: null };
}

function holidayDraft(h: HolidayView): HolidayDraft {
  return {
    country: h.country,
    onDate: h.onDate,
    name: h.name,
    stateCode: h.stateCode ?? "",
    observedOn: h.observedOn ?? "",
    isMovable: h.isMovable,
    from: { country: h.country, onDate: h.onDate, stateCode: h.stateCode ?? "" },
  };
}

/** True when the draft has been moved off the entry it was opened from, so a save adds a row. */
function movedOffKey(d: HolidayDraft): boolean {
  if (!d.from) return false;
  return d.from.country !== d.country || d.from.onDate !== d.onDate || d.from.stateCode !== d.stateCode;
}

export function PublicHolidayEditor({ holidays }: { holidays: HolidayView[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<HolidayDraft | null>(null);
  const [result, setResult] = useState<ReferenceResult | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function patch(changes: Partial<HolidayDraft>) {
    setDraft((d) => (d ? { ...d, ...changes } : d));
  }

  function save() {
    if (!draft) return;
    start(async () => {
      const outcome = await savePublicHoliday({
        country: draft.country,
        onDate: draft.onDate,
        name: draft.name,
        stateCode: draft.stateCode,
        observedOn: draft.observedOn,
        isMovable: draft.isMovable,
      });
      setResult(outcome);
      if (outcome.ok) {
        setDraft(null);
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    start(async () => {
      const outcome = await deletePublicHoliday(id);
      setResult(outcome);
      setConfirmId(null);
      if (outcome.ok) router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader title="Public holidays" action={<Badge>{holidays.length} listed</Badge>} />
      <CardBody className="space-y-4">
        <p className="text-sm text-gray-600">
          A holiday is keyed by its country, its date and its state — not by a row number. Saving
          the same date twice corrects the entry that is already there; a movable feast that falls
          on a different day next year is a new entry, because it is a different day. Eid-el-Fitr,
          Eid-el-Kabir and Eid-el-Maulud are declared by the Federal Government each year and go in
          here when they are gazetted, never before.
        </p>

        <Outcome result={result} />

        {draft ? (
          <div className="space-y-4 rounded-lg border border-gray-200 p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="holiday-date">
                  The day itself
                </label>
                <input
                  id="holiday-date"
                  type="date"
                  value={draft.onDate}
                  onChange={(e) => patch({ onDate: e.target.value })}
                  className={field}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="holiday-country">
                  Country
                </label>
                <input
                  id="holiday-country"
                  value={draft.country}
                  onChange={(e) => patch({ country: e.target.value.toUpperCase() })}
                  maxLength={2}
                  autoCapitalize="characters"
                  spellCheck={false}
                  className={field}
                />
              </div>
            </div>

            <div>
              <label className={labelClass} htmlFor="holiday-name">
                What the gazette calls it
              </label>
              <input
                id="holiday-name"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                maxLength={120}
                placeholder="Democracy Day"
                className={field}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="holiday-state">
                  Where it binds
                </label>
                <StateSelect
                  id="holiday-state"
                  value={draft.stateCode}
                  onChange={(v) => patch({ stateCode: v })}
                  blankLabel="National — everywhere"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="holiday-observed">
                  Kept on (only if the Government shifted it)
                </label>
                <input
                  id="holiday-observed"
                  type="date"
                  value={draft.observedOn}
                  onChange={(e) => patch({ observedOn: e.target.value })}
                  className={field}
                />
              </div>
            </div>

            <label className="flex items-start gap-3 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={draft.isMovable}
                onChange={(e) => patch({ isMovable: e.target.checked })}
                className="mt-1 h-5 w-5"
              />
              <span>
                This feast moves from year to year — Eid, Good Friday, Easter Monday. Ticking it does
                not make Docket work out next year&apos;s date; it records that somebody has to enter
                it when it is declared.
              </span>
            </label>

            {movedOffKey(draft) && draft.from && (
              <Alert kind="warning" title="This will add a second entry, not move the first">
                A holiday is keyed by its country, its date and its state — not by a row number. You
                opened <strong>{dayLabel(draft.from.onDate)}</strong>
                {draft.from.stateCode ? ` (${stateLabel(draft.from.stateCode)})` : " (national)"} and have
                changed one of those three, so saving writes a new entry and leaves the old one where it
                is. That is right for a movable feast in a new year. If the old entry was simply wrong,
                remove it afterwards.
              </Alert>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={save} disabled={busy} className={primaryButton}>
                {busy ? "Saving…" : "Save this holiday"}
              </button>
              <button type="button" onClick={() => setDraft(null)} disabled={busy} className={ghostButton}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(emptyHoliday());
              setResult(null);
            }}
            className={primaryButton}
          >
            Add or correct a holiday
          </button>
        )}

        {holidays.length === 0 ? (
          <EmptyState
            title="No holiday reaches this far ahead"
            hint="Add the fixed dates for the coming year above; the courts sit on any day that is not entered here."
          />
        ) : (
          <>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              Recorded from 1 January this year onwards
            </p>
            <ul className="divide-y divide-gray-100">
              {holidays.map((h) => (
                <li key={h.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">{h.name}</p>
                      <p className="text-sm text-gray-700">
                        {dayLabel(h.onDate)}
                        {h.observedOn ? ` · kept on ${dayLabel(h.observedOn)}` : ""}
                      </p>
                      <p className="text-sm text-gray-600">
                        {h.country} · {h.stateCode ? stateLabel(h.stateCode) : "national"}
                      </p>
                    </div>
                    {h.isMovable && <Badge className="bg-sky-100 text-sky-900">movable</Badge>}
                  </div>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(holidayDraft(h));
                        setResult(null);
                      }}
                      disabled={busy}
                      className={ghostButton}
                    >
                      Correct this
                    </button>
                    {confirmId === h.id ? (
                      <>
                        <button type="button" onClick={() => remove(h.id)} disabled={busy} className={dangerButton}>
                          {busy ? "Removing…" : "Yes, remove it"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          disabled={busy}
                          className={ghostButton}
                        >
                          Keep it
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmId(h.id)}
                        disabled={busy}
                        className={dangerButton}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------- the shared court directory

interface CourtDraft {
  id: string | null;
  name: string;
  level: string;
  stateCode: string;
  division: string;
  city: string;
  shortName: string;
  suitNumberHint: string;
  isActive: boolean;
}

function emptyCourt(): CourtDraft {
  return { id: null, name: "", level: "state_high", stateCode: "", division: "", city: "", shortName: "", suitNumberHint: "", isActive: true };
}

function courtDraft(c: CourtView): CourtDraft {
  return {
    id: c.id,
    name: c.name,
    level: c.level,
    stateCode: c.stateCode ?? "",
    division: c.division ?? "",
    city: c.city ?? "",
    shortName: c.shortName ?? "",
    suitNumberHint: c.suitNumberHint ?? "",
    isActive: c.isActive,
  };
}

export function PlatformCourtEditor({
  courts,
  totalCourts,
  search,
}: {
  courts: CourtView[];
  totalCourts: number;
  /** The name filter currently applied, so the box shows what the list is showing. */
  search: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<CourtDraft | null>(null);
  const [result, setResult] = useState<ReferenceResult | null>(null);
  const [busy, start] = useTransition();

  function patch(changes: Partial<CourtDraft>) {
    setDraft((d) => (d ? { ...d, ...changes } : d));
  }

  function save() {
    if (!draft) return;
    start(async () => {
      const outcome = await savePlatformCourt({ ...draft });
      setResult(outcome);
      if (outcome.ok) {
        setDraft(null);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader title="Platform courts" action={<Badge>{totalCourts} in the directory</Badge>} />
      <CardBody className="space-y-4">
        {/* The directory is longer than any page of it. Without this box most of it could never
            be opened, and this screen is the only place a platform court can be corrected. */}
        <form method="get" action="/admin/reference" className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="court-search" className="block text-sm font-medium text-gray-800">
              Find a court
            </label>
            <input
              id="court-search"
              type="search"
              name="court"
              defaultValue={search}
              placeholder="Name, division or town"
              className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 focus:border-brand focus:outline focus:outline-2 focus:outline-brand"
            />
          </div>
          <button type="submit" className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800">
            Search
          </button>
          {search && (
            <a href="/admin/reference" className="min-h-[44px] px-2 py-2.5 text-sm text-brand underline">
              Clear
            </a>
          )}
        </form>
        <p className="text-sm text-gray-600">
          Every firm on Docket picks from this directory when it opens a matter or posts a sitting. A
          court entered here belongs to the platform, not to a firm — a firm adds its own private
          courts from its own console, and those are none of this screen&apos;s business. There is no
          delete: a matter can already point at a court, so a court that has closed or was entered in
          error is marked closed instead, which keeps it attached to everything that used it and takes
          it out of every picker.
        </p>

        <Outcome result={result} />

        {draft ? (
          <div className="space-y-4 rounded-lg border border-gray-200 p-4">
            <div>
              <label className={labelClass} htmlFor="court-name">
                Full name, as the registry writes it
              </label>
              <input
                id="court-name"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                maxLength={200}
                placeholder="Federal High Court, Warri Judicial Division"
                className={field}
              />
              <p className="mt-1 text-sm text-gray-500">
                The name is the key: the database refuses a second platform court with the same name.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="court-level">
                  Where it sits in the hierarchy
                </label>
                <select
                  id="court-level"
                  value={draft.level}
                  onChange={(e) => patch({ level: e.target.value })}
                  className={field}
                >
                  {COURT_LEVEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="court-short">
                  Short name
                </label>
                <input
                  id="court-short"
                  value={draft.shortName}
                  onChange={(e) => patch({ shortName: e.target.value })}
                  maxLength={60}
                  placeholder="FHC Warri"
                  className={field}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="court-suit-hint">
                  Suit-number example
                </label>
                <input
                  id="court-suit-hint"
                  value={draft.suitNumberHint}
                  onChange={(e) => patch({ suitNumberHint: e.target.value })}
                  maxLength={80}
                  placeholder="FHC/WR/CS/123/2026"
                  className={field}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Shown to a lawyer opening a matter at this court, so the suit number is typed the
                  way the registry writes it. Leave it empty if the shape varies.
                </p>
              </div>
              <div>
                <label className={labelClass} htmlFor="court-state">
                  State
                </label>
                <StateSelect
                  id="court-state"
                  value={draft.stateCode}
                  onChange={(v) => patch({ stateCode: v })}
                  blankLabel="Not tied to a state"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="court-division">
                  Judicial division or district
                </label>
                <input
                  id="court-division"
                  value={draft.division}
                  onChange={(e) => patch({ division: e.target.value })}
                  maxLength={120}
                  placeholder="Warri"
                  className={field}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="court-city">
                  City
                </label>
                <input
                  id="court-city"
                  value={draft.city}
                  onChange={(e) => patch({ city: e.target.value })}
                  maxLength={120}
                  placeholder="Warri"
                  className={field}
                />
              </div>
            </div>

            <label className="flex items-start gap-3 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => patch({ isActive: e.target.checked })}
                className="mt-1 h-5 w-5"
              />
              <span>Open — firms can pick this court. Untick it to retire a court without detaching it from the matters that already name it.</span>
            </label>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={save} disabled={busy} className={primaryButton}>
                {busy ? "Saving…" : draft.id ? "Save this court" : "Add this court"}
              </button>
              <button type="button" onClick={() => setDraft(null)} disabled={busy} className={ghostButton}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(emptyCourt());
              setResult(null);
            }}
            className={primaryButton}
          >
            Add a court
          </button>
        )}

        {courts.length === 0 ? (
          <EmptyState
            title="No platform court is in the directory"
            hint="Add the first one above — until then a firm can only use courts it has entered privately."
          />
        ) : (
          <>
            <p className="text-xs uppercase tracking-wide text-gray-500">Most recently added</p>
            <ul className="divide-y divide-gray-100">
              {courts.map((c) => (
                <li key={c.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">{c.name}</p>
                      <p className="text-sm text-gray-600">
                        {levelLabel(c.level)}
                        {c.stateCode ? ` · ${stateLabel(c.stateCode)}` : ""}
                        {c.division ? ` · ${c.division}` : ""}
                        {c.city ? ` · ${c.city}` : ""}
                      </p>
                    </div>
                    {!c.isActive && <Badge className="bg-gray-200 text-gray-800">closed</Badge>}
                  </div>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(courtDraft(c));
                        setResult(null);
                      }}
                      disabled={busy}
                      className={ghostButton}
                    >
                      Correct this
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
