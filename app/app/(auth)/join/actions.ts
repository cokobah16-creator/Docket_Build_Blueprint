"use server";

// Accepting an invitation to a matter is the database's decision. accept_invite()
// checks the token, that it has not already been used and that it has not expired,
// then adds the caller to matter_parties in the role the firm invited them in. It
// is granted to `authenticated` only, so an anonymous visitor holding a token gets
// nothing until they have signed in as themselves.
//
// Nothing here decides who may join, and no service key is used: the RPC runs as
// the signed-in client and its refusal is returned word for word.

import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

export type JoinState = { error?: string };

/** invites.token is 24 random bytes rendered as hex. */
const tokenSchema = z.string().regex(/^[0-9a-f]{48}$/);

export async function acceptMatterInvite(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const parsed = tokenSchema.safeParse(formData.get("token"));
  if (!parsed.success) return { error: "This invitation link is not valid." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data, error } = await supabase.rpc("accept_invite", { p_token: parsed.data });
  if (error) {
    // The database says "invite invalid or expired" for a token that is unknown,
    // already used or out of date — it cannot say which without telling a stranger
    // something about a token they do not hold. Pass it on, and say what to do.
    return { error: error.message };
  }

  const matterId = (data as { matter_id?: string | null } | null)?.matter_id ?? null;
  redirect(matterId ? `/app/matters/${matterId}` : "/app/matters");
}
