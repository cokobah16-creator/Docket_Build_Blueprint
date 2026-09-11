// Shared reads for the staff console. Every query runs as the signed-in staff
// member; RLS (is_firm_member / staff_w) is the authorization, and the console
// layout has already proved session + aal2 + membership before any of this runs.

import { cookies, headers } from "next/headers";
import { STAFF_FIRM_COOKIE } from "@/lib/staff-firm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import type {
  AvailabilityRule, CourtRow, FirmMembership, FirmOverview, FirmRoleName,
  MatterRow, MatterStatus, SittingDue,
} from "@/lib/db/types";

export interface StaffMember {
  user_id: string;
  role: FirmRoleName;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  scn: string | null;
  title: string | null;
}

export interface StaffContext {
  supabase: SupabaseClient;
  userId: string;
  firmId: string;
  firmName: string;
  role: FirmRoleName;
  timezone: string;
  memberships: FirmMembership[];
  isAdmin: boolean;
}

/**
 * The console's per-request context. Returns null only when Supabase is not
 * configured or the caller is not a firm member — the layout redirects first,
 * so pages may treat null as "render the not-configured notice".
 *
 * A staff member may belong to more than one firm (counsel who moved chambers,
 * a consultant). `?firm=<id>` picks one; otherwise the first membership wins.
 */
export async function staffContext(preferredFirmId?: string): Promise<StaffContext | null> {
  const supabase = await supabaseServer();
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // firm_members_select is `is_firm_member(firm_id)`, so this query returns every
  // colleague's row as well as the caller's. Whose row is whose matters: the role
  // below is what the console offers to do, and picking a row at random would
  // offer a lawyer the owner's buttons and let the database refuse them one by
  // one. Ask the database for the firm's people through firmStaff(); here, only
  // the caller's own memberships count.
  const { data: rows } = await supabase.from("firm_members").select("firm_id, user_id, role").eq("user_id", user.id);
  const memberships = (rows ?? []) as FirmMembership[];
  if (memberships.length === 0) return null;

  // `?firm=` is documented as a slug and middleware resolves it that way, while the
  // console's own links carry the id. Both have to work, and neither may quietly
  // select a different firm than the one named: comparing a slug against uuids
  // matched nothing and fell through to the first membership, so a multi-firm
  // member could read and write under a firm the URL did not name.
  let chosen = memberships[0];
  if (preferredFirmId) {
    const byId = memberships.find((m) => m.firm_id === preferredFirmId);
    if (byId) {
      chosen = byId;
    } else {
      const wanted = preferredFirmId.toLowerCase();
      const { data: firmRows } = await supabase
        .from("firms")
        .select("id, slug")
        .in("id", memberships.map((m) => m.firm_id));
      const match = ((firmRows ?? []) as Array<{ id: string; slug: string }>).find((f) => f.slug === wanted);
      const bySlug = match ? memberships.find((m) => m.firm_id === match.id) : undefined;
      // A firm was named and it is not one of theirs. Refuse rather than act as
      // another firm behind a URL that says otherwise.
      if (!bySlug) return null;
      chosen = bySlug;
    }
  }
  const [{ data: profile }, { data: overview }] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    supabase.from("firm_overview").select("firm_id, name").eq("firm_id", chosen.firm_id).maybeSingle(),
  ]);

  return {
    supabase,
    userId: user.id,
    firmId: chosen.firm_id,
    firmName: (overview as { name: string } | null)?.name ?? "Your firm",
    role: chosen.role,
    timezone: (profile as { timezone: string } | null)?.timezone ?? "Africa/Lagos",
    memberships,
    isAdmin: chosen.role === "owner" || chosen.role === "admin",
  };
}

/** The firm's Today/Overview counters — one round trip (migration 18). */
export async function firmOverview(supabase: SupabaseClient, firmId: string): Promise<FirmOverview | null> {
  const { data } = await supabase.from("firm_overview").select("*").eq("firm_id", firmId).maybeSingle();
  return (data ?? null) as FirmOverview | null;
}

/** Past court dates with no update posted — the standing chase list. */
export async function sittingsDue(supabase: SupabaseClient, firmId: string, limit = 25): Promise<SittingDue[]> {
  const { data } = await supabase
    .from("firm_sittings_due")
    .select("*")
    .eq("firm_id", firmId)
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  return (data ?? []) as SittingDue[];
}

export async function matterStatuses(supabase: SupabaseClient, firmId: string): Promise<MatterStatus[]> {
  const { data } = await supabase
    .from("matter_statuses")
    .select("id, firm_id, key, label, colour, is_terminal")
    .eq("firm_id", firmId)
    .order("sort", { ascending: true });
  return (data ?? []) as MatterStatus[];
}

/** Everyone who can be a handling lawyer, an assignee or an invitee's contact. */
export async function firmStaff(supabase: SupabaseClient, firmId: string): Promise<StaffMember[]> {
  const { data: members } = await supabase.from("firm_members").select("user_id, role").eq("firm_id", firmId);
  const rows = (members ?? []) as Array<{ user_id: string; role: FirmRoleName }>;
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.user_id);
  const [{ data: profiles }, { data: lawyers }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, phone").in("id", ids),
    supabase.from("lawyer_profiles").select("user_id, scn, title").eq("firm_id", firmId).in("user_id", ids),
  ]);
  const byId = new Map(((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null; phone: string | null }>).map((p) => [p.id, p]));
  const lawyerById = new Map(((lawyers ?? []) as Array<{ user_id: string; scn: string | null; title: string | null }>).map((l) => [l.user_id, l]));
  return rows.map((r) => ({
    user_id: r.user_id,
    role: r.role,
    full_name: byId.get(r.user_id)?.full_name ?? null,
    email: byId.get(r.user_id)?.email ?? null,
    phone: byId.get(r.user_id)?.phone ?? null,
    scn: lawyerById.get(r.user_id)?.scn ?? null,
    title: lawyerById.get(r.user_id)?.title ?? null,
  }));
}

export function staffLabel(m: Pick<StaffMember, "full_name" | "email" | "title">): string {
  return m.full_name?.trim() || m.title?.trim() || m.email || "Colleague";
}

/** Courts this firm may point a matter at: the platform directory plus its own. */
export async function courtsFor(supabase: SupabaseClient, firmId: string): Promise<CourtRow[]> {
  const { data } = await supabase
    .from("courts")
    .select("id, firm_id, level, name, short_name, state_code, division, city, suit_number_hint, is_active")
    .eq("is_active", true)
    .or(`firm_id.is.null,firm_id.eq.${firmId}`)
    .order("sort", { ascending: true })
    .order("name", { ascending: true })
    .limit(1000);
  return (data ?? []) as CourtRow[];
}

export interface MatterListRow extends MatterRow {
  status: MatterStatus | null;
  lead_lawyer_id: string | null;
  client_names: string[];
  cause_title: string | null;
  court_id: string | null;
  originating_lawyer_id: string | null;
  handling_lawyer_id: string | null;
}

/** The firm's matters with the columns the list and the overview need. */
export async function firmMatters(
  supabase: SupabaseClient,
  firmId: string,
  opts: { statusId?: string | null; openOnly?: boolean; lawyerId?: string | null; search?: string | null; limit?: number } = {},
): Promise<MatterListRow[]> {
  const limit = opts.limit ?? 100;

  // "This lawyer's matters" means two things at once: the file is assigned to
  // them, or they are on its team. Filtering the second one in JavaScript after
  // the row limit would silently hide older files — the limit would be spent on
  // matters that are then thrown away — so each side is a query the database
  // limits for itself and the two are merged here.
  type Fetched = MatterRow & {
    cause_title: string | null;
    court_id: string | null;
    originating_lawyer_id: string | null;
    handling_lawyer_id: string | null;
  };

  const COLUMNS =
    "id, firm_id, reference, title, cause_title, type, status_id, description, next_action, next_action_owner_id, next_action_due, court_id, court_name, suit_number, next_event_at, next_event_note, opened_at, closed_at, originating_lawyer_id, handling_lawyer_id, access";

  const searchFilter = opts.search
    ? `title.ilike.%${opts.search}%,reference.ilike.%${opts.search}%,suit_number.ilike.%${opts.search}%`
    : null;

  /** Matters the lawyer is assigned to — or, with no lawyer named, all of them. */
  const assignedQuery = () => {
    let q = supabase.from("matters").select(COLUMNS).eq("firm_id", firmId).is("deleted_at", null);
    if (opts.statusId) q = q.eq("status_id", opts.statusId);
    if (opts.openOnly) q = q.is("closed_at", null);
    if (searchFilter) q = q.or(searchFilter);
    if (opts.lawyerId) q = q.eq("handling_lawyer_id", opts.lawyerId);
    return q.order("opened_at", { ascending: false }).limit(limit);
  };

  /**
   * Matters the lawyer is on the team of. The embed is how the database, rather
   * than this process, applies "on the team" BEFORE the row limit — filtering it
   * afterwards would spend the limit on matters that are then thrown away and
   * silently lose the older ones. supabase-js cannot type an embedded select on
   * an untyped client, so the rows are cast the way every other embedded read in
   * this codebase is.
   */
  const teamQuery = (lawyerId: string) => {
    let q = supabase
      .from("matters")
      .select(`${COLUMNS}, matter_lawyers!inner(user_id)`)
      .eq("firm_id", firmId)
      .is("deleted_at", null);
    if (opts.statusId) q = q.eq("status_id", opts.statusId);
    if (opts.openOnly) q = q.is("closed_at", null);
    if (searchFilter) q = q.or(searchFilter);
    q = q.eq("matter_lawyers.user_id", lawyerId);
    return q.order("opened_at", { ascending: false }).limit(limit);
  };

  let matters: Fetched[];
  if (opts.lawyerId) {
    const [assigned, team] = await Promise.all([assignedQuery(), teamQuery(opts.lawyerId)]);
    const byId = new Map<string, Fetched>();
    const rows = [
      ...((assigned.data ?? []) as unknown as Fetched[]),
      ...((team.data ?? []) as unknown as Fetched[]),
    ];
    for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);
    matters = Array.from(byId.values())
      .sort((a, b) => (a.opened_at < b.opened_at ? 1 : a.opened_at > b.opened_at ? -1 : 0))
      .slice(0, limit);
  } else {
    const { data } = await assignedQuery();
    matters = (data ?? []) as unknown as Fetched[];
  }

  if (matters.length === 0) return [];

  const ids = matters.map((m) => m.id);
  const [statuses, { data: leads }, { data: parties }] = await Promise.all([
    matterStatuses(supabase, firmId),
    supabase.from("matter_lawyers").select("matter_id, user_id, is_lead").in("matter_id", ids),
    supabase.from("matter_parties").select("matter_id, user_id, role").in("matter_id", ids),
  ]);
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const leadRows = (leads ?? []) as Array<{ matter_id: string; user_id: string; is_lead: boolean }>;
  const partyRows = (parties ?? []) as Array<{ matter_id: string; user_id: string; role: string }>;
  const partyIds = Array.from(new Set(partyRows.map((p) => p.user_id)));
  const { data: partyProfiles } = partyIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", partyIds)
    : { data: [] as Array<{ id: string; full_name: string | null }> };
  const nameById = new Map(((partyProfiles ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, p.full_name]));

  return matters.map((m) => ({
    ...m,
    status: m.status_id ? statusById.get(m.status_id) ?? null : null,
    lead_lawyer_id: leadRows.find((l) => l.matter_id === m.id && l.is_lead)?.user_id ?? null,
    client_names: partyRows.filter((p) => p.matter_id === m.id).map((p) => nameById.get(p.user_id) ?? "Client"),
  }));
}

/** Weekly availability for one lawyer, Sunday-first. */
export async function availabilityFor(supabase: SupabaseClient, firmId: string, lawyerId: string): Promise<AvailabilityRule[]> {
  const { data } = await supabase
    .from("availability_rules")
    .select("id, firm_id, lawyer_id, weekday, start_time, end_time, break_start, break_end, slot_min, max_per_day")
    .eq("firm_id", firmId)
    .eq("lawyer_id", lawyerId)
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true });
  return (data ?? []) as AvailabilityRule[];
}

/**
 * Which firm the current request is asking for, so a multi-firm member can switch.
 *
 * `?firm=` may be a slug (what middleware resolves and what the docs describe) or
 * the id (what the console's own links carry). Either is passed straight through:
 * staffContext() is the one that matches it against the caller's memberships, and
 * refuses if it names a firm that is not theirs. Failing that, the tenant header
 * middleware stamped from the host.
 */
export async function requestedFirmId(searchParams?: { firm?: string }): Promise<string | undefined> {
  if (searchParams?.firm) return searchParams.firm;
  // Set by the middleware on any console visit that carried ?firm=, so the links that follow —
  // none of which carry it — keep the member on the firm they chose. Validated against their
  // memberships by staffContext(); a stale or tampered value selects nothing.
  const remembered = (await cookies()).get(STAFF_FIRM_COOKIE)?.value;
  if (remembered) return remembered;
  const h = await headers();
  return h.get("x-firm-id") ?? undefined;
}

// Re-exported so the console's server code can keep taking everything from one
// place. Client components must import it from "@/lib/weekdays" directly: this
// module reaches for next/headers and cannot be pulled into the client graph.
export { WEEKDAYS } from "@/lib/weekdays";
