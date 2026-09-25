// Which of a firm's policy texts a client may be shown.
//
// seed_firm_defaults() gives every new firm a policies skeleton whose versions all start "0-"
// ("0-draft"), with placeholder text the firm has never read, let alone adopted. The default
// cancellation text in it promises free cancellation up to 24 hours before, and nothing in the
// code refunds anyone. A draft is not the firm's policy, so no client screen presents one as if
// it were. The console's own test for "published" is the same one (settings-forms.tsx).
//
// The holding sentence the same seed stores as terms and privacy text can outlive the draft
// version, because a firm publishes by changing only the version. It is not the firm's notice
// either, so it counts as no text whatever the version.

import { SEEDED_POLICY_TEXT, type PolicyVersioned } from "@/lib/db/types";

/** The text of a policy document the firm has published, or null for a draft, an empty one or
 *  the seeded holding sentence. */
export function publishedPolicyText(doc: PolicyVersioned | null | undefined): string | null {
  if (!doc) return null;
  const version = typeof doc.version === "string" ? doc.version.trim() : "";
  if (version === "" || version.startsWith("0-")) return null;
  const text = typeof doc.text === "string" ? doc.text.trim() : "";
  return text === "" || text === SEEDED_POLICY_TEXT ? null : text;
}

/** Where a client reads a firm's terms or privacy notice before accepting it: the firm's own link
 *  when it gave one, else `fallback`, the firm's page on Docket (which shows the saved text). The
 *  portal gate and the booking review step both use it, so both link the same document. */
export function policyDocumentHref(doc: PolicyVersioned | null | undefined, fallback: string): string {
  const url = typeof doc?.url === "string" ? doc.url.trim() : "";
  return url !== "" ? url : fallback;
}
