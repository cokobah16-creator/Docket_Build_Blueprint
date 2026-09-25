// The visitor's analytics choice, as one cookie.
//
// EDGE-SAFE ON PURPOSE. middleware.ts reads this before it decides whether to mint the visitor
// cookie, and middleware runs on the edge, where next/headers does not exist. So this module
// imports nothing. The server-side reader that does use next/headers is
// src/lib/observability/consent.ts; the writer is src/lib/actions/cookie-consent.ts; the banner
// that asks is src/components/ui/cookie-banner.tsx.
//
// NOT httpOnly. The platform landing page is prerendered (src/lib/csp.ts), so no server code runs
// when it is served and the banner has to read the choice in the browser to know whether to ask.
// The value is only ever the version and one of two words, so script reading it learns nothing a
// visitor did not choose to say.
//
// THE VERSION. A stored choice counts only if it was made against the current version. Bump
// CONSENT_VERSION when what "Allow analytics" means changes, and every visitor is asked again.

/** The cookie that holds the choice. */
export const CONSENT_COOKIE = "docket_consent";

/** Bump when the choice means something new; older choices then count as no choice. */
export const CONSENT_VERSION = 1;

/** One year, the same as the visitor cookie it governs. */
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 365;

/** The window event that reopens the banner (CookieSettingsButton sends it). */
export const COOKIE_SETTINGS_EVENT = "docket:cookie-settings";

export interface ConsentState {
  /** A choice for the current version is stored. */
  decided: boolean;
  /** The visitor chose "Allow analytics". False when undecided. */
  analytics: boolean;
}

const UNDECIDED: ConsentState = { decided: false, analytics: false };

/** The cookie value for a choice: "1.analytics" or "1.necessary". */
export function consentValue(analytics: boolean): string {
  return `${CONSENT_VERSION}.${analytics ? "analytics" : "necessary"}`;
}

/**
 * Read a stored value. Anything missing, malformed or from another version is no choice, and no
 * choice never allows analytics.
 */
export function parseConsent(value: string | null | undefined): ConsentState {
  if (!value) return UNDECIDED;
  let raw = value.trim();
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return UNDECIDED;
  }
  const match = /^(\d+)\.(analytics|necessary)$/.exec(raw);
  if (!match || Number(match[1]) !== CONSENT_VERSION) return UNDECIDED;
  return { decided: true, analytics: match[2] === "analytics" };
}

/** The choice from a whole Cookie header, or from document.cookie in the browser. */
export function consentFromCookieHeader(header: string | null | undefined): ConsentState {
  if (!header) return UNDECIDED;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === CONSENT_COOKIE) return parseConsent(part.slice(eq + 1));
  }
  return UNDECIDED;
}

/**
 * Is product analytics switched on for this deployment at all? Server and edge only: POSTHOG_KEY
 * is not NEXT_PUBLIC_, so in a browser bundle this is always false. Server components pass the
 * answer down as a prop instead.
 */
export function analyticsConfigured(): boolean {
  return Boolean(process.env.POSTHOG_KEY);
}
