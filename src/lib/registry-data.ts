// Shared reads for the registry console. Every query runs as the signed-in registry member; RLS
// (is_registry_member / registry_w / registrar_w) is the authorization, and the layout at
// app/registry/layout.tsx has already proved session + aal2 + membership before any of this runs.
//
// A registry member is NOT a firm member and nothing here reaches a firm: the tables read are
// registries, registry_members, registry_notice_batches and registry_notices, none of which
// carries a firm or a matter.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import type { RegistryMemberRow, RegistryNoticeBatchRow, RegistryNoticeRow, RegistryRole, RegistryRow } from "@/lib/db/types";

export interface RegistryContext {
  supabase: SupabaseClient;
  userId: string;
  registry: RegistryRow;
  role: RegistryRole;
  courtName: string;
  timezone: string;
  /** Every registry the caller belongs to — almost always one. */
  memberships: RegistryMemberRow[];
}

/**
 * The registry console's per-request context. Null when Supabase is not configured, nobody is
 * signed in, or the caller belongs to no registry. `?registry=<id>` picks one where a person
 * belongs to more than one; otherwise the first.
 */
export async function registryContext(preferred?: string): Promise<RegistryContext | null> {
  const supabase = await supabaseServer();
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // registry_members_select admits the caller's own rows, their colleagues', and the platform's;
  // only the caller's own rows say which registries THEY act for.
  const { data: rows } = await supabase.from("registry_members").select("registry_id, user_id, role, added_by, created_at").eq("user_id", user.id);
  const memberships = (rows ?? []) as RegistryMemberRow[];
  if (memberships.length === 0) return null;
  const chosen = (preferred && memberships.find((m) => m.registry_id === preferred)) || memberships[0]!;

  const [{ data: registryRow }, { data: profile }] = await Promise.all([
    supabase.from("registries").select("*").eq("id", chosen.registry_id).maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
  ]);
  const registry = (registryRow ?? null) as RegistryRow | null;
  if (!registry) return null;
  const { data: court } = await supabase.from("courts").select("name").eq("id", registry.court_id).maybeSingle();

  return {
    supabase,
    userId: user.id,
    registry,
    role: chosen.role,
    courtName: (court as { name: string } | null)?.name ?? "the court",
    timezone: (profile as { timezone: string } | null)?.timezone ?? "Africa/Lagos",
    memberships,
  };
}

export async function registryMembers(supabase: SupabaseClient, registryId: string): Promise<Array<RegistryMemberRow & { full_name: string | null; email: string | null }>> {
  const { data } = await supabase.from("registry_members").select("registry_id, user_id, role, added_by, created_at").eq("registry_id", registryId);
  const members = (data ?? []) as RegistryMemberRow[];
  if (members.length === 0) return [];
  const { data: people } = await supabase.from("profiles").select("id, full_name, email").in("id", members.map((m) => m.user_id));
  const byId = new Map(((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p]));
  return members.map((m) => ({ ...m, full_name: byId.get(m.user_id)?.full_name ?? null, email: byId.get(m.user_id)?.email ?? null }));
}

/**
 * This registry's notices. A batch may hold 500 rows and a registry accumulates history, so this
 * read is CAPPED and the caller must treat it as a page, not as the truth about how many there
 * are. `registryDraftCounts()` below is what the Publish button counts, because a button that
 * says "Publish 300" and publishes 500 is a button that lies.
 */
export async function registryNotices(supabase: SupabaseClient, registryId: string, limit = 600): Promise<RegistryNoticeRow[]> {
  const { data } = await supabase.from("registry_notices").select("*").eq("registry_id", registryId)
    .order("status", { ascending: true })          // draft, published, withdrawn — drafts first, always
    .order("listed_on", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as RegistryNoticeRow[];
}

/**
 * How many drafts each of these batches actually holds, asked of the database rather than counted
 * from a page that may be short. One `head` count per batch, and there are rarely more than a few
 * unpublished batches.
 */
export async function registryDraftCounts(supabase: SupabaseClient, batchIds: string[]): Promise<Record<string, number>> {
  if (batchIds.length === 0) return {};
  const counts = await Promise.all(batchIds.map(async (id) => {
    const { count } = await supabase.from("registry_notices")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", id).eq("status", "draft");
    return [id, count ?? 0] as const;
  }));
  return Object.fromEntries(counts);
}

export async function registryBatches(supabase: SupabaseClient, registryId: string, limit = 50): Promise<RegistryNoticeBatchRow[]> {
  const { data } = await supabase.from("registry_notice_batches").select("*").eq("registry_id", registryId)
    .order("staged_at", { ascending: false }).limit(limit);
  return (data ?? []) as RegistryNoticeBatchRow[];
}
