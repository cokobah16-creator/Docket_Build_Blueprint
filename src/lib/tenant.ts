// Tenant resolution used by middleware (Edge runtime) and server components.
// Reads only the anon-safe firm_public view over PostgREST — never the firms
// table, never with the service role.

import { supabaseAnonKey, supabaseUrl } from "@/lib/env";
import type { FirmPublic } from "@/lib/db/types";

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: FirmPublic | null; expires: number }>();

async function fetchFirmPublic(filter: string): Promise<FirmPublic | null> {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) return null;

  const cached = cache.get(filter);
  if (cached && cached.expires > Date.now()) return cached.value;

  let value: FirmPublic | null = null;
  try {
    const res = await fetch(
      `${url}/rest/v1/firm_public?select=id,slug,name,brand,policies,custom_domain,timezone,default_currency&${filter}&limit=1`,
      { headers: { apikey: key, authorization: `Bearer ${key}` } },
    );
    if (res.ok) {
      const rows = (await res.json()) as FirmPublic[];
      value = rows[0] ?? null;
    }
  } catch {
    value = null;
  }
  cache.set(filter, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function firmBySlug(slug: string): Promise<FirmPublic | null> {
  if (!/^[a-z0-9-]{2,64}$/.test(slug)) return null;
  return fetchFirmPublic(`slug=eq.${encodeURIComponent(slug)}`);
}

export async function firmByCustomDomain(host: string): Promise<FirmPublic | null> {
  if (!/^[a-z0-9.-]{4,255}$/.test(host)) return null;
  return fetchFirmPublic(`custom_domain=eq.${encodeURIComponent(host)}`);
}

/**
 * Resolve the request host to a firm:
 *  1. custom domain (firm_public.custom_domain)
 *  2. {slug}.docket.app subdomain
 *  3. ?firm= query parameter (dev and preview deployments)
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

  if (firmParam) return firmBySlug(firmParam.toLowerCase());
  return null;
}
