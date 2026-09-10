"use server";

// Server actions for the client portal. Every write runs as the signed-in
// user — RLS (consent_records: with check user_id = auth.uid()) is the
// authorization, not this code.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

const consentSchema = z.object({
  firmId: z.string().uuid(),
  termsVersion: z.string().min(1).max(64),
  privacyVersion: z.string().min(1).max(64),
});

export async function recordConsent(formData: FormData): Promise<void> {
  const parsed = consentSchema.safeParse({
    firmId: formData.get("firmId"),
    termsVersion: formData.get("termsVersion"),
    privacyVersion: formData.get("privacyVersion"),
  });
  if (!parsed.success) return;

  const supabase = await supabaseServer();
  if (!supabase) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("consent_records").insert([
    {
      user_id: user.id,
      firm_id: parsed.data.firmId,
      kind: "terms",
      version: parsed.data.termsVersion,
    },
    {
      user_id: user.id,
      firm_id: parsed.data.firmId,
      kind: "privacy",
      version: parsed.data.privacyVersion,
    },
  ]);

  revalidatePath("/app");
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  if (supabase) await supabase.auth.signOut();
  redirect("/app/login");
}
