"use server";

// Partner API credentials and endpoints (migration 46).
//
// Every rule is the database's: issue_api_credential(), revoke_api_credential(), set_api_endpoint()
// and remove_api_endpoint() all ask admin_w(), which is owner-or-admin with a second factor. This
// file carries a form to them and returns their refusals word for word.
//
// The key and the signing secret are returned ONCE, by the database, and passed straight back to
// the screen that asked. Neither is stored anywhere here, logged, or retrievable afterwards.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

type Err = { error: string } | undefined;
const uuid = z.string().uuid();

export async function issueApiCredential(
  firmId: string, name: string, scopes: string[], expiresOn: string | null,
): Promise<{ error: string } | { id: string; prefix: string; key: string }> {
  if (!uuid.safeParse(firmId).success) return { error: "Unknown firm." };
  const parsed = z.object({
    name: z.string().trim().min(2, "Give the key a name you will recognise in six months.").max(80),
    scopes: z.array(z.enum(["matters:read", "invoices:read", "clients:read", "events:read"]))
      .min(1, "Choose at least one thing the key may read."),
    expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }).safeParse({ name, scopes, expiresOn });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data, error } = await supabase.rpc("issue_api_credential", {
    p_firm: firmId, p_name: parsed.data.name, p_scopes: parsed.data.scopes, p_expires_on: parsed.data.expiresOn,
  });
  if (error) return { error: error.message };
  const r = (data ?? {}) as { id?: string; prefix?: string; key?: string };
  revalidatePath("/firm/admin/api");
  return { id: String(r.id ?? ""), prefix: String(r.prefix ?? ""), key: String(r.key ?? "") };
}

export async function revokeApiCredential(id: string, reason?: string | null): Promise<Err> {
  if (!uuid.safeParse(id).success) return { error: "Unknown key." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("revoke_api_credential", {
    p_id: id, p_reason: reason?.trim() ? reason.trim().slice(0, 500) : null,
  });
  if (error) return { error: error.message };
  revalidatePath("/firm/admin/api");
  return undefined;
}

export async function setApiEndpoint(
  firmId: string, url: string, types: string[],
): Promise<{ error: string } | { id: string; signingSecret: string }> {
  if (!uuid.safeParse(firmId).success) return { error: "Unknown firm." };
  const parsed = z.string().trim().url("That is not a web address.")
    .startsWith("https://", "An endpoint must be https: Docket will not post a firm's events over plain http.")
    .max(500).safeParse(url);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the address." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data, error } = await supabase.rpc("set_api_endpoint", {
    p_firm: firmId, p_url: parsed.data, p_types: types,
  });
  if (error) return { error: error.message };
  const r = (data ?? {}) as { id?: string; signing_secret?: string };
  revalidatePath("/firm/admin/api");
  return { id: String(r.id ?? ""), signingSecret: String(r.signing_secret ?? "") };
}

export async function removeApiEndpoint(id: string): Promise<Err> {
  if (!uuid.safeParse(id).success) return { error: "Unknown endpoint." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("remove_api_endpoint", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/firm/admin/api");
  return undefined;
}
