"use server";

// Availability writes: the working week that decides what the public booking
// wizard may offer a client, and the days it must not.
//
// Screens served: the availability editor in the staff console.
//
// Rules enforced here:
//  · The database is the authorization layer. Every write runs as the signed-in
//    staff member and no service key is ever used. availability_rules_write and
//    availability_exceptions_write allow (lawyer_id = auth.uid() and staff_w) or
//    admin_w — a lawyer edits her own week, an owner or admin edits anyone's —
//    and staff_w already means member + MFA + firm not suspended. This file
//    never decides who may write; it shows the database's refusal verbatim.
//  · The times below are the LAWYER'S own local times. available_slots() reads
//    coalesce(profiles.timezone, firms.timezone) for the lawyer, so a block that
//    says 09:00 means nine in the morning where that lawyer sits — the editor
//    says so, and nothing here converts anything.
//  · Nothing firm-specific: the firm and the lawyer arrive as arguments.
//
// A week is saved whole (delete, then insert) because that is the only way to
// express "this day is now closed". The rows that were there are read first and
// put back if the insert is refused, so a refusal never leaves a lawyer with an
// empty week.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { WEEKDAYS } from "@/lib/firm-data";
import type { AvailabilityRule } from "@/lib/db/types";

type Err = { error: string } | undefined;

/** A time-of-day column: accepts 09:00 and the 09:00:00 the database returns. */
const hhmm = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, { message: "Use a 24-hour time such as 09:00." })
  .transform((v) => v.slice(0, 5));

const uuid = z.string().uuid();

const ruleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: hhmm,
  endTime: hhmm,
  breakStart: hhmm.nullish(),
  breakEnd: hhmm.nullish(),
  slotMin: z.number().int().min(5, { message: "A slot cannot be shorter than 5 minutes." }).max(240, { message: "Keep the slot step to four hours or less." }),
  maxPerDay: z.number().int().min(1, { message: "A working day allows at least one appointment." }).max(40, { message: "Forty appointments in a day is not a working day." }),
});

/** What the editor sends for one block of one weekday. */
export interface AvailabilityRuleInput {
  weekday: number;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
  slotMin: number;
  maxPerDay: number;
}

export interface AvailabilityExceptionInput {
  onDate: string;
  isAvailable: boolean;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
}

const exceptionSchema = z.object({
  onDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Choose a date." }),
  isAvailable: z.boolean(),
  startTime: hhmm.nullish(),
  endTime: hhmm.nullish(),
  reason: z.string().trim().max(200).nullish(),
});

/** Minutes since midnight — the only arithmetic a time-of-day column needs. */
function minutes(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

function dayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? `Day ${weekday}`;
}

function refresh() {
  revalidatePath("/firm/availability");
  revalidatePath("/firm/appointments");
  revalidatePath("/firm");
}

/**
 * Replace a lawyer's whole week. An empty array is a valid week: it means the
 * lawyer takes no consultations at all, and the wizard will offer nothing.
 */
export async function saveRules(
  firmId: string,
  lawyerId: string,
  rules: AvailabilityRuleInput[],
): Promise<Err> {
  if (!uuid.safeParse(firmId).success || !uuid.safeParse(lawyerId).success) {
    return { error: "That firm or lawyer could not be read." };
  }
  const parsed = z.array(ruleSchema).max(35, { message: "Five blocks a day is already more than a diary can hold." }).safeParse(rules);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the week and try again." };
  const clean = parsed.data;

  // Same validation the editor runs, repeated here because a server action is a
  // public endpoint: the browser's check is a courtesy, this one is the rule.
  for (const r of clean) {
    const day = dayName(r.weekday);
    if (minutes(r.endTime) <= minutes(r.startTime)) {
      return { error: `${day}: a block that starts at ${r.startTime} cannot end at ${r.endTime}. The end must be later than the start.` };
    }
    const hasBreakStart = Boolean(r.breakStart);
    const hasBreakEnd = Boolean(r.breakEnd);
    if (hasBreakStart !== hasBreakEnd) {
      return { error: `${day}: a break needs both a start and an end, or neither.` };
    }
    if (r.breakStart && r.breakEnd) {
      if (minutes(r.breakEnd) <= minutes(r.breakStart)) {
        return { error: `${day}: the break ends at ${r.breakEnd}, before it starts at ${r.breakStart}.` };
      }
      if (minutes(r.breakStart) < minutes(r.startTime) || minutes(r.breakEnd) > minutes(r.endTime)) {
        return { error: `${day}: the break ${r.breakStart}–${r.breakEnd} falls outside the block ${r.startTime}–${r.endTime}, so it would block nothing.` };
      }
    }
  }

  for (let i = 0; i < clean.length; i += 1) {
    for (let j = i + 1; j < clean.length; j += 1) {
      const a = clean[i];
      const b = clean[j];
      if (a.weekday !== b.weekday) continue;
      if (minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime)) {
        return {
          error: `${dayName(a.weekday)}: the blocks ${a.startTime}–${a.endTime} and ${b.startTime}–${b.endTime} overlap, so the same time would be offered twice.`,
        };
      }
    }
  }

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const columns = "id, firm_id, lawyer_id, weekday, start_time, end_time, break_start, break_end, slot_min, max_per_day";
  const { data: before, error: readError } = await supabase
    .from("availability_rules")
    .select(columns)
    .eq("firm_id", firmId)
    .eq("lawyer_id", lawyerId);
  if (readError) return { error: readError.message };
  const previous = (before ?? []) as AvailabilityRule[];

  const { error: deleteError } = await supabase
    .from("availability_rules")
    .delete()
    .eq("firm_id", firmId)
    .eq("lawyer_id", lawyerId);
  if (deleteError) return { error: deleteError.message };

  if (clean.length === 0) {
    refresh();
    return undefined;
  }

  // No RETURNING: the select policy reads the same table, and the id is ours to make.
  const rows = clean.map((r) => ({
    id: crypto.randomUUID(),
    firm_id: firmId,
    lawyer_id: lawyerId,
    weekday: r.weekday,
    start_time: r.startTime,
    end_time: r.endTime,
    break_start: r.breakStart || null,
    break_end: r.breakEnd || null,
    slot_min: r.slotMin,
    max_per_day: r.maxPerDay,
  }));
  const { error: insertError } = await supabase.from("availability_rules").insert(rows);
  if (!insertError) {
    refresh();
    return undefined;
  }

  // Refused. Put back whatever the delete actually removed — under RLS a refused
  // delete removes nothing, so only the rows that really went missing go back.
  const { data: after } = await supabase
    .from("availability_rules")
    .select("id")
    .eq("firm_id", firmId)
    .eq("lawyer_id", lawyerId);
  const stillThere = new Set(((after ?? []) as Array<{ id: string }>).map((r) => r.id));
  const missing = previous.filter((r) => !stillThere.has(r.id));
  if (missing.length > 0) {
    const { error: restoreError } = await supabase.from("availability_rules").insert(missing);
    if (restoreError) {
      return {
        error: `${insertError.message} — and the week that was there could not be put back (${restoreError.message}). Re-enter it and save again before anyone books.`,
      };
    }
  }
  refresh();
  return { error: `${insertError.message} Nothing was changed.` };
}

/**
 * Block a date, or part of one: court, leave, a public holiday. available_slots()
 * drops the whole day when there are no times, and only the overlapping slots
 * when there are.
 */
export async function addException(
  firmId: string,
  lawyerId: string,
  input: AvailabilityExceptionInput,
): Promise<Err> {
  if (!uuid.safeParse(firmId).success || !uuid.safeParse(lawyerId).success) {
    return { error: "That firm or lawyer could not be read." };
  }
  const parsed = exceptionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the date and try again." };
  const d = parsed.data;

  const hasStart = Boolean(d.startTime);
  const hasEnd = Boolean(d.endTime);
  if (hasStart !== hasEnd) return { error: "Give both a start and an end time, or block the whole day." };
  if (d.startTime && d.endTime && minutes(d.endTime) <= minutes(d.startTime)) {
    return { error: `That range ends at ${d.endTime}, before it starts at ${d.startTime}.` };
  }

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data: clash } = await supabase
    .from("availability_exceptions")
    .select("id, is_available, start_time, end_time")
    .eq("firm_id", firmId)
    .eq("lawyer_id", lawyerId)
    .eq("on_date", d.onDate);
  const existing = (clash ?? []) as Array<{ id: string; is_available: boolean; start_time: string | null; end_time: string | null }>;
  if (existing.some((e) => e.is_available === d.isAvailable && (e.start_time ?? "").slice(0, 5) === (d.startTime ?? "") && (e.end_time ?? "").slice(0, 5) === (d.endTime ?? ""))) {
    return { error: "That date is already blocked in exactly this way." };
  }
  if (!d.startTime && existing.some((e) => !e.is_available && !e.start_time)) {
    return { error: "That whole day is already blocked." };
  }

  const { error } = await supabase.from("availability_exceptions").insert({
    id: crypto.randomUUID(),
    firm_id: firmId,
    lawyer_id: lawyerId,
    on_date: d.onDate,
    is_available: d.isAvailable,
    start_time: d.startTime || null,
    end_time: d.endTime || null,
    reason: d.reason?.trim() || null,
  });
  if (error) return { error: error.message };
  refresh();
  return undefined;
}

/** Lift a block. Existing appointments are untouched — move those on the diary. */
export async function removeException(id: string): Promise<Err> {
  if (!uuid.safeParse(id).success) return { error: "That entry could not be read." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { error } = await supabase.from("availability_exceptions").delete().eq("id", id);
  if (error) return { error: error.message };

  // A delete the policy refuses removes nothing and says nothing: check.
  const { data: still } = await supabase.from("availability_exceptions").select("id").eq("id", id).maybeSingle();
  if (still) {
    return {
      error: "The database refused to remove that. Only the lawyer whose diary it is, or an owner or admin of the firm, may lift a block — and the firm must not be suspended.",
    };
  }
  refresh();
  return undefined;
}
