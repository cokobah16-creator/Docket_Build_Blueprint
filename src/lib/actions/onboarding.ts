"use server";

// The checklist's two writes and the import's five, as the signed-in owner or admin.
//
// Rules enforced here: the database is the authorization layer — skip_onboarding_step(),
// resume_onboarding_step(), process_import_batch(), preview_import_duplicates() and
// discard_import_batch() ask admin_w(firm) themselves, and the two
// table writes (import_batches, import_rows) run under policies that ask the same; no service
// key is used; refusals are the database's own words. An INSERT never uses .select(): ids are
// minted here with crypto.randomUUID() and read back separately. Nothing here interprets a CSV
// value — what a column means was decided on the screen, and the database decides what it can
// file. Nothing firm-specific: the firm arrives from the caller's context.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import type { OnboardingStep } from "@/lib/db/types";

type Err = { error: string } | undefined;

const STEPS: OnboardingStep[] = ["policies", "operations", "settlement", "people", "profile", "availability", "services", "intake", "brand", "service_of_process", "import", "domain"];
const uuid = z.string().uuid();

function refresh() {
  revalidatePath("/firm/admin");
  revalidatePath("/firm/admin/services");
  revalidatePath("/firm/admin/import");
}

export async function skipOnboardingStep(firmId: string, step: OnboardingStep, note: string | null | undefined): Promise<Err> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };
  if (!STEPS.includes(step)) return { error: "Unknown step." };
  const trimmed = (note ?? "").trim();
  if (trimmed.length > 500) return { error: "Keep the note to 500 characters." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("skip_onboarding_step", { p_firm: firmId, p_step: step, p_note: trimmed || null });
  if (error) return { error: error.message };
  refresh();
  return undefined;
}

export async function resumeOnboardingStep(firmId: string, step: OnboardingStep): Promise<Err> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };
  if (!STEPS.includes(step)) return { error: "Unknown step." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("resume_onboarding_step", { p_firm: firmId, p_step: step });
  if (error) return { error: error.message };
  refresh();
  return undefined;
}

// ---------------------------------------------------------------- the import
/** The columns an import row may carry. Anything else the screen mapped is dropped before staging. */
export const IMPORT_FIELDS = [
  "title", "cause_title", "type", "status", "court", "suit_number", "judicial_division",
  "handling_lawyer", "originating_lawyer", "opened_on", "closed_on", "legacy_reference",
  "client_name", "client_phone", "client_email", "opposing_party", "description", "next_action",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

const rowSchema = z.object({
  row_no: z.number().int().min(1).max(100000),
  raw: z.record(z.string(), z.string().max(8000)),
  skip: z.boolean().optional(),
});

export type CreateImportBatchResult = { error: string } | { batchId: string };

/** One staged file. The rows follow in chunks; nothing is processed until the screen asks. */
export async function createImportBatch(firmId: string, sourceName: string, rowCount: number): Promise<CreateImportBatchResult> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };
  const name = sourceName.trim().slice(0, 200);
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > 5000) return { error: "An import carries between 1 and 5,000 rows." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Not signed in." };
  const id = crypto.randomUUID();
  const { error } = await supabase.from("import_batches").insert({ id, firm_id: firmId, kind: "matters", source_name: name || null, row_count: rowCount, created_by: auth.user.id });
  if (error) return { error: error.message };
  return { batchId: id };
}

/** Up to 200 rows at a time. The database keeps only the known columns' text, verbatim. */
export async function stageImportRows(batchId: string, firmId: string, rows: Array<{ row_no: number; raw: Record<string, string>; skip?: boolean }>): Promise<Err> {
  if (!uuid.safeParse(batchId).success || !uuid.safeParse(firmId).success) return { error: "Unknown import." };
  if (rows.length === 0 || rows.length > 200) return { error: "Stage between 1 and 200 rows at a time." };
  const parsed = z.array(rowSchema).safeParse(rows);
  if (!parsed.success) {
    const at = Number(parsed.error.issues[0]?.path?.[0] ?? 0);
    const rowNo = rows[at]?.row_no ?? at + 1;
    return { error: `Row ${rowNo} could not be read — a cell is longer than 8,000 characters.` };
  }
  const allowed = new Set<string>(IMPORT_FIELDS);
  const clean = parsed.data.map((r) => ({
    id: crypto.randomUUID(),
    batch_id: batchId,
    firm_id: firmId,
    row_no: r.row_no,
    skip: Boolean(r.skip),
    raw: Object.fromEntries(Object.entries(r.raw as Record<string, string>).filter(([k, v]) => allowed.has(k) && v.trim() !== "").map(([k, v]) => [k, v.trim()])),
  }));
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.from("import_rows").insert(clean);
  // A chunk is one insert: either it all landed or none of it did. A duplicate (batch, row_no) means
  // the chunk landed and the reply was lost, so the retry is done.
  if (error && error.code === "23505") return undefined;
  if (error) return { error: error.message };
  return undefined;
}

/** A batch whose staging never finished has filed nothing and can go. One that has begun filing stays. */
export async function discardImportBatch(batchId: string): Promise<Err> {
  if (!uuid.safeParse(batchId).success) return { error: "Unknown import." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("discard_import_batch", { p_batch: batchId });
  if (error) return { error: error.message };
  refresh();
  revalidatePath(`/firm/admin/import/${batchId}`);
  return undefined;
}

/** Tick a row out (or back in) before the batch is processed. After processing the policy refuses. */
export async function setImportRowSkip(rowId: string, skip: boolean): Promise<Err> {
  if (!uuid.safeParse(rowId).success) return { error: "Unknown row." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error, count } = await supabase.from("import_rows").update({ skip }, { count: "exact" }).eq("id", rowId);
  if (error) return { error: error.message };
  if (count === 0) return { error: "That row has already been processed." };
  return undefined;
}

export type ProcessImportResult = { error: string } | { processed: number; created: number; skipped: number; failed: number; remaining: number };

/** Processes a bounded number of rows; the screen calls it until remaining is 0. */
export async function processImportBatch(batchId: string, limit = 25): Promise<ProcessImportResult> {
  if (!uuid.safeParse(batchId).success) return { error: "Unknown import." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data, error } = await supabase.rpc("process_import_batch", { p_batch: batchId, p_limit: Math.min(200, Math.max(1, limit)) });
  if (error) return { error: error.message };
  const r = (data ?? {}) as Record<string, number>;
  revalidatePath("/firm/matters");
  revalidatePath("/firm");
  revalidatePath(`/firm/admin/import/${batchId}`);
  return { processed: Number(r.processed ?? 0), created: Number(r.created ?? 0), skipped: Number(r.skipped ?? 0), failed: Number(r.failed ?? 0), remaining: Number(r.remaining ?? 0) };
}

export interface DuplicateHit { row_no: number; reason: string; reference: string }

/**
 * Before staging: which rows already look like a matter on the books — same old file number,
 * same suit number, or the same cause title. preview_import_duplicates() compares in the
 * database with the values as parameters (never in a URL, so a file of a thousand suit numbers or
 * a title with a quote in it is like any other), under the signed-in admin's own rights, so only
 * this firm's matters — and only the ones they can see — are compared. A hit is a warning for
 * the person, not a decision.
 */
export async function previewImportDuplicates(
  firmId: string,
  rows: Array<{ row_no: number; legacy_reference?: string; suit_number?: string; cause_title?: string }>,
): Promise<{ error: string } | { hits: DuplicateHit[] }> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  if (rows.length > 5000) return { error: "An import carries at most 5,000 rows." };
  const legacy = Array.from(new Set(rows.map((r) => (r.legacy_reference ?? "").trim()).filter(Boolean)));
  const suits = Array.from(new Set(rows.map((r) => (r.suit_number ?? "").trim().toLowerCase()).filter(Boolean)));
  const causes = Array.from(new Set(rows.map((r) => (r.cause_title ?? "").trim().toLowerCase()).filter(Boolean)));
  if (legacy.length + suits.length + causes.length === 0) return { hits: [] };
  const { data, error } = await supabase.rpc("preview_import_duplicates", {
    p_firm: firmId, p_legacy: legacy.length ? legacy : null, p_suits: suits.length ? suits : null, p_causes: causes.length ? causes : null,
  });
  if (error) return { error: error.message };
  const found = (data ?? []) as Array<{ kind: "legacy" | "suit" | "cause"; matched: string | null; reference: string }>;
  const legacyMap = new Map(found.filter((f) => f.kind === "legacy").map((f) => [f.matched ?? "", f.reference]));
  const suitMap = new Map(found.filter((f) => f.kind === "suit").map((f) => [(f.matched ?? "").toLowerCase(), f.reference]));
  const causeMap = new Map(found.filter((f) => f.kind === "cause").map((f) => [(f.matched ?? "").toLowerCase(), f.reference]));
  const hits: DuplicateHit[] = [];
  for (const r of rows) {
    const l = (r.legacy_reference ?? "").trim();
    const s = (r.suit_number ?? "").trim().toLowerCase();
    const c = (r.cause_title ?? "").trim().toLowerCase();
    if (l && legacyMap.has(l)) hits.push({ row_no: r.row_no, reason: `file ${l} is already on Docket`, reference: legacyMap.get(l)! });
    else if (s && suitMap.has(s)) hits.push({ row_no: r.row_no, reason: `suit ${s} is already on Docket`, reference: suitMap.get(s)! });
    else if (c && causeMap.has(c)) hits.push({ row_no: r.row_no, reason: "a matter with this cause title is already on Docket", reference: causeMap.get(c)! });
  }
  return { hits };
}
