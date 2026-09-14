"use server";

// The one thing a browser-side sign-in cannot do for itself.
//
// src/components/auth/sign-in-forms.tsx verifies the phone code and the emailed code with the
// browser client, so the session appears in the browser and the server is never told. Both halves
// of the funnel stitch are server-side on purpose — the visitor cookie is httpOnly and POSTHOG_KEY
// is not NEXT_PUBLIC_ — so the component calls this, and this reads both.
//
// IT TAKES NO ARGUMENTS, AND THAT IS THE POINT. The obvious shape would be
// stitch(userId: string), called with the id the component just got back from verifyOtp. That
// would be an unauthenticated endpoint accepting somebody else's user id and attaching this
// browser's visitor cookie to it — a stranger's analytics identity, poisoned by anyone who can
// POST. The id is read from the session cookie here instead, so the only account this can ever
// name is the one the caller actually holds.
//
// Nothing is returned. The caller has already signed in; whether the report landed is not its
// business, and a rejection must never reach a screen that has just said "Signed in".

import { supabaseServer } from "@/lib/supabase/server";
import { stitchVisitor } from "@/lib/observability/stitch";

export async function stitchSignedInVisitor(): Promise<void> {
  const supabase = await supabaseServer();
  if (!supabase) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await stitchVisitor(user?.id ?? null);
}
