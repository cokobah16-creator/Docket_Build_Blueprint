"use server";

// The firm's people: who works here, what each of them may do, and how somebody new gets in.
//
// Screens served: /firm/admin/people in the staff console.
//
// Rules obeyed here:
//  · THE DATABASE IS THE AUTHORIZATION LAYER, and for members it is not even a policy — it is
//    two functions written for this job in migration 20. set_member_role() and remove_member()
//    hold every rule about roles: nobody changes their own role, only an owner appoints or
//    stands down an owner, the firm's last owner is protected, and a lawyer with consultations
//    still to come cannot be removed until they are reassigned or cancelled. firm_members_write
//    would allow all of those — an admin could promote itself to owner and delete the last one —
//    which is exactly why the console never writes that table and always calls the function.
//    Nothing in this file re-decides any of it; every refusal below is the database's sentence,
//    passed through word for word.
//  · Invitations ARE a plain table write, because the database already guards them properly:
//    staff_invites_write_ins (migration 21) is `admin_w(firm_id) and created_by = auth.uid()`,
//    and check_staff_invite_role() (migration 15) raises "only an owner may invite another
//    owner". So created_by is set to the signed-in account, and the trigger's words are shown.
//  · An INSERT never uses .select(). The id is minted here with crypto.randomUUID(); the token
//    is minted by the column default (gen_random_bytes), and read back in a SEPARATE query,
//    which staff_invites_select (admin_w) allows the person who just created it.
//  · Nothing firm-specific: the firm always arrives as an argument from staffContext().
//  · No service role key. Every call runs as the signed-in staff member through supabaseServer().
//
// Docket does NOT send a staff invitation. enqueue_notification() needs an account to send to
// and an invitee has none yet, so the link is handed back to the person inviting and they send
// it themselves. The screen says that out loud; this file is where it is true.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

// ---------------------------------------------------------------- shapes

export interface PeopleResult {
  ok?: true;
  error?: string;
  /** Something true and worth saying that is not a failure. */
  notice?: string;
}

export interface InviteCreated extends PeopleResult {
  inviteId?: string;
  /** The secret in the link. It is shown once here and again in the pending list below. */
  token?: string;
  expiresAt?: string;
  email?: string;
  role?: string;
}

export interface MemberRemoved extends PeopleResult {
  wasRole?: string;
  /** How many weekly availability rules remove_member() deleted on the way out. */
  availabilityRulesCleared?: number;
}

const uuid = z.string().uuid();

const roleSchema = z.enum(["owner", "admin", "lawyer", "staff"], {
  errorMap: () => ({ message: "A role is owner, administrator, lawyer or staff." }),
});

const inviteSchema = z.object({
  firmId: uuid,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, { message: "Type the email address the invitation is for." })
    .max(200, { message: "That email address is too long." })
    .email({ message: "That does not look like an email address." }),
  role: roleSchema,
});

/** A PostgREST error, word for word, with the detail and hint the database attached to it. */
function verbatim(error: { message: string; details?: string | null; hint?: string | null }): string {
  return [error.message, error.details ?? "", error.hint ?? ""]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" — ");
}

/**
 * Why a write changed nothing — asked of the database, not decided here.
 *
 * Under RLS a DELETE whose USING clause excludes the row affects zero rows and raises nothing
 * at all. That silence is the refusal, and inside admin_w() it has three possible reasons:
 * role, MFA, suspension. Each is a function the caller may ask directly, so all three are asked
 * and their answers repeated.
 */
async function whyNothingChanged(
  supabase: NonNullable<Awaited<ReturnType<typeof supabaseServer>>>,
  firmId: string,
  what: string,
): Promise<string> {
  const [allowed, mfa, notSuspended] = await Promise.all([
    supabase.rpc("admin_w", { f: firmId }),
    supabase.rpc("mfa_ok"),
    supabase.rpc("firm_not_suspended", { f: firmId }),
  ]);
  if (allowed.error) {
    return `Nothing was changed, and the database could not say why: ${allowed.error.message}. Reload the page and try again.`;
  }
  if (allowed.data === true) {
    return `The database allows you to write here — admin_w() is true — but no ${what} matched. It was probably already dealt with by a colleague since this page loaded. Reload and try again.`;
  }
  const reasons: string[] = [];
  if (mfa.data === false) {
    reasons.push("this session is not MFA-verified — mfa_ok() is false, so sign in again with your authenticator");
  }
  if (notSuspended.data === false) {
    reasons.push("this firm is suspended, and every write on a suspended firm is refused until Docket lifts it");
  }
  if (mfa.data === true && notSuspended.data === true) {
    reasons.push("this account is not an owner or an administrator of this firm");
  }
  if (reasons.length === 0) {
    reasons.push("the database did not say which of role, MFA or suspension it was");
  }
  return `The database refused it: admin_w() is false for this firm — ${reasons.join("; ")}. Nothing was changed.`;
}

function refresh(): void {
  revalidatePath("/firm/admin/people");
  // The member count and "who runs this firm" line live on the administration front page.
  revalidatePath("/firm/admin");
  // A removal deletes the person's weekly rules and unpublishes their public profile, so the
  // diary and the console's front page are both out of date the moment it succeeds.
  revalidatePath("/firm/availability");
  revalidatePath("/firm");
}

// ================================================================ invitations

/**
 * Invite somebody to the firm.
 *
 * The row is the invitation: there is no email behind it. accept_staff_invite() will only join
 * the person whose signed-in email matches this address exactly (case aside), so the address
 * typed here is the address they must sign in with.
 */
export async function inviteColleague(input: {
  firmId: string;
  email: string;
  role: string;
}): Promise<InviteCreated> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the invitation and try again." };
  const d = parsed.data;

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  // staff_invites_write_ins is `admin_w(firm_id) and created_by = auth.uid()`: an invitation
  // with anybody else's id in created_by — or none — is refused by the policy itself.
  if (!user) return { error: "You are not signed in any more. Sign in again and repeat this." };

  const id = crypto.randomUUID();
  const { error } = await supabase.from("staff_invites").insert({
    id,
    firm_id: d.firmId,
    email: d.email,
    role: d.role,
    created_by: user.id,
  });

  if (error) return { error: verbatim(error) };

  // The token is the column's own default (24 random bytes, hex). It has to be read back to be
  // handed over, and that is a separate SELECT rather than .select() on the insert, because an
  // insert that reads itself back through the select policy is the one pattern this codebase
  // does not use.
  const { data: row } = await supabase
    .from("staff_invites")
    .select("id, token, expires_at")
    .eq("id", id)
    .maybeSingle();
  const created = (row ?? null) as { id: string; token: string; expires_at: string } | null;

  refresh();

  if (!created) {
    return {
      ok: true,
      inviteId: id,
      email: d.email,
      role: d.role,
      notice:
        "The invitation was created, but reading its link back was refused. Reload this page — the link is listed with the other invitations that are still open.",
    };
  }

  return {
    ok: true,
    inviteId: created.id,
    token: created.token,
    expiresAt: created.expires_at,
    email: d.email,
    role: d.role,
  };
}

/**
 * Cancel an invitation that has not been used.
 *
 * staff_invites_write_del is admin_w(firm_id) and nothing more, so an accepted invitation would
 * be deleted just as happily — and deleting it would take away the record of how somebody got
 * in. The firm_id is matched as well as the id so a mistyped id can never reach another firm's
 * row, and accepted_by is required to be null so the history stays.
 */
export async function revokeStaffInvite(inviteId: string, firmId: string): Promise<PeopleResult> {
  if (!uuid.safeParse(inviteId).success) return { error: "That invitation could not be read." };
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { error, count } = await supabase
    .from("staff_invites")
    .delete({ count: "exact" })
    .eq("id", inviteId)
    .eq("firm_id", firmId)
    .is("accepted_by", null);

  if (error) return { error: verbatim(error) };
  if ((count ?? 0) === 0) {
    return { error: await whyNothingChanged(supabase, firmId, "open invitation") };
  }

  refresh();
  return { ok: true, notice: "That invitation is cancelled. Its link stops working straight away." };
}

// ================================================================ roles and removal

/**
 * Change what a colleague may do.
 *
 * set_member_role() (migration 20) is the rule and the whole of it. This function does not check
 * who the caller is, whether they are changing their own row, or whether the target is the last
 * owner — the database checks all three and says so in a sentence written for the person reading
 * it, and that sentence is what comes back.
 */
export async function changeMemberRole(firmId: string, userId: string, role: string): Promise<PeopleResult> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };
  if (!uuid.safeParse(userId).success) return { error: "That person could not be read." };
  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) return { error: parsedRole.error.issues[0]?.message ?? "Choose a role." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { error } = await supabase.rpc("set_member_role", {
    p_firm: firmId,
    p_user: userId,
    p_role: parsedRole.data,
  });
  if (error) return { error: verbatim(error) };

  refresh();
  return { ok: true };
}

/**
 * Take somebody off the firm.
 *
 * remove_member() (migration 20) does four things in one transaction: it deletes their weekly
 * availability rules and any exceptions, unpublishes their lawyer profile, deletes the
 * membership, and audits all of it — and it refuses outright while they still have a
 * consultation to come. What it deleted comes back in the return value, so the screen can say
 * what was actually cleared rather than guessing.
 */
export async function removeFirmMember(firmId: string, userId: string): Promise<MemberRemoved> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };
  if (!uuid.safeParse(userId).success) return { error: "That person could not be read." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data, error } = await supabase.rpc("remove_member", { p_firm: firmId, p_user: userId });
  if (error) return { error: verbatim(error) };

  const result = (data ?? null) as
    | { removed?: boolean; was_role?: string; availability_rules_cleared?: number }
    | null;

  refresh();
  return {
    ok: true,
    wasRole: result?.was_role,
    availabilityRulesCleared:
      typeof result?.availability_rules_cleared === "number" ? result.availability_rules_cleared : undefined,
  };
}
