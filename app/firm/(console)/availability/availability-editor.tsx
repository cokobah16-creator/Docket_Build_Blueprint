"use client";

// The working week, edited: a row per weekday with as many blocks as the day
// really has (morning in court, afternoon in chambers), plus the dates that are
// blocked — court, leave, a public holiday.
//
// Rules enforced here:
//  · The times typed here are the LAWYER'S own local times. available_slots()
//    reads coalesce(profiles.timezone, firms.timezone) for that lawyer, so the
//    zone is stated on the screen and nothing is silently converted.
//  · End must be later than start, a break must sit inside its block, and two
//    blocks on one day may not overlap — checked here so the lawyer is told why
//    before saving, and checked again in the server action, which is the rule.
//  · The database is the authorization layer: a refusal from availability_rules_write
//    (only this lawyer, or an owner or admin, and never a suspended firm) is
//    shown exactly as the database words it.
//  · Everything is reachable with a thumb at 390px: 44px targets, one column.

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { addException, removeException, saveRules } from "@/lib/actions/availability";
import { WEEKDAYS } from "@/lib/weekdays";
import { Alert } from "@/components/ui/alert";
import {
  AppButton,
  AppCard,
  AppCardBody,
  AppCardHeader,
  AppEmpty,
  Footnote,
} from "@/components/app";
import { WarningIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { AvailabilityException, AvailabilityRule } from "@/lib/db/types";

// The console's own field: neutral edge, 44px of thumb, and a focus ring in the
// shell's ink rather than any firm's colour.
const field =
  "mt-1.5 w-full rounded-[9px] border border-dk-field bg-white px-3 py-[11px] text-[14px] text-dk-strong placeholder:text-dk-muted focus:border-dk-pri focus:outline-none disabled:bg-dk-tint disabled:text-dk-soft";
const timeField = cn(field, "min-h-[44px]");
const labelClass = "text-[13px] font-semibold text-dk-strong";
const smallLabelClass = "text-[11.5px] font-semibold text-dk-soft";

/** The quiet grey chip a weekday wears: "closed", or how many blocks it has. */
function DayChip({ children, quiet }: { children: ReactNode; quiet?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center rounded-full px-2 py-px text-[10.5px] font-bold uppercase tracking-[0.03em]",
        quiet ? "bg-dk-rule text-dk-muted" : "bg-dk-rule text-dk-soft",
      )}
    >
      {children}
    </span>
  );
}

const DEFAULT_SLOT_MIN = 45;
const DEFAULT_MAX_PER_DAY = 6;
const REASONS = ["Court", "Leave", "Public holiday"] as const;

interface Block {
  key: string;
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
  slotMin: string;
  maxPerDay: string;
}

type Week = Block[][];

/** A time column comes back as 09:00:00; the time input wants 09:00. */
function hm(value: string | null): string {
  return (value ?? "").slice(0, 5);
}

function minutes(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

function isTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

let seq = 0;
function nextKey(): string {
  seq += 1;
  return `b${seq}`;
}

function emptyWeek(): Week {
  return [[], [], [], [], [], [], []];
}

function weekFrom(rules: AvailabilityRule[]): Week {
  const week = emptyWeek();
  for (const r of [...rules].sort((a, b) => a.weekday - b.weekday || hm(a.start_time).localeCompare(hm(b.start_time)))) {
    if (r.weekday < 0 || r.weekday > 6) continue;
    week[r.weekday].push({
      key: nextKey(),
      startTime: hm(r.start_time),
      endTime: hm(r.end_time),
      breakStart: hm(r.break_start),
      breakEnd: hm(r.break_end),
      slotMin: String(r.slot_min),
      maxPerDay: String(r.max_per_day),
    });
  }
  return week;
}

function newBlock(from?: Block): Block {
  if (from) return { ...from, key: nextKey() };
  return {
    key: nextKey(),
    startTime: "09:00",
    endTime: "17:00",
    breakStart: "13:00",
    breakEnd: "14:00",
    slotMin: String(DEFAULT_SLOT_MIN),
    maxPerDay: String(DEFAULT_MAX_PER_DAY),
  };
}

/** One signature of the whole week, so "unsaved changes" is a fact, not a guess. */
function signature(week: Week): string {
  return week
    .map((blocks, weekday) =>
      blocks
        .map((b) => [weekday, b.startTime, b.endTime, b.breakStart, b.breakEnd, b.slotMin, b.maxPerDay].join("|"))
        .join(","),
    )
    .join(";");
}

/** Why a day cannot be saved, in the lawyer's words. One message per day. */
function dayProblem(blocks: Block[]): string | null {
  for (const b of blocks) {
    if (!isTime(b.startTime) || !isTime(b.endTime)) return "Give both a start and an end time for every block.";
    if (minutes(b.endTime) <= minutes(b.startTime)) {
      return `A block that starts at ${b.startTime} cannot end at ${b.endTime} — the end must be later than the start.`;
    }
    const hasStart = b.breakStart.length > 0;
    const hasEnd = b.breakEnd.length > 0;
    if (hasStart !== hasEnd) return "A break needs both a start and an end, or neither.";
    if (hasStart && hasEnd) {
      if (!isTime(b.breakStart) || !isTime(b.breakEnd)) return "That break time could not be read.";
      if (minutes(b.breakEnd) <= minutes(b.breakStart)) {
        return `The break ends at ${b.breakEnd}, before it starts at ${b.breakStart}.`;
      }
      if (minutes(b.breakStart) < minutes(b.startTime) || minutes(b.breakEnd) > minutes(b.endTime)) {
        return `The break ${b.breakStart}–${b.breakEnd} falls outside ${b.startTime}–${b.endTime}, so it would block nothing.`;
      }
    }
    const slot = Number(b.slotMin);
    if (!Number.isInteger(slot) || slot < 5 || slot > 240) return "Slot length must be a whole number of minutes between 5 and 240.";
    const cap = Number(b.maxPerDay);
    if (!Number.isInteger(cap) || cap < 1 || cap > 40) return "The daily cap must be a whole number between 1 and 40.";
    // No check that the slot step "fits" the block. The step is the distance
    // between start times; what has to fit is the SERVICE duration, which
    // available_slots() applies and this screen does not know. A 09:00–09:30
    // block with a 45-minute step legitimately offers one short consultation,
    // and the database accepts it, so refusing to save the week here would
    // refuse a configuration the booking engine is happy with. The fortnight
    // preview under the editor shows the truthful answer for the real service.
  }
  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      const a = blocks[i];
      const b = blocks[j];
      if (minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime)) {
        return `${a.startTime}–${a.endTime} and ${b.startTime}–${b.endTime} overlap, so the same time would be offered twice.`;
      }
    }
  }
  return null;
}

/** A blocked date is a calendar day, not an instant: render it as the day it is. */
function dayLabel(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${ymd}T12:00:00Z`));
}

export function AvailabilityEditor({
  firmId,
  lawyerId,
  lawyerName,
  lawyerTimezone,
  isSelf,
  canEdit,
  todayYmd,
  initialRules,
  initialExceptions,
}: {
  firmId: string;
  lawyerId: string;
  lawyerName: string;
  lawyerTimezone: string;
  isSelf: boolean;
  canEdit: boolean;
  todayYmd: string;
  initialRules: AvailabilityRule[];
  initialExceptions: AvailabilityException[];
}) {
  const router = useRouter();
  const [week, setWeek] = useState<Week>(() => weekFrom(initialRules));
  const [baseline, setBaseline] = useState<string>(() => signature(weekFrom(initialRules)));
  const [weekError, setWeekError] = useState<string | null>(null);
  const [weekSaved, setWeekSaved] = useState(false);
  const [savingWeek, startSaveWeek] = useTransition();

  const [exDate, setExDate] = useState("");
  const [exWholeDay, setExWholeDay] = useState(true);
  const [exStart, setExStart] = useState("09:00");
  const [exEnd, setExEnd] = useState("13:00");
  const [exReason, setExReason] = useState("");
  const [exError, setExError] = useState<string | null>(null);
  const [addingException, startAddException] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removing, startRemove] = useTransition();

  const problems = useMemo(() => week.map((blocks) => dayProblem(blocks)), [week]);
  const firstProblem = problems.findIndex((p) => p !== null);
  const dirty = signature(week) !== baseline;
  const totalBlocks = week.reduce((n, blocks) => n + blocks.length, 0);

  function mutate(weekday: number, next: Block[]) {
    setWeekSaved(false);
    setWeekError(null);
    setWeek((current) => current.map((blocks, i) => (i === weekday ? next : blocks)));
  }

  function patch(weekday: number, key: string, changes: Partial<Block>) {
    setWeekSaved(false);
    setWeekError(null);
    setWeek((current) =>
      current.map((blocks, i) => (i === weekday ? blocks.map((b) => (b.key === key ? { ...b, ...changes } : b)) : blocks)),
    );
  }

  function copyMonday() {
    setWeekSaved(false);
    setWeekError(null);
    setWeek((current) => current.map((blocks, i) => (i >= 2 && i <= 5 ? current[1].map((b) => newBlock(b)) : blocks)));
  }

  function saveWeek() {
    if (firstProblem >= 0) {
      setWeekError(`${WEEKDAYS[firstProblem]}: ${problems[firstProblem]}`);
      return;
    }
    setWeekError(null);
    const payload = week.flatMap((blocks, weekday) =>
      blocks.map((b) => ({
        weekday,
        startTime: b.startTime,
        endTime: b.endTime,
        breakStart: b.breakStart || null,
        breakEnd: b.breakEnd || null,
        slotMin: Number(b.slotMin),
        maxPerDay: Number(b.maxPerDay),
      })),
    );
    const saved = signature(week);
    startSaveWeek(async () => {
      const result = await saveRules(firmId, lawyerId, payload);
      if (result?.error) {
        setWeekError(result.error);
        return;
      }
      setBaseline(saved);
      setWeekSaved(true);
      router.refresh();
    });
  }

  function submitException() {
    setExError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exDate)) {
      setExError("Choose the date to block.");
      return;
    }
    if (!exWholeDay) {
      if (!isTime(exStart) || !isTime(exEnd)) {
        setExError("Give both a start and an end time, or block the whole day.");
        return;
      }
      if (minutes(exEnd) <= minutes(exStart)) {
        setExError(`That range ends at ${exEnd}, before it starts at ${exStart}. The end must be later than the start.`);
        return;
      }
    }
    startAddException(async () => {
      const result = await addException(firmId, lawyerId, {
        onDate: exDate,
        isAvailable: false,
        startTime: exWholeDay ? null : exStart,
        endTime: exWholeDay ? null : exEnd,
        reason: exReason.trim() || null,
      });
      if (result?.error) {
        setExError(result.error);
        return;
      }
      setExDate("");
      setExReason("");
      setExWholeDay(true);
      router.refresh();
    });
  }

  function lift(id: string) {
    setExError(null);
    setRemovingId(id);
    startRemove(async () => {
      const result = await removeException(id);
      setRemovingId(null);
      if (result?.error) {
        setExError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const whose = isSelf ? "your" : `${lawyerName}'s`;

  return (
    <div className="flex flex-col gap-3.5">
      <AppCard>
        <AppCardHeader
          title="The working week"
          action={
            <span className="hidden flex-none text-[11.5px] text-dk-soft sm:inline">
              {totalBlocks === 0 ? "nothing set" : `${totalBlocks} block${totalBlocks === 1 ? "" : "s"}`}
            </span>
          }
        />
        <AppCardBody className="flex flex-col gap-4">
          <p className="text-[12.5px] leading-[1.55] text-dk-soft">
            These are {whose} own local times in <span className="font-semibold text-dk-strong">{lawyerTimezone}</span> — the
            zone the booking engine reads for this lawyer. A day with no block takes no consultations at all.
          </p>

          {!canEdit && (
            <Alert kind="info" title="Read only">
              You can see this week but not change it. The database lets the lawyer whose diary this is edit it, and an
              owner or admin edit anyone's.
            </Alert>
          )}
          {weekError && <Alert kind="error" title="Not saved">{weekError}</Alert>}
          {weekSaved && !dirty && (
            <Alert kind="success">Saved. The public booking wizard is offering these hours from now on.</Alert>
          )}

          <div className="flex flex-col gap-3">
            {WEEKDAYS.map((label, weekday) => {
              const blocks = week[weekday];
              const problem = problems[weekday];
              return (
                // A day that will not save carries the console's red edge, and
                // the sentence at the foot of the day says what is wrong.
                <section
                  key={label}
                  className={cn("rounded-[11px] border p-3", problem ? "border-[#E5B0AC] bg-[#FEF6F5]" : "border-dk-line")}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-app-head text-[14px] font-bold text-dk-strong">{label}</h3>
                      {blocks.length === 0 ? (
                        <DayChip quiet>closed</DayChip>
                      ) : (
                        <DayChip>{blocks.length === 1 ? "1 block" : `${blocks.length} blocks`}</DayChip>
                      )}
                    </div>
                    {canEdit && (
                      <AppButton
                        variant="ghost-sm"
                        onClick={() => mutate(weekday, [...blocks, newBlock(blocks[blocks.length - 1])])}
                      >
                        Add a block
                      </AppButton>
                    )}
                  </div>

                  {blocks.length === 0 ? (
                    <p className="mt-2 text-[12.5px] leading-[1.5] text-dk-muted">
                      Closed — nothing is offered on a {label}.
                      {canEdit ? " Add a block to open it." : ""}
                    </p>
                  ) : (
                    <ul className="mt-3 flex flex-col gap-3">
                      {blocks.map((b, index) => {
                        const id = `d${weekday}b${index}`;
                        return (
                          <li key={b.key} className="rounded-[10px] border border-dk-line bg-white p-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label htmlFor={`${id}start`} className={smallLabelClass}>Starts</label>
                                <input
                                  id={`${id}start`} type="time" value={b.startTime} disabled={!canEdit}
                                  onChange={(e) => patch(weekday, b.key, { startTime: e.target.value })}
                                  className={timeField}
                                />
                              </div>
                              <div>
                                <label htmlFor={`${id}end`} className={smallLabelClass}>Ends</label>
                                <input
                                  id={`${id}end`} type="time" value={b.endTime} disabled={!canEdit}
                                  onChange={(e) => patch(weekday, b.key, { endTime: e.target.value })}
                                  className={timeField}
                                />
                              </div>
                              <div>
                                <label htmlFor={`${id}bs`} className={smallLabelClass}>Break starts</label>
                                <input
                                  id={`${id}bs`} type="time" value={b.breakStart} disabled={!canEdit}
                                  onChange={(e) => patch(weekday, b.key, { breakStart: e.target.value })}
                                  className={timeField}
                                />
                              </div>
                              <div>
                                <label htmlFor={`${id}be`} className={smallLabelClass}>Break ends</label>
                                <input
                                  id={`${id}be`} type="time" value={b.breakEnd} disabled={!canEdit}
                                  onChange={(e) => patch(weekday, b.key, { breakEnd: e.target.value })}
                                  className={timeField}
                                />
                              </div>
                              <div>
                                <label htmlFor={`${id}slot`} className={smallLabelClass}>Slot (minutes)</label>
                                <input
                                  id={`${id}slot`} type="number" inputMode="numeric" min={5} max={240} step={5}
                                  value={b.slotMin} disabled={!canEdit}
                                  onChange={(e) => patch(weekday, b.key, { slotMin: e.target.value })}
                                  className={timeField}
                                />
                              </div>
                              <div>
                                <label htmlFor={`${id}cap`} className={smallLabelClass}>Daily cap</label>
                                <input
                                  id={`${id}cap`} type="number" inputMode="numeric" min={1} max={40} step={1}
                                  value={b.maxPerDay} disabled={!canEdit}
                                  onChange={(e) => patch(weekday, b.key, { maxPerDay: e.target.value })}
                                  className={timeField}
                                />
                              </div>
                            </div>
                            {canEdit && (
                              <div className="mt-2 flex justify-end">
                                <AppButton
                                  variant="ghost-sm"
                                  onClick={() => mutate(weekday, blocks.filter((x) => x.key !== b.key))}
                                >
                                  Remove this block
                                </AppButton>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {problem && (
                    <p className="mt-2 flex items-start gap-2 text-[12.5px] font-semibold leading-snug text-[#B42318]">
                      <WarningIcon size={14} className="mt-px flex-none" />
                      <span>{problem}</span>
                    </p>
                  )}
                </section>
              );
            })}
          </div>

          <Footnote>
            The slot length is the step between start times, not the length of the appointment — that comes from the
            service. The daily cap counts appointments already in the diary that day: once it is reached, the whole day
            stops being offered.
          </Footnote>

          {canEdit && (
            <div className="flex flex-col gap-2.5">
              <AppButton variant="primary" onClick={saveWeek} disabled={savingWeek || !dirty}>
                {savingWeek ? "Saving…" : dirty ? "Save the week" : "Saved"}
              </AppButton>
              <AppButton
                variant="ghost"
                className="w-full"
                onClick={copyMonday}
                disabled={savingWeek || week[1].length === 0}
                title={week[1].length === 0 ? "Set Monday first" : "Overwrites Tuesday to Friday"}
              >
                Copy Monday to Tuesday–Friday
              </AppButton>
              {/* Unsaved work is waiting on you, which is the console's amber,
                  and the words say it too. */}
              {dirty && (
                <span className="text-[12.5px] font-semibold text-[#92400E]">Unsaved changes.</span>
              )}
            </div>
          )}
          {canEdit && week[1].length === 0 && (
            <Footnote>Set Monday first, then copy it across the working week.</Footnote>
          )}
        </AppCardBody>
      </AppCard>

      <AppCard>
        <AppCardHeader title="Days off and blocked hours" />
        <AppCardBody className="flex flex-col gap-4">
          <p className="text-[12.5px] leading-[1.55] text-dk-soft">
            Court, leave, a public holiday. A blocked day disappears from the wizard entirely; a blocked range removes
            only the slots it touches. Appointments already booked are not moved — reschedule those on the diary.
          </p>

          {exError && <Alert kind="error" title="Not blocked">{exError}</Alert>}

          {canEdit && (
            <div className="flex flex-col gap-3 rounded-[11px] border border-dk-line p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="ex_date" className={labelClass}>Date</label>
                  <input
                    id="ex_date" type="date" min={todayYmd} value={exDate}
                    onChange={(e) => { setExDate(e.target.value); setExError(null); }}
                    className={timeField}
                  />
                </div>
                <div>
                  <span className={labelClass}>How much of it</span>
                  <div className="mt-1.5 flex gap-2">
                    <button
                      type="button"
                      aria-pressed={exWholeDay}
                      onClick={() => { setExWholeDay(true); setExError(null); }}
                      className={cn(
                        "min-h-[44px] flex-1 rounded-[10px] border px-3 text-[13px] font-semibold",
                        exWholeDay ? "border-dk-pri bg-dk-pri text-dk-on-pri" : "border-dk-field bg-white text-dk-soft",
                      )}
                    >
                      Whole day
                    </button>
                    <button
                      type="button"
                      aria-pressed={!exWholeDay}
                      onClick={() => { setExWholeDay(false); setExError(null); }}
                      className={cn(
                        "min-h-[44px] flex-1 rounded-[10px] border px-3 text-[13px] font-semibold",
                        !exWholeDay ? "border-dk-pri bg-dk-pri text-dk-on-pri" : "border-dk-field bg-white text-dk-soft",
                      )}
                    >
                      Part of it
                    </button>
                  </div>
                </div>
              </div>

              {!exWholeDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="ex_start" className={labelClass}>Blocked from</label>
                    <input id="ex_start" type="time" value={exStart} onChange={(e) => setExStart(e.target.value)} className={timeField} />
                  </div>
                  <div>
                    <label htmlFor="ex_end" className={labelClass}>Blocked until</label>
                    <input id="ex_end" type="time" value={exEnd} onChange={(e) => setExEnd(e.target.value)} className={timeField} />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="ex_reason" className={labelClass}>Reason</label>
                <input
                  id="ex_reason" type="text" maxLength={200} value={exReason}
                  onChange={(e) => setExReason(e.target.value)}
                  placeholder="Court, leave, public holiday…"
                  className={timeField}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setExReason(r)}
                      className="min-h-[44px] rounded-full border border-dk-field bg-white px-3.5 text-[12.5px] font-medium text-dk-soft"
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <Footnote className="mt-1.5">
                  The reason is for the chambers only — a client never sees it, only that nothing is free.
                </Footnote>
              </div>

              <AppButton variant="primary" onClick={submitException} disabled={addingException}>
                {addingException ? "Blocking…" : exWholeDay ? "Block the whole day" : "Block those hours"}
              </AppButton>
            </div>
          )}

          {initialExceptions.length === 0 ? (
            <AppEmpty
              title="Nothing blocked from today onwards"
              hint={
                canEdit
                  ? "Block a date above the moment it is fixed — a hearing, a trip, a public holiday — and the wizard stops offering it."
                  : "An owner or admin of the firm, or this lawyer, can block a date here."
              }
            />
          ) : (
            <ul className="divide-y divide-dk-rule overflow-hidden rounded-[10px] border border-dk-line">
              {initialExceptions.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">
                      {dayLabel(e.on_date)}
                      {e.start_time && e.end_time ? ` · ${hm(e.start_time)}–${hm(e.end_time)}` : " · whole day"}
                    </p>
                    <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-soft">
                      {e.is_available
                        ? "Marked available — the booking engine only reads blocks, so this changes nothing."
                        : e.reason?.trim() || "No reason recorded"}
                    </p>
                  </div>
                  {canEdit && (
                    <AppButton
                      variant="ghost-sm"
                      disabled={removing && removingId === e.id}
                      onClick={() => lift(e.id)}
                    >
                      {removing && removingId === e.id ? "Lifting…" : "Lift"}
                    </AppButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </AppCardBody>
      </AppCard>
    </div>
  );
}
