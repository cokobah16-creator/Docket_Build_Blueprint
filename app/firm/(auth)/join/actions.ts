"use server";

// Accepting a staff invite is the database's decision: accept_staff_invite() checks the
// token, its expiry and that the identity provider's email matches the invitation.

import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

export type JoinState = { error?: string };

export async function acceptInvite(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const parsed = z.string().regex(/^[0-9a-f]{48}$/).safeParse(formData.get("token"));
  if (!parsed.success) return { error: "This invitation link is not valid." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("accept_staff_invite", { p_token: parsed.data });
  if (error) return { error: error.message };
  redirect("/firm/security/mfa");
}
