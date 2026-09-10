"use client";

// Browser Supabase client for client components (sign-in forms, MFA
// enrolment). Uses only the public URL + anon key; RLS decides everything.

import { createBrowserClient } from "@supabase/ssr";

export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}
