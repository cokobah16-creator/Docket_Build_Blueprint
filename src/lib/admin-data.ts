// Shared reads for the PLATFORM console at /admin. The firm console has its own (firm-data.ts);
// this is the other side of the wall.
//
// A platform admin has no row-level access to firms, notifications, payments or anything a firm
// works on. Everything below reads a definer view or an RPC that decides for itself, which is
// why there are so few queries here: the narrow surface is the point, not a limitation.

import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
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
export async function platformFirms(supabase: SupabaseClient, limit = 200): Promise<FirmAdminRow[]> {
  const { data } = await supabase
    .from("firm_admin")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as FirmAdminRow[];
}

/** Domain requests across every firm, newest first. */
export async function domainRequests(supabase: SupabaseClient, limit = 100): Promise<DomainRequestRow[]> {
  const { data } = await supabase
    .from("domain_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as DomainRequestRow[];
}

/**
 * The notification queue, grouped. Counts, errors and timing — never a payload and never a
 * recipient, which is what the view itself enforces.
 */
export async function notificationHealth(supabase: SupabaseClient): Promise<NotificationHealthRow[]> {
  const { data } = await supabase
    .from("platform_notification_health")
    .select("*")
    .order("rows", { ascending: false })
    .limit(200);
  return (data ?? []) as NotificationHealthRow[];
}

/** Payments that did not settle cleanly, down to what reconciling one needs and no further. */
export async function settlementHealth(supabase: SupabaseClient, limit = 100): Promise<SettlementHealthRow[]> {
  const { data } = await supabase
    .from("platform_settlement_health")
    .select("*")
    // paid_at is null on every row this view can hold — record_payment only writes it on success
    // — so recency comes from payments.created_at, which migration 20 added for exactly this.
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as SettlementHealthRow[];
}

/**
 * Failed notifications one at a time, because the grouped health view has no id and a message
 * cannot be put back in the queue without one. Still no payload and no recipient.
 */
export async function failedNotifications(
  supabase: SupabaseClient,
  limit = 100,
): Promise<FailedNotificationRow[]> {
  const { data } = await supabase
    .from("platform_failed_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as FailedNotificationRow[];
}

/** What providers sent us. `badOnly` is the view an operator actually wants. */
export async function webhookEvents(
  supabase: SupabaseClient,
  opts: { badOnly?: boolean; limit?: number } = {},
): Promise<WebhookEventRow[]> {
  let q = supabase.from("webhook_events").select("*");
  if (opts.badOnly) q = q.neq("outcome", "processed");
  const { data } = await q.order("received_at", { ascending: false }).limit(opts.limit ?? 100);
  return (data ?? []) as WebhookEventRow[];
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
