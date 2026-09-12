"use server";

// Templates and execution (migration 40): a firm's templates, a document generated from the
// matter's facts, a signature asked for and recorded, an instrument executed on paper recorded.
//
// Rules enforced here: the database is the authorization layer — the template policies ask
// admin_w(); prepare_generated_document(), finalize_generated_version(), request_signature() and
// record_paper_execution() ask matter_row_w(); record_signature() asks that the signer may see
// the version, opened it, and typed their own name. The PDF is rendered here as the signed-in
// person and uploaded through the storage policy that already lets them add to the document; its
// sha256 is computed from the bytes stored, and the version is recorded by the database with it.
// No service key. A character the document's font cannot print stops the generation and is named
// — nothing is silently printed as "?". Refusals are the database's own words.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { PdfEncodingError, textPdf, type PdfLine } from "@/lib/pdf";
import { MATTER_TYPES, type TemplateExecution } from "@/lib/db/types";

type Err = { error: string } | undefined;
const uuid = z.string().uuid();

function refreshMatter(matterId: string | null) {
  if (matterId) { revalidatePath(`/firm/matters/${matterId}`); revalidatePath(`/app/matters/${matterId}`); }
  revalidatePath("/firm/uploads");
}

// ---------------------------------------------------------------- templates
export interface TemplateInput { id?: string | null; firmId: string; name: string; matterTypes: string[]; body: string; execution: TemplateExecution; note: string }

export async function saveDocumentTemplate(input: TemplateInput): Promise<Err> {
  const parsed = z.object({
    id: uuid.nullish(), firmId: uuid, name: z.string().trim().min(2, "Give the template a name.").max(120),
    matterTypes: z.array(z.enum(MATTER_TYPES)).max(20), body: z.string().min(1, "Write the template.").max(60000),
    execution: z.enum(["electronic", "paper", "either"]), note: z.string().trim().max(1000),
  }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const row = { name: d.name, matter_types: d.matterTypes.length ? d.matterTypes : null, body: d.body, execution: d.execution, note: d.note || null };
  if (d.id) {
    const { error, count } = await supabase.from("document_templates").update(row, { count: "exact" }).eq("id", d.id);
    if (error) return { error: error.message };
    if (count === 0) return { error: "Nothing was changed: only an owner or administrator with a second factor edits templates." };
  } else {
    const { error } = await supabase.from("document_templates").insert({ id: crypto.randomUUID(), firm_id: d.firmId, ...row });
    if (error) return { error: error.message };
  }
  revalidatePath("/firm/admin/templates");
  return undefined;
}

export async function retireDocumentTemplate(templateId: string, retire: boolean): Promise<Err> {
  if (!uuid.safeParse(templateId).success) return { error: "Unknown template." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error, count } = await supabase.from("document_templates").update({ retired_at: retire ? new Date().toISOString() : null }, { count: "exact" }).eq("id", templateId);
  if (error) return { error: error.message };
  if (count === 0) return { error: "Nothing was changed: only an owner or administrator with a second factor edits templates." };
  revalidatePath("/firm/admin/templates");
  return undefined;
}

// ---------------------------------------------------------------- generation
export interface GenerateInput { matterId: string; templateId: string; name?: string | null; clientId?: string | null; extra: Record<string, string> }

/**
 * Prepare (the database fills the template and opens the document), render, hash, store,
 * finalise. If rendering or storing fails the document is left without a file, which the screens
 * show as such and Remove retires.
 */
export async function generateDocument(input: GenerateInput): Promise<{ error: string } | { documentId: string; versionId: string }> {
  const parsed = z.object({
    matterId: uuid, templateId: uuid, name: z.string().trim().max(200).nullish(), clientId: uuid.nullish(),
    extra: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), z.string().max(2000)),
  }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data, error } = await supabase.rpc("prepare_generated_document", { p_matter: d.matterId, p_template: d.templateId, p_name: d.name || null, p_client: d.clientId ?? null, p_extra: d.extra });
  if (error) return { error: error.message };
  const prep = data as { document_id: string; version_id: string; storage_path: string; name: string; text: string; facts: Record<string, unknown>; template_version: number; execution: string };

  let bytes: Uint8Array;
  try {
    const lines: PdfLine[] = [
      { text: prep.name, size: 14, bold: true, gap: 8 },
      ...prep.text.split(/\r?\n/).map((t): PdfLine => ({ text: t, size: 11 })),
      { text: "", gap: 14 },
      { text: `Generated on Docket · document ${prep.document_id} · version ${prep.version_id} · template version ${prep.template_version}`, size: 7 },
    ];
    bytes = textPdf(lines);
  } catch (e) {
    if (e instanceof PdfEncodingError) return { error: e.message };
    return { error: `The document could not be rendered: ${String((e as Error)?.message ?? e)}` };
  }
  const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const { error: upError } = await supabase.storage.from("documents").upload(prep.storage_path, bytes, { contentType: "application/pdf", upsert: false });
  if (upError) return { error: `The file could not be stored: ${upError.message}. The document is listed without a file; remove it or try again.` };
  const { error: finError } = await supabase.rpc("finalize_generated_version", {
    p_document: prep.document_id, p_version: prep.version_id, p_storage_path: prep.storage_path, p_size_bytes: bytes.byteLength,
    p_checksum: checksum, p_template: d.templateId, p_facts: prep.facts, p_template_version: prep.template_version,
  });
  if (finError) return { error: finError.message };
  refreshMatter(d.matterId);
  return { documentId: prep.document_id, versionId: prep.version_id };
}

// ---------------------------------------------------------------- execution
export async function requestSignature(documentId: string, matterId: string | null): Promise<Err> {
  if (!uuid.safeParse(documentId).success) return { error: "Unknown document." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("request_signature", { p_document: documentId });
  if (error) return { error: error.message };
  refreshMatter(matterId);
  return undefined;
}

/** The signer has opened the version (recordDocumentOpen) and types their own name. */
export async function signDocument(versionId: string, typedName: string, matterId: string | null): Promise<{ error: string } | { signatureId: string }> {
  if (!uuid.safeParse(versionId).success) return { error: "Unknown version." };
  const name = typedName.trim();
  if (name.length < 2 || name.length > 200) return { error: "Type your name as it is on your profile." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data, error } = await supabase.rpc("record_signature", { p_version: versionId, p_typed_name: name });
  if (error) return { error: error.message };
  refreshMatter(matterId);
  return { signatureId: String(data) };
}

export interface PaperExecutionInput { documentId: string; versionId: string; matterId: string | null; executedOn: string; witnessName: string; attestedBy: string; stampRef: string; registrationRef: string }

export async function recordPaperExecution(input: PaperExecutionInput): Promise<Err> {
  const parsed = z.object({
    documentId: uuid, versionId: uuid, matterId: uuid.nullish(), executedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "The day of execution is YYYY-MM-DD."),
    witnessName: z.string().trim().max(200), attestedBy: z.string().trim().max(200), stampRef: z.string().trim().max(120), registrationRef: z.string().trim().max(120),
  }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("record_paper_execution", {
    p_document: d.documentId, p_version: d.versionId, p_executed_on: d.executedOn, p_witness_name: d.witnessName || null,
    p_attested_by: d.attestedBy || null, p_stamp_ref: d.stampRef || null, p_registration_ref: d.registrationRef || null,
  });
  if (error) return { error: error.message };
  refreshMatter(d.matterId ?? null);
  return undefined;
}
