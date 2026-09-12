"use server";

// Workflow packs (migration 39): a firm installs a version, corrects its own stage wording, and
// the platform publishes a new version. The database decides who may: install_workflow_pack()
// and the matter_statuses write policies ask admin_w(); publish_workflow_pack() asks for a
// platform admin with a second factor. No service key; refusals are the database's own words.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { MATTER_TYPES } from "@/lib/db/types";

type Err = { error: string } | undefined;
const uuid = z.string().uuid();
const packKey = z.string().regex(/^[a-z0-9_]{2,40}$/, "A pack key is lower-case letters, digits and underscores.");

export async function installWorkflowPack(firmId: string, key: string, version?: number | null): Promise<{ error: string } | { version: number; added: number; recognised: number; ofAnotherPack: number }> {
  if (!uuid.safeParse(firmId).success || !packKey.safeParse(key).success) return { error: "Unknown pack." };
  if (version !== null && version !== undefined && (!Number.isInteger(version) || version < 1)) return { error: "Unknown version." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data, error } = await supabase.rpc("install_workflow_pack", { p_firm: firmId, p_key: key, p_version: version ?? null });
  if (error) return { error: error.message };
  // All three counts, because the three of them add up to the pack's stage list and two of them
  // do not. install_workflow_pack() separates a stage this pack already owns from one the firm
  // holds under a DIFFERENT pack — which it leaves exactly as it reads — and dropping the second
  // number here left the administrator looking at "9 stages" and a notice accounting for 7.
  const r = (data ?? {}) as { version?: number; statuses_added?: number; statuses_recognised?: number; statuses_of_another_pack?: number };
  revalidatePath("/firm/admin/workflow");
  revalidatePath("/firm/matters");
  return {
    version: Number(r.version ?? 0), added: Number(r.statuses_added ?? 0),
    recognised: Number(r.statuses_recognised ?? 0), ofAnotherPack: Number(r.statuses_of_another_pack ?? 0),
  };
}

/** The firm's own wording, colour and order on a stage. Never the key: matters and packs point at it. */
export async function updateMatterStatusRow(input: { statusId: string; label: string; colour: string; sort: number; defaultNextAction: string }): Promise<Err> {
  const parsed = z.object({
    statusId: uuid, label: z.string().trim().min(2, "Give the stage a label.").max(80), colour: z.string().trim().max(20),
    sort: z.number().int().min(0).max(10000), defaultNextAction: z.string().trim().max(500),
  }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error, count } = await supabase
    .from("matter_statuses")
    .update({ label: d.label, colour: d.colour || null, sort: d.sort, default_next_action: d.defaultNextAction || null }, { count: "exact" })
    .eq("id", d.statusId);
  if (error) return { error: error.message };
  if (count === 0) return { error: "Nothing was changed: only an owner or administrator with a second factor edits the firm's stages." };
  revalidatePath("/firm/admin/workflow");
  revalidatePath("/firm/matters");
  return undefined;
}

/** The platform publishes a new version of a pack from its JSON definition. */
export async function publishWorkflowPack(input: { key: string; name: string; matterTypes: string[]; definition: string; note: string }): Promise<{ error: string } | { version: number }> {
  const parsed = z.object({
    key: packKey, name: z.string().trim().min(2).max(120), matterTypes: z.array(z.enum(MATTER_TYPES)).max(20),
    definition: z.string().min(2), note: z.string().trim().max(1000),
  }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  let def: unknown;
  try { def = JSON.parse(d.definition); } catch (e) { return { error: `The definition is not JSON: ${String((e as Error).message)}` }; }
  if (!def || typeof def !== "object" || Array.isArray(def)) return { error: "The definition is a JSON object with \"statuses\" and, optionally, \"task_templates\"." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data, error } = await supabase.rpc("publish_workflow_pack", {
    p_key: d.key, p_name: d.name, p_matter_types: d.matterTypes.length ? d.matterTypes : null, p_definition: def, p_note: d.note || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/workflow");
  revalidatePath("/firm/admin/workflow");
  return { version: Number(data) };
}
