// Shared client-portal reads (server components). All queries run as the
// signed-in user; RLS scopes them to what the client may see.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatterRow, MatterStatus, UpdateRow } from "@/lib/db/types";
import { firmById } from "@/lib/tenant";

export interface MatterSummary extends MatterRow {
  status: MatterStatus | null;
  firm_name: string;
  last_update: UpdateRow | null;
  lawyer_names: string[];
}

export async function firmNamesFor(ids: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const entries = await Promise.all(unique.map(async (id) => [id, (await firmById(id))?.name ?? "Your firm"] as const));
  return Object.fromEntries(entries);
}

/** Matters the client is party to, across every firm, with status label, firm name, last update and lawyers. */
export async function clientMatters(supabase: SupabaseClient, limit = 50): Promise<MatterSummary[]> {
  const { data } = await supabase
    .from("matters")
    .select("id, firm_id, reference, title, type, status_id, description, next_action, court_name, suit_number, next_event_at, next_event_note, opened_at, closed_at")
    .is("deleted_at", null)
    .order("opened_at", { ascending: false })
    .limit(limit);
  const matters = (data ?? []) as MatterRow[];
  if (matters.length === 0) return [];
  const ids = matters.map((m) => m.id);
  const firmIds = Array.from(new Set(matters.map((m) => m.firm_id)));
  const [{ data: statusRows }, { data: updateRows }, { data: lawyerRows }, firmNames] = await Promise.all([
    supabase.from("matter_statuses").select("id, firm_id, key, label, colour, is_terminal").in("firm_id", firmIds),
    supabase.from("updates").select("id, matter_id, firm_id, kind, title, body, payload, occurred_at, created_at").in("matter_id", ids).order("occurred_at", { ascending: false }).limit(200),
    supabase.from("matter_lawyers").select("matter_id, user_id, is_lead").in("matter_id", ids),
    firmNamesFor(firmIds),
  ]);
  const statuses = new Map(((statusRows ?? []) as MatterStatus[]).map((s) => [s.id, s]));
  const lastUpdate = new Map<string, UpdateRow>();
  for (const u of (updateRows ?? []) as UpdateRow[]) if (!lastUpdate.has(u.matter_id)) lastUpdate.set(u.matter_id, u);
  const lawyerIds = Array.from(new Set(((lawyerRows ?? []) as Array<{ user_id: string }>).map((l) => l.user_id)));
  const { data: lawyerPublic } = lawyerIds.length
    ? await supabase.from("lawyer_public").select("id, full_name, title").in("id", lawyerIds)
    : { data: [] as Array<{ id: string; full_name: string | null; title: string | null }> };
  const lawyerName = new Map(((lawyerPublic ?? []) as Array<{ id: string; full_name: string | null; title: string | null }>).map((l) => [l.id, l.full_name ?? l.title ?? "Your lawyer"]));
  return matters.map((m) => ({
    ...m,
    status: m.status_id ? statuses.get(m.status_id) ?? null : null,
    firm_name: firmNames[m.firm_id] ?? "Your firm",
    last_update: lastUpdate.get(m.id) ?? null,
    lawyer_names: ((lawyerRows ?? []) as Array<{ matter_id: string; user_id: string }>).filter((l) => l.matter_id === m.id).map((l) => lawyerName.get(l.user_id) ?? "Your lawyer"),
  }));
}

export async function clientTimezone(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  return (data as { timezone: string } | null)?.timezone ?? "Africa/Lagos";
}

export function outstandingByCurrency(invoices: Array<{ currency: string; total_minor: number; paid_minor: number; status: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of invoices) {
    if (!["issued", "partially_paid", "overdue"].includes(i.status)) continue;
    out[i.currency] = (out[i.currency] ?? 0) + Math.max(0, i.total_minor - i.paid_minor);
  }
  return out;
}
