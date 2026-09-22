// Where to send someone who is not signed in, and how they get back.
//
// THE PROBLEM THIS SOLVES. Docket sends people links to individual pages: the pay-by-link a firm
// copies off an invoice (/app/payments/<id>), a push or email notification
// (src/lib/notifications-copy.ts), an invitation to a matter. Every one of those lands on a page
// that checks the session and, finding none, sent the visitor to a bare /app/login — which then
// dropped them on the portal home screen. The invoice they were asked to pay was never mentioned
// again. Forty-one gates did this; two remembered to pass the destination on.
//
// So the destination is not something each gate has to remember any more. The middleware stamps
// the path it is serving on the request; loginPath() (src/lib/auth-redirect-server.ts) reads it
// back and hangs it off the sign-in URL as ?next=, and the sign-in screens return there.
//
// WHAT IS NOT THREADED. Signing out is a decision, not an interruption — those redirects stay
// bare, so "sign out" never means "sign back in and carry on where you were".
//
// THE HEADER IS OURS, NEVER THE CALLER'S. x-pathname is deleted from every inbound request in
// middleware.ts (CLIENT_SPOOFABLE) and re-set only from the URL the middleware itself resolved.
// safeNext() is applied on the way out and again on the way back in all the same, because a
// redirect target read off a request is exactly the shape an open redirect takes.
//
// THIS HALF IMPORTS NOTHING, like src/lib/staff-firm.ts and for the same reason: middleware.ts
// needs the header name, and middleware runs on the edge, where next/headers does not exist.
// Anything that has to read a request lives in auth-redirect-server.ts next door.

/** The request header the middleware stamps with the path (and query) being served. */
export const PATHNAME_HEADER = "x-pathname";

/** Which sign-in screen: clients have one, staff and the platform consoles share the other. */
export type Surface = "client" | "staff";

export const LOGIN_PATH: Record<Surface, string> = {
  client: "/app/login",
  staff: "/firm/login",
};

/** Where the two-factor challenge lives. Staff reach the console through it, never around it. */
export const MFA_PATH = "/firm/security/mfa";

/**
 * A redirect target we are willing to honour, or null.
 *
 * Same-origin paths only. "//evil.example" and "https://evil.example" are both rejected: the
 * first is a protocol-relative URL that a browser follows off-site, and it is the one an origin
 * check written as `startsWith("/")` lets through. Backslashes go too — some browsers normalise
 * "/\evil.example" the same way.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  // URL parsers discard tabs and newlines before resolving the destination. A decoded
  // ?next=/%09/evil.example would otherwise become a protocol-relative redirect.
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  try {
    const resolved = new URL(raw, "https://docket.invalid");
    if (resolved.origin !== "https://docket.invalid") return null;
  } catch {
    return null;
  }
  // Neither sign-in screen is a destination, and nor is the two-factor one: returning to a page
  // someone has just come through would loop them back into it.
  const path = raw.split("?")[0];
  if (path === LOGIN_PATH.client || path === LOGIN_PATH.staff || path === MFA_PATH) return null;
  return raw;
}

/**
 * Which sign-in screen a path belongs behind.
 *
 * /auth/callback is shared — the client's magic link and, now, a staff password-recovery link both
 * land on it — so when it has to send somebody back to sign in, "back" is not one fixed place. It
 * was, briefly: the failure redirect was written as loginHref("client", next), which would have
 * dropped a lawyer whose recovery link expired onto the client portal's sign-in screen, asking for
 * the phone number of a person who does not have one here.
 */
export function surfaceFor(path: string | null | undefined): Surface {
  const p = path ?? "";
  const staff = ["/firm", "/admin", "/registry"];
  return staff.some((prefix) => p === prefix || p.startsWith(`${prefix}/`)) ? "staff" : "client";
}

/** The sign-in URL for a surface, carrying `next` when there is one worth carrying. */
export function loginHref(surface: Surface, next?: string | null): string {
  const target = safeNext(next);
  return target
    ? `${LOGIN_PATH[surface]}?next=${encodeURIComponent(target)}`
    : LOGIN_PATH[surface];
}

/**
 * The two-factor URL, carrying the destination on.
 *
 * Signing in is two gates for staff, not one: the password screen, then this. A `next` that
 * survived the first gate and died at the second would still land a lawyer on the console home
 * instead of the sitting they were sent a link to, so it is threaded through both.
 */
export function mfaHref(next?: string | null): string {
  const target = safeNext(next);
  return target ? `${MFA_PATH}?next=${encodeURIComponent(target)}` : MFA_PATH;
}
