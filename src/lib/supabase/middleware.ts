// Session refresh, on the edge, before anything renders.
//
// WHY THIS EXISTS. A Supabase access token lasts an hour; the refresh token outlives it and is
// spent to mint the next one. Whoever calls getUser() first after expiry receives that new pair
// and MUST write it back to the browser, or the refresh is lost and the session dies early.
//
// In this app the first caller is almost always a server component — the console layout's gate,
// a portal page's own check. A server component cannot set a cookie: Next.js has already begun
// streaming by then, and supabaseServer()'s setAll catches the resulting throw and drops the
// write (src/lib/supabase/server.ts). So the refreshed pair went nowhere, the old access token
// stayed in the jar, and the next request was unauthenticated: staff were returned to
// /firm/login and a fresh TOTP challenge roughly every hour of use, clients to /app/login.
//
// Middleware is the one place that runs before the render and still owns the response, so the
// refresh belongs here. The cookies come back to the caller to be put on the response, and the
// forwarded request headers are rewritten so the render happening now sees the new session
// rather than the expired one it would otherwise read.
//
// ONLY THE APP SURFACES. The public tenant site is served to signed-out visitors and asks
// Supabase nothing; refreshing there would add an auth round-trip to every marketing page view
// for no session at all. middleware.ts calls this for /app, /firm, /admin, /registry, /auth and
// /api only.

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

/** A cookie Supabase wants set, in the shape NextResponse.cookies.set takes. */
export type SessionCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

/**
 * Refresh the caller's session if it needs it.
 *
 * Returns the cookies to put on the response — an empty array when there was nothing to write,
 * which is the common case: Supabase only hands cookies back when the token actually rotated.
 * `requestHeaders` is mutated in place so the current render reads the new session.
 *
 * Never throws. A sign-in page that 500s because Supabase was unreachable is worse than a
 * request that proceeds with the session it already had.
 */
export async function refreshSession(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<SessionCookie[]> {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) return [];

  // No auth cookie, nothing to refresh — and getUser() would still cost a round-trip to the
  // auth server to be told so. That is most traffic on these paths: a signed-out visitor
  // opening the sign-in page, the /api routes a provider calls. Supabase names the cookie
  // sb-<project-ref>-auth-token, chunked as .0, .1 when it outgrows one cookie.
  const hasSession = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
  if (!hasSession) return [];

  const written: SessionCookie[] = [];
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        written.push(...cookiesToSet);
      },
    },
  });

  try {
    // getUser(), not getSession(): it verifies the token with the auth server, and verifying is
    // what triggers the refresh. Nothing goes between this and the client above — the Supabase
    // guidance is that any await in between can let a stale jar win the race.
    await supabase.auth.getUser();
  } catch {
    return [];
  }

  if (written.length > 0) {
    // Splice the new pair into the cookie header being forwarded, so the page rendering from
    // these headers reads the refreshed session and not the expired one. Later names win, which
    // is what we want: the rotated value replaces the one the browser sent.
    const jar = new Map<string, string>();
    for (const cookie of request.cookies.getAll()) jar.set(cookie.name, cookie.value);
    for (const cookie of written) jar.set(cookie.name, cookie.value);
    requestHeaders.set(
      "cookie",
      Array.from(jar, ([name, value]) => `${name}=${value}`).join("; "),
    );
  }

  return written;
}
