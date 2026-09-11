"use server";

// Staff-session actions. Nothing here writes firm data — the console's writes
// live with the thing they write (matters, invoices, court, availability).

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Sign out of the console. Ends the session on this device only: a lawyer
 * signing out of a borrowed phone should not knock their own desk out too.
 */
export async function staffSignOut(): Promise<void> {
  const supabase = await supabaseServer();
  if (supabase) await supabase.auth.signOut();
  redirect("/firm/login");
}
