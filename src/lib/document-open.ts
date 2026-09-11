// Recording a document read, and the one error that is not a refusal.
//
// open_document_version() (migration 30) records who opened which version, and the Storage
// read policy requires that record before it mints a signed URL. The runbook deploys this front
// end BEFORE applying 30 — the other order would stop every document opening on the old front
// end — so for the length of that window the function does not exist and PostgREST answers
// PGRST202 (not in the schema cache). During that window the old Storage policy still admits the
// read, so that one error is passed over. Every other error is a refusal and stops the open.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Returns null when the read may proceed, otherwise the refusal to show. */
export async function recordDocumentOpen(supabase: SupabaseClient, versionId: string): Promise<string | null> {
  const { error } = await supabase.rpc("open_document_version", { p_version: versionId });
  if (!error) return null;
  if (error.code === "PGRST202") return null;
  return error.message;
}
