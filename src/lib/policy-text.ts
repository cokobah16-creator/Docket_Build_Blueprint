// Which of a firm's policy texts a client may be shown.
//
// seed_firm_defaults() gives every new firm a policies skeleton whose versions all start "0-"
// ("0-draft"), with placeholder text the firm has never read, let alone adopted. The default
// cancellation text in it promises free cancellation up to 24 hours before, and nothing in the
// code refunds anyone. A draft is not the firm's policy, so no client screen presents one as if
// it were. The console's own test for "published" is the same one (settings-forms.tsx).

import type { PolicyVersioned } from "@/lib/db/types";

/** The text of a policy document the firm has published, or null for a draft or an empty one. */
export function publishedPolicyText(doc: PolicyVersioned | null | undefined): string | null {
  if (!doc) return null;
  const version = typeof doc.version === "string" ? doc.version.trim() : "";
  if (version === "" || version.startsWith("0-")) return null;
  const text = typeof doc.text === "string" ? doc.text.trim() : "";
  return text === "" ? null : text;
}
