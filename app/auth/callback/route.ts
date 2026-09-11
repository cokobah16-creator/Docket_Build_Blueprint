// Magic-link / OAuth code exchange. The URL in the sign-in email lands here;
// we trade the code for a session cookie and continue to the requested page.
//
// THE FUNNEL IS STITCHED HERE. Until this moment the person has been counted under the
// anonymous cookie middleware.ts minted (VISITOR_COOKIE) — that is the id on site_viewed and
// booking_started. identify() tells PostHog that the anonymous visitor and the account that
// just signed in are one person, so the funnel does not break in half at the sign-in step.
// Nothing but two opaque ids is sent; no email, no phone, no name.

import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { VISITOR_COOKIE, identify } from "@/lib/observability";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/app";
  const next = nextParam.startsWith("/") ? nextParam : "/app";

  const supabase = await supabaseServer();
  if (supabase && code) {
    const { data } = await supabase.auth.exchangeCodeForSession(code);
    const userId: string | null = data?.user?.id ?? data?.session?.user?.id ?? null;
    if (userId) {
      const anonymousId =
        (await cookies()).getAll().find((c) => c.name === VISITOR_COOKIE)?.value ?? null;
      // Fired and ignored: a failed stitch loses a report, never a sign-in.
      after(() => identify(userId, anonymousId).catch(() => undefined));
    }
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
