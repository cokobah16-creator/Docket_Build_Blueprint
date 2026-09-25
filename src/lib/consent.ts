// Recording a client's acceptance of a firm's terms and privacy notice (legal readiness item 6).
//
// Two places ask for it: the review step of the booking wizard, and the portal's consent gate.
// Both come through here, and both record through record_consent() (migration 52). The user is
// auth.uid() inside the function, so a form cannot name somebody else.
//
// THE VERSIONS ON SCREEN ARE SENT, AND THE DATABASE DECIDES. The page that showed the boxes read
// the firm through a cache (src/lib/tenant.ts, one minute), so a firm that has just published new
// terms can have a client tick "I accept version 3" while the database is on version 4. The
// versions the page showed go to record_consent(), which locks the firm's row, compares them with
// the versions the firm has published, and writes nothing when they differ (SQLSTATE DKC01). So a
// client is never on record for a version they were not shown, and there is nothing to check
// after the call: when it returns, the rows it wrote are for the versions on screen.
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

/** record_consent()'s refusal when the versions shown are not the versions published. */
const STALE_POLICY_VERSIONS = "DKC01";

/**
 * Record the signed-in person's acceptance of the firm's terms and privacy notice, at the
 * versions the page showed them. Returns null when it is recorded (or was already), otherwise
 * the sentence to show. Nothing is recorded when the firm has published other versions since.
 */
export async function recordFirmConsent(
  supabase: SupabaseClient,
  firmId: string,
  shown: ShownPolicyVersions,
): Promise<string | null> {
  const { error } = await supabase.rpc("record_consent", {
    p_firm: firmId,
    p_terms_version: shown.terms,
    p_privacy_version: shown.privacy,
  });
  if (!error) return null;

  // The firm published other versions after this page was drawn. Nothing was written.
  if (error.code === STALE_POLICY_VERSIONS) return POLICY_VERSIONS_CHANGED;
  // P0001 is a plain RAISE: one of the function's own refusals (the firm is not active, or has
  // not published its terms and privacy notice). Its words are the reason, so they are shown.
  // Anything else (no session, the network) gets the standard sentence.
  if (error.code === "P0001") return `Your acceptance was not recorded: ${error.message}.`;
  return userError(error, "Your acceptance", "consent: record_consent");
}
