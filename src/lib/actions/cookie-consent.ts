"use server";

// Saving the cookie banner's answer (src/components/ui/cookie-banner.tsx).
//
// The choice lives in the docket_consent cookie (src/lib/consent-cookie.ts) and nowhere else: it
// belongs to this browser on this site address, whoever is signed in. It is readable by script,
// because the prerendered landing page can only learn the choice in the browser.
//
// "Only necessary" also expires docket_did at once, so the visitor id does not outlive the answer
// by even one request. middleware.ts would expire it on the next request anyway; this closes the
// gap. "Allow analytics" mints nothing here: the middleware mints the id on the next request, the
// same way it does for every visitor who has allowed it.
//
// Anyone can call a server action with any argument, so only a literal true counts as consent.

import { cookies } from "next/headers";
import { VISITOR_COOKIE } from "@/lib/observability";
import { CONSENT_COOKIE, CONSENT_MAX_AGE, consentValue } from "@/lib/consent-cookie";

export async function setAnalyticsConsent(allow: boolean): Promise<void> {
  const analytics = allow === true;
  const jar = await cookies();
  jar.set(CONSENT_COOKIE, consentValue(analytics), {
    path: "/",
    maxAge: CONSENT_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
  });
  if (!analytics) jar.delete({ name: VISITOR_COOKIE, path: "/" });
}
