"use server";

// Server actions for the client portal. Every write runs as the signed-in
// user. The database is the authorization, not this code: record_consent()
// (migration 52) records an acceptance for auth.uid() only, at the versions the
// firm has published.

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { SELECTED_FIRM_COOKIE } from "@/lib/portal-firm";
import { recordFirmConsent } from "@/lib/consent";

export type ConsentState = { error?: string };

// A ticked checkbox posts "on"; an unticked one posts nothing at all. Both are required here as
// well as in the browser, because a form can be posted without the page that drew it.
const consentSchema = z.object({
  firmId: z.string().uuid(),
  acceptTerms: z.literal("on"),
  acceptPrivacy: z.literal("on"),
  // What the gate showed. Compared with the firm's published versions, never recorded as given:
  // record_consent() takes the versions from the database. See src/lib/consent.ts.
  shownTermsVersion: z.string().min(1).max(64),
  shownPrivacyVersion: z.string().min(1).max(64),
});

export async function recordConsent(_prev: ConsentState, formData: FormData): Promise<ConsentState> {
  const parsed = consentSchema.safeParse({
    firmId: formData.get("firmId"),
    acceptTerms: formData.get("acceptTerms"),
    acceptPrivacy: formData.get("acceptPrivacy"),
    shownTermsVersion: formData.get("shownTermsVersion"),
    shownPrivacyVersion: formData.get("shownPrivacyVersion"),
  });
  if (!parsed.success) {
    const ticked = formData.get("acceptTerms") === "on" && formData.get("acceptPrivacy") === "on";
    return {
      error: ticked
        ? "This form is out of date. Reload the page and try again."
        : "Tick both boxes: one to accept the terms of service, one to say you have read the privacy notice.",
    };
  }

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out. Sign in again, then accept." };

  const error = await recordFirmConsent(supabase, parsed.data.firmId, {
    terms: parsed.data.shownTermsVersion,
    privacy: parsed.data.shownPrivacyVersion,
  });
  if (error) return { error };

  revalidatePath("/app", "layout");
  return {};
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  if (supabase) await supabase.auth.signOut();
  // The firm selection belongs to the session that made it — the next person
  // to sign in on this phone must not arrive wearing someone else's firm.
  (await cookies()).delete({ name: SELECTED_FIRM_COOKIE, path: "/app" });
  redirect("/app/login");
}
