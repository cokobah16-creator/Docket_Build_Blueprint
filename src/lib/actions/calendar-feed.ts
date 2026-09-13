"use server";

// The subscribed calendar URL (migration 47).
//
// Both rules are the database's: issue_calendar_feed() asks staff_w() and takes no user parameter,
// so nobody issues a feed for anybody else; revoke_calendar_feed() lets the owner of a feed or an
// administrator end it. This file carries the form to them and returns their refusals word for word.
//
// The token is returned ONCE, by the database, and passed straight back to the screen that asked.
// It is not stored here, not logged, and not retrievable afterwards — Docket keeps only its hash.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

const uuid = z.string().uuid();

export async function issueCalendarFeed(
  firmId: string, includeClientNames: boolean,
): Promise<{ error: string } | { id: string; token: string }> {
  if (!uuid.safeParse(firmId).success) return { error: "Unknown firm." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data, error } = await supabase.rpc("issue_calendar_feed", {
    p_firm: firmId, p_include_client_names: Boolean(includeClientNames),
  });
  if (error) return { error: error.message };
  const r = (data ?? {}) as { id?: string; token?: string };
  revalidatePath("/firm/me");
  return { id: String(r.id ?? ""), token: String(r.token ?? "") };
}

export async function revokeCalendarFeed(id: string): Promise<{ error: string } | undefined> {
  if (!uuid.safeParse(id).success) return { error: "Unknown feed." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("revoke_calendar_feed", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/firm/me");
  return undefined;
}
