// The gate every PostHog event passes through.
//
// Analytics runs for a request only when two things are true: POSTHOG_KEY is set, and the browser
// making the request has stored "Allow analytics" in the docket_consent cookie
// (src/lib/consent-cookie.ts). Without both, nothing is sent: no event, no $identify.
//
// NOT EXPORTED FROM ../observability's index, for the reason stitch.ts gives: that barrel is
// imported by middleware.ts on the edge, where next/headers does not exist. Import this module by
// its own path.
//
// cookies() IS READ FIRST AND ALWAYS, even when POSTHOG_KEY is unset and the answer is already
// known. The tenant layout relies on reading it to render per request (see its header), and a
// helper that skipped the read when analytics was off would quietly let that route go static.
// For the same reason nothing here catches: the error cookies() throws during a static render is
// how Next.js learns the route is dynamic.

import { cookies } from "next/headers";
import { VISITOR_COOKIE } from "@/lib/observability";
import { CONSENT_COOKIE, analyticsConfigured, parseConsent } from "@/lib/consent-cookie";

type CookieJar = { getAll(): Array<{ name: string; value: string }> };

function read(jar: CookieJar, name: string): string | undefined {
  return jar.getAll().find((c) => c.name === name)?.value;
}

function allowedIn(jar: CookieJar): boolean {
  return analyticsConfigured() && parseConsent(read(jar, CONSENT_COOKIE)).analytics;
}

/** May an analytics event be sent on behalf of the browser making this request? */
export async function analyticsAllowed(): Promise<boolean> {
  return allowedIn(await cookies());
}

/**
 * The anonymous visitor id to count this request under, or null. Null when analytics is off, when
 * this browser has not allowed it, or when the middleware has not minted an id yet.
 */
export async function consentedVisitorId(): Promise<string | null> {
  const jar = await cookies();
  if (!allowedIn(jar)) return null;
  return read(jar, VISITOR_COOKIE) || null;
}
