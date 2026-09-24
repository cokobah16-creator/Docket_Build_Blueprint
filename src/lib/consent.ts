// Recording a client's acceptance of a firm's terms and privacy notice (legal readiness item 6).
//
// Two places ask for it: the review step of the booking wizard, and the portal's consent gate.
// Both come through here, and both record through record_consent() (migration 52), which takes
// the firm and nothing else. The user is auth.uid() inside the function and the versions are the
// ones the firm has published at that moment, so a form cannot name somebody else or a version
// the firm never published.
//
// WHY THE VERSIONS ON SCREEN ARE STILL SENT HERE. Not to be recorded: to be compared. The page
// that showed the boxes read the firm through a cache (src/lib/tenant.ts, one minute), so a firm
// that has just published new terms can have a client tick "I accept version 3" while the
// database is on version 4. Recording version 4 would say the client accepted text they were
// never shown. So the published versions are read fresh first, and nothing is recorded when they
// differ from the ones on screen. What record_consent() returns is checked the same way, for a
// change that lands between that read and the call.
//
// Server-only: it is called from server actions, with the caller's own session.

import type { SupabaseClient } from "@supabase/supabase-js";
import { userError } from "@/lib/user-error";

/** The versions the page showed next to the two boxes. */
export interface ShownPolicyVersions {
  terms: string;
  privacy: string;
}

export const POLICY_VERSIONS_CHANGED =
  "The firm has changed its terms or privacy notice since this page was loaded. " +
  "Reload the page and read the new version before you continue. It can take up to a minute to appear.";

interface PolicyVersionsRow {
  policies: { terms?: { version?: unknown }; privacy?: { version?: unknown } } | null;
}

/**
 * Record the signed-in person's acceptance of the firm's current terms and privacy notice.
 * Returns null when it is recorded (or was already), otherwise the sentence to show.
 */
export async function recordFirmConsent(
  supabase: SupabaseClient,
  firmId: string,
  shown: ShownPolicyVersions,
): Promise<string | null> {
  const { data: firmRow, error: readError } = await supabase
    .from("firm_public")
    .select("policies")
    .eq("id", firmId)
    .maybeSingle();
  if (readError) return userError(readError, "Your acceptance", "consent: read firm policies");
  const policies = (firmRow as PolicyVersionsRow | null)?.policies ?? null;
  if (
    policies &&
    (String(policies.terms?.version ?? "") !== shown.terms || String(policies.privacy?.version ?? "") !== shown.privacy)
  ) {
    return POLICY_VERSIONS_CHANGED;
  }
  // No row means the firm is not active. record_consent() refuses that in its own words below.

  const { data, error } = await supabase.rpc("record_consent", { p_firm: firmId });
  if (error) {
    // P0001 is a plain RAISE: one of the function's own refusals (the firm is not active, or has
    // not published its terms and privacy notice). Its words are the reason, so they are shown.
    // Anything else (no session, the network) gets the standard sentence.
    if (error.code === "P0001") return `Your acceptance was not recorded: ${error.message}.`;
    return userError(error, "Your acceptance", "consent: record_consent");
  }

  const recorded = (data ?? null) as { terms_version?: string; privacy_version?: string } | null;
  if (recorded?.terms_version !== shown.terms || recorded?.privacy_version !== shown.privacy) {
    return POLICY_VERSIONS_CHANGED;
  }
  return null;
}
