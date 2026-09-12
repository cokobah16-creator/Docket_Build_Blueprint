"use server";

// Court server actions: what happened in court, whether a proposed date is a
// sitting day, and a date the registry vacated.
//
// Rule enforced: the database is the authorization layer. post_court_update(),
// is_non_sitting_day() and vacate_court_event() all run as the signed-in staff
// member — staff_w() (firm member + MFA + firm not suspended) decides, never
// this file, and no service key is ever used. Database messages are returned
// verbatim so the lawyer reads the registry's own reason ("next date … is a
// weekend, public holiday or court vacation") instead of a shrug.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { COURT_OUTCOMES, PURPOSE_KINDS } from "@/lib/db/types";

const OUTCOMES = new Set(COURT_OUTCOMES.map((o) => o.value));
const KINDS = new Set<string>(PURPOSE_KINDS);

/** An instant, always UTC in the database; the forms convert from the viewer's zone. */
const isoInstant = z.string().datetime({ offset: true });
const plainDay = /^\d{4}-\d{2}-\d{2}$/;

const postSchema = z.object({
  matterId: z.string().uuid(),
  outcome: z.string().refine((v) => OUTCOMES.has(v), { message: "Choose what happened in court." }),
  occurredAt: isoInstant.nullish(),
  courtName: z.string().trim().max(200).nullish(),
  adjournedAtInstanceOf: z.string().trim().max(120).nullish(),
  nextDate: isoInstant.nullish(),
  nextPurpose: z.string().trim().max(200).nullish(),
  noteToClient: z.string().trim().max(4000).nullish(),
  internalNote: z.string().trim().max(8000).nullish(),
  courtId: z.string().uuid().nullish(),
  judicialDivision: z.string().trim().max(120).nullish(),
  allowNonSitting: z.boolean().optional(),
  judge: z.string().trim().max(160).nullish(),
  courtroom: z.string().trim().max(80).nullish(),
  purposeKind: z.string().refine((v) => KINDS.has(v), { message: "Unknown purpose." }).nullish(),
  // The client update's shape. "unstated" writes null; the function refuses a "required" with
  // nothing said and a "none" beside something said, so the two cannot contradict each other.
  meaning: z.string().trim().max(2000).nullish(),
  nextStep: z.string().trim().max(2000).nullish(),
  clientAction: z.string().trim().max(2000).nullish(),
  actionRequired: z.enum(["unstated", "none", "required"]).optional(),
  nextUpdateBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "The next update day must be a calendar day.").nullish(),
  /** Minted by the form per posting; a retry with the same reference returns the posting already made. */
  clientRef: z.string().uuid().nullish(),
});

export type CourtUpdateInput = z.infer<typeof postSchema>;
export type PostCourtUpdateResult = { error: string } | { updateId: string };

/**
 * Post a sitting to the matter timeline. The client sees the generated title
 * and the note to the client; the internal note is filed by the same function
 * as a separate visibility='internal' entry and never reaches them.
 */
export async function postCourtUpdate(input: CourtUpdateInput): Promise<PostCourtUpdateResult> {
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  if (d.outcome === "hearing_notice" && !d.nextDate) {
    return { error: "A hearing notice fixes a date — give the next date." };
  }

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data, error } = await supabase.rpc("post_court_update", {
    p_matter: d.matterId,
    p_outcome: d.outcome,
    p_occurred_at: d.occurredAt || new Date().toISOString(),
    p_court_name: d.courtName || null,
    p_adjourned_at_instance_of: d.outcome === "adjourned" ? d.adjournedAtInstanceOf || null : null,
    p_next_date: d.nextDate || null,
    p_next_purpose: d.nextPurpose || null,
    p_note_to_client: d.noteToClient || null,
    p_internal_note: d.internalNote || null,
    p_court_id: d.courtId || null,
    p_judicial_division: d.judicialDivision || null,
    p_allow_non_sitting: d.allowNonSitting ?? false,
    p_judge: d.judge || null,
    p_courtroom: d.courtroom || null,
    p_purpose_kind: d.purposeKind || null,
    p_meaning: d.meaning || null,
    p_next_step: d.nextStep || null,
    p_client_action: d.actionRequired === "required" ? d.clientAction || null : null,
    p_action_required: d.actionRequired === "required" ? true : d.actionRequired === "none" ? false : null,
    p_next_update_by: d.nextUpdateBy || null,
    p_client_ref: d.clientRef || null,
  });
  if (error) return { error: error.message };
  const updateId = typeof data === "string" ? data : null;
  if (!updateId) {
    return { error: "The database did not return the update. Open the matter timeline and check before posting again." };
  }

  revalidatePath("/firm");
  revalidatePath("/firm/sittings");
  revalidatePath("/firm/matters");
  revalidatePath(`/firm/matters/${d.matterId}`);
  return { updateId };
}

export interface NonSittingCheck {
  nonSitting: boolean;
  /** Why, in the lawyer's words: "a Saturday", "Independence Day, a public holiday". */
  reason?: string;
  /** Set when the calendar could not be read; the database still refuses on submit. */
  error?: string;
}

/**
 * Warn before submitting: is this a weekend, a public holiday or a court
 * vacation? Same rule the database applies, asked early so the lawyer is not
 * refused after typing everything. `dateISO` may be a plain YYYY-MM-DD (the
 * court's own calendar date) or a full instant.
 */
export async function checkNonSittingDay(
  dateISO: string,
  level?: string | null,
  state?: string | null,
): Promise<NonSittingCheck> {
  const day = (dateISO ?? "").slice(0, 10);
  if (!plainDay.test(day)) return { nonSitting: false, error: "That date could not be read." };

  const supabase = await supabaseServer();
  if (!supabase) return { nonSitting: false, error: "Not configured." };

  const { data, error } = await supabase.rpc("is_non_sitting_day", {
    p_date: day,
    p_level: level || null,
    p_state: state || null,
  });
  if (error) return { nonSitting: false, error: error.message };
  if (data !== true) return { nonSitting: false };

  return { nonSitting: true, reason: await nonSittingReason(supabase, day, level ?? null, state ?? null) };
}

type Sb = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

/** Name the reason from the same reference data the function reads. Both tables are world-readable. */
async function nonSittingReason(supabase: Sb, day: string, level: string | null, state: string | null): Promise<string | undefined> {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  if (weekday === 6) return "a Saturday";
  if (weekday === 0) return "a Sunday";

  const [{ data: holidayRows }, { data: vacationRows }] = await Promise.all([
    supabase
      .from("public_holidays")
      .select("name, state_code")
      .eq("country", "NG")
      .or(`on_date.eq.${day},observed_on.eq.${day}`),
    supabase
      .from("court_vacations")
      .select("name, level, state_code")
      .lte("starts_on", day)
      .gte("ends_on", day),
  ]);

  const holiday = ((holidayRows ?? []) as Array<{ name: string; state_code: string | null }>)
    .find((h) => h.state_code === null || h.state_code === state);
  if (holiday) return `${holiday.name}, a public holiday`;

  const vacation = ((vacationRows ?? []) as Array<{ name: string; level: string | null; state_code: string | null }>)
    .find((v) => (v.level === null || v.level === level) && (v.state_code === null || v.state_code === state));
  if (vacation) return `${vacation.name} — the court is on vacation`;

  return undefined;
}

const vacateSchema = z.object({
  eventId: z.string().uuid(),
  reason: z.string().trim().min(3, "Say why the date was vacated.").max(500),
  newDateISO: isoInstant.nullish(),
  newPurpose: z.string().trim().max(200).nullish(),
});

export type VacateResult = { error: string } | { newEventId: string | null };

/**
 * The registry vacated a date (judge on leave, transferred, election duty).
 * With a refixed date the function creates the replacement sitting; without
 * one the matter is marked as awaiting a date. Either way the client is told.
 */
export async function vacateCourtEvent(
  eventId: string,
  reason: string,
  newDateISO?: string | null,
  newPurpose?: string | null,
): Promise<VacateResult> {
  const parsed = vacateSchema.safeParse({ eventId, reason, newDateISO, newPurpose });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data, error } = await supabase.rpc("vacate_court_event", {
    p_event: parsed.data.eventId,
    p_reason: parsed.data.reason,
    p_new_date: parsed.data.newDateISO || null,
    p_new_purpose: parsed.data.newPurpose || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/firm");
  revalidatePath("/firm/sittings");
  revalidatePath("/firm/matters");
  return { newEventId: typeof data === "string" ? data : null };
}
