// Public service catalogue reads (anon-safe: RLS shows active services only).

import { restHeaders, supabaseAnonKey, supabaseUrl } from "@/lib/env";
import type { ServiceRow } from "@/lib/db/types";

export async function activeServices(firmId: string): Promise<ServiceRow[]> {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) throw new Error("Public service data is not configured.");

  const res = await fetch(
    `${url}/rest/v1/services?select=id,slug,name,description,price_minor,currency,duration_min,virtual_available,is_active,sort,firm_id` +
      `&firm_id=eq.${encodeURIComponent(firmId)}&is_active=eq.true&order=sort.asc`,
    {
      headers: restHeaders(key),
      next: { revalidate: 120 },
    },
  );
  if (!res.ok) throw new Error(`Public services could not be loaded (status ${res.status}).`);
  return (await res.json()) as ServiceRow[];
}

export { formatMoneyMinor } from "@/lib/money";
