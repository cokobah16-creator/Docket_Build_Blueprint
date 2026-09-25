// Recording a client's acceptance of a firm's terms and privacy notice (legal readiness item 6).
//
// Two places ask for it: the review step of the booking wizard, and the portal's consent gate.
// Both come through here, and both record through record_consent() (migration 52). The user is
// auth.uid() inside the function, so a form cannot name somebody else. Where 52 is not applied
// yet, recordWithoutFunction() at the end of this file stands in for it.
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
import type { FirmPolicies } from "@/lib/db/types";
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

/** PostgREST's answer when the schema has no such function: migration 52 is not applied yet. */
const FUNCTION_NOT_FOUND = "PGRST202";

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
  if (error.code === FUNCTION_NOT_FOUND) return recordWithoutFunction(supabase, firmId, shown);

  // The firm published other versions after this page was drawn. Nothing was written.
  if (error.code === STALE_POLICY_VERSIONS) return POLICY_VERSIONS_CHANGED;
  // P0001 is a plain RAISE: one of the function's own refusals (the firm is not active, or has
  // not published its terms and privacy notice). Its words are the reason, so they are shown.
  // Anything else (no session, the network) gets the standard sentence.
  if (error.code === "P0001") return `Your acceptance was not recorded: ${error.message}.`;
  return userError(error, "Your acceptance", "consent: record_consent");
}

/**
 * The same acceptance where migration 52 has not been applied yet. The app has reached production
 * ahead of its migrations before (docs/DEPLOYMENT_RUNBOOK.md), and a client must still be able to
 * book and to get past the portal gate. So this does what the gate did before 52: it inserts the
 * two rows directly, which consent_records_insert allows until migration 53 revokes it.
 *
 * It keeps record_consent()'s refusals. The firm's published versions are read from firm_public
 * without the tenant cache, and nothing is written for a draft or for versions other than the
 * ones shown. Only a row the caller does not already hold is inserted. Unlike record_consent(),
 * it cannot lock the firm's row, so a publish in the same instant as the insert goes unseen.
 */
async function recordWithoutFunction(
  supabase: SupabaseClient,
  firmId: string,
  shown: ShownPolicyVersions,
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Sign in first, then accept the terms and privacy notice.";

  const { data: firm, error: readError } = await supabase
    .from("firm_public")
    .select("policies")
    .eq("id", firmId)
    .maybeSingle();
  if (readError) return userError(readError, "Your acceptance", "consent: firm_public");
  if (!firm) return "Your acceptance was not recorded: this firm is not active on Docket.";

  const policies = (firm as { policies: FirmPolicies | null }).policies;
  const terms = policies?.terms?.version ?? "";
  const privacy = policies?.privacy?.version ?? "";
  if (terms === "" || privacy === "" || terms.startsWith("0-") || privacy.startsWith("0-")) {
    return "Your acceptance was not recorded: this firm has not published its terms and privacy notice yet.";
  }
  if (terms !== shown.terms || privacy !== shown.privacy) return POLICY_VERSIONS_CHANGED;

  const { data: held, error: heldError } = await supabase
    .from("consent_records")
    .select("kind, version")
    .eq("firm_id", firmId)
    .eq("user_id", user.id);
  if (heldError) return userError(heldError, "Your acceptance", "consent: consent_records");
  const rows = (held ?? []) as Array<{ kind: string; version: string }>;
  const missing = (
    [
      { kind: "terms", version: terms },
      { kind: "privacy", version: privacy },
    ] as const
  ).filter((want) => !rows.some((r) => r.kind === want.kind && r.version === want.version));
  if (missing.length === 0) return null;

  const { error } = await supabase
    .from("consent_records")
    .insert(missing.map((m) => ({ user_id: user.id, firm_id: firmId, kind: m.kind, version: m.version })));
  return error ? userError(error, "Your acceptance", "consent: direct insert") : null;
}
