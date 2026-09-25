// Tenant resolution used by middleware (Edge runtime) and server components.
// Reads only the anon-safe firm_public view over PostgREST — never the firms
// table, never with the service role.

import { isProductionDeployment, restHeaders, supabaseAnonKey, supabaseUrl } from "@/lib/env";
import type { FirmPublic } from "@/lib/db/types";

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: FirmPublic | null; expires: number }>();

const FIRM_COLUMNS = "id,slug,name,legal_name,brand,policies,custom_domain,timezone,default_currency,verified";
/** Appended to firm_public by migration 51. */
const MIGRATION_51_COLUMNS = "vat_rate,rc_number";

function firmPublicQuery(url: string, columns: string, filter: string): string {
  return `${url}/rest/v1/firm_public?select=${columns}&${filter}&limit=1`;
}

/** PostgREST's refusal of a select that names a column the view does not have. */
async function isUndefinedColumn(res: Response): Promise<boolean> {
  if (res.status !== 400) return false;
  const body = (await res.json().catch(() => null)) as { code?: string } | null;
  return body?.code === "42703";
}

async function fetchFirmPublic(filter: string): Promise<FirmPublic | null> {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) return null;

  const cached = cache.get(filter);
  if (cached && cached.expires > Date.now()) return cached.value;

  // Only an answer is cached: a firm, or "no such firm". A failed request (a network error, or
  // PostgREST refusing the select) returns null this time and is asked again on the next request.
  // Caching it would show "no such firm" for every tenant for the whole minute.
  //
  // The app has reached production ahead of its migrations before (docs/DEPLOYMENT_RUNBOOK.md),
  // and the Playwright smoke suite runs this code against the live project. Without migration 51,
  // PostgREST refuses vat_rate and rc_number with 42703, so the firm is asked for again without
  // them and served with no VAT rate and no RC/BN. Prices then show as they did before 51, the fee
  // alone with no "incl. VAT", and the booking wizard still opens no checkout when the invoice
  // total differs from the total it showed.
  try {
    let res = await fetch(firmPublicQuery(url, `${FIRM_COLUMNS},${MIGRATION_51_COLUMNS}`, filter), {
      headers: restHeaders(key),
    });
    let before51 = false;
    if (await isUndefinedColumn(res)) {
      before51 = true;
      res = await fetch(firmPublicQuery(url, FIRM_COLUMNS, filter), { headers: restHeaders(key) });
    }
    if (!res.ok) return null;
    const rows = (await res.json()) as FirmPublic[];
    const row = rows[0];
    const value = row ? (before51 ? { ...row, vat_rate: 0, rc_number: null } : row) : null;
    cache.set(filter, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  } catch {
    return null;
  }
}

export async function firmBySlug(slug: string): Promise<FirmPublic | null> {
  if (!/^[a-z0-9-]{2,64}$/.test(slug)) return null;
  return fetchFirmPublic(`slug=eq.${encodeURIComponent(slug)}`);
}

export async function firmById(id: string): Promise<FirmPublic | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return fetchFirmPublic(`id=eq.${id}`);
}

export async function firmByCustomDomain(host: string): Promise<FirmPublic | null> {
  if (!/^[a-z0-9.-]{4,255}$/.test(host)) return null;
  return fetchFirmPublic(`custom_domain=eq.${encodeURIComponent(host)}`);
}

/**
 * The address a firm's public site is actually served from — the inverse of
 * resolveFirm(). In production that is the firm's own domain, or its
 * {slug}.docket.app subdomain. Outside production neither host exists, so the
 * ?firm= fallback is the only way to reach it, which is what resolveFirm
 * allows there and nowhere else.
 */
export function firmSiteHref(firm: { slug: string; custom_domain?: string | null }): string {
  if (!isProductionDeployment()) return `/?firm=${encodeURIComponent(firm.slug)}`;
  if (firm.custom_domain) return `https://${firm.custom_domain}`;
  return `https://${firm.slug}.docket.app`;
}

/**
 * Resolve the request host to a firm:
 *  1. custom domain (firm_public.custom_domain)
 *  2. {slug}.docket.app subdomain
 *  3. ?firm= query parameter, outside production only
 *
 * The query parameter is a development and preview affordance, not a routing
 * rule. A preview host is neither a firm's custom domain nor a docket.app
 * subdomain, so without it no tenant site is reachable on a preview at all.
 * In production the host is the only thing that selects a tenant, so that a
 * firm's site is only ever served from an address that belongs to that firm.
 */
export async function resolveFirm(
  host: string | null,
  firmParam: string | null,
): Promise<FirmPublic | null> {
  const bareHost = (host ?? "").split(":")[0].toLowerCase();

  if (bareHost.endsWith(".docket.app")) {
    const sub = bareHost.slice(0, -".docket.app".length);
    if (sub && sub !== "www" && sub !== "app") {
      const bySub = await firmBySlug(sub);
      if (bySub) return bySub;
    }
  } else if (bareHost) {
    const byDomain = await firmByCustomDomain(bareHost);
    if (byDomain) return byDomain;
  }

  if (firmParam && !isProductionDeployment()) return firmBySlug(firmParam.toLowerCase());
  return null;
}
