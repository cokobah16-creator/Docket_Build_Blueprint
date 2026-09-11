// Environment access with graceful degradation: until Supabase env vars are
// configured (Vercel → Settings → Environment Variables, values from
// .env.example) the app still builds and renders a setup notice instead of
// crashing. Nothing here ever exposes a secret to the browser — only the
// NEXT_PUBLIC_* pair is read.

export function supabaseUrl(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
}

export function supabaseAnonKey(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

/**
 * True only on the production deployment. Vercel sets VERCEL_ENV to
 * "production" | "preview" | "development"; off Vercel it is absent and
 * NODE_ENV is the only signal there is. Read as a static member so the Edge
 * runtime can inline it — process.env[key] does not work in middleware.
 */
export function isProductionDeployment(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv) return vercelEnv === "production";
  return process.env.NODE_ENV === "production";
}

/** PostgREST headers for the public key: JWT anon keys also go in Authorization;
 *  sb_publishable_ keys are not JWTs and travel only as apikey. */
export function restHeaders(key: string): Record<string, string> {
  return key.startsWith("sb_publishable_")
    ? { apikey: key }
    : { apikey: key, authorization: `Bearer ${key}` };
}
