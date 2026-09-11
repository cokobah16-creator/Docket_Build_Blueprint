// Rate limiting, keyed on whoever the caller actually is.
//
// The decision lives in Postgres (rate_limit_hit, migration 21) because the surfaces that need
// limiting run in different runtimes — Next.js server actions here, a Deno Edge Function for the
// webhook — and the database is the only thing they share. This module is the Next.js half: it
// works out the key and asks.
//
// Postgres cannot see a request's IP — nothing in this codebase passes headers down — so:
//  · a signed-in caller is keyed on auth.uid() INSIDE the function, where it cannot be forged;
//  · an anonymous caller is keyed on a hash of the client address, computed here.
//
// The hash matters. A raw IP is personal data under the NDPR and does not need to be stored to
// count requests, so only its digest ever reaches the database.
//
// WHAT A LIMIT HERE IS, AND IS NOT. A check in a server action bounds the people who use the
// screen. It does not bound a caller who takes the anon key from the browser and calls the RPC
// underneath directly — every signed-in user can — so a limit that lives only here is a
// convenience, not a rule. Each entry below says where the rule actually is:
//
//   booking     — INSIDE book_appointment() (migration 23), same bucket, same count. This check is
//                 the front door; the function refuses on its own. It is the one surface where the
//                 database bounded nothing else: a direct caller could take every free slot as a
//                 fifteen-minute hold, and again when the holds released.
//   checkout    — this action is the only door. Starting a Paystack transaction needs the secret
//                 key, which never reaches a browser.
//   firm_start  — create_firm() refuses a fourth firm per account (migration 9). This slows a
//                 person down; the database already bounds what they can do.
//   invite      — accept_staff_invite() and accept_invite() consume a single-use token. Same.
//   webhook_bad — applied in the Edge Function (supabase/functions/paystack-webhook), which has
//                 its own copy of the number. Change both or neither.
//   report      — /api/report is a route handler and is the only thing that calls captureException
//                 for the browser; there is no RPC beneath it to bypass.
//
// There is deliberately NO entry for slot browsing. available_slots() is granted to anon and the
// booking wizard calls it directly, so a limit declared here would never run — and for a while one
// was declared here and never ran. If slot searches ever need a ceiling, it has to live inside
// available_slots() itself; a number in this file would be a claim the code does not keep.

import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/** How long a window lasts and how many requests it allows, per surface. */
export const LIMITS = {
  /** Actually taking a slot. Low, and per person. The rule is in book_appointment() itself. */
  booking: { limit: 10, window: "1 hour" },
  /** Starting a checkout — each one creates a Paystack transaction. */
  checkout: { limit: 20, window: "1 hour" },
  /** Redeeming an invitation, staff or client. */
  invite: { limit: 20, window: "1 hour" },
  /** Registering a firm. */
  firm_start: { limit: 5, window: "1 hour" },
  /** A webhook whose signature did not verify. */
  webhook_bad: { limit: 60, window: "1 minute" },
  /** A browser reporting its own error. Generous: a broken page can throw in a loop. */
  report: { limit: 30, window: "1 minute" },
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
