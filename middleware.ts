// Host → firm resolution (blueprint §4 tenancy) and the per-request security policy.
//
// Three jobs, in this order:
//
//  1. THROW AWAY WHAT THE CALLER CLAIMED. x-firm-id and x-firm-slug are how every server
//     component learns which tenant it is serving (src/lib/firm.ts, src/lib/firm-data.ts).
//     They are request headers, and a request header is whatever the client typed. Anyone
//     could curl Docket with x-firm-id set to another firm's id and, on any path where the
//     host did not resolve, be read as that firm. So they are deleted before anything else
//     and only ever re-set from the host we resolved ourselves.
//
//  2. BUILD THE CONTENT-SECURITY-POLICY, with a fresh nonce (src/lib/csp.ts). The policy has
//     to be built here rather than in next.config.mjs because the App Router streams inline
//     bootstrap scripts and a nonce is the only way to allow them without 'unsafe-inline'.
//     Next.js finds the nonce for its own script tags by reading the CSP back off the REQUEST
//     headers, so the policy is set on the request as well as the response, on BOTH branches
//     below. The nonce also travels as x-nonce so a page can put it on its own script tag.
//
//  3. MINT THE VISITOR COOKIE. The funnel in src/lib/observability counts a visitor from the
//     moment they land on a firm's site, long before they sign in, and identify() later stitches
//     that anonymous id to the account. Without a cookie minted here the first two steps of the
//     funnel have no distinct id at all.
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
import { STAFF_FIRM_COOKIE, STAFF_FIRM_MAX_AGE } from "@/lib/staff-firm";

const APP_PREFIXES = ["/app", "/firm", "/admin", "/auth", "/api"];

/** Headers a caller must never be able to assert. Deleted inbound, set by us or not at all. */
const CLIENT_SPOOFABLE = [
  "x-firm-id",
  "x-firm-slug",
  CSP_NONCE_HEADER,
  "content-security-policy",
  "content-security-policy-report-only",
];

/** One year. Long enough that a returning visitor is still the same person in the funnel. */
const VISITOR_MAX_AGE = 60 * 60 * 24 * 365;


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

  const firm = await resolveFirm(
    request.headers.get("host"),
    searchParams.get("firm"),
  );
  if (firm) {
    requestHeaders.set("x-firm-id", firm.id);
    requestHeaders.set("x-firm-slug", firm.slug);
  }

  const isAppSurface = APP_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
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

  // A visitor who already has an id keeps it; a new one gets it on this response and can be
  // read on this same render, because it is spliced into the forwarded cookie header too.
  const existingVisitor = request.cookies.get(VISITOR_COOKIE)?.value;
  const visitorId = existingVisitor || crypto.randomUUID();
  if (!existingVisitor) {
    const cookieHeader = requestHeaders.get("cookie");
    requestHeaders.set(
      "cookie",
      cookieHeader ? `${cookieHeader}; ${VISITOR_COOKIE}=${visitorId}` : `${VISITOR_COOKIE}=${visitorId}`,
    );
  }

  const tenantPath =
    rewriteToTenant && firm ? `/${firm.slug}${pathname === "/" ? "" : pathname}` : null;
  const response = tenantPath
    ? NextResponse.rewrite(withPathname(request, tenantPath), { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });

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

  if (!existingVisitor) {
    response.cookies.set(VISITOR_COOKIE, visitorId, {
      path: "/",
      maxAge: VISITOR_MAX_AGE,
      sameSite: "lax",
      // Nothing in the browser reads this id — every funnel event is emitted from server code
      // (POSTHOG_KEY is server-side only), so script has no reason to see it.
      httpOnly: true,
      secure: true,
    });
  }

  return response;
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
