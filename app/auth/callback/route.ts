// Magic-link / OAuth code exchange. The URL in the sign-in email lands here;
// we trade the code for a session cookie and continue to the requested page.
//
// A LINK THAT FAILS NOW SAYS SO. This route used to have exactly one outcome: redirect to `next`,
// whatever had happened. The exchange's error was destructured away — `const { data } = await
// exchangeCodeForSession(code)` — and a refusal GoTrue had already made, arriving as
// ?error=access_denied&error_code=otp_expired with no code at all, was not read either. Both cases
// redirected to a page that found no session and bounced the caller to sign in with nothing said,
// so an expired link and a link opened in the wrong browser were indistinguishable from a link
// that simply did nothing. The reason now travels to the sign-in screen as ?reason= and is turned
// back into a sentence there (src/lib/auth-errors.ts), never into a query string carrying
// GoTrue's own words.
//
// THE FUNNEL IS STITCHED HERE. Until this moment the person has been counted under the
// anonymous cookie middleware.ts minted (VISITOR_COOKIE) — that is the id on site_viewed and
// booking_started. identify() tells PostHog that the anonymous visitor and the account that
// just signed in are one person, so the funnel does not break in half at the sign-in step.
// Nothing but two opaque ids is sent; no email, no phone, no name.

import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { loginHref, safeNext, surfaceFor } from "@/lib/auth-redirect";
import { callbackReason } from "@/lib/auth-errors";
import { VISITOR_COOKIE, identify } from "@/lib/observability";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // The destination the sign-in link was asked to return to — the invoice, the matter, the
  // message someone was sent. safeNext() rather than a startsWith("/") test: "//evil.example"
  // starts with a slash and is a protocol-relative URL a browser follows straight off Docket,
  // and this value arrives on a link that has been out in someone's email.
  const next = safeNext(url.searchParams.get("next")) ?? "/app";

  const supabase = await supabaseServer();
  let exchangeFailed = false;

  if (supabase && code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    exchangeFailed = Boolean(error);
    const userId: string | null = data?.user?.id ?? data?.session?.user?.id ?? null;
    if (userId) {
      const anonymousId =
        (await cookies()).getAll().find((c) => c.name === VISITOR_COOKIE)?.value ?? null;
      // Fired and ignored: a failed stitch loses a report, never a sign-in.
      after(() => identify(userId, anonymousId).catch(() => undefined));
    }
  }

  const reason = callbackReason({
    error: url.searchParams.get("error"),
    errorCode: url.searchParams.get("error_code"),
    hasCode: Boolean(code),
    exchangeFailed,
  });

  if (reason) {
    // Back to sign-in with the destination still attached, so a second attempt — by link or by the
    // code in the same email — still ends up where the first one was going. Which sign-in screen
    // depends on where the link was heading: this route carries a client's magic link and a
    // member of staff's password-recovery link alike.
    const back = new URL(loginHref(surfaceFor(next), next), url.origin);
    back.searchParams.set("reason", reason);
    return NextResponse.redirect(back);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
