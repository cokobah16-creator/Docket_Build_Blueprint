// A link from the portal to one of a firm's own public pages: its terms, its privacy notice, its
// booking page, its Urgent help page.
//
// It lives in its own module because a layout or page file may only export what Next.js expects
// of one, and the layout, the home screen and the messages screen all need it.

import { currentFirmSlug } from "@/lib/firm";
import { isProductionDeployment } from "@/lib/env";
import { firmSiteHref } from "@/lib/tenant";

/**
 * Where a link to `path` on the firm's own site goes.
 *
 * The /{slug}/… form works on Docket's shared host and on the firm's own host, because
 * middleware leaves a path that already starts with the firm's slug alone. On ANOTHER firm's
 * host it does not: middleware would rewrite it onto that firm's site, and the link would 404.
 * That happens when a client of two firms opens the portal on one firm's domain and has the
 * other selected, so there the link goes to the firm's own address instead. Outside production
 * a host never selects a firm (only ?firm= does, and this link carries none), so the relative
 * form always works there.
 */
export async function firmPageHref(
  firm: { slug: string; custom_domain?: string | null },
  path: `/${string}`,
): Promise<string> {
  const hostSlug = await currentFirmSlug();
  if (hostSlug && hostSlug !== firm.slug && isProductionDeployment()) return `${firmSiteHref(firm)}${path}`;
  return `/${firm.slug}${path}`;
}
