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
// THE FUNNEL IS STITCHED HERE — but not only here, which was the bug. Until this moment the
// person has been counted under the anonymous cookie middleware.ts minted (VISITOR_COOKIE): that
// is the id on site_viewed and booking_started. stitchVisitor() tells PostHog that the anonymous
// visitor and the account that just signed in are one person, so the funnel does not break in
// half at the sign-in step. Nothing but two opaque ids is sent; no email, no phone, no name.
//
// This route is reached by exactly one sign-in, the emailed magic link. The phone code and the
// code in that same email both verify in the browser and never come through here, so for them the
// join is made by src/lib/actions/analytics.ts instead — the same helper, called from the other
// side. See src/lib/observability/stitch.ts for what that costs when it is missed.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { loginHref, safeNext, surfaceFor } from "@/lib/auth-redirect";
import { callbackReason } from "@/lib/auth-errors";
import { stitchVisitor } from "@/lib/observability/stitch";

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
    // The same join the phone and email codes now make through src/lib/actions/analytics.ts. It
    // used to be written out here, which is why it only ever covered the one sign-in that passes
    // through this route.
    await stitchVisitor(data?.user?.id ?? data?.session?.user?.id ?? null);
  }

  const reason = callbackReason({
    error: url.searchParams.get("error"),
    errorCode: url.searchParams.get("error_code"),
    hasCode: Boolean(code),
    exchangeFailed,
    // WHICH WAY IN THIS WAS, which the parameters themselves do not say. Google's PKCE handshake
    // ends here exactly as a magic link does, and a cancelled consent screen arrives carrying
    // access_denied — the same error_code a spent magic link carries. Without this, somebody who
    // tapped "Continue with Google" and changed their mind was told a sign-in link had expired and
    // invited to type the code from an email nobody had sent. Docket put ?flow=google on its own
    // redirect_to (src/components/auth/sign-in-forms.tsx), and Supabase hands the whole URL back.
    flow: url.searchParams.get("flow"),
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
