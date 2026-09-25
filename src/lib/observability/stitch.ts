// Joining the visitor to the account, wherever the sign-in actually happened.
//
// THE FUNNEL SPANS TWO KINDS OF ID, which is the whole reason this exists. site_viewed
// (app/(public)/[firm]/layout.tsx) and booking_started (src/lib/actions/booking.ts) are recorded
// against the anonymous cookie the middleware mints; later steps belong to the signed-in account
// (matter_opened did, and is held back until the client's own consent can be read: see
// src/lib/actions/matters.ts). PostHog only knows those are one person if it is told,
// once, with $identify — and if it is not told, the funnel does not merely lose a step, it splits
// into two people who each completed half of it.
//
// WHERE IT WAS BEING TOLD, AND WHERE IT WAS NOT. app/auth/callback/route.ts did this, and that
// route is reached by the emailed magic link and Google OAuth. Phone and WhatsApp codes verify in
// the browser and so never passed through the one place that stitched. The booking wizard is the
// sharpest version of the loss: someone lands on a firm's site, starts a booking, signs in with the
// phone code in the middle of it, and pays. site_viewed and booking_started are the cookie; the
// payment and the matter are the account; nothing joined them, so the two halves of the funnel
// Docket most wants to read belonged to two different people.
//
// WHY IT CANNOT BE DONE IN THE BROWSER, and so why a client component has to ask a server to do
// it. Both halves are deliberately server-side: the visitor cookie is httpOnly (middleware.ts says
// so, and says why), and POSTHOG_KEY is not NEXT_PUBLIC_. Script can read neither. A sign-in that
// completes in the browser therefore has to hand the fact back to the server, which is what
// src/lib/actions/analytics.ts is for.
//
// ONLY WITH CONSENT. The stitch links an anonymous visitor to an account, which is the most
// identifying thing analytics does, so it happens only when this browser chose "Allow analytics"
// and POSTHOG_KEY is set (consentedVisitorId() in ./consent.ts). Without that, nothing is sent.
// Every sign-in path comes through here, so this one check covers them all.
//
// NOT EXPORTED FROM ../observability's index. That barrel is imported by middleware.ts, which runs
// on the edge, where next/headers does not exist — the same rule src/lib/auth-redirect.ts is split
// along. Import this module by its own path.

import { after } from "next/server";
import { identify } from "@/lib/observability";
import { consentedVisitorId } from "@/lib/observability/consent";

/**
 * Tell PostHog that the anonymous visitor holding this browser's cookie and `userId` are one
 * person. Safe to call more than once: $identify is idempotent, and identify() already declines
 * when there is no anonymous id or when it is the user id already.
 *
 * Fired and ignored, like the call it replaces: a lost stitch costs a report, never a sign-in, so
 * nothing here is allowed to throw into a caller that has just signed somebody in.
 */
export async function stitchVisitor(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    const anonymousId = await consentedVisitorId();
    if (!anonymousId) return;
    after(() => identify(userId, anonymousId).catch(() => undefined));
  } catch {
    /* no cookie store, or after() outside a request: the funnel loses one join and nothing else */
  }
}
