"use server";

// Referrals, joint counsel and agency between two firms on Docket (migration 45).
//
// Every rule is the database's. propose_collaboration() asks matter_row_w() on the owning firm and
// refuses a firm that is not on Docket; respond_to_collaboration() admits the receiving firm alone;
// share_document_with_collaborator() is the owning firm's act and refuses a version with no
// checksum; end_collaboration() admits either side. Nothing is decided here and no service key is
// used — the refusals below are the database's own sentences.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import type { ProposeInput } from "@/lib/collaboration-copy";

type Err = { error: string } | undefined;
const uuid = z.string().uuid();

const proposeSchema = z.object({
  matterId: uuid,
  withFirmId: uuid,
  kind: z.enum(["referral", "joint_counsel", "agency"]),
  scopeNote: z.string().trim().min(2, "Say what you are asking them to do.").max(2000),
  shareUpdates: z.boolean(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the day as YYYY-MM-DD.").nullable(),
});

export async function proposeCollaboration(input: ProposeInput): Promise<{ error: string } | { id: string }> {
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data, error } = await supabase.rpc("propose_collaboration", {
    p_matter: d.matterId, p_with_firm: d.withFirmId, p_kind: d.kind,
    p_scope_note: d.scopeNote, p_share_updates: d.shareUpdates, p_ends_on: d.endsOn,
  });
  if (error) return { error: error.message };
  revalidatePath(`/firm/matters/${d.matterId}`);
  return { id: String(data ?? "") };
}

export async function respondToCollaboration(id: string, accept: boolean, reason?: string | null): Promise<Err> {
  if (!uuid.safeParse(id).success) return { error: "Unknown arrangement." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("respond_to_collaboration", {
    p_id: id, p_accept: accept, p_reason: reason?.trim() ? reason.trim().slice(0, 1000) : null,
  });
  if (error) return { error: error.message };
  revalidatePath("/firm/collaborations");
  return undefined;
}

export async function shareDocumentWithCollaborator(collaborationId: string, versionId: string, matterId: string): Promise<Err> {
  if (!uuid.safeParse(collaborationId).success || !uuid.safeParse(versionId).success) return { error: "Unknown document." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("share_document_with_collaborator", {
    p_collaboration: collaborationId, p_version: versionId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/firm/matters/${matterId}`);
  return undefined;
}

export async function withdrawSharedDocument(id: string, matterId: string): Promise<Err> {
  if (!uuid.safeParse(id).success) return { error: "Unknown document." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("withdraw_shared_document", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath(`/firm/matters/${matterId}`);
  return undefined;
}

export async function endCollaboration(id: string, reason?: string | null): Promise<Err> {
  if (!uuid.safeParse(id).success) return { error: "Unknown arrangement." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("end_collaboration", {
    p_id: id, p_reason: reason?.trim() ? reason.trim().slice(0, 1000) : null,
  });
  if (error) return { error: error.message };
  revalidatePath("/firm/collaborations");
  revalidatePath("/firm/matters");
  return undefined;
}

export async function postCollaborationNote(collaborationId: string, body: string): Promise<Err> {
  if (!uuid.safeParse(collaborationId).success) return { error: "Unknown arrangement." };
  const text = body.trim();
  if (text.length === 0) return { error: "Say something." };
  if (text.length > 4000) return { error: "That is too long for a note." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("post_collaboration_note", { p_collaboration: collaborationId, p_body: text });
  if (error) return { error: error.message };
  revalidatePath("/firm/collaborations");
  revalidatePath("/firm/matters");
  return undefined;
}
