"use server";

// The legal diary's writes, as the signed-in staff member: a deadline computed, confirmed or
// discharged, and a court date given its evidence.
//
// Rules enforced here: the database is the authorization layer — compute_deadline(),
// confirm_deadline(), discharge_deadline() and attach_court_event_source() ask matter_row_w()
// themselves and confirm_deadline() asks for a lawyer of the firm; count_deadline() is the only
// arithmetic and it runs in the database, so a preview and the saved row are the same count. No
// service key; refusals are the database's own words. A DATE is sent as YYYY-MM-DD and never
// converted through a Date, so nothing shifts by a day.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { DEADLINE_TRIGGERS, type DeadlineCalculation } from "@/lib/db/types";

type Err = { error: string } | undefined;
const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A day is YYYY-MM-DD.");

function refresh(matterId: string) {
  revalidatePath(`/firm/matters/${matterId}`);
  revalidatePath("/firm/sittings");
}

export interface ComputeDeadlineInput {
  matterId: string;
  triggerKind: string;
  triggerOn: string;
  provisionId?: string | null;
  dueOn?: string | null;
  title?: string | null;
  triggerRef?: Record<string, unknown>;
  supersedes?: string | null;
  note?: string | null;
}

const computeSchema = z.object({
  matterId: uuid,
  triggerKind: z.enum(DEADLINE_TRIGGERS),
  triggerOn: day,
  provisionId: uuid.nullish(),
  dueOn: day.nullish(),
  title: z.string().trim().max(200).nullish(),
  triggerRef: z.record(z.string(), z.unknown()).optional(),
  supersedes: uuid.nullish(),
  note: z.string().trim().max(1000).nullish(),
});

/** Count and propose. Returns the new row's id; the database has already audited it. */
export async function computeDeadline(input: ComputeDeadlineInput): Promise<{ error: string } | { id: string }> {
  const parsed = computeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data, error } = await supabase.rpc("compute_deadline", {
    p_matter: d.matterId, p_trigger_kind: d.triggerKind, p_trigger_on: d.triggerOn,
    p_provision: d.provisionId ?? null, p_due_on: d.dueOn ?? null, p_title: d.title || null,
    p_trigger_ref: d.triggerRef ?? {}, p_supersedes: d.supersedes ?? null, p_note: d.note || null,
  });
  if (error) return { error: error.message };
  refresh(d.matterId);
  return { id: String(data) };
}

export interface PreviewDeadlineInput {
  from: string;
  period: number;
  unit: "days" | "months";
  mode: "calendar" | "clear" | "working";
  level?: string | null;
  stateCode?: string | null;
  excludesVacation: boolean;
  rollsForward: boolean;
}

/** The same count the saved row will carry, shown before anything is written. */
export async function previewDeadline(input: PreviewDeadlineInput): Promise<{ error: string } | { calculation: DeadlineCalculation }> {
  const parsed = z.object({
    from: day, period: z.number().int().min(1).max(3660), unit: z.enum(["days", "months"]), mode: z.enum(["calendar", "clear", "working"]),
    level: z.string().nullish(), stateCode: z.string().length(2).nullish(), excludesVacation: z.boolean(), rollsForward: z.boolean(),
  }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data, error } = await supabase.rpc("count_deadline", {
    p_from: d.from, p_period: d.period, p_unit: d.unit, p_mode: d.mode,
    p_level: d.level || null, p_state: d.stateCode || null, p_excludes_vacation: d.excludesVacation, p_rolls_forward: d.rollsForward,
  });
  if (error) return { error: error.message };
  return { calculation: data as DeadlineCalculation };
}

export async function confirmDeadline(deadlineId: string, matterId: string): Promise<Err> {
  if (!uuid.safeParse(deadlineId).success || !uuid.safeParse(matterId).success) return { error: "Unknown deadline." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("confirm_deadline", { p_deadline: deadlineId });
  if (error) return { error: error.message };
  refresh(matterId);
  return undefined;
}

export async function dischargeDeadline(deadlineId: string, matterId: string, note: string | null | undefined): Promise<Err> {
  if (!uuid.safeParse(deadlineId).success || !uuid.safeParse(matterId).success) return { error: "Unknown deadline." };
  const trimmed = (note ?? "").trim();
  if (trimmed.length > 1000) return { error: "Keep the note to 1,000 characters." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("discharge_deadline", { p_deadline: deadlineId, p_note: trimmed || null });
  if (error) return { error: error.message };
  refresh(matterId);
  return undefined;
}

/** Attach the notice or cause-list reference a court date came from. Whoever attaches it confirms the date. */
export async function attachCourtEventSource(input: { eventId: string; matterId: string; documentId?: string | null; ref?: string | null; source?: "hearing_notice" | "cause_list" | null }): Promise<Err> {
  const parsed = z.object({
    eventId: uuid, matterId: uuid, documentId: uuid.nullish(), ref: z.string().trim().max(200).nullish(), source: z.enum(["hearing_notice", "cause_list"]).nullish(),
  }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("attach_court_event_source", { p_event: d.eventId, p_document: d.documentId ?? null, p_ref: d.ref || null, p_source: d.source ?? null });
  if (error) return { error: error.message };
  refresh(d.matterId);
  return undefined;
}
