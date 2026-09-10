// Anonymous reads for the tenant public site and booking wizard, all through
// PostgREST with the public key — RLS/views decide what is visible.

import { restHeaders, supabaseAnonKey, supabaseUrl } from "@/lib/env";
import type { ContentRow, IntakeForm, LawyerPublic, ServiceRow } from "@/lib/db/types";

async function rest<T>(path: string, revalidate = 120): Promise<T[]> {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) return [];
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: restHeaders(key),
      next: { revalidate },
    });
    if (!res.ok) return [];
    return (await res.json()) as T[];
  } catch {
    return [];
  }
}

const SERVICE_COLS =
  "id,slug,name,description,price_minor,currency,duration_min,virtual_available,is_active,sort,firm_id";

export async function serviceBySlug(firmId: string, slug: string): Promise<ServiceRow | null> {
  const rows = await rest<ServiceRow>(
    `services?select=${SERVICE_COLS}&firm_id=eq.${firmId}&slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&limit=1`,
  );
  return rows[0] ?? null;
}

const LAWYER_COLS = "firm_id,id,slug,title,bio,photo_path,practice_areas,category,full_name,timezone";

export async function publicLawyers(firmId: string): Promise<LawyerPublic[]> {
  return rest<LawyerPublic>(`lawyer_public?select=${LAWYER_COLS}&firm_id=eq.${firmId}&order=full_name.asc`);
}

export async function lawyerBySlug(firmId: string, slug: string): Promise<LawyerPublic | null> {
  const rows = await rest<LawyerPublic>(
    `lawyer_public?select=${LAWYER_COLS}&firm_id=eq.${firmId}&slug=eq.${encodeURIComponent(slug)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function activeIntakeForms(firmId: string): Promise<IntakeForm[]> {
  return rest<IntakeForm>(
    `intake_forms?select=id,firm_id,service_id,name,schema&firm_id=eq.${firmId}&is_active=eq.true`,
  );
}

export async function publishedContent(
  firmId: string,
  kind: string,
  slug: string,
): Promise<ContentRow | null> {
  const rows = await rest<ContentRow>(
    `content?select=id,firm_id,kind,slug,title,body,status,published_at&firm_id=eq.${firmId}&kind=eq.${kind}&slug=eq.${encodeURIComponent(slug)}&status=eq.published&limit=1`,
  );
  return rows[0] ?? null;
}

export async function publishedList(firmId: string, kind: string): Promise<ContentRow[]> {
  return rest<ContentRow>(
    `content?select=id,firm_id,kind,slug,title,body,status,published_at&firm_id=eq.${firmId}&kind=eq.${kind}&status=eq.published&order=published_at.desc`,
  );
}

/** Display name for a lawyer card (profiles may not have a name yet). */
export function lawyerDisplayName(l: LawyerPublic, firmName: string): string {
  return l.full_name ?? `${firmName} lawyer`;
}
