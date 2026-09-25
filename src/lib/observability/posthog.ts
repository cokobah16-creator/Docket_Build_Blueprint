// Product analytics, with no dependency.
//
// The funnel Docket cares about is five events long: a visitor lands on a firm's site, starts a
// booking, pays, attends, and becomes a matter. PostHog's ingestion endpoint takes a plain JSON
// POST, so there is nothing to install.
//
// The project key is an ingest-only write key. It is still kept server-side (POSTHOG_KEY, not
// NEXT_PUBLIC_) because every event Docket sends is emitted from a server action, a server
// component or an Edge Function — there is no browser SDK and no autocapture.
//
// Nothing here identifies a person by name, phone or email. A distinct id is either the signed-in
// user's id or the anonymous cookie the middleware mints, and firm identity travels as data.
//
// CONSENT IS CHECKED BY THE CALLER, not here. Every call site asks ./consent.ts first
// (analyticsAllowed() or consentedVisitorId()), and sends nothing unless the browser making the
// request chose "Allow analytics". capture() cannot check for itself: this module reaches
// middleware.ts through the index, on the edge, where the cookie reader in ./consent.ts cannot run.

const DEFAULT_HOST = "https://eu.i.posthog.com";

/** The five steps, named once so a typo cannot invent a sixth. */
export const FUNNEL = {
  siteViewed: "site_viewed",
  bookingStarted: "booking_started",
  bookingPaid: "booking_paid",
  consultationAttended: "consultation_attended",
  matterOpened: "matter_opened",
} as const;

/**
 * The platform's own journey, which is a different journey and deliberately not a sixth step.
 *
 * FUNNEL above is one client moving through one firm. This is a firm arriving at Docket, and the
 * two do not compose: nobody views a firm's site and then registers a firm as the next step, and
 * anything that charted Object.values(FUNNEL) as a single sequence would be nonsense if this were
 * folded in. Named here for the same reason FUNNEL is — so a typo cannot invent a variant — and
 * kept apart so the client funnel stays five steps long.
 */
export const PLATFORM = {
  firmRegistered: "firm_registered",
} as const;

export type FunnelEvent = (typeof FUNNEL)[keyof typeof FUNNEL];
export type PlatformEvent = (typeof PLATFORM)[keyof typeof PLATFORM];

function host(): string {
  return (process.env.POSTHOG_HOST ?? DEFAULT_HOST).replace(/\/+$/, "");
}

/**
 * Record one event. Returns true if it was sent.
 *
 * Never throws and never blocks a request meaningfully: with no key set it returns at once.
 * Timestamps are UTC — rendering in a person's zone is a screen's job, not telemetry's.
 */
export async function capture(
  event: FunnelEvent | PlatformEvent | string,
  distinctId: string,
  properties: Record<string, unknown> = {},
): Promise<boolean> {
  const key = process.env.POSTHOG_KEY;
  if (!key || !distinctId) return false;
  try {
    const res = await fetch(`${host()}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: distinctId,
        timestamp: new Date().toISOString(),
        properties: {
          ...properties,
          $lib: "docket",
          environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Tie the anonymous visitor who browsed the site to the account they just signed into, so the
 * funnel does not break in half at the sign-in step.
 */
export async function identify(userId: string, anonymousId: string | null): Promise<boolean> {
  if (!anonymousId || anonymousId === userId) return false;
  return capture("$identify", userId, { $anon_distinct_id: anonymousId });
}
