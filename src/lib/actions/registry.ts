"use server";

// The court-registry pilot (migration 49): every write, on all three sides.
//
// Every rule is the database's. create_registry() and set_registry_status() ask is_platform_admin()
// and mfa_ok(); add/remove_registry_member() ask that or registrar_w(); stage_registry_notices()
// asks registry_w(); publish_*, withdraw_* ask registrar_w(); confirm/reject_registry_notice() ask
// matter_row_w() — the firm's staff write with the matter wall. This file carries a form to each
// of them and returns the refusal word for word, because the words carry the reason.
//
// A listed day is a CALENDAR DAY and travels as a plain YYYY-MM-DD string. A listed time is the
// court's own wall-clock HH:MM. Neither is ever turned into a Date here.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import type { StageNoticesResult } from "@/lib/db/types";

type Err = { error: string } | undefined;
const uuid = z.string().uuid();
const NOT_CONFIGURED = "Supabase is not configured on this deployment, so nothing can be saved.";

// ---------------------------------------------------------------- the platform

export interface RegistryWriteState { error?: string; done?: string; fieldErrors?: Record<string, string> }

export async function createRegistry(_prev: RegistryWriteState, formData: FormData): Promise<RegistryWriteState> {
  const parsed = z.object({
    courtId: z.string().uuid("Choose a court."),
    name: z.string().trim().min(2, "Name the registry as it names itself.").max(200),
    contactName: z.string().trim().max(200).optional(),
    contactEmail: z.string().trim().max(320).optional(),
    note: z.string().trim().max(2000).optional(),
  }).safeParse({
    courtId: formData.get("courtId"), name: formData.get("name"), contactName: formData.get("contactName") || undefined,
    contactEmail: formData.get("contactEmail") || undefined, note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) { const k = String(i.path[0] ?? "form"); if (!fieldErrors[k]) fieldErrors[k] = i.message; }
    return { error: "Please check the highlighted fields.", fieldErrors };
  }
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("create_registry", {
    p_court: parsed.data.courtId, p_name: parsed.data.name, p_contact_name: parsed.data.contactName ?? null,
    p_contact_email: parsed.data.contactEmail ?? null, p_note: parsed.data.note ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/registries");
  return { done: `${parsed.data.name} exists. Add its registrar by the email they signed up with.` };
}

export async function setRegistryStatus(_prev: RegistryWriteState, formData: FormData): Promise<RegistryWriteState> {
  const id = String(formData.get("registryId") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!uuid.safeParse(id).success) return { error: "Unknown registry." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("set_registry_status", { p_registry: id, p_status: status, p_note: note || null });
  if (error) return { error: error.message };
  revalidatePath("/admin/registries");
  return { done: status === "suspended" ? "Suspended. Its members can read what they published and write nothing." : "Active." };
}

export async function addRegistryMember(_prev: RegistryWriteState, formData: FormData): Promise<RegistryWriteState> {
  const id = String(formData.get("registryId") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  if (!uuid.safeParse(id).success) return { error: "Unknown registry." };
  if (!z.string().email().safeParse(email).success) return { error: "That is not an email address." };
  if (role !== "registrar" && role !== "clerk") return { error: "A member is a registrar or a clerk." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("add_registry_member", { p_registry: id, p_email: email, p_role: role });
  if (error) return { error: error.message };
  revalidatePath("/admin/registries"); revalidatePath("/registry");
  return { done: `${email} is now a ${role}.` };
}

export async function removeRegistryMember(registryId: string, userId: string): Promise<Err> {
  if (!uuid.safeParse(registryId).success || !uuid.safeParse(userId).success) return { error: "Unknown member." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("remove_registry_member", { p_registry: registryId, p_user: userId });
  if (error) return { error: error.message };
  revalidatePath("/admin/registries"); revalidatePath("/registry");
  return undefined;
}

// ---------------------------------------------------------------- the registry

export interface NoticeRowInput {
  suit_number: string;
  cause_title?: string | null;
  listed_on: string;
  listed_time?: string | null;
  judge?: string | null;
  courtroom?: string | null;
  purpose_kind?: string | null;
  purpose?: string | null;
}

/** Stage a cause list. Rows are checked by the database one at a time; the bad ones come back with reasons. */
export async function stageRegistryNotices(
  registryId: string, rows: NoticeRowInput[], sourceNote: string | null,
): Promise<{ error: string } | StageNoticesResult> {
  if (!uuid.safeParse(registryId).success) return { error: "Unknown registry." };
  // The same lengths the columns hold. Longer is REFUSED here and refused again by the database,
  // per row, with the length in the message — never trimmed to fit, because a trimmed cause title
  // is altered court data reported as staged.
  const parsed = z.array(z.object({
    suit_number: z.string().max(60, "A suit number is at most 60 characters."),
    cause_title: z.string().max(300, "A cause title is at most 300 characters.").nullish(),
    listed_on: z.string().max(40),
    listed_time: z.string().max(20).nullish(),
    judge: z.string().max(200, "A judge is at most 200 characters.").nullish(),
    courtroom: z.string().max(100, "A courtroom is at most 100 characters.").nullish(),
    purpose_kind: z.string().max(300).nullish(),
    purpose: z.string().max(300, "A purpose is at most 300 characters.").nullish(),
  })).min(1, "Nothing to stage.").max(500, "At most 500 rows in one batch.").safeParse(rows);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the rows." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { data, error } = await supabase.rpc("stage_registry_notices", {
    p_registry: registryId, p_rows: parsed.data, p_source_note: sourceNote?.trim() ? sourceNote.trim().slice(0, 300) : null,
  });
  if (error) return { error: error.message };
  revalidatePath("/registry");
  const r = (data ?? {}) as Partial<StageNoticesResult>;
  return { batch_id: String(r.batch_id ?? ""), staged: Number(r.staged ?? 0), rejected: Array.isArray(r.rejected) ? r.rejected : [] };
}

export async function publishRegistryBatch(batchId: string): Promise<{ error: string } | { published: number }> {
  if (!uuid.safeParse(batchId).success) return { error: "Unknown batch." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { data, error } = await supabase.rpc("publish_registry_batch", { p_batch: batchId });
  if (error) return { error: error.message };
  revalidatePath("/registry");
  return { published: Number(data ?? 0) };
}

export async function publishRegistryNotice(noticeId: string): Promise<Err> {
  if (!uuid.safeParse(noticeId).success) return { error: "Unknown notice." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("publish_registry_notice", { p_notice: noticeId });
  if (error) return { error: error.message };
  revalidatePath("/registry");
  return undefined;
}

export async function discardRegistryDraft(noticeId: string): Promise<Err> {
  if (!uuid.safeParse(noticeId).success) return { error: "Unknown notice." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("discard_registry_draft", { p_notice: noticeId });
  if (error) return { error: error.message };
  revalidatePath("/registry");
  return undefined;
}

export async function withdrawRegistryNotice(noticeId: string, reason: string): Promise<Err> {
  if (!uuid.safeParse(noticeId).success) return { error: "Unknown notice." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("withdraw_registry_notice", { p_notice: noticeId, p_reason: reason.trim().slice(0, 500) });
  if (error) return { error: error.message };
  revalidatePath("/registry");
  return undefined;
}

// ---------------------------------------------------------------- the firm

export async function confirmRegistryNotice(
  noticeId: string, matterId: string, time: string | null, vacateExisting: boolean, vacateReason: string | null,
): Promise<{ error: string } | { courtEventId: string }> {
  if (!uuid.safeParse(noticeId).success || !uuid.safeParse(matterId).success) return { error: "Unknown notice." };
  const t = time?.trim() ? time.trim() : null;
  if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return { error: "That time could not be read." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { data, error } = await supabase.rpc("confirm_registry_notice", {
    p_notice: noticeId, p_matter: matterId, p_time: t, p_vacate_existing: Boolean(vacateExisting),
    p_vacate_reason: vacateReason?.trim() ? vacateReason.trim().slice(0, 500) : null,
  });
  if (error) return { error: error.message };
  revalidatePath("/firm/sittings"); revalidatePath(`/firm/matters/${matterId}`);
  return { courtEventId: String(data ?? "") };
}

export async function rejectRegistryNotice(noticeId: string, matterId: string, reason: string): Promise<Err> {
  if (!uuid.safeParse(noticeId).success || !uuid.safeParse(matterId).success) return { error: "Unknown notice." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("reject_registry_notice", { p_notice: noticeId, p_matter: matterId, p_reason: reason.trim().slice(0, 500) });
  if (error) return { error: error.message };
  revalidatePath("/firm/sittings");
  return undefined;
}
