"use client";

// The firm's people, edited: one card per colleague, one form for a new invitation, the firm's
// own roles, and the invitations that are still out there with the link each of them is.
//
// Rules obeyed here:
//  · Nothing on this screen decides who may do what. set_member_role() and remove_member()
//    (migration 20), set_member_title(), set_member_custom_role(), set_member_permissions(),
//    upsert_custom_role() and delete_custom_role() (migration 62) hold every rule, and the
//    actions in "@/lib/actions/people" call them as the signed-in person. What this file does is
//    decline to OFFER a control the database would certainly refuse — a lawyer cannot be handed
//    buttons that all fail — and, when the database refuses anyway, show its sentence word for
//    word. The two are not the same thing: the first is courtesy, the second is the rule.
//  · What a person MAY do is drawn beside the controls that change it, from the same resolution
//    the database makes: an owner holds all; a grant or denial wins; then the custom role; then
//    the tier. A permission is shown as allowed or denied, and where that came from.
//  · Removing a lawyer is destructive in ways that are not obvious from the word "remove", so
//    what it will clear is counted and shown BEFORE the button: their bookable week goes, their
//    public profile comes down, and while they have a consultation still to come the database
//    refuses the removal outright.
//  · The invitation link is the invitation. Docket does not send it, so it is shown in full with
//    a copy control and a hand-off to email, because that is how it actually reaches somebody.
//  · Mobile first: one column at 390px, 44px targets, nothing that scrolls sideways.
//  · Nothing firm-specific — the firm's name and id arrive as props.

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  changeMemberRole,
  deleteCustomRole,
  inviteColleague,
  removeFirmMember,
  revokeStaffInvite,
  setMemberCustomRole,
  setMemberPermissions,
  setMemberTitle,
  upsertCustomRole,
} from "@/lib/actions/people";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { FIRM_ROLES, MEMBER_TITLES, PERMISSIONS, ROLE_DEFAULT_PERMISSIONS, type FirmRoleName } from "@/lib/db/types";
import { cn } from "@/lib/cn";

/** Where a colleague lands with their invitation. accept_staff_invite() does the rest. */
const JOIN_PATH = "/firm/join";

const field =
  "mt-1 min-h-[44px] w-full rounded-lg border border-edge bg-raised px-3 py-2 text-base text-ink focus:border-brand focus:outline focus:outline-2 focus:outline-brand";
const labelClass = "block text-15 font-medium text-ink";

export interface PersonView {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  scn: string | null;
  /** lawyer_profiles.title: the professional title on the public profile. */
  title: string | null;
  /** firm_members.title: the job title at the firm. */
  memberTitle: string | null;
  customRoleKey: string | null;
  /** permission -> granted, from firm_member_permissions. */
  overrides: Record<string, boolean>;
  /** What they may do, resolved the way the database resolves it. */
  effective: string[];
  isYou: boolean;
  /** lawyer_profiles.is_public — whether they are on the firm's public site right now. */
  isPublic: boolean;
  hasLawyerProfile: boolean;
  /** Consultations still to come with them as the lawyer. remove_member() refuses while > 0. */
  futureConsultations: number;
  /** Weekly availability rules remove_member() would delete. */
  availabilityRules: number;
}

export interface CustomRoleView {
  key: string;
  label: string;
  baseRole: string;
  permissions: string[];
  holders: number;
}

export interface InviteView {
  id: string;
  email: string;
  role: string;
  title: string | null;
  token: string;
  expiresAt: string;
  createdAt: string;
  expired: boolean;
  invitedBy: string | null;
}

function roleLabel(role: string): string {
  return FIRM_ROLES.find((r) => r.value === role)?.label ?? role;
}

function roleHint(role: string): string | null {
  return FIRM_ROLES.find((r) => r.value === role)?.hint ?? null;
}

/**
 * Copies a link, and shows it to be copied by hand when the browser refuses clipboard access —
 * an insecure context or an older Android WebView, which is a real phone in a real corridor.
 */
function CopyLink({ url, label = "Copy the link" }: { url: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("manual");
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={copy}
        className="inline-flex min-h-[44px] items-center rounded-lg border border-edge px-3 text-15 font-medium text-brand hover:bg-hover"
      >
        {state === "copied" ? "Copied" : label}
      </button>
      {state === "manual" && (
        <input
          readOnly
          value={url}
          aria-label="Invitation link to copy"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-edge px-3 py-2 text-base text-ink sm:w-80"
        />
      )}
    </span>
  );
}

/** Default, allowed or denied: what the three choices on a permission row mean. */
type Choice = "default" | "allow" | "deny";
function choiceOf(override: boolean | undefined): Choice {
  return override === undefined ? "default" : override ? "allow" : "deny";
}

/**
 * The permission editor for one colleague. The effective state is drawn from the same resolution
 * the database makes; the select changes only the per member grant, which is the final word.
 */
function PermissionsEditor({
  firmId,
  person,
  customRole,
  onSaved,
}: {
  firmId: string;
  person: PersonView;
  customRole: CustomRoleView | null;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(PERMISSIONS.map((p) => [p.key, choiceOf(person.overrides[p.key])])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseline = customRole
    ? customRole.permissions
    : (ROLE_DEFAULT_PERMISSIONS[person.role as FirmRoleName] ?? []);
  const baselineName = customRole ? `the ${customRole.label} role` : `${roleLabel(person.role).toLowerCase()}`;

  const changed = PERMISSIONS.filter((p) => draft[p.key] !== choiceOf(person.overrides[p.key]));

  async function save() {
    setBusy(true);
    setError(null);
    const changes: Record<string, boolean | null> = {};
    for (const p of changed) changes[p.key] = draft[p.key] === "default" ? null : draft[p.key] === "allow";
    const result = await setMemberPermissions(firmId, person.userId, changes);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved(`${person.name} may now: ${(result.permissions ?? []).map((k) => PERMISSIONS.find((p) => p.key === k)?.label ?? k).join(", ") || "nothing"}.`);
  }

  return (
    <details className="rounded-lg border border-hairline bg-sunken">
      <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-15 font-medium text-ink">
        Permissions · {person.effective.length} of {PERMISSIONS.length}
      </summary>
      <div className="space-y-3 border-t border-hairline p-3">
        <p className="text-13 text-ink-muted">
          Left to the role, each permission follows {baselineName}. Allow or deny one here and that is the final word for{" "}
          {person.name}, whatever the role says. The database decides on every write; this only shows the same answer.
        </p>
        <ul className="divide-y divide-hairline">
          {PERMISSIONS.map((p) => {
            const inBaseline = baseline.includes(p.key);
            const choice = draft[p.key];
            const effective = choice === "default" ? inBaseline : choice === "allow";
            return (
              <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-15 text-ink">
                    {p.label}{" "}
                    <span className={cn("text-13", effective ? "text-settled-ink" : "text-ink-muted")}>
                      · {effective ? "allowed" : "not allowed"}
                      {choice === "default" ? ` by ${baselineName}` : choice === "allow" ? " by a grant" : " by a denial"}
                    </span>
                  </p>
                  <p className="text-13 text-ink-muted">{p.hint}</p>
                </div>
                <label className="text-13 text-ink">
                  <span className="sr-only">{p.label}</span>
                  <select
                    value={choice}
                    onChange={(e) => setDraft({ ...draft, [p.key]: e.currentTarget.value as Choice })}
                    className="min-h-[44px] rounded-lg border border-edge bg-raised px-2 text-base text-ink"
                  >
                    <option value="default">Left to the role</option>
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                  </select>
                </label>
              </li>
            );
          })}
        </ul>
        {error && <Alert kind="error" title="The database refused that">{error}</Alert>}
        <Button variant="ghost" size="lg" disabled={busy || changed.length === 0} onClick={save}>
          {busy ? "Saving…" : changed.length === 0 ? "Nothing changed" : `Save ${changed.length} ${changed.length === 1 ? "change" : "changes"}`}
        </Button>
      </div>
    </details>
  );
}

/** The firm's own roles: a tier plus the permissions it carries. */
function CustomRolesCard({
  firmId,
  roles,
  canManageTeam,
  onDone,
}: {
  firmId: string;
  roles: CustomRoleView[];
  canManageTeam: boolean;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [baseRole, setBaseRole] = useState("staff");
  const [perms, setPerms] = useState<string[]>([...ROLE_DEFAULT_PERMISSIONS.staff]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  function pickBase(next: string) {
    setBaseRole(next);
    setPerms([...(ROLE_DEFAULT_PERMISSIONS[next as FirmRoleName] ?? [])]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await upsertCustomRole(firmId, { key: key.trim().toLowerCase(), label: label.trim(), baseRole, permissions: perms });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onDone(result.notice ?? "The role is saved.");
    setKey("");
    setLabel("");
    router.refresh();
  }

  async function remove(role: CustomRoleView) {
    setDeleting(role.key);
    setError(null);
    const result = await deleteCustomRole(firmId, role.key);
    setDeleting(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    onDone(`${role.label} is gone.`);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader title="The firm's own roles" action={roles.length > 0 ? <Badge>{roles.length}</Badge> : undefined} />
      <CardBody className="space-y-4">
        <p className="text-15 text-ink-muted">
          A role is a tier the database understands plus the permissions it carries. Put a colleague on one from their
          card and its list replaces the tier&rsquo;s defaults for them; a grant or denial on the person still wins.
        </p>
        {roles.length === 0 ? (
          <EmptyState title="No role defined yet" hint="Every colleague follows their tier's defaults until the firm defines a role of its own." />
        ) : (
          <ul className="divide-y divide-hairline">
            {roles.map((r) => (
              <li key={r.key} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-15 font-medium text-ink">
                    {r.label} <span className="text-13 font-normal text-ink-muted">· {r.key} · built on {roleLabel(r.baseRole).toLowerCase()}</span>
                  </p>
                  <p className="text-13 text-ink-muted">
                    {r.permissions.length === 0 ? "No permissions" : r.permissions.map((k) => PERMISSIONS.find((p) => p.key === k)?.label ?? k).join(", ")}
                  </p>
                  <p className="text-13 text-ink-muted">{r.holders === 0 ? "Nobody holds it" : `${r.holders} ${r.holders === 1 ? "person holds" : "people hold"} it`}</p>
                </div>
                {canManageTeam && (
                  <Button variant="ghost" size="sm" disabled={deleting === r.key || r.holders > 0} onClick={() => remove(r)}>
                    {deleting === r.key ? "Removing…" : r.holders > 0 ? "In use" : "Remove"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && <Alert kind="error" title="The database refused that">{error}</Alert>}
        {canManageTeam && (
          <form onSubmit={submit} className="space-y-3 border-t border-hairline pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="role-label" className={labelClass}>Name</label>
                <input id="role-label" required maxLength={80} value={label} onChange={(e) => { setLabel(e.currentTarget.value); if (!key) setKey(e.currentTarget.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)); }} className={field} placeholder="Billing clerk" />
              </div>
              <div>
                <label htmlFor="role-key" className={labelClass}>Key</label>
                <input id="role-key" required pattern="[a-z][a-z0-9_]{1,39}" value={key} onChange={(e) => setKey(e.currentTarget.value)} className={field} placeholder="billing_clerk" />
                <p className="mt-1 text-13 text-ink-muted">Lowercase letters, digits and underscores. Fixed once people hold the role.</p>
              </div>
            </div>
            <div>
              <label htmlFor="role-base" className={labelClass}>Built on</label>
              <select id="role-base" value={baseRole} onChange={(e) => pickBase(e.currentTarget.value)} className={field}>
                {FIRM_ROLES.filter((r) => r.value !== "owner").map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <p className="mt-1 text-13 text-ink-muted">
                The tier the gates see. A role built on read only or external still cannot write anything, whatever it lists.
              </p>
            </div>
            <fieldset>
              <legend className={labelClass}>Permissions the role carries</legend>
              <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                {PERMISSIONS.map((p) => (
                  <li key={p.key}>
                    <label className="flex min-h-[44px] items-center gap-2 text-15 text-ink">
                      <input
                        type="checkbox"
                        checked={perms.includes(p.key)}
                        onChange={(e) => setPerms(e.currentTarget.checked ? [...perms, p.key] : perms.filter((k) => k !== p.key))}
                        className="h-5 w-5"
                      />
                      {p.label}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            <Button type="submit" size="lg" disabled={busy} className="w-full sm:w-auto">
              {busy ? "Saving…" : "Save the role"}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

export function PeoplePanel({
  firmId,
  firmName,
  callerRole,
  canWrite,
  canManageTeam,
  isAdmin,
  suspended,
  ownerCount,
  people,
  customRoles,
  invites,
  timezone,
}: {
  firmId: string;
  firmName: string;
  callerRole: string;
  canWrite: boolean;
  canManageTeam: boolean;
  isAdmin: boolean;
  suspended: boolean;
  ownerCount: number;
  people: PersonView[];
  customRoles: CustomRoleView[];
  invites: InviteView[];
  timezone: string;
}) {
  const router = useRouter();
  const callerIsOwner = callerRole === "owner";
  // A readonly or external caller has no verified write session the database accepts, so even
  // their own title is refused (set_member_title asks staff_w for self).
  const callerCanWriteSelf = !suspended && callerRole !== "readonly" && callerRole !== "external";

  // The link has to be absolute to be worth copying, and the origin is only knowable in the
  // browser — the console answers on /firm, on a preview deployment and on a custom domain, and
  // hard-coding any of them would be a firm-specific string in shared code. Reading it after
  // mount also keeps the server render and the first client render identical.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("lawyer");
  const [inviteTitle, setInviteTitle] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [minted, setMinted] = useState<{ token: string; email: string; role: string; notice?: string } | null>(null);

  const [roleDraft, setRoleDraft] = useState<Record<string, string>>({});
  const [titleDraft, setTitleDraft] = useState<Record<string, string>>({});
  const [customDraft, setCustomDraft] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [rowDone, setRowDone] = useState<{ id: string; message: string } | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);
  // A removal and a cancelled invitation both delete the card that asked for them, so what the
  // database did has to be reported somewhere that survives the refresh. This is that place.
  const [outcome, setOutcome] = useState<string | null>(null);

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const day = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: timezone });

  const linkFor = (token: string) => (origin ? `${origin}${JOIN_PATH}?token=${encodeURIComponent(token)}` : "");
  const roleByKey = new Map(customRoles.map((r) => [r.key, r]));

  /** The roles this caller may hand out. Only an owner may appoint or stand down an owner. */
  const grantableRoles = FIRM_ROLES.filter((r) => r.value !== "owner" || callerIsOwner);

  /** Why this caller cannot change this person's role — the database's reason, before the click. */
  function roleChangeBlocked(p: PersonView): string | null {
    if (p.isYou) {
      return "This is you. set_member_role() refuses “you cannot change your own role — ask another owner to do it”.";
    }
    if (p.role === "owner" && !callerIsOwner) {
      return "Only an owner can stand down another owner. You are an administrator, so the database refuses this one.";
    }
    if (p.role === "owner" && ownerCount <= 1) {
      return "This is the firm's last owner. Appoint a second owner first, then this becomes possible.";
    }
    return null;
  }

  /** Why this caller cannot remove this person, in the order the database checks it. */
  function removalBlocked(p: PersonView): string | null {
    if (p.isYou) {
      return "This is you. remove_member() refuses “you cannot remove yourself — ask another owner to do it”.";
    }
    if (p.role === "owner" && !callerIsOwner) {
      return "Only an owner can remove another owner. You are an administrator, so the database refuses this one.";
    }
    if (p.role === "owner" && ownerCount <= 1) {
      return "This is the firm's last owner. Appoint a second owner first.";
    }
    if (p.futureConsultations > 0) {
      return `${p.name} has ${p.futureConsultations} consultation${p.futureConsultations === 1 ? "" : "s"} still to come. remove_member() refuses until each one is reassigned to another lawyer or cancelled.`;
    }
    return null;
  }

  function report(id: string, message: string) {
    setRowError(null);
    setRowDone({ id, message });
    router.refresh();
  }

  async function submitInvite(e: FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setMinted(null);
    setInviting(true);
    const result = await inviteColleague({ firmId, email: email.trim(), role: inviteRole, title: inviteTitle.trim() });
    setInviting(false);
    if (result.error) {
      setInviteError(result.error);
      return;
    }
    setMinted({
      token: result.token ?? "",
      email: result.email ?? email.trim().toLowerCase(),
      role: result.role ?? inviteRole,
      notice: result.notice,
    });
    setEmail("");
    setInviteTitle("");
    router.refresh();
  }

  async function saveRole(p: PersonView) {
    const next = roleDraft[p.userId] ?? p.role;
    setRowError(null);
    setRowDone(null);
    setOutcome(null);
    if (next === p.role) {
      setRowDone({ id: p.userId, message: `${p.name} is already ${roleLabel(p.role).toLowerCase()}. Nothing to change.` });
      return;
    }
    setWorking(p.userId);
    const result = await changeMemberRole(firmId, p.userId, next);
    setWorking(null);
    if (result.error) {
      setRowError({ id: p.userId, message: result.error });
      return;
    }
    report(p.userId, `${p.name} is now ${roleLabel(next).toLowerCase()}.`);
  }

  async function saveTitle(p: PersonView) {
    const next = (titleDraft[p.userId] ?? p.memberTitle ?? "").trim();
    setRowError(null);
    setRowDone(null);
    setWorking(p.userId);
    const result = await setMemberTitle(firmId, p.userId, next);
    setWorking(null);
    if (result.error) {
      setRowError({ id: p.userId, message: result.error });
      return;
    }
    report(p.userId, result.notice ?? "The title is saved.");
  }

  async function saveCustomRole(p: PersonView) {
    const next = customDraft[p.userId] ?? p.customRoleKey ?? "";
    setRowError(null);
    setRowDone(null);
    setWorking(p.userId);
    const result = await setMemberCustomRole(firmId, p.userId, next || null);
    setWorking(null);
    if (result.error) {
      setRowError({ id: p.userId, message: result.error });
      return;
    }
    report(p.userId, next ? `${p.name} now holds the ${roleByKey.get(next)?.label ?? next} role.` : `${p.name} follows the ${roleLabel(p.role).toLowerCase()} defaults again.`);
  }

  async function remove(p: PersonView) {
    setRowError(null);
    setRowDone(null);
    setOutcome(null);
    setWorking(p.userId);
    const result = await removeFirmMember(firmId, p.userId);
    setWorking(null);
    setConfirmingRemoval(null);
    if (result.error) {
      setRowError({ id: p.userId, message: result.error });
      return;
    }
    const cleared = result.availabilityRulesCleared ?? 0;
    setOutcome(
      `${p.name} is off the firm. They were ${roleLabel(result.wasRole ?? p.role).toLowerCase()}. ${
        cleared > 0
          ? `${cleared} weekly availability ${cleared === 1 ? "rule was" : "rules were"} cleared, so nothing of theirs can be booked.`
          : "They had no weekly availability rules to clear."
      }${p.isPublic ? " Their profile is off the public site." : ""} Anything they were working on keeps their name on it.`,
    );
    router.refresh();
  }

  async function cancelInvite(invite: InviteView) {
    setRowError(null);
    setRowDone(null);
    setOutcome(null);
    setWorking(invite.id);
    const result = await revokeStaffInvite(invite.id, firmId);
    setWorking(null);
    setConfirmingRemoval(null);
    if (result.error) {
      setRowError({ id: invite.id, message: result.error });
      return;
    }
    setOutcome(
      `${result.notice ?? "That invitation is cancelled."} It was for ${invite.email}, as ${roleLabel(invite.role).toLowerCase()}.`,
    );
    router.refresh();
  }

  // Two things worth knowing BEFORE the click, both readable from what is already on screen.
  // Neither is a refusal — the database allows both — so each is said and then got out of the way.
  const typedEmail = email.trim().toLowerCase();
  const alreadyMember = typedEmail ? people.find((p) => (p.email ?? "").toLowerCase() === typedEmail) ?? null : null;
  const alreadyInvited = typedEmail ? invites.find((i) => i.email.toLowerCase() === typedEmail && !i.expired) ?? null : null;

  const mintedLink = minted?.token ? linkFor(minted.token) : "";
  const mintedMessage = minted
    ? `${firmName} has invited you to join its Docket console as ${roleLabel(minted.role).toLowerCase()}. Open this link, sign in with ${minted.email}, and accept: ${mintedLink}`
    : "";

  return (
    <div className="space-y-5">
      {outcome && (
        <Alert kind="success" title="Done">
          <p>{outcome}</p>
          <p className="mt-2">
            It is written to the audit trail with your name on it.{" "}
            <Link href="/firm/admin/audit" className="font-medium underline">
              Read the audit trail
            </Link>
            .
          </p>
        </Alert>
      )}

      {/* ------------------------------------------------------------------ invite */}
      {canManageTeam && (
        <Card>
          <CardHeader title="Invite somebody to the firm" />
          <CardBody className="space-y-4">
            <form onSubmit={submitInvite} className="space-y-4">
              <div>
                <label htmlFor="invite-email" className={labelClass}>
                  Their email address
                </label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  autoComplete="off"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                  className={field}
                  placeholder="colleague@example.com"
                />
                <p className="mt-1 text-15 text-ink-muted">
                  This is the address they must sign in with. accept_staff_invite() compares it to
                  the address on their account and refuses any other, so a personal address on the
                  invitation and a work address at sign-in will not meet.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="invite-role" className={labelClass}>
                    What they will be able to do
                  </label>
                  <select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.currentTarget.value)}
                    className={field}
                  >
                    {grantableRoles.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-15 text-ink-muted">{roleHint(inviteRole)}</p>
                  {!callerIsOwner && (
                    <p className="mt-1 text-15 text-ink-muted">
                      Owner is not on this list because only an owner may invite another owner — the
                      database raises “only an owner may invite another owner” if it is tried.
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="invite-title" className={labelClass}>
                    Their title (optional)
                  </label>
                  <input
                    id="invite-title"
                    list="member-titles"
                    maxLength={80}
                    value={inviteTitle}
                    onChange={(e) => setInviteTitle(e.currentTarget.value)}
                    className={field}
                    placeholder="Associate"
                  />
                  <datalist id="member-titles">
                    {MEMBER_TITLES.map((t) => <option key={t} value={t} />)}
                  </datalist>
                  <p className="mt-1 text-15 text-ink-muted">A label on their card and in signature blocks. It decides nothing.</p>
                </div>
              </div>

              {alreadyMember && (
                <Alert kind="warning" title={`${alreadyMember.name} already works here`}>
                  They are {roleLabel(alreadyMember.role).toLowerCase()} at this firm. An invitation
                  to the same address still works, and accepting it would set their role to{" "}
                  {roleLabel(inviteRole).toLowerCase()} — accept_staff_invite() writes the
                  membership on conflict. If a role change is what you want, change it on their card
                  below instead; that goes through set_member_role(), which protects the last owner
                  and refuses what an administrator may not do.
                </Alert>
              )}

              {alreadyInvited && !alreadyMember && (
                <Alert kind="warning" title="There is already an open invitation to that address">
                  It was created on {day.format(new Date(alreadyInvited.createdAt))} as{" "}
                  {roleLabel(alreadyInvited.role).toLowerCase()} and its link still works. A second
                  invitation leaves two live links to the same person; send the one below, or cancel
                  it first.
                </Alert>
              )}

              {inviteError && (
                <Alert kind="error" title="The database refused that invitation">
                  {inviteError}
                </Alert>
              )}

              <Button type="submit" size="lg" disabled={inviting} className="w-full sm:w-auto">
                {inviting ? "Creating the invitation…" : "Create the invitation"}
              </Button>
            </form>

            {minted && (
              <div className="rounded-lg border border-settled-line bg-settled-bg p-4">
                <p className="text-15 font-semibold text-settled-ink">
                  Invitation created for {minted.email} as {roleLabel(minted.role).toLowerCase()}.
                </p>
                {minted.notice ? (
                  <p className="mt-1 text-15 text-settled-ink">{minted.notice}</p>
                ) : (
                  <>
                    <p className="mt-1 text-15 text-settled-ink">
                      Docket does not send this. Send the link yourself — it is the invitation.
                    </p>
                    <p className="mt-2 break-all rounded border border-settled-line bg-raised px-3 py-2 text-13 text-settled-ink">
                      {mintedLink || `${JOIN_PATH}?token=…`}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <CopyLink url={mintedLink} />
                      <a
                        href={`mailto:${encodeURIComponent(minted.email)}?subject=${encodeURIComponent(
                          `Join ${firmName} on Docket`,
                        )}&body=${encodeURIComponent(mintedMessage)}`}
                        className="inline-flex min-h-[44px] items-center rounded-lg border border-settled-line px-3 text-15 font-medium text-settled-ink hover:bg-hover"
                      >
                        Open in your email app
                      </a>
                    </div>
                  </>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* ------------------------------------------------------------------ the firm's people */}
      <Card>
        <CardHeader
          title="Who works here"
          action={<Badge>{people.length === 1 ? "1 person" : `${people.length} people`}</Badge>}
        />
        <CardBody className="space-y-3">
          {people.length === 0 ? (
            <EmptyState
              title="Nobody is listed as a member of this firm"
              hint="That should be impossible while you are signed in to it: firm_members_select is is_firm_member(firm_id), so an empty list here means the membership this console is using has gone. Sign out and in again, and tell Docket if it stays empty."
              action={
                <Link href="/firm" className="min-h-[44px] py-2.5 font-medium text-brand underline">
                  Back to Today
                </Link>
              }
            />
          ) : (
            people.map((p) => {
              const blockedRole = roleChangeBlocked(p);
              const blockedRemoval = removalBlocked(p);
              const draft = roleDraft[p.userId] ?? p.role;
              const busy = working === p.userId;
              const customRole = p.customRoleKey ? roleByKey.get(p.customRoleKey) ?? null : null;
              const canEditTitle = (p.isYou && callerCanWriteSelf) || canManageTeam;
              return (
                <div
                  key={p.userId}
                  className={cn(
                    "rounded-lg border p-4",
                    p.isYou ? "border-brand/30 bg-brand-surface/40" : "border-hairline bg-raised",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">
                        {p.name}
                        {p.isYou && <span className="ml-2 text-15 font-normal text-brand">(this is you)</span>}
                      </p>
                      {p.memberTitle && <p className="text-15 text-ink">{p.memberTitle}</p>}
                      {p.title && <p className="text-15 text-ink-muted">{p.title}</p>}
                      <p className="break-all text-15 text-ink-muted">{p.email ?? "No email address on their profile"}</p>
                      {p.phone && <p className="text-15 text-ink-muted">{p.phone}</p>}
                      {p.scn && <p className="text-15 text-ink-muted">Enrolment number {p.scn}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className="bg-sunken text-ink">{roleLabel(p.role)}</Badge>
                      {customRole && <Badge tone="informing" icon="dot">{customRole.label}</Badge>}
                    </div>
                  </div>

                  <p className="mt-2 text-15 text-ink-muted">{roleHint(p.role)}</p>

                  <ul className="mt-2 space-y-1 text-15 text-ink-muted">
                    <li>
                      {p.role === "owner"
                        ? "Holds every permission, always. Nothing can narrow an owner."
                        : `May: ${p.effective.map((k) => PERMISSIONS.find((x) => x.key === k)?.label ?? k).join(", ") || "nothing"}.`}
                    </li>
                    <li>
                      {p.availabilityRules > 0
                        ? `${p.availabilityRules} weekly availability ${p.availabilityRules === 1 ? "rule" : "rules"} — clients can book them.`
                        : "No weekly availability, so nothing of theirs can be booked."}
                    </li>
                    <li>
                      {p.isPublic
                        ? "On the firm's public site."
                        : p.hasLawyerProfile
                          ? "Has a lawyer profile, kept off the public site."
                          : "No lawyer profile."}
                    </li>
                    <li>
                      {p.futureConsultations > 0
                        ? `${p.futureConsultations} consultation${p.futureConsultations === 1 ? "" : "s"} still to come.`
                        : "No consultations still to come."}
                    </li>
                  </ul>

                  {rowError?.id === p.userId && (
                    <Alert kind="error" title="The database refused that" className="mt-3">
                      {rowError.message}
                    </Alert>
                  )}
                  {rowDone?.id === p.userId && (
                    <Alert kind="success" title="Done" className="mt-3">
                      {rowDone.message}
                    </Alert>
                  )}

                  {canEditTitle && (
                    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-hairline pt-3">
                      <div className="min-w-[12rem] flex-1">
                        <label htmlFor={`title-${p.userId}`} className={labelClass}>Title</label>
                        <input
                          id={`title-${p.userId}`}
                          list="member-titles"
                          maxLength={80}
                          value={titleDraft[p.userId] ?? p.memberTitle ?? ""}
                          onChange={(e) => setTitleDraft({ ...titleDraft, [p.userId]: e.currentTarget.value })}
                          className={field}
                          placeholder="Managing Partner, Associate, Paralegal…"
                        />
                      </div>
                      <Button variant="ghost" size="lg" disabled={busy || (titleDraft[p.userId] ?? p.memberTitle ?? "") === (p.memberTitle ?? "")} onClick={() => saveTitle(p)}>
                        {busy ? "Saving…" : "Save the title"}
                      </Button>
                    </div>
                  )}

                  {canManageTeam && (
                    <div className="mt-3 space-y-3 border-t border-hairline pt-3">
                      {blockedRole ? (
                        <p className="text-15 text-ink-muted">{blockedRole}</p>
                      ) : (
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="min-w-[12rem] flex-1">
                            <label htmlFor={`role-${p.userId}`} className={labelClass}>
                              Role
                            </label>
                            <select
                              id={`role-${p.userId}`}
                              value={draft}
                              onChange={(e) =>
                                setRoleDraft({ ...roleDraft, [p.userId]: e.currentTarget.value })
                              }
                              className={field}
                            >
                              {grantableRoles.map((r) => (
                                <option key={r.value} value={r.value}>
                                  {r.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <Button
                            variant="ghost"
                            size="lg"
                            disabled={busy || draft === p.role}
                            onClick={() => saveRole(p)}
                          >
                            {busy ? "Saving…" : "Save the role"}
                          </Button>
                        </div>
                      )}

                      {p.role !== "owner" && !p.isYou && customRoles.length > 0 && (
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="min-w-[12rem] flex-1">
                            <label htmlFor={`custom-${p.userId}`} className={labelClass}>The firm&rsquo;s own role</label>
                            <select
                              id={`custom-${p.userId}`}
                              value={customDraft[p.userId] ?? p.customRoleKey ?? ""}
                              onChange={(e) => setCustomDraft({ ...customDraft, [p.userId]: e.currentTarget.value })}
                              className={field}
                            >
                              <option value="">None: the {roleLabel(p.role).toLowerCase()} defaults</option>
                              {customRoles.map((r) => (
                                <option key={r.key} value={r.key}>{r.label}</option>
                              ))}
                            </select>
                          </div>
                          <Button
                            variant="ghost"
                            size="lg"
                            disabled={busy || (customDraft[p.userId] ?? p.customRoleKey ?? "") === (p.customRoleKey ?? "")}
                            onClick={() => saveCustomRole(p)}
                          >
                            {busy ? "Saving…" : "Save"}
                          </Button>
                        </div>
                      )}

                      {p.role !== "owner" && !p.isYou && (
                        <PermissionsEditor
                          firmId={firmId}
                          person={p}
                          customRole={customRole}
                          onSaved={(message) => report(p.userId, message)}
                        />
                      )}

                      {blockedRemoval ? (
                        <p className="text-15 text-ink-muted">
                          {blockedRemoval}
                          {p.futureConsultations > 0 && (
                            <>
                              {" "}
                              <Link href="/firm/appointments" className="font-medium text-brand underline">
                                Open the consultations diary
                              </Link>
                              .
                            </>
                          )}
                        </p>
                      ) : confirmingRemoval === p.userId ? (
                        <div className="rounded-lg border border-wrong-line bg-wrong-bg p-3">
                          <p className="text-15 font-semibold text-wrong-ink">Remove {p.name} from {firmName}?</p>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-15 text-wrong-ink">
                            <li>
                              {p.availabilityRules > 0
                                ? `Their bookable week goes: ${p.availabilityRules} availability ${p.availabilityRules === 1 ? "rule" : "rules"} and every exception are deleted, and no client can book them again.`
                                : "They have no availability rules, so there is no bookable week to clear."}
                            </li>
                            <li>
                              {p.isPublic
                                ? "Their profile comes off the firm's public site straight away."
                                : "Their lawyer profile is already off the public site and stays off."}
                            </li>
                            <li>They lose the console. Matters, notes, updates and past consultations stay exactly where they are, with their name still on them.</li>
                            <li>This cannot be undone here. Bringing them back means a fresh invitation.</li>
                          </ul>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button variant="danger" size="lg" disabled={busy} onClick={() => remove(p)}>
                              {busy ? "Removing…" : `Yes, remove ${p.name}`}
                            </Button>
                            <Button variant="ghost" size="lg" onClick={() => setConfirmingRemoval(null)}>
                              Keep them
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button variant="ghost" size="lg" onClick={() => setConfirmingRemoval(p.userId)}>
                          Remove from the firm
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------------ the firm's own roles */}
      {(canWrite || customRoles.length > 0) && (
        <CustomRolesCard firmId={firmId} roles={customRoles} canManageTeam={canManageTeam} onDone={(m) => { setOutcome(m); }} />
      )}

      {/* ------------------------------------------------------------------ open invitations */}
      <Card>
        <CardHeader
          title="Invitations that have not been used"
          action={invites.length > 0 ? <Badge>{invites.length}</Badge> : undefined}
        />
        <CardBody className="space-y-3">
          {invites.length === 0 ? (
            suspended ? (
              <EmptyState
                title="Outstanding invitations cannot be read while this firm is suspended"
                hint="staff_invites_select is admin_w(firm_id), and admin_w() is false on a suspended firm. There may be invitations open; this list cannot say. Docket lifts the suspension and they reappear."
              />
            ) : !isAdmin ? (
              <EmptyState
                title="Outstanding invitations are readable by an owner or an administrator only"
                hint="staff_invites_select is admin_w(firm_id), so this list is empty for your account rather than short. Ask an owner or an administrator what is outstanding."
              />
            ) : (
              <EmptyState
                title="Nobody is waiting to join"
                hint="An invitation that has been accepted moves up into the list of people. Invite a colleague above and their link appears here until they use it."
              />
            )
          ) : (
            invites.map((i) => {
              const url = linkFor(i.token);
              const busy = working === i.id;
              return (
                <div key={i.id} className="rounded-lg border border-hairline p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-all font-medium text-ink">{i.email}</p>
                      <p className="text-15 text-ink-muted">
                        Invited as {roleLabel(i.role).toLowerCase()}{i.title ? ` (${i.title})` : ""}
                        {i.invitedBy ? ` by ${i.invitedBy}` : ""} on {day.format(new Date(i.createdAt))}
                      </p>
                    </div>
                    <Badge tone={i.expired ? "wrong" : "waiting"} icon={i.expired ? "close" : "clock"}>
                      {i.expired ? "expired" : "waiting"}
                    </Badge>
                  </div>

                  <p className="mt-2 text-15 text-ink-muted">
                    {i.expired
                      ? `This link stopped working on ${fmt.format(new Date(i.expiresAt))}. accept_staff_invite() refuses it with “invite invalid or expired”. Cancel it and invite them again.`
                      : `The link works until ${fmt.format(new Date(i.expiresAt))}.`}
                  </p>

                  {!i.expired && (
                    <>
                      <p className="mt-2 break-all rounded border border-hairline bg-sunken px-3 py-2 text-13 text-ink">
                        {url || `${JOIN_PATH}?token=…`}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <CopyLink url={url} />
                        <a
                          href={`mailto:${encodeURIComponent(i.email)}?subject=${encodeURIComponent(
                            `Join ${firmName} on Docket`,
                          )}&body=${encodeURIComponent(
                            `${firmName} has invited you to join its Docket console as ${roleLabel(i.role).toLowerCase()}. Open this link, sign in with ${i.email}, and accept: ${url}`,
                          )}`}
                          className="inline-flex min-h-[44px] items-center rounded-lg border border-edge px-3 text-15 font-medium text-brand hover:bg-hover"
                        >
                          Open in your email app
                        </a>
                      </div>
                    </>
                  )}

                  {rowError?.id === i.id && (
                    <Alert kind="error" title="The database refused that" className="mt-3">
                      {rowError.message}
                    </Alert>
                  )}

                  {canManageTeam && (
                    <div className="mt-3">
                      {confirmingRemoval === i.id ? (
                        <div className="rounded-lg border border-wrong-line bg-wrong-bg p-3">
                          <p className="text-15 text-wrong-ink">
                            Cancelling deletes the invitation, so its link stops working at once. If
                            they have already been sent it, tell them — they will otherwise meet
                            “invite invalid or expired”.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button variant="danger" size="lg" disabled={busy} onClick={() => cancelInvite(i)}>
                              {busy ? "Cancelling…" : "Yes, cancel it"}
                            </Button>
                            <Button variant="ghost" size="lg" onClick={() => setConfirmingRemoval(null)}>
                              Leave it open
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button variant="ghost" size="lg" onClick={() => setConfirmingRemoval(i.id)}>
                          Cancel this invitation
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardBody>
      </Card>
    </div>
  );
}
