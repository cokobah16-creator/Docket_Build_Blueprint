// The firm's people: everybody who can sign in to this console, what each of them may do, and
// the invitations that have gone out and not been used.
//
// Rules obeyed here:
//  · Every read runs as the signed-in person and RLS decides what comes back. firm_members_select
//    is is_firm_member(firm_id), so every colleague is readable by every colleague; but
//    staff_invites_select is admin_w(firm_id) — owner or admin, MFA, firm NOT suspended — so a
//    lawyer, and anybody at a suspended firm, gets an EMPTY invitation list rather than a short
//    one. That is said on screen, because an empty list that means "you may not see this" and an
//    empty list that means "there are none" are different facts.
//  · The firm's own row is read directly from firms, never firm_public: a pending firm is absent
//    from that view and a pending firm is exactly the firm setting its people up.
//  · Roles, titles, permissions and removal are not decided here. set_member_role(),
//    remove_member() (migration 20), set_member_title(), set_member_custom_role(),
//    set_member_permissions() and the custom role doors (migration 62) hold every rule; this
//    screen only declines to OFFER what the database would certainly refuse for this caller, and
//    when the database refuses anyway its words are shown as they came.
//  · What a person may do is drawn from the same resolution the database makes — owner holds
//    all, a grant wins, then the custom role, then the tier — so the screen and the database
//    agree before a click. The database still decides on every write.
//  · Removing a lawyer clears their bookable week and takes them off the public site, and is
//    refused outright while they have a consultation to come. Those three facts are counted from
//    the database and shown BEFORE the button, not after.
//  · Every count that is capped says so.
//  · Nothing firm-specific: the firm arrives from staffContext().

import { WorkspaceUnavailable } from "@/components/ui/unavailable";
import Link from "next/link";
import { firmStaff, requestedFirmId, staffContext, staffLabel } from "@/lib/firm-data";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { effectivePermissions, type CustomRoleRow, type FirmRoleName, type MemberPermissionRow } from "@/lib/db/types";
import { PeoplePanel, type CustomRoleView, type InviteView, type PersonView } from "./people-panel";

export const metadata = { title: "People" };

/**
 * How many future consultations and weekly rules are read before the numbers stop being exact.
 * A firm with more than this many of either is far outside anything Docket has seen, and the
 * screen says the numbers are capped rather than quietly under-reporting them.
 */
const READ_CAP = 2000;

/** The statuses remove_member() itself counts as "still to come". They must stay in step. */
const LIVE_APPOINTMENT_STATUSES = ["pending", "awaiting_payment", "confirmed", "rescheduled"];

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));

  if (!ctx) {
    return (
      <WorkspaceUnavailable audience="staff" />
    );
  }

  const { supabase, firmId, firmName, userId, role: callerRole, isAdmin, timezone } = ctx;

  const nowIso = new Date().toISOString();

  const [
    { data: firmRow }, members, { data: inviteRows }, { data: lawyerRows }, { data: apptRows }, { data: ruleRows },
    { data: roleRows }, { data: grantRows },
  ] = await Promise.all([
    supabase.from("firms").select("status").eq("id", firmId).maybeSingle(),
    firmStaff(supabase, firmId),
    supabase
      .from("staff_invites")
      .select("id, email, role, title, token, expires_at, created_at, created_by")
      .eq("firm_id", firmId)
      .is("accepted_by", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("lawyer_profiles").select("user_id, is_public").eq("firm_id", firmId).limit(500),
    // What remove_member() will count. Same statuses, same "from now on" cut, so the warning
    // on screen and the database's refusal are about the same appointments.
    supabase
      .from("appointments")
      .select("lawyer_id")
      .eq("firm_id", firmId)
      .in("status", LIVE_APPOINTMENT_STATUSES)
      .gte("starts_at", nowIso)
      .limit(READ_CAP),
    supabase.from("availability_rules").select("lawyer_id").eq("firm_id", firmId).limit(READ_CAP),
    // The firm's own roles and every grant or denial, both member readable (migration 62).
    supabase.from("firm_custom_roles").select("*").eq("firm_id", firmId).order("label").limit(200),
    supabase.from("firm_member_permissions").select("*").eq("firm_id", firmId).limit(5000),
  ]);

  const firm = (firmRow ?? null) as { status: string } | null;
  const firmStatus = firm?.status ?? "pending";
  const suspended = firmStatus === "suspended";
  const canWrite = isAdmin && !suspended;
  // Inviting, titling others, roles and permissions are manage_team acts; an admin denied it is
  // refused by the trigger on staff_invites and by each door. Shown as such, not as a surprise.
  const canManageTeam = canWrite && ctx.can("manage_team");

  const invites = (inviteRows ?? []) as Array<{
    id: string;
    email: string;
    role: string;
    title: string | null;
    token: string;
    expires_at: string;
    created_at: string;
    created_by: string | null;
  }>;
  const publicById = new Map(
    ((lawyerRows ?? []) as Array<{ user_id: string; is_public: boolean }>).map((l) => [l.user_id, l.is_public]),
  );
  const customRoles = (roleRows ?? []) as CustomRoleRow[];
  const roleByKey = new Map(customRoles.map((r) => [r.key, r]));
  const overridesByUser = new Map<string, Record<string, boolean>>();
  for (const g of (grantRows ?? []) as MemberPermissionRow[]) {
    const m = overridesByUser.get(g.user_id) ?? {};
    m[g.permission] = g.granted;
    overridesByUser.set(g.user_id, m);
  }

  const appointments = (apptRows ?? []) as Array<{ lawyer_id: string | null }>;
  const rules = (ruleRows ?? []) as Array<{ lawyer_id: string }>;
  const apptCapped = appointments.length >= READ_CAP;
  const rulesCapped = rules.length >= READ_CAP;

  const futureByLawyer = new Map<string, number>();
  for (const a of appointments) {
    if (!a.lawyer_id) continue;
    futureByLawyer.set(a.lawyer_id, (futureByLawyer.get(a.lawyer_id) ?? 0) + 1);
  }
  const rulesByLawyer = new Map<string, number>();
  for (const r of rules) rulesByLawyer.set(r.lawyer_id, (rulesByLawyer.get(r.lawyer_id) ?? 0) + 1);

  const nameById = new Map(members.map((m) => [m.user_id, staffLabel(m)]));

  const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, lawyer: 2, staff: 3, external: 4, readonly: 5 };
  const people: PersonView[] = members
    .map((m) => {
      const overrides = overridesByUser.get(m.user_id) ?? {};
      const customRole = m.custom_role_key ? roleByKey.get(m.custom_role_key) ?? null : null;
      return {
        userId: m.user_id,
        name: staffLabel(m),
        email: m.email,
        phone: m.phone,
        role: m.role,
        scn: m.scn,
        title: m.title,
        memberTitle: m.member_title,
        customRoleKey: m.custom_role_key,
        overrides,
        effective: effectivePermissions(m.role as FirmRoleName, customRole?.permissions ?? null, overrides),
        isYou: m.user_id === userId,
        isPublic: publicById.get(m.user_id) === true,
        hasLawyerProfile: publicById.has(m.user_id),
        futureConsultations: futureByLawyer.get(m.user_id) ?? 0,
        availabilityRules: rulesByLawyer.get(m.user_id) ?? 0,
      };
    })
    .sort((a, b) => {
      const byRole = (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9);
      return byRole !== 0 ? byRole : a.name.localeCompare(b.name);
    });

  const holders = new Map<string, number>();
  for (const p of people) if (p.customRoleKey) holders.set(p.customRoleKey, (holders.get(p.customRoleKey) ?? 0) + 1);
  const customRoleViews: CustomRoleView[] = customRoles.map((r) => ({
    key: r.key,
    label: r.label,
    baseRole: r.base_role,
    permissions: r.permissions,
    holders: holders.get(r.key) ?? 0,
  }));

  const now = Date.now();
  const inviteViews: InviteView[] = invites.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    title: i.title,
    token: i.token,
    expiresAt: i.expires_at,
    createdAt: i.created_at,
    expired: new Date(i.expires_at).getTime() <= now,
    invitedBy: i.created_by ? nameById.get(i.created_by) ?? null : null,
  }));

  const ownerCount = people.filter((p) => p.role === "owner").length;
  const you = people.find((p) => p.isYou) ?? null;

  return (
    <div className="space-y-5">
      <header className="min-w-0">
        <h2 className="font-heading text-26 font-semibold text-brand">People</h2>
        <p className="text-15 text-ink-muted">
          {firmName} · {people.length} {people.length === 1 ? "person" : "people"} can sign in to this console
        </p>
      </header>

      {suspended && (
        <Alert kind="error" title="This firm is suspended">
          <p>
            Everybody here can still be read. admin_w() is false while a firm is suspended, so
            inviting, changing a role and removing somebody are all refused by the database until
            Docket lifts it.
          </p>
          <p className="mt-2">
            The invitation list below is empty for the same reason and not because there are none:
            staff_invites_select is admin_w(firm_id) too, so a suspended firm cannot read its own
            outstanding invitations.
          </p>
        </Alert>
      )}

      {!isAdmin && !suspended && (
        <Alert kind="info" title={`You are ${callerRole} at ${firmName}`}>
          <p>
            You can see who your colleagues are and what each may do. Inviting somebody, changing a
            role, a title or a permission and removing somebody are an owner&rsquo;s or an
            administrator&rsquo;s acts — the database refuses everybody else — and outstanding
            invitations are not readable by a {callerRole} at all, so that list is empty rather
            than short.
          </p>
          <p className="mt-2">
            Ask an owner or an administrator, or{" "}
            <Link href="/firm" className="font-medium underline">
              go back to Today
            </Link>
            .
          </p>
        </Alert>
      )}

      {isAdmin && !suspended && !canManageTeam && (
        <Alert kind="warning" title="Your account has been denied the manage team permission">
          An owner or another administrator has taken manage team off your account. You can still read
          everybody; the database refuses an invitation, a title, a role or a permission change from you.
        </Alert>
      )}

      {firmStatus === "pending" && isAdmin && (
        <Alert kind="info" title="Your firm is still pending, and people still work">
          Inviting colleagues, setting roles and removing somebody all work while Docket verifies
          the firm. What waits for verification is the public site, not the console.
        </Alert>
      )}

      {ownerCount === 1 && (
        <Alert kind="warning" title="This firm has one owner">
          <p>
            {you?.role === "owner"
              ? "That is you. Nobody can change your role or remove you — including you — and the database protects the last owner besides."
              : `That is ${people.find((p) => p.role === "owner")?.name ?? "one person"}. Nobody can stand them down or remove them until a second owner exists.`}{" "}
            An owner who loses their phone, leaves the firm or dies leaves nobody who can appoint
            another. Invite a second owner while it is easy.
          </p>
        </Alert>
      )}

      {(apptCapped || rulesCapped) && (
        <Alert kind="warning" title="Some of the numbers below are capped">
          This screen reads at most {READ_CAP.toLocaleString("en-NG")} rows of{" "}
          {apptCapped && rulesCapped
            ? "future consultations, and the same again of weekly availability rules"
            : apptCapped
              ? "future consultations"
              : "weekly availability rules"}
          , and this firm has at least that many. Read the figures below as “at least”. The
          database counts every one of them when it decides.
        </Alert>
      )}

      <PeoplePanel
        firmId={firmId}
        firmName={firmName}
        callerRole={callerRole}
        canWrite={canWrite}
        canManageTeam={canManageTeam}
        isAdmin={isAdmin}
        suspended={suspended}
        ownerCount={ownerCount}
        people={people}
        customRoles={customRoleViews}
        invites={inviteViews}
        timezone={timezone}
      />

      <Card>
        <CardHeader title="How somebody actually joins" />
        <CardBody className="space-y-2 text-15 text-ink-muted">
          <p>
            <span className="font-medium text-ink">Docket does not send the invitation.</span>{" "}
            Creating one writes a row and mints a link; sending it is yours to do, by email or
            WhatsApp or however you reach the person. Copy the link above and send it.
          </p>
          <p>
            They open the link, sign in or sign up{" "}
            <span className="font-medium text-ink">with the exact address you invited</span>,
            and accept. A different address is refused with “this invite was sent to a different
            email address” — the token alone proves nothing.
          </p>
          <p>
            An invitation lasts fourteen days. When it is accepted the person becomes a member with
            the role and the title on the invitation; if they are already a member, accepting sets
            their role to it instead. Owners, administrators and lawyers also get a private lawyer
            profile, which stays off the public site until somebody publishes it.
          </p>
          <p>
            <span className="font-medium text-ink">What a role means.</span> The tier (owner,
            administrator, lawyer, staff, read only, external) is what the database&rsquo;s gates
            understand. A read only member writes nothing; an external collaborator reads only the
            matters they are put on. On top of the tier, a firm may define its own roles and grant
            or deny any one permission per person. An owner always holds every permission.
          </p>
          <p>
            Everything on this screen is written to the audit trail — who invited whom, every role,
            title and permission change, every removal.{" "}
            <Link href="/firm/admin/audit" className="font-medium text-brand underline">
              Read the audit trail
            </Link>
            .
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
