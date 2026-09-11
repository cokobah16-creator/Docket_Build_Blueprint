"use server";

// Matter server actions: open a matter, edit its face, set who is on it, invite
// the client onto it, and the two task writes the console needs. Shared by the
// matters list, the open-a-matter screen and the matter detail screen.
//
// Rules enforced here: the database is the authorization layer — open_matter(),
// invite_matter_party(), revoke_matter_invite() and every direct table write below
// run as the signed-in staff member, so staff_w() (firm member + MFA + firm not
// suspended) decides, never this file, and no service key is ever used. Database
// messages are returned verbatim so a lawyer reads the real reason ("a member of
// the firm cannot be its client on a matter") instead of a shrug. Nothing here is
// firm-specific: the firm always arrives from the caller's context.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { isE164, normalizeNigerianPhone } from "@/lib/nigeria";
import { MATTER_TYPES } from "@/lib/db/types";
import { FUNNEL, capture } from "@/lib/observability";
import { after } from "next/server";

type Err = { error: string } | undefined;

const TYPES = new Set<string>(MATTER_TYPES);

/** A timestamp the database stores in UTC; forms send an instant from the viewer's zone. */
const instant = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "That date and time could not be read." })
  .transform((v) => new Date(v).toISOString());

/** matters.closed_at is a date: accept a plain day or an instant and keep the day. */
const plainDay = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "That closing date could not be read." })
  .transform((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date(v).toISOString().slice(0, 10)));

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}

function refreshMatter(matterId?: string | null) {
  revalidatePath("/firm");
  revalidatePath("/firm/matters");
  if (matterId) revalidatePath(`/firm/matters/${matterId}`);
}

// ---------------------------------------------------------------- open a matter
const openSchema = z.object({
  firmId: z.string().uuid(),
  title: z.string().trim().min(2, "Give the matter a working title.").max(200),
  type: z.string().refine((v) => TYPES.has(v), { message: "Choose the type of matter." }),
  clientId: z.string().uuid().nullish(),
  causeTitle: z.string().trim().max(300).nullish(),
  description: z.string().trim().max(8000).nullish(),
  courtId: z.string().uuid().nullish(),
  suitNumber: z.string().trim().max(120).nullish(),
  judicialDivision: z.string().trim().max(120).nullish(),
  originatingLawyerId: z.string().uuid().nullish(),
  handlingLawyerId: z.string().uuid().nullish(),
  statusKey: z.string().trim().max(64).nullish(),
  noteToClient: z.string().trim().max(4000).nullish(),
  /** A decided conflict check run before the matter existed; open_matter() attaches it. */
  conflictCheckId: z.string().uuid().nullish(),
  /** The other side as known at the outset — the register a later check searches. */
  adverseParties: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(200),
        kind: z.enum(["person", "organisation"]).default("person"),
        aliases: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
      }),
    )
    .max(20)
    .nullish(),
});

export type OpenMatterInput = z.input<typeof openSchema>;
export type OpenMatterResult = { error: string } | { matterId: string; reference: string };

/**
 * open_matter() mints the reference (next_reference() is service-only), files the
 * lead lawyer, records the suit number as a court number and — when a client is
 * attached — posts the client-visible "Matter opened" entry. It refuses a handling
 * lawyer who is not a member of the firm, and a client who is.
 */
export async function openMatter(input: OpenMatterInput): Promise<OpenMatterResult> {
  const parsed = openSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data, error } = await supabase.rpc("open_matter", {
    p_firm: d.firmId,
    p_title: d.title,
    p_type: d.type,
    p_client: d.clientId || null,
    p_cause_title: d.causeTitle || null,
    p_description: d.description || null,
    p_court_id: d.courtId || null,
    p_suit_number: d.suitNumber || null,
    p_judicial_division: d.judicialDivision || null,
    p_originating_lawyer: d.originatingLawyerId || null,
    p_handling_lawyer: d.handlingLawyerId || null,
    p_status_key: d.statusKey || null,
    p_note_to_client: d.noteToClient || null,
    p_conflict_check: d.conflictCheckId || null,
    p_adverse_parties: d.adverseParties && d.adverseParties.length > 0 ? d.adverseParties : null,
  });
  if (error) return { error: error.message };

  const result = (data ?? null) as { matter_id?: string; reference?: string } | null;
  if (!result?.matter_id || !result.reference) return { error: "The matter could not be opened. Try again." };

  // The last step of the funnel: a visitor who found the firm's site has become a matter.
  //
  // The distinct id is the CLIENT, not the staff member who typed this in. The funnel follows
  // one person from site_viewed to here, and the browser doing the typing belongs to the lawyer
  // — using their visitor cookie would file the client's journey under the wrong person. A
  // matter opened with no client attached is a real matter but not the end of anyone's journey,
  // so it is left uncounted rather than attributed to somebody made up. The properties are facts
  // about the matter; nothing about the person travels with it. Fired and ignored: telemetry
  // never gets to fail a matter that the database has already opened.
  // Bound to a const first: inside the after() closure TypeScript can no longer prove that
  // d.clientId is still the string the `if` tested, because a property is not a narrowing that
  // survives into a callback.
  const clientId = d.clientId;
  if (clientId) {
    after(() =>
      capture(FUNNEL.matterOpened, clientId, {
        firm_id: d.firmId,
        matter_type: d.type,
      }).catch(() => undefined),
    );
  }

  refreshMatter(result.matter_id);
  return { matterId: result.matter_id, reference: result.reference };
}

// ---------------------------------------------------------------- edit a matter
const patchSchema = z.object({
  title: z.string().trim().min(2, "Give the matter a working title.").max(200).optional(),
  causeTitle: z.string().trim().max(300).nullish(),
  description: z.string().trim().max(8000).nullish(),
  nextAction: z.string().trim().max(500).nullish(),
  nextActionOwnerId: z.string().uuid().nullish(),
  // A calendar day, never an instant: matters.next_action_due is a DATE.
  nextActionDue: plainDay.nullish(),
  statusId: z.string().uuid().nullish(),
  courtId: z.string().uuid().nullish(),
  courtName: z.string().trim().max(200).nullish(),
  suitNumber: z.string().trim().max(120).nullish(),
  judicialDivision: z.string().trim().max(120).nullish(),
  handlingLawyerId: z.string().uuid().nullish(),
  originatingLawyerId: z.string().uuid().nullish(),
  closedAt: plainDay.nullable().optional(),
  // Changed through setMatterAccess(), never here: restricting needs the caller on the team first.
});

export type MatterPatch = z.input<typeof patchSchema>;

/**
 * Restrict a matter to its team, or open it to the firm again. The database holds the rules
 * (migration 29): the firm's walls must be on, and whoever restricts must be on the team — a wall
 * you are outside of would lock you out. So 'team' first makes sure the caller is on the team,
 * then sets access; 'firm' just sets it. Owners and admins outside the team cannot do either,
 * which is what a wall means.
 */
export async function setMatterAccess(matterId: string, firmId: string, access: "firm" | "team"): Promise<Err> {
  if (!z.string().uuid().safeParse(matterId).success || !z.string().uuid().safeParse(firmId).success) return { error: "Unknown matter." };
  if (access !== "firm" && access !== "team") return { error: "Choose firm-wide or team only." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };

  if (access === "team") {
    const { data: team } = await supabase.from("matter_lawyers").select("user_id, is_lead").eq("matter_id", matterId);
    const rows = (team ?? []) as Array<{ user_id: string; is_lead: boolean }>;
    if (!rows.some((r) => r.user_id === user.id)) {
      const { error: teamError } = await supabase
        .from("matter_lawyers")
        .insert({ matter_id: matterId, firm_id: firmId, user_id: user.id, is_lead: !rows.some((r) => r.is_lead) });
      if (teamError) return { error: teamError.message };
    }
  }

  const { error, count } = await supabase.from("matters").update({ access }, { count: "exact" }).eq("id", matterId);
  if (error) return { error: error.message };
  if (count === 0) return { error: "Nothing changed: you may not be on this matter's team, or the firm's walls are off." };
  refreshMatter(matterId);
  return undefined;
}

/**
 * Direct update under the matters policy (staff_w). Only the keys the caller
 * actually passed are written, so a form that edits the court never blanks the
 * next action. A key passed as null clears that column.
 */
export async function updateMatter(matterId: string, patch: MatterPatch): Promise<Err> {
  if (!z.string().uuid().safeParse(matterId).success) return { error: "Unknown matter." };
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  const given = (key: keyof MatterPatch) => Object.prototype.hasOwnProperty.call(patch, key);

  const row: Record<string, string | null> = {};
  if (given("title") && d.title !== undefined) row.title = d.title;
  if (given("causeTitle")) row.cause_title = d.causeTitle || null;
  if (given("description")) row.description = d.description || null;
  if (given("nextAction")) row.next_action = d.nextAction || null;
  if (given("nextActionOwnerId")) row.next_action_owner_id = d.nextActionOwnerId || null;
  if (given("nextActionDue")) row.next_action_due = d.nextActionDue || null;
  if (given("statusId")) row.status_id = d.statusId || null;
  if (given("courtId")) row.court_id = d.courtId || null;
  if (given("courtName")) row.court_name = d.courtName || null;
  if (given("suitNumber")) row.suit_number = d.suitNumber || null;
  if (given("judicialDivision")) row.judicial_division = d.judicialDivision || null;
  if (given("handlingLawyerId")) row.handling_lawyer_id = d.handlingLawyerId || null;
  if (given("originatingLawyerId")) row.originating_lawyer_id = d.originatingLawyerId || null;
  if (given("closedAt")) row.closed_at = d.closedAt ?? null;

  if (Object.keys(row).length === 0) return { error: "Nothing to change." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.from("matters").update(row).eq("id", matterId);
  if (error) return { error: error.message };

  refreshMatter(matterId);
  revalidatePath("/app/matters");
  return undefined;
}

// ---------------------------------------------------------------- who is on the matter
/**
 * One lead and any number of colleagues also on the file. Written before the
 * removals, so the matter is never left without a lead if a write is refused.
 */
export async function setMatterLawyers(
  matterId: string,
  firmId: string,
  leadLawyerId: string,
  alsoOn: string[],
): Promise<Err> {
  const parsed = z
    .object({
      matterId: z.string().uuid(),
      firmId: z.string().uuid(),
      leadLawyerId: z.string().uuid({ message: "Choose the lawyer with conduct of the matter." }),
      alsoOn: z.array(z.string().uuid()).max(50),
    })
    .safeParse({ matterId, firmId, leadLawyerId, alsoOn });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;

  const others = Array.from(new Set(d.alsoOn)).filter((id) => id !== d.leadLawyerId);
  const keep = [d.leadLawyerId, ...others];
  const rows = keep.map((userId) => ({
    matter_id: d.matterId,
    firm_id: d.firmId,
    user_id: userId,
    is_lead: userId === d.leadLawyerId,
  }));

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { error: upsertError } = await supabase
    .from("matter_lawyers")
    .upsert(rows, { onConflict: "matter_id,user_id" });
  if (upsertError) return { error: upsertError.message };

  const { error: deleteError } = await supabase
    .from("matter_lawyers")
    .delete()
    .eq("matter_id", d.matterId)
    .not("user_id", "in", `(${keep.join(",")})`);
  if (deleteError) return { error: deleteError.message };

  refreshMatter(d.matterId);
  return undefined;
}

// ---------------------------------------------------------------- documents the client is asked for
const requestSchema = z.object({
  title: z.string().trim().min(2, "Say what document you need.").max(200),
  why: z.string().trim().max(2000).optional(),
  // A calendar day, never an instant: document_requests.due_on is a DATE.
  dueOn: plainDay.nullable().optional(),
});

/** Ask the client on a matter for a named document. Under document_requests_insert (the wall applies). */
export async function requestDocument(matterId: string, firmId: string, input: z.input<typeof requestSchema>): Promise<Err> {
  if (!z.string().uuid().safeParse(matterId).success || !z.string().uuid().safeParse(firmId).success) return { error: "Unknown matter." };
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };
  const { error } = await supabase.from("document_requests").insert({
    firm_id: firmId, matter_id: matterId, title: parsed.data.title, why: parsed.data.why || null,
    due_on: parsed.data.dueOn ?? null, requested_by: user.id,
  });
  if (error) return { error: error.message };
  refreshMatter(matterId);
  return undefined;
}

/** Withdraw a request. Never deleted: what was asked for is part of the file's history. */
export async function cancelDocumentRequest(requestId: string, matterId: string): Promise<Err> {
  if (!z.string().uuid().safeParse(requestId).success) return { error: "Unknown request." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error, count } = await supabase
    .from("document_requests")
    .update({ cancelled_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", requestId)
    .is("fulfilled_at", null)
    .is("cancelled_at", null);
  if (error) return { error: error.message };
  if (count === 0) return { error: "That request was already answered or withdrawn." };
  refreshMatter(matterId);
  return undefined;
}

// ---------------------------------------------------------------- the client on the matter
const inviteSchema = z.object({
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(200).optional(),
  role: z.enum(["client", "contact"]),
});

export type InviteMatterPartyInput = z.input<typeof inviteSchema>;
export type InviteMatterPartyResult =
  | { error: string }
  | { token: string; matterReference: string; matterTitle: string; expiresAt: string };

/**
 * invite_matter_party() returns the token so the console can hand the client a
 * link over WhatsApp or SMS. The token is never guessable from the client side —
 * only this call produces it, and only for a matter the caller's firm owns.
 */
export async function inviteMatterParty(
  matterId: string,
  input: InviteMatterPartyInput,
): Promise<InviteMatterPartyResult> {
  if (!z.string().uuid().safeParse(matterId).success) return { error: "Unknown matter." };
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;

  const rawPhone = (d.phone ?? "").trim();
  let phone: string | null = null;
  if (rawPhone) {
    phone = normalizeNigerianPhone(rawPhone) ?? (isE164(rawPhone) ? rawPhone : null);
    if (!phone) return { error: "That phone number does not look right. Use 0803… or +234…" };
  }

  const rawEmail = (d.email ?? "").trim().toLowerCase();
  if (rawEmail && !z.string().email().safeParse(rawEmail).success) {
    return { error: "That email address does not look right." };
  }
  const email = rawEmail || null;
  if (!phone && !email) return { error: "Give a phone number or an email address to send the invitation to." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data, error } = await supabase.rpc("invite_matter_party", {
    p_matter: matterId,
    p_phone: phone,
    p_email: email,
    p_role: d.role,
  });
  if (error) return { error: error.message };

  const result = (data ?? null) as
    | { token?: string; matter_reference?: string; matter_title?: string; expires_at?: string }
    | null;
  if (!result?.token) return { error: "The invitation could not be created. Try again." };

  refreshMatter(matterId);
  return {
    token: result.token,
    matterReference: result.matter_reference ?? "",
    matterTitle: result.matter_title ?? "",
    expiresAt: result.expires_at ?? "",
  };
}

/**
 * Expires an invitation that has not been accepted; an accepted one is refused.
 *
 * The matter is taken as an argument because the matter page is the only screen
 * that lists outstanding invitations, and it is the one page refreshMatter cannot
 * find on its own. Without it a revoked invitation stays in the cache and reads
 * as still live to anyone who did not refresh the browser themselves.
 */
export async function revokeMatterInvite(inviteId: string, matterId?: string | null): Promise<Err> {
  if (!z.string().uuid().safeParse(inviteId).success) return { error: "Unknown invitation." };
  if (matterId != null && !z.string().uuid().safeParse(matterId).success) return { error: "Unknown matter." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("revoke_matter_invite", { p_invite: inviteId });
  if (error) return { error: error.message };
  refreshMatter(matterId ?? null);
  return undefined;
}

/** Takes a client or contact off a matter: they lose the file in their app at once. */
export async function removeMatterParty(matterId: string, userId: string): Promise<Err> {
  const parsed = z
    .object({ matterId: z.string().uuid(), userId: z.string().uuid() })
    .safeParse({ matterId, userId });
  if (!parsed.success) return { error: "Unknown person on this matter." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase
    .from("matter_parties")
    .delete()
    .eq("matter_id", parsed.data.matterId)
    .eq("user_id", parsed.data.userId);
  if (error) return { error: error.message };

  refreshMatter(parsed.data.matterId);
  revalidatePath("/app/matters");
  return undefined;
}

// ---------------------------------------------------------------- tasks
const taskSchema = z.object({
  firmId: z.string().uuid(),
  matterId: z.string().uuid().nullish(),
  title: z.string().trim().min(2, "Say what has to be done.").max(200),
  dueAt: instant.nullish(),
  assigneeId: z.string().uuid().nullish(),
});

export type CreateTaskInput = z.input<typeof taskSchema>;

/** A task belongs to the firm; the row trigger refuses one filed on another firm's matter. */
export async function createTask(input: CreateTaskInput): Promise<Err> {
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.from("tasks").insert({
    firm_id: d.firmId,
    matter_id: d.matterId || null,
    assignee_id: d.assigneeId || null,
    title: d.title,
    due_at: d.dueAt || null,
    status: "open",
  });
  if (error) return { error: error.message };

  refreshMatter(d.matterId);
  return undefined;
}

/** Closing a task clears it from the firm's overdue counter (firm_overview counts status = 'open'). */
export async function closeTask(taskId: string): Promise<Err> {
  if (!z.string().uuid().safeParse(taskId).success) return { error: "Unknown task." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  // Read the matter first so the matter page can be revalidated by name. A read
  // that fails is not fatal — the task still closes — but it must not be mistaken
  // for a task with no matter, so say so on the way out.
  const { data: row, error: readError } = await supabase
    .from("tasks")
    .select("id, matter_id")
    .eq("id", taskId)
    .maybeSingle();
  const { error } = await supabase.from("tasks").update({ status: "done" }).eq("id", taskId);
  if (error) return { error: error.message };

  const matterId = (row as { matter_id: string | null } | null)?.matter_id ?? null;
  refreshMatter(matterId);
  if (readError && !matterId) {
    return { error: "The task is closed, but this page could not be refreshed. Reload to see it." };
  }
  return undefined;
}

// ---------------------------------------------------------------- the other side, and conflicts (migration 32)
const adverseSchema = z.object({
  name: z.string().trim().min(2, "Give the name as it appears on the process.").max(200),
  kind: z.enum(["person", "organisation"]).default("person"),
  relation: z.enum(["adverse", "co_party", "witness", "related"]).default("adverse"),
  aliases: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  note: z.string().trim().max(2000).nullish(),
});
export type AdversePartyInput = z.input<typeof adverseSchema>;

/** Record someone on the other side. Under matter_adverse_parties_insert (the wall applies); never visible to a client. */
export async function addAdverseParty(matterId: string, firmId: string, input: AdversePartyInput): Promise<Err> {
  if (!z.string().uuid().safeParse(matterId).success || !z.string().uuid().safeParse(firmId).success) return { error: "Unknown matter." };
  const parsed = adverseSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("matter_adverse_parties").insert({
    matter_id: matterId,
    firm_id: firmId,
    name: d.name,
    kind: d.kind,
    relation: d.relation,
    aliases: d.aliases,
    note: d.note || null,
    created_by: auth.user?.id ?? null,
  });
  if (error) return { error: error.message };
  refreshMatter(matterId);
  return undefined;
}

export async function removeAdverseParty(partyId: string, matterId: string): Promise<Err> {
  if (!z.string().uuid().safeParse(partyId).success) return { error: "Unknown entry." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error, count } = await supabase.from("matter_adverse_parties").delete({ count: "exact" }).eq("id", partyId);
  if (error) return { error: error.message };
  if (count === 0) return { error: "That entry could not be removed — it may already be gone, or this matter is not yours to change." };
  refreshMatter(matterId);
  return undefined;
}

export type ConflictCheckResult =
  | { error: string }
  | { checkId: string; keys: string[]; matches: import("@/lib/db/types").ConflictMatch[]; matchCount: number };

/**
 * Search the firm's own register — its clients, the adverse parties it has recorded, the
 * free-text opposing parties and cause titles — for the names given and, when a matter is
 * named, everyone that matter names. run_conflict_check() records the search as a
 * conflict_checks row; the decision is a separate step. Never another firm's register.
 */
export async function runConflictCheck(firmId: string, input: { matterId?: string | null; names?: string[] }): Promise<ConflictCheckResult> {
  if (!z.string().uuid().safeParse(firmId).success) return { error: "Unknown firm." };
  const matterId = input.matterId && z.string().uuid().safeParse(input.matterId).success ? input.matterId : null;
  const names = (input.names ?? []).map((n) => n.trim()).filter((n) => n.length > 0).slice(0, 20);
  if (!matterId && names.length === 0) return { error: "Give at least one name to check." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data, error } = await supabase.rpc("run_conflict_check", { p_firm: firmId, p_matter: matterId, p_names: names.length > 0 ? names : null });
  if (error) return { error: error.message };
  const r = (data ?? null) as { check_id?: string; keys?: string[]; matches?: import("@/lib/db/types").ConflictMatch[]; match_count?: number } | null;
  if (!r?.check_id) return { error: "The check could not be run. Try again." };
  if (matterId) refreshMatter(matterId);
  return { checkId: r.check_id, keys: r.keys ?? [], matches: r.matches ?? [], matchCount: Number(r.match_count ?? 0) };
}

/** The lawyer's decision on a check: clear, conflict, or waived with the reason. Once. */
export async function decideConflictCheck(
  checkId: string,
  outcome: "clear" | "conflict" | "waived",
  note: string | null | undefined,
  matterId?: string | null,
): Promise<Err> {
  if (!z.string().uuid().safeParse(checkId).success) return { error: "Unknown check." };
  if (!["clear", "conflict", "waived"].includes(outcome)) return { error: "The outcome is clear, conflict or waived." };
  const trimmed = (note ?? "").trim();
  if (outcome === "waived" && trimmed.length < 2) return { error: "A waiver records why: give the note." };
  if (trimmed.length > 2000) return { error: "Keep the note to 2,000 characters." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("decide_conflict_check", { p_check: checkId, p_outcome: outcome, p_note: trimmed || null });
  if (error) return { error: error.message };
  refreshMatter(matterId ?? null);
  return undefined;
}
