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

  let firm;
  try {
    firm = await resolveFirm(
      request.headers.get("host"),
      searchParams.get("firm"),
    );
  } catch {
    // Tenant resolution runs in middleware, above Next's error boundaries. A failed public-data
    // lookup must not become either a fake "firm not found" or an opaque edge exception.
    const nonce = newNonce();
    const policy = contentSecurityPolicy(nonce, { prerendered: false });
    const response = new NextResponse(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Docket temporarily unavailable</title></head><body><main><h1>Docket is temporarily unavailable</h1><p>We could not load the firm information needed for this page. Please try again in a moment.</p></main></body></html>`,
      {
        status: 503,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "retry-after": "30",
          [cspHeaderName()]: policy,
          [CSP_NONCE_HEADER]: nonce,
          "Strict-Transport-Security": "max-age=63072000",
        },
      },
    );
    for (const cookie of sessionCookies) {
      response.cookies.set(cookie.name, cookie.value, cookie.options);
    }
    return response;
  }
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

  // Remove identifiers set by earlier builds. Analytics are paused until consent exists.
  if (request.cookies.has(VISITOR_COOKIE)) response.cookies.delete(VISITOR_COOKIE);

  return response;
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
