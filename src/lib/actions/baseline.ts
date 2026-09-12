"use server";

// The pilot baseline (migration 41): what the firm's own rows say over a window, and the dated
// record of it.
//
// Rules enforced here: firm_metrics() asks is_firm_member() and record_firm_baseline() asks
// admin_w(), so the database decides who may compute and who may record — this file only carries
// the window. Nothing is computed in TypeScript: a figure the screen shows is a figure the
// database returned, and the caveats travel with it rather than being written into the markup.
// What the firm states about the work before Docket is passed through as the claim it is.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import type { FirmMetrics } from "@/lib/db/types";

type Err = { error: string } | undefined;
const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/));

export async function computeFirmMetrics(firmId: string, from: string, to: string): Promise<{ error: string } | { metrics: FirmMetrics }> {
  const parsed = z.object({ firmId: uuid, from: instant, to: instant }).safeParse({ firmId, from, to });
  if (!parsed.success) return { error: "Give a window with a start and an end." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data, error } = await supabase.rpc("firm_metrics", { p_firm: firmId, p_from: from, p_to: to });
  if (error) return { error: error.message };
  return { metrics: data as FirmMetrics };
}

export interface BaselineInput {
  firmId: string;
  from: string;
  to: string;
  note: string;
  /** What the firm says about the work before Docket. Claims, never measurements. */
  stated: Record<string, string>;
}

export async function recordBaseline(input: BaselineInput): Promise<Err> {
  const parsed = z.object({
    firmId: uuid, from: instant, to: instant,
    note: z.string().trim().max(2000),
    stated: z.record(z.string().regex(/^[a-z0-9_]{1,60}$/), z.string().trim().max(500)),
  }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the window and try again." };
  const d = parsed.data;
  // An empty answer is not a claim: it is left out rather than recorded as one nobody made.
  const stated: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.stated as Record<string, string>)) if (v.length > 0) stated[k] = v;
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("record_firm_baseline", {
    p_firm: d.firmId, p_from: d.from, p_to: d.to, p_note: d.note || null, p_stated: stated,
  });
  if (error) return { error: error.message };
  revalidatePath("/firm/admin/baseline");
  return undefined;
}
