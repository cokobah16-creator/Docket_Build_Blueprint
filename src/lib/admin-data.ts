// Shared reads for the PLATFORM console at /admin. The firm console has its own (firm-data.ts);
// this is the other side of the wall.
//
// A platform admin has no row-level access to firms, notifications, payments or anything a firm
// works on. Everything below reads a definer view or an RPC that decides for itself, which is
// why there are so few queries here: the narrow surface is the point, not a limitation.

import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * What every list reader returns. `error` is set when the QUERY failed — a missing view, a
 * permission refusal, a connection dropped — and a screen must show that as a failure, never as an
 * empty list. In `rows` alone, "nothing is waiting" and "the read did not happen" are identical, and
 * an operator told the first when the truth is the second goes home while a misdirected payment
 * sits unreconciled. Empty and failed are different states; they get different screens.
 */
export interface Read<T> {
  rows: T[];
  error: string | null;
}
import type {
  DomainRequestRow, FailedNotificationRow, FirmAdminRow, NotificationHealthRow,
  SettlementHealthRow, WebhookEventRow,
} from "@/lib/db/types";

export interface PlatformContext {
  supabase: SupabaseClient;
  userId: string;
  timezone: string;
}

/**
 * The /admin per-request context. Returns null when Supabase is not configured, nobody is
 * signed in, or the caller is not a platform admin — the layout turns each of those into its
 * own message, because they are three different problems.
 *
 * The aal2 check is the layout's, not this function's: a redirect belongs to a route.
 */
export async function platformContext(): Promise<PlatformContext | null> {
  const supabase = await supabaseServer();
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // platform_admins_self is `user_id = auth.uid()`, so this row exists only for the caller.
  const [{ data: row }, { data: profile }] = await Promise.all([
    supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
  ]);
  if (!row) return null;

  return {
    supabase,
    userId: user.id,
    timezone: (profile as { timezone: string } | null)?.timezone ?? "Africa/Lagos",
  };
}

/** Every firm on Docket, lifecycle only. This view is the platform's whole read of firms. */
export async function platformFirms(supabase: SupabaseClient, limit = 200): Promise<Read<FirmAdminRow>> {
  const { data, error } = await supabase
    .from("firm_admin")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return { rows: (data ?? []) as FirmAdminRow[], error: error?.message ?? null };
}

/** Domain requests across every firm, newest first. */
export async function domainRequests(supabase: SupabaseClient, limit = 100): Promise<Read<DomainRequestRow>> {
  const { data, error } = await supabase
    .from("domain_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return { rows: (data ?? []) as DomainRequestRow[], error: error?.message ?? null };
}

/**
 * The notification queue, grouped. Counts, errors and timing — never a payload and never a
 * recipient, which is what the view itself enforces.
 */
export async function notificationHealth(supabase: SupabaseClient): Promise<Read<NotificationHealthRow>> {
  const { data, error } = await supabase
    .from("platform_notification_health")
    .select("*")
    .order("rows", { ascending: false })
    .limit(200);
  return { rows: (data ?? []) as NotificationHealthRow[], error: error?.message ?? null };
}

/** Payments that did not settle cleanly, down to what reconciling one needs and no further. */
export async function settlementHealth(supabase: SupabaseClient, limit = 100): Promise<Read<SettlementHealthRow>> {
  const { data, error } = await supabase
    .from("platform_settlement_health")
    .select("*")
    // paid_at is null on every row this view can hold — record_payment only writes it on success
    // — so recency comes from payments.created_at, which migration 20 added for exactly this.
    .order("created_at", { ascending: false })
    .limit(limit);
  return { rows: (data ?? []) as SettlementHealthRow[], error: error?.message ?? null };
}

/**
 * Failed notifications one at a time, because the grouped health view has no id and a message
 * cannot be put back in the queue without one. Still no payload and no recipient.
 */
export async function failedNotifications(
  supabase: SupabaseClient,
  limit = 100,
): Promise<Read<FailedNotificationRow>> {
  const { data, error } = await supabase
    .from("platform_failed_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return { rows: (data ?? []) as FailedNotificationRow[], error: error?.message ?? null };
}

/** What providers sent us. `badOnly` is the view an operator actually wants. */
export async function webhookEvents(
  supabase: SupabaseClient,
  opts: { badOnly?: boolean; limit?: number } = {},
): Promise<Read<WebhookEventRow>> {
  let q = supabase.from("webhook_events").select("*");
  if (opts.badOnly) q = q.neq("outcome", "processed");
  const { data, error } = await q.order("received_at", { ascending: false }).limit(opts.limit ?? 100);
  return { rows: (data ?? []) as WebhookEventRow[], error: error?.message ?? null };
}

/**
 * Where this deployment is, so a domain screen can tell an operator which host to point DNS at
 * instead of making them guess. Falls back to the request's own host.
 */
export async function deploymentHost(): Promise<string> {
  const configured = process.env.APP_URL;
  if (configured) {
    try { return new URL(configured).host; } catch { /* fall through to the request */ }
  }
  const h = await headers();
  return h.get("x-forwarded-host") ?? h.get("host") ?? "";
}
