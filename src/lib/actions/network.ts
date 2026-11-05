"use server";

// Docket Network (migration 63): every write the network screens make.
//
// Every rule is the database's. invite_firm() asks staff_w() and the invite_firms permission and
// refuses an unverified firm; verify_network_invitation() checks the token, the expiry, the attempts
// and the code and grants nothing; respond_network_invitation() admits a member of the receiving
// firm who holds invite_firms, on an invitation that firm's member verified, and decides active or
// review from the invited domain; set_connection_status() ends every live collaboration between
// the two firms when a connection ends. Nothing is decided here and no service key is used; the
// refusals below are the database's own sentences.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import type { NetworkProfileInput } from "@/lib/network-copy";

type Err = { error: string } | undefined;
const uuid = z.string().uuid();
const NOT_CONFIGURED = "Supabase is not configured on this deployment, so nothing can be saved.";

function refresh(): void {
  revalidatePath("/firm/network");
  revalidatePath("/firm/network/discover");
  revalidatePath("/firm/network/alliances");
  revalidatePath("/firm/collaborations");
  revalidatePath("/firm");
}

// ---------------------------------------------------------------- the profile
const profileSchema = z.object({
  visibility: z.enum(["network", "connections", "private"]),
  official_email: z.string().trim().max(200).optional().or(z.literal("")),
  website: z.string().trim().max(200).optional().or(z.literal("")),
  telephone: z.string().trim().max(40).optional().or(z.literal("")),
  office_address: z.string().trim().max(400).optional().or(z.literal("")),
  registration_details: z.string().trim().max(400).optional().or(z.literal("")),
  country_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose a country."),
  region: z.string().trim().max(80).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  practice_areas: z.array(z.string().regex(/^[a-z0-9_]{2,40}$/)).max(30),
  jurisdictions: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)).max(30),
  languages: z.array(z.string().trim().min(2).max(40)).max(20),
  specialisms: z.array(z.string().trim().min(2).max(80)).max(30),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  accepts_referrals: z.boolean(),
  accepts_joint_matters: z.boolean(),
  accepts_introductions: z.boolean(),
  share_contacts: z.boolean(),
});

export async function saveNetworkProfile(firmId: string, input: NetworkProfileInput): Promise<Err> {
  if (!uuid.safeParse(firmId).success) return { error: "Unknown firm." };
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the profile and try again." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("upsert_network_profile", { p_firm: firmId, p_profile: parsed.data });
  if (error) return { error: error.message };
  revalidatePath("/firm/network/profile");
  refresh();
  return undefined;
}

// ---------------------------------------------------------------- invitations
export type InviteFirmResult = { error: string } | { invitationId: string; expiresAt: string; toEmail: string };

export async function inviteFirm(firmId: string, input: { email: string; reason: string; representative?: string }): Promise<InviteFirmResult> {
  const parsed = z
    .object({
      email: z.string().trim().toLowerCase().email("Give the firm's official email address."),
      reason: z.string().trim().min(10, "Say why you are asking to connect, in at least ten characters.").max(2000),
      representative: z.string().trim().max(120).optional().or(z.literal("")),
    })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the invitation and try again." };
  if (!uuid.safeParse(firmId).success) return { error: "Unknown firm." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { data, error } = await supabase.rpc("invite_firm", {
    p_firm: firmId, p_to_email: parsed.data.email, p_reason: parsed.data.reason, p_representative: parsed.data.representative || null,
  });
  if (error) return { error: error.message };
  const r = (data ?? null) as { invitation_id?: string; expires_at?: string; to_email?: string } | null;
  if (!r?.invitation_id) return { error: "The invitation was not created. Try again." };
  refresh();
  return { invitationId: r.invitation_id, expiresAt: r.expires_at ?? "", toEmail: r.to_email ?? parsed.data.email };
}

export async function resendInvitation(invitationId: string): Promise<Err> {
  if (!uuid.safeParse(invitationId).success) return { error: "Unknown invitation." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("resend_network_invitation", { p_id: invitationId });
  if (error) return { error: error.message };
  refresh();
  return undefined;
}

export async function revokeInvitation(invitationId: string, reason?: string): Promise<Err> {
  if (!uuid.safeParse(invitationId).success) return { error: "Unknown invitation." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("revoke_network_invitation", { p_id: invitationId, p_reason: reason?.trim() || null });
  if (error) return { error: error.message };
  refresh();
  return undefined;
}

export interface VerifiedInvitation {
  invitationId: string;
  fromFirmName: string;
  fromCountry: string | null;
  fromPracticeAreas: string[];
  fromRepresentative: string | null;
  reason: string;
  toEmail: string;
}

/** Enter the code from the email. Proves the email was received and nothing more. */
export async function verifyInvitation(token: string, code: string): Promise<{ error: string } | { verified: VerifiedInvitation }> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: "This invitation link is not valid." };
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(clean)) return { error: "The code is eight letters and digits, as in ABCD-EFGH." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { data, error } = await supabase.rpc("verify_network_invitation", { p_token: token, p_code: clean });
  if (error) return { error: error.message };
  const r = (data ?? {}) as Record<string, unknown>;
  // A wrong code is an answer the database committed, with the attempt counted (migration 63).
  if (r.status === "wrong_code") {
    const left = Number(r.attempts_left ?? 0);
    return { error: `That code is not right. ${left} ${left === 1 ? "attempt" : "attempts"} left before this invitation locks.` };
  }
  if (r.status === "locked") {
    return { error: "Too many wrong codes: this invitation is locked. Ask the inviting firm to send a new one." };
  }
  return {
    verified: {
      invitationId: String(r.invitation_id ?? ""),
      fromFirmName: String(r.from_firm_name ?? ""),
      fromCountry: (r.from_country as string | null) ?? null,
      fromPracticeAreas: Array.isArray(r.from_practice_areas) ? (r.from_practice_areas as string[]) : [],
      fromRepresentative: (r.from_representative as string | null) ?? null,
      reason: String(r.reason ?? ""),
      toEmail: String(r.to_email ?? ""),
    },
  };
}

/** The receiving firm's answer, by a member who holds invite_firms. */
export async function respondInvitation(invitationId: string, firmId: string, accept: boolean, reason?: string): Promise<{ error: string } | { status: string; connectionId: string | null }> {
  if (!uuid.safeParse(invitationId).success) return { error: "Unknown invitation." };
  if (!uuid.safeParse(firmId).success) return { error: "Choose which of your firms is answering." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { data, error } = await supabase.rpc("respond_network_invitation", {
    p_id: invitationId, p_firm: firmId, p_accept: accept, p_reason: reason?.trim() || null,
  });
  if (error) return { error: error.message };
  const r = (data ?? {}) as { status?: string; connection_id?: string };
  refresh();
  revalidatePath("/network/join");
  return { status: r.status ?? (accept ? "active" : "declined"), connectionId: r.connection_id ?? null };
}

// ---------------------------------------------------------------- connections
export async function setConnectionStatus(connectionId: string, firmId: string, status: "active" | "suspended" | "ended", reason?: string): Promise<Err> {
  if (!uuid.safeParse(connectionId).success || !uuid.safeParse(firmId).success) return { error: "Unknown connection." };
  if (!["active", "suspended", "ended"].includes(status)) return { error: "A connection is active, suspended or ended." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("set_connection_status", { p_id: connectionId, p_firm: firmId, p_status: status, p_reason: reason?.trim() || null });
  if (error) return { error: error.message };
  refresh();
  revalidatePath("/firm/matters");
  return undefined;
}

export async function setConnectionSettings(connectionId: string, firmId: string, settings: { share_contacts: boolean; allow_joint_matters: boolean; allow_referrals: boolean; allow_introductions: boolean }): Promise<Err> {
  if (!uuid.safeParse(connectionId).success || !uuid.safeParse(firmId).success) return { error: "Unknown connection." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("set_connection_settings", { p_id: connectionId, p_firm: firmId, p_settings: settings });
  if (error) return { error: error.message };
  refresh();
  return undefined;
}

/** The platform settles a connection in review. */
export async function reviewConnection(connectionId: string, approve: boolean, note?: string): Promise<Err> {
  if (!uuid.safeParse(connectionId).success) return { error: "Unknown connection." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("review_connection", { p_id: connectionId, p_approve: approve, p_note: note?.trim() || null });
  if (error) return { error: error.message };
  revalidatePath("/admin/network");
  return undefined;
}

// ---------------------------------------------------------------- approaches
export async function requestIntroduction(firmId: string, input: { toFirmId: string; kind: string; brief: string; country?: string; practiceArea?: string }): Promise<Err> {
  const parsed = z
    .object({
      toFirmId: uuid,
      kind: z.enum(["introduction", "referral_request"]),
      brief: z.string().trim().min(20, "Say what you are asking for, in at least twenty characters, with no client confidential information.").max(2000),
      country: z.string().trim().max(2).optional().or(z.literal("")),
      practiceArea: z.string().trim().max(80).optional().or(z.literal("")),
    })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the approach and try again." };
  if (!uuid.safeParse(firmId).success) return { error: "Unknown firm." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("request_introduction", {
    p_firm: firmId, p_to_firm: parsed.data.toFirmId, p_kind: parsed.data.kind, p_brief: parsed.data.brief,
    p_country: parsed.data.country || null, p_practice_area: parsed.data.practiceArea || null,
  });
  if (error) return { error: error.message };
  refresh();
  return undefined;
}

export async function respondIntroduction(introductionId: string, accept: boolean, response?: string): Promise<Err> {
  if (!uuid.safeParse(introductionId).success) return { error: "Unknown approach." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("respond_introduction", { p_id: introductionId, p_accept: accept, p_response: response?.trim() || null });
  if (error) return { error: error.message };
  refresh();
  return undefined;
}

export async function withdrawIntroduction(introductionId: string): Promise<Err> {
  if (!uuid.safeParse(introductionId).success) return { error: "Unknown approach." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("withdraw_introduction", { p_id: introductionId });
  if (error) return { error: error.message };
  refresh();
  return undefined;
}

// ---------------------------------------------------------------- alliances
export async function proposeAlliance(firmId: string, input: { name: string; memberFirmIds: string[]; practiceAreas: string[]; jurisdictions: string[]; referralProcedure?: string; startsOn?: string; renewsOn?: string }): Promise<{ error: string } | { allianceId: string }> {
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal(""));
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Name the alliance.").max(120),
      memberFirmIds: z.array(uuid).min(1, "Choose at least one connected firm.").max(20),
      practiceAreas: z.array(z.string().regex(/^[a-z0-9_]{2,40}$/)).max(30),
      jurisdictions: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)).max(30),
      referralProcedure: z.string().trim().max(4000).optional().or(z.literal("")),
      startsOn: day,
      renewsOn: day,
    })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the alliance and try again." };
  if (!uuid.safeParse(firmId).success) return { error: "Unknown firm." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const d = parsed.data;
  const { data, error } = await supabase.rpc("propose_alliance", {
    p_firm: firmId, p_name: d.name, p_member_firms: d.memberFirmIds, p_practice_areas: d.practiceAreas, p_jurisdictions: d.jurisdictions,
    p_referral_procedure: d.referralProcedure || null, p_preferences: {}, p_starts_on: d.startsOn || null, p_renews_on: d.renewsOn || null,
  });
  if (error) return { error: error.message };
  refresh();
  return { allianceId: String(data ?? "") };
}

export async function respondAlliance(allianceId: string, firmId: string, accept: boolean): Promise<Err> {
  if (!uuid.safeParse(allianceId).success || !uuid.safeParse(firmId).success) return { error: "Unknown alliance." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("respond_alliance", { p_alliance: allianceId, p_firm: firmId, p_accept: accept });
  if (error) return { error: error.message };
  refresh();
  return undefined;
}

export async function leaveOrTerminateAlliance(allianceId: string, firmId: string, terminate: boolean, reason?: string): Promise<Err> {
  if (!uuid.safeParse(allianceId).success || !uuid.safeParse(firmId).success) return { error: "Unknown alliance." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("leave_or_terminate_alliance", { p_alliance: allianceId, p_firm: firmId, p_terminate: terminate, p_reason: reason?.trim() || null });
  if (error) return { error: error.message };
  refresh();
  return undefined;
}

export async function postAllianceNote(allianceId: string, firmId: string, visibility: "shared" | "internal", body: string): Promise<Err> {
  if (!uuid.safeParse(allianceId).success || !uuid.safeParse(firmId).success) return { error: "Unknown alliance." };
  const text = body.trim();
  if (text.length === 0) return { error: "Say something." };
  if (text.length > 4000) return { error: "That is too long for a note." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("post_alliance_note", { p_alliance: allianceId, p_firm: firmId, p_visibility: visibility, p_body: text });
  if (error) return { error: error.message };
  refresh();
  return undefined;
}

// ---------------------------------------------------------------- shared tasks on a joint matter
export async function createCollaborationTask(collaborationId: string, assignedFirmId: string, input: { title: string; detail?: string; dueOn?: string }): Promise<Err> {
  if (!uuid.safeParse(collaborationId).success || !uuid.safeParse(assignedFirmId).success) return { error: "Unknown arrangement." };
  const parsed = z
    .object({
      title: z.string().trim().min(2, "Say what has to be done.").max(200),
      detail: z.string().trim().max(2000).optional().or(z.literal("")),
      dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
    })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the task and try again." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("create_collaboration_task", {
    p_collaboration: collaborationId, p_assigned_firm: assignedFirmId, p_title: parsed.data.title,
    p_detail: parsed.data.detail || null, p_due_on: parsed.data.dueOn || null,
  });
  if (error) return { error: error.message };
  refresh();
  revalidatePath("/firm/matters");
  return undefined;
}

export async function closeCollaborationTask(taskId: string, status: "done" | "cancelled"): Promise<Err> {
  if (!uuid.safeParse(taskId).success) return { error: "Unknown task." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("close_collaboration_task", { p_id: taskId, p_status: status });
  if (error) return { error: error.message };
  refresh();
  revalidatePath("/firm/matters");
  return undefined;
}
