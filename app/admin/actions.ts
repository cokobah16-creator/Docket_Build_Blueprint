"use server";

// Platform-admin actions. Authorization is the database's: create_firm()
// accepts p_owner_email only from a platform admin, and the firms/firm_members
// policies open to platform admins are read-only lifecycle views.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import type { CreateFirmResult } from "@/lib/db/types";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "Use lowercase letters, numbers and hyphens"),
  ownerEmail: z.string().trim().email(),
});

export type AdminCreateFirmState = { error?: string; created?: { slug: string; firm_id: string } };

export async function createFirmForOwner(
  _prev: AdminCreateFirmState,
  formData: FormData,
): Promise<AdminCreateFirmState> {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    ownerEmail: formData.get("ownerEmail"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data, error } = await supabase.rpc("create_firm", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_owner_email: parsed.data.ownerEmail,
  });
  if (error) return { error: error.message };
  const result = data as CreateFirmResult | null;
  if (!result?.firm_id) return { error: "The firm was not created." };

  revalidatePath("/admin");
  return { created: { slug: result.slug, firm_id: result.firm_id } };
}

const statusSchema = z.object({
  firmId: z.string().uuid(),
  status: z.enum(["pending", "active", "suspended"]),
});

export async function setFirmStatus(formData: FormData): Promise<void> {
  const parsed = statusSchema.safeParse({ firmId: formData.get("firmId"), status: formData.get("status") });
  if (!parsed.success) return;
  const supabase = await supabaseServer();
  if (!supabase) return;
  await supabase.from("firms").update({ status: parsed.data.status }).eq("id", parsed.data.firmId);
  revalidatePath("/admin");
}
