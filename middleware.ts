// Host → firm resolution (blueprint §4 tenancy). Resolves the tenant from
// the custom domain, the {slug}.docket.app subdomain, or ?firm= in dev, then
// stamps x-firm-id / x-firm-slug request headers for server components and
// rewrites public paths onto the tenant site at app/(public)/[firm].

import { NextResponse, type NextRequest } from "next/server";
import { resolveFirm } from "@/lib/tenant";

const APP_PREFIXES = ["/app", "/firm", "/admin", "/auth", "/api"];

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  const firm = await resolveFirm(
    request.headers.get("host"),
    searchParams.get("firm"),
  );

  const requestHeaders = new Headers(request.headers);
  if (firm) {
    requestHeaders.set("x-firm-id", firm.id);
    requestHeaders.set("x-firm-slug", firm.slug);
  }

  const isAppSurface = APP_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // Public site: serve the tenant's pages from app/(public)/[firm]/…
  if (firm && !isAppSurface && !pathname.startsWith(`/${firm.slug}`)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${firm.slug}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
