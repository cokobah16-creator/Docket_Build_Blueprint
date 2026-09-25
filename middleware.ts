// Host → firm resolution (blueprint §4 tenancy) and the per-request security policy.
//
// Five jobs, in this order:
//
//  1. THROW AWAY WHAT THE CALLER CLAIMED. x-firm-id and x-firm-slug are how every server
//     component learns which tenant it is serving (src/lib/firm.ts, src/lib/firm-data.ts).
//     They are request headers, and a request header is whatever the client typed. Anyone
//     could curl Docket with x-firm-id set to another firm's id and, on any path where the
//     host did not resolve, be read as that firm. So they are deleted before anything else
//     and only ever re-set from the host we resolved ourselves.
//
//  2. REFRESH THE SESSION (src/lib/supabase/middleware.ts), on the app surfaces only. A server
//     component cannot write a cookie — the response has already begun streaming by the time it
//     runs — so the rotated token a server-side getUser() receives was being thrown away, and
//     the session died about an hour into a working day. Middleware is the only place that runs
//     before the render and still owns the response. It goes before jobs 3 and 5 because it
//     rewrites the forwarded cookie header, and they only append to it.
//
//  3. STAMP THE PATH being served as x-pathname, so a page that turns an anonymous caller away
//     can say where they were going: src/lib/auth-redirect.ts hangs it off the sign-in URL as
//     ?next=. It is a header, so it is spoofable, so it is deleted inbound with the rest above
//     and set only from the URL resolved here.
//
//  4. BUILD THE CONTENT-SECURITY-POLICY, with a fresh nonce (src/lib/csp.ts). The policy has
//     to be built here rather than in next.config.mjs because the App Router streams inline
//     bootstrap scripts and a nonce is the only way to allow them without 'unsafe-inline'.
//     Next.js finds the nonce for its own script tags by reading the CSP back off the REQUEST
//     headers, so the policy is set on the request as well as the response, on BOTH branches
//     below. The nonce also travels as x-nonce so a page can put it on its own script tag.
//
//  5. MINT THE VISITOR COOKIE, BUT ONLY WITH CONSENT. The funnel in src/lib/observability counts a
//     visitor from the moment they land on a firm's site, long before they sign in, and
//     identify() later stitches that anonymous id to the account. That id is an analytics
//     cookie, so it is minted only when POSTHOG_KEY is set AND the visitor has chosen "Allow
//     analytics" (the docket_consent cookie, src/lib/consent-cookie.ts). Otherwise an id the
//     browser already holds is expired and kept out of the headers the app reads, so no server
//     code can count this request under it. The sign-in cookies, dk_firm and dk_staff_firm are
//     strictly necessary and are not touched by this step.
//
// Then the original job: rewrite public paths onto the tenant site at app/(public)/[firm].

import { NextResponse, type NextRequest } from "next/server";
import { resolveFirm } from "@/lib/tenant";
import {
  CSP_NONCE_HEADER,
  CSP_REQUEST_HEADER,
  contentSecurityPolicy,
  cspHeaderName,
  isPrerenderedShell,
  newNonce,
} from "@/lib/csp";
import { VISITOR_COOKIE } from "@/lib/observability";
import { CONSENT_COOKIE, analyticsConfigured, parseConsent } from "@/lib/consent-cookie";
import { STAFF_FIRM_COOKIE, STAFF_FIRM_MAX_AGE } from "@/lib/staff-firm";
import { PATHNAME_HEADER } from "@/lib/auth-redirect";
import { refreshSession } from "@/lib/supabase/middleware";

const APP_PREFIXES = ["/app", "/firm", "/admin", "/registry", "/auth", "/api"];

/** Headers a caller must never be able to assert. Deleted inbound, set by us or not at all. */
const CLIENT_SPOOFABLE = [
  "x-firm-id",
  "x-firm-slug",
  PATHNAME_HEADER,
  CSP_NONCE_HEADER,
  "content-security-policy",
  "content-security-policy-report-only",
];

/** One year. Long enough that a returning visitor is still the same person in the funnel. */
const VISITOR_MAX_AGE = 60 * 60 * 24 * 365;

/** A Cookie header without one cookie in it, or null when nothing is left. */
function withoutCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const kept = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && part.split("=", 1)[0].trim() !== name);
  return kept.length > 0 ? kept.join("; ") : null;
}

/** The same URL with a different path — the tenant rewrite target. */
function withPathname(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return url;
}

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  const requestHeaders = new Headers(request.headers);
  for (const header of CLIENT_SPOOFABLE) requestHeaders.delete(header);

  const isAppSurface = APP_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // Before the firm lookup and before the cookie splices below, because it rewrites the
  // forwarded cookie header wholesale and they only append to it.
  const sessionCookies = isAppSurface ? await refreshSession(request, requestHeaders) : [];

  // The path a gate sends people back to after signing in. The query goes with it: ?tab=invoices
  // and ?firm= are part of where someone was, and a return that drops them returns them somewhere
  // else. request.nextUrl, not the rewritten path — this is a destination, not an implementation.
  requestHeaders.set(PATHNAME_HEADER, `${pathname}${request.nextUrl.search}`);

  const firm = await resolveFirm(
    request.headers.get("host"),
    searchParams.get("firm"),
  );
  if (firm) {
    requestHeaders.set("x-firm-id", firm.id);
    requestHeaders.set("x-firm-slug", firm.slug);
  }
  // Public site: serve the tenant's pages from app/(public)/[firm]/… The decision is made here
  // rather than below because the policy depends on it: a firm host's "/" is a tenant page,
  // rendered per request, while the platform's own "/" is prerendered at build time.
  const rewriteToTenant =
    Boolean(firm) && !isAppSurface && !pathname.startsWith(`/${firm?.slug}`);

  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce, {
    prerendered: isPrerenderedShell(pathname, rewriteToTenant),
  });
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  // Always the enforcing name on the request: this copy never reaches the browser, it exists
  // only so Next.js can lift the nonce out of it and stamp its own scripts. In report-only mode
  // the response below carries the other name.
  requestHeaders.set(CSP_REQUEST_HEADER, policy);

  // The visitor id is an analytics cookie: it exists only while analytics is on for this
  // deployment and this visitor has allowed it.
  const analyticsOn =
    analyticsConfigured() && parseConsent(request.cookies.get(CONSENT_COOKIE)?.value).analytics;
  const existingVisitor = request.cookies.get(VISITOR_COOKIE)?.value;
  // With consent, a visitor who already has an id keeps it; a new one gets it on this response
  // and can be read on this same render, because it is spliced into the forwarded cookie header.
  const mintedVisitor = analyticsOn && !existingVisitor ? crypto.randomUUID() : null;
  if (mintedVisitor) {
    // An empty docket_did= would otherwise be read before the new id.
    const cookieHeader = withoutCookie(requestHeaders.get("cookie"), VISITOR_COOKIE);
    requestHeaders.set(
      "cookie",
      cookieHeader ? `${cookieHeader}; ${VISITOR_COOKIE}=${mintedVisitor}` : `${VISITOR_COOKIE}=${mintedVisitor}`,
    );
  }
  // Without consent, an id the browser still holds (minted before this rule, or before the
  // visitor said no) is taken out of what the app sees here and expired on the response below.
  // After refreshSession(), because that rewrites the forwarded header from the raw request.
  const dropVisitor = !analyticsOn && request.cookies.has(VISITOR_COOKIE);
  if (dropVisitor) {
    const stripped = withoutCookie(requestHeaders.get("cookie"), VISITOR_COOKIE);
    if (stripped) requestHeaders.set("cookie", stripped);
    else requestHeaders.delete("cookie");
  }

  const tenantPath =
    rewriteToTenant && firm ? `/${firm.slug}${pathname === "/" ? "" : pathname}` : null;
  const response = tenantPath
    ? NextResponse.rewrite(withPathname(request, tenantPath), { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });

  // The rotated session, back to the browser. Supabase's own options come with it (httpOnly,
  // sameSite, path, the expiry it chose) — nothing here second-guesses them.
  for (const cookie of sessionCookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }

  response.headers.set(cspHeaderName(), policy);
  response.headers.set(CSP_NONCE_HEADER, nonce);

  // Strict-Transport-Security, decided per host rather than in next.config.mjs, because only here
  // do we know whose host this is. On Docket's own hosts includeSubDomains is ours to give. On a
  // firm's custom domain it is not: Docket serves exactly the one hostname there, so the
  // subdomain commitment buys nothing and would pin that firm's mail, intranet or legacy
  // subdomains to HTTPS for two years — a promise made on their behalf that they cannot withdraw.
  // No preload either: that is a one-way door and belongs to a deliberate decision.
  const onTenantDomain = Boolean(firm?.custom_domain) && firm?.custom_domain === request.headers.get("host")?.split(":")[0].toLowerCase();
  response.headers.set(
    "Strict-Transport-Security",
    onTenantDomain ? "max-age=63072000" : "max-age=63072000; includeSubDomains",
  );

  // A console visit that names a firm is remembered for the links that follow — see src/lib/staff-firm.ts.
  const staffFirm = searchParams.get("firm");
  if (staffFirm && (pathname === "/firm" || pathname.startsWith("/firm/"))) {
    response.cookies.set(STAFF_FIRM_COOKIE, staffFirm, {
      path: "/firm",
      maxAge: STAFF_FIRM_MAX_AGE,
      sameSite: "lax",
      httpOnly: true,
      secure: true,
    });
  }

  if (mintedVisitor) {
    response.cookies.set(VISITOR_COOKIE, mintedVisitor, {
      path: "/",
      maxAge: VISITOR_MAX_AGE,
      sameSite: "lax",
      // Nothing in the browser reads this id — every funnel event is emitted from server code
      // (POSTHOG_KEY is server-side only), so script has no reason to see it.
      httpOnly: true,
      secure: true,
    });
  } else if (dropVisitor) {
    response.cookies.delete({ name: VISITOR_COOKIE, path: "/" });
  }

  return response;
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
