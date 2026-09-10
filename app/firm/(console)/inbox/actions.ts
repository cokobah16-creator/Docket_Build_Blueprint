"use server";

// Acknowledging service is the served firm's act: acknowledge_service() checks the caller
// is an owner, admin or lawyer of the served firm with an MFA session, and refuses
// withdrawn or already-acknowledged records.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

export type AcknowledgeState = { error?: string; done?: boolean };

const schema = z.object({ serviceId: z.string().uuid(), note: z.string().trim().max(500).optional().or(z.literal("")) });

export async function acknowledgeService(_prev: AcknowledgeState, formData: FormData): Promise<AcknowledgeState> {
  const parsed = schema.safeParse({ serviceId: formData.get("serviceId"), note: formData.get("note") ?? "" });
  if (!parsed.success) return { error: "Invalid request." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("acknowledge_service", {
    p_service: parsed.data.serviceId,
    p_note: parsed.data.note || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/firm/inbox");
  return { done: true };
}
