// The half of src/lib/auth-redirect.ts that reads the request.
//
// Separate file because that one is imported by middleware.ts, which runs on the edge runtime
// where next/headers does not exist. Everything here needs a request, so everything here is for
// server components, server actions and route handlers only.

import { headers } from "next/headers";
import { loginHref, mfaHref, PATHNAME_HEADER, safeNext, type Surface } from "@/lib/auth-redirect";

/** The path and query the middleware is serving, or null if it did not run. */
export async function currentPath(): Promise<string | null> {
  try {
    return safeNext((await headers()).get(PATHNAME_HEADER));
  } catch {
    return null;
  }
}

/**
 * The sign-in URL to send an unauthenticated caller to, remembering where they were going.
 *
 * Written to be used as `if (!user) redirect(await loginPath("client"))` rather than wrapped in a
 * redirecting helper of its own, for two reasons. redirect() stays the direct call, so TypeScript
 * still reads it as never-returning and narrows `user` to non-null below the guard. And the
 * header is only read on the way out — a signed-in caller pays nothing.
 */
export async function loginPath(surface: Surface): Promise<string> {
  return loginHref(surface, await currentPath());
}

/** The two-factor URL for a staff session that is signed in but still aal1, destination attached. */
export async function mfaPath(): Promise<string> {
  return mfaHref(await currentPath());
}
