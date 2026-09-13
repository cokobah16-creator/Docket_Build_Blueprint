// Server-side Supabase client (server components, server actions, route
// handlers). Always runs with the caller's own session — RLS is the
// authorization layer. The service role is never used in the app.

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

export async function supabaseServer() {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) return null;

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, which cannot set a cookie: the response has
          // already begun streaming. The write is dropped, so a token rotated here would be
          // lost — which is why the refresh happens in middleware instead, before any of this
          // runs. See src/lib/supabase/middleware.ts.
        }
      },
    },
  });
}
