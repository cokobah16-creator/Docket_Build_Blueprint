// The client's conversations, loaded once and read by both screens that show
// them: the list at /app/messages and the pane beside an open conversation.
//
// One loader rather than two, so the order, the unread count and the preview
// cannot drift between the list you tapped and the list still on screen beside
// what you tapped into.

import type { SupabaseClient } from "@supabase/supabase-js";
import { clientTimezone, firmNamesFor } from "@/lib/portal-data";
import type { MessageRow } from "@/lib/db/types";

export interface ClientThread {
  /** Stable across reloads, and what marks the open one in the list. */
  key: string;
  href: string;
  title: string;
  subtitle: string;
  last: MessageRow | null;
  lastFromMe: boolean;
  unread: number;
}

export interface ClientThreads {
  threads: ClientThread[];
  timezone: string;
}

/**
 * Every thread this client has with the firm on screen: one per matter, plus
 * one per consultation that either has messages or is still to happen.
 *
 * `firmId` narrows to the firm the portal is painted as, the same way every
 * other portal read does — a client acting with two firms sees one firm's
 * conversations at a time, under that firm's name.
 */
export async function clientThreads(
  supabase: SupabaseClient,
  userId: string,
  firmId?: string | null,
): Promise<ClientThreads> {
  let matterQuery = supabase.from("portal_matters").select("id, firm_id, reference, title");
  let apptQuery = supabase.from("appointments").select("id, firm_id, reference, starts_at, status");
  let msgQuery = supabase.from("messages").select("id, firm_id, matter_id, appointment_id, sender_id, body, attachments, read_at, created_at");
  if (firmId) {
    matterQuery = matterQuery.eq("firm_id", firmId);
    apptQuery = apptQuery.eq("firm_id", firmId);
    msgQuery = msgQuery.eq("firm_id", firmId);
  }

  const [matterResult, apptResult, msgResult, timezone] = await Promise.all([
    matterQuery.order("opened_at", { ascending: false }).limit(50),
    apptQuery.order("starts_at", { ascending: false }).limit(20),
    msgQuery.order("created_at", { ascending: false }).limit(300),
    clientTimezone(supabase, userId),
  ]);
  if (matterResult.error) throw new Error(`Message matters could not be loaded: ${matterResult.error.message}`);
  if (apptResult.error) throw new Error(`Consultations could not be loaded: ${apptResult.error.message}`);
  if (msgResult.error) throw new Error(`Messages could not be loaded: ${msgResult.error.message}`);

  const matters = (matterResult.data ?? []) as Array<{ id: string; firm_id: string; reference: string; title: string }>;
  const appts = (apptResult.data ?? []) as Array<{ id: string; firm_id: string; reference: string; starts_at: string; status: string }>;
  const messages = (msgResult.data ?? []) as MessageRow[];
  const firmNames = await firmNamesFor([...matters.map((m) => m.firm_id), ...appts.map((a) => a.firm_id)]);
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  const threads: ClientThread[] = [
    ...matters.map((m) => {
      const mine = messages.filter((x) => x.matter_id === m.id);
      return {
        key: `m-${m.id}`,
        href: `/app/matters/${m.id}?tab=messages`,
        title: m.title,
        subtitle: `${m.reference} · ${firmNames[m.firm_id] ?? "Your firm"}`,
        last: mine[0] ?? null,
        lastFromMe: mine[0]?.sender_id === userId,
        unread: mine.filter((x) => x.sender_id !== userId && !x.read_at).length,
      };
    }),
    ...appts
      .filter((a) => messages.some((x) => x.appointment_id === a.id) || ["confirmed", "rescheduled"].includes(a.status))
      .map((a) => {
        const mine = messages.filter((x) => x.appointment_id === a.id);
        return {
          key: `a-${a.id}`,
          href: `/app/messages/appointment/${a.id}`,
          title: `Consultation ${a.reference}`,
          subtitle: `${fmt.format(new Date(a.starts_at))} · ${firmNames[a.firm_id] ?? "Your firm"}`,
          last: mine[0] ?? null,
          lastFromMe: mine[0]?.sender_id === userId,
          unread: mine.filter((x) => x.sender_id !== userId && !x.read_at).length,
        };
      }),
  ].sort((a, b) => (b.last?.created_at ?? "").localeCompare(a.last?.created_at ?? ""));

  return { threads, timezone };
}
