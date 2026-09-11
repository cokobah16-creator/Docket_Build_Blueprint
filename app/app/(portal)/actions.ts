"use server";

// Server actions for the client portal. Every write runs as the signed-in
// user — RLS (consent_records: with check user_id = auth.uid()) is the
// authorization, not this code.

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { SELECTED_FIRM_COOKIE } from "@/lib/portal-firm";

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
  // The firm selection belongs to the session that made it — the next person
  // to sign in on this phone must not arrive wearing someone else's firm.
  (await cookies()).delete({ name: SELECTED_FIRM_COOKIE, path: "/app" });
  redirect("/app/login");
}
