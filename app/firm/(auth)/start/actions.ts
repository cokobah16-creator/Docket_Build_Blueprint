"use server";

// Firm registration. The database does the work: create_firm() validates the
// slug, makes the caller the owner, seeds the firm's defaults and audits it —
// exactly what every firm on Docket gets. This action only validates input
// shape and forwards the session.

import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { NG_STATES } from "@/lib/nigeria";
import type { CreateFirmResult } from "@/lib/db/types";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "Use lowercase letters, numbers and hyphens"),
  legalName: z.string().trim().max(200).optional().or(z.literal("")),
  rcNumber: z.string().trim().max(40).optional().or(z.literal("")),
  stateCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine((c) => c === "" || c in NG_STATES, "Choose a state")
    .optional()
    .or(z.literal("")),
  primaryColour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .or(z.literal("")),
});

export type CreateFirmState = { error?: string; fieldErrors?: Record<string, string> };

export async function createFirm(
  _prev: CreateFirmState,
  formData: FormData,
): Promise<CreateFirmState> {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    legalName: formData.get("legalName") ?? "",
    rcNumber: formData.get("rcNumber") ?? "",
    stateCode: formData.get("stateCode") ?? "",
    primaryColour: formData.get("primaryColour") ?? "",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "Please check the highlighted fields.", fieldErrors };
  }

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Docket is not configured on this host yet." };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in or create your account first." };

  const brand = parsed.data.primaryColour
    ? { colours: { primary: parsed.data.primaryColour } }
    : {};

  const { data, error } = await supabase.rpc("create_firm", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_legal_name: parsed.data.legalName || null,
    p_rc_number: parsed.data.rcNumber || null,
    p_state_code: parsed.data.stateCode || null,
    p_brand: brand,
  });
  if (error) {
    // Postgres messages from create_firm are written for people ("slug x is already taken").
    return { error: error.message };
  }
  const result = data as CreateFirmResult | null;
  if (!result?.firm_id) return { error: "The firm was not created. Please try again." };

  // Owner writes need an MFA-verified session: enrol before the console.
  redirect("/firm/security/mfa");
}
