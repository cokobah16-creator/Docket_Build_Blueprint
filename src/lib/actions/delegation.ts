"use server";

// Representations (migration 44): who may act for a client, on what, until when.
//
// Every rule is the database's. grant_representation() asks staff_w() and refuses a principal who
// is not this firm's client; accept_representation() binds a person only when they redeem a
// single-use token AND are the person the firm named; revoke_representation() admits the firm or
// the principal and nobody else. This file carries a form to those functions and returns their
// refusals word for word. No service key, and no decision taken here.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { AUTHORITY_KINDS, CAPACITIES, type GrantInput } from "@/lib/delegation-copy";

type Err = { error: string } | undefined;

const uuid = z.string().uuid();
/** representations.token is 24 random bytes rendered as hex, like every other token here. */
const tokenSchema = z.string().regex(/^[0-9a-f]{48}$/, "This link is not a valid invitation.");

const grantSchema = z.object({
  firmId: uuid,
  principalId: uuid,
  capacity: z.enum(CAPACITIES.map((c) => c.value) as [string, ...string[]]),
  authorityKind: z.enum(AUTHORITY_KINDS.map((a) => a.value) as [string, ...string[]]),
  matterId: uuid.nullable(),
  organisation: z.string().trim().max(200).nullable(),
  canViewDocs: z.boolean(),
  canPay: z.boolean(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the day as YYYY-MM-DD.").nullable(),
  authorityRef: z.string().trim().max(200).nullable(),
  note: z.string().trim().max(2000).nullable(),
  invitedEmail: z.string().trim().email("That is not an email address.").nullable(),
  invitedPhone: z.string().trim().max(32).nullable(),
});

/**
 * Returns the invitation token so the firm can send it by whatever means it already uses. It is
 * shown once, on the screen of the person who granted it, and never emailed by Docket — the same
 * treatment the matter invitation gets.
 */
export async function grantRepresentation(input: GrantInput): Promise<{ error: string } | { token: string; id: string }> {
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  // The database refuses an authority with nothing recorded against it; saying so here first is
  // kinder than a constraint name, and the constraint is still what enforces it.
  if (!d.authorityRef && !d.note) {
    return { error: "Record what you saw: a reference for the document, or a note of how you verified it." };
  }
  // An authority must name somebody. Without one, redeeming the link would have nothing to be
  // measured against — and a link that binds whoever holds it is not an authority. The database
  // refuses it too (representations_invitee_chk); this is only the kinder sentence.
  if (!d.invitedEmail && !d.invitedPhone) {
    return { error: "Give the email or phone of the person who may act. They take it up by signing in as that person, and nobody else can." };
  }
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data, error } = await supabase.rpc("grant_representation", {
    p_firm: d.firmId, p_principal: d.principalId, p_capacity: d.capacity, p_authority_kind: d.authorityKind,
    p_matter: d.matterId, p_organisation: d.organisation, p_can_view_docs: d.canViewDocs, p_can_pay: d.canPay,
    p_expires_on: d.expiresOn, p_authority_ref: d.authorityRef, p_authority_document: null,
    p_note: d.note, p_invited_email: d.invitedEmail, p_invited_phone: d.invitedPhone,
  });
  if (error) return { error: error.message };
  const r = (data ?? {}) as { representation_id?: string; token?: string };
  if (d.matterId) revalidatePath(`/firm/matters/${d.matterId}`);
  revalidatePath(`/firm/clients/${d.principalId}`);
  return { id: String(r.representation_id ?? ""), token: String(r.token ?? "") };
}

export async function revokeRepresentation(id: string, reason?: string | null): Promise<Err> {
  if (!uuid.safeParse(id).success) return { error: "Unknown authority." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("revoke_representation", {
    p_id: id, p_reason: reason?.trim() ? reason.trim().slice(0, 1000) : null,
  });
  if (error) return { error: error.message };
  revalidatePath("/firm/matters");
  revalidatePath("/app/authority");
  return undefined;
}

export async function acceptRepresentation(token: string): Promise<{ error: string } | { matterId: string | null }> {
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "This link is not valid." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data, error } = await supabase.rpc("accept_representation", { p_token: parsed.data });
  if (error) return { error: error.message };
  return { matterId: ((data ?? {}) as { matter_id?: string | null }).matter_id ?? null };
}
