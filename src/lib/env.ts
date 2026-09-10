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
