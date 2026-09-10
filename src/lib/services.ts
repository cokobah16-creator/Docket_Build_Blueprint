// Public service catalogue reads (anon-safe: RLS shows active services only).

import { supabaseAnonKey, supabaseUrl } from "@/lib/env";
import type { ServiceRow } from "@/lib/db/types";

export async function activeServices(firmId: string): Promise<ServiceRow[]> {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) return [];
  try {
    const res = await fetch(
      `${url}/rest/v1/services?select=id,slug,name,description,price_minor,currency,duration_min,virtual_available,is_active,sort,firm_id` +
        `&firm_id=eq.${encodeURIComponent(firmId)}&is_active=eq.true&order=sort.asc`,
      {
        headers: { apikey: key, authorization: `Bearer ${key}` },
        next: { revalidate: 120 },
      },
    );
    if (!res.ok) return [];
    return (await res.json()) as ServiceRow[];
  } catch {
    return [];
  }
}

export function formatMoneyMinor(minor: number, currency: string): string {
  return new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}
