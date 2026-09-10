// Rate limiting, keyed on whoever the caller actually is.
//
// The decision lives in Postgres (rate_limit_hit, migration 21) because the three surfaces that
// need limiting run in three different runtimes and the database is the only thing they share.
// This module is the Next.js half: it works out the key and asks.
//
// Postgres cannot see a request's IP — nothing in this codebase passes headers down — so:
//  · a signed-in caller is keyed on auth.uid() INSIDE the function, where it cannot be forged;
//  · an anonymous caller is keyed on a hash of the client address, computed here.
//
// The hash matters. A raw IP is personal data under the NDPR and does not need to be stored to
// count requests, so only its digest ever reaches the database.

import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/** How long a window lasts and how many requests it allows, per surface. */
export const LIMITS = {
  /** Anonymous slot browsing on the booking wizard. */
  slots: { limit: 120, window: "1 minute" },
  /** Actually taking a slot. Low, and per person. */
  booking: { limit: 10, window: "1 hour" },
  /** Starting a checkout — each one creates a Paystack transaction. */
  checkout: { limit: 20, window: "1 hour" },
  /** Redeeming an invitation, staff or client. */
  invite: { limit: 20, window: "1 hour" },
  /** Registering a firm. */
  firm_start: { limit: 5, window: "1 hour" },
  /** A webhook whose signature did not verify. */
  webhook_bad: { limit: 60, window: "1 minute" },
} as const;

export type LimitedSurface = keyof typeof LIMITS;

/**
 * The leftmost hop in x-forwarded-for is the client as Vercel saw it. Everything after it is a
 * proxy, and anything a caller sets themselves lands further right, so only the first is read.
 */
async function clientKey(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || h.get("x-real-ip") || "";
  if (!ip) return "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`docket:${ip}`));
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Returns true when the caller may proceed, false when they have had their allowance.
 *
 * Fails OPEN: if the check itself errors, the request continues. A limiter that takes the site
 * down when the database hiccups is worse than one that misses a burst.
 */
export async function allow(
  supabase: SupabaseClient,
  surface: LimitedSurface,
  signedIn: boolean,
): Promise<boolean> {
  const { limit, window } = LIMITS[surface];
  try {
    const { data, error } = await supabase.rpc("rate_limit_hit", {
      p_bucket: surface,
      p_limit: limit,
      p_window: window,
      // A signed-in caller is keyed on their own id inside the function; the key is ignored there.
      p_key: signedIn ? null : await clientKey(),
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

/** The sentence a person sees when they have been going too fast. */
export function tooFast(surface: LimitedSurface): string {
  const { limit, window } = LIMITS[surface];
  return `That is more than ${limit} attempts in ${window.replace("1 ", "a ")}. Wait a moment and try again.`;
}
