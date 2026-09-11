// Which firm the client portal is reading.
//
// The public site resolves its tenant from the request host (src/lib/firm.ts),
// because a firm's marketing pages must only ever be served from an address
// that belongs to that firm. /app cannot work that way: one sign-in, one
// person, and several firms may act for them. So the portal keeps a selected
// firm in a cookie and repaints itself — name, colours, typeface — as the
// firm the client is reading.
//
// The cookie is a *view* preference, never an authorisation. It is validated
// against the firms the signed-in client actually has a relationship with on
// every read, and RLS decides what any query returns regardless of what it
// says. A tampered cookie selects nothing.

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { currentFirm } from "@/lib/firm";
import { firmById } from "@/lib/tenant";
import type { FirmPublic } from "@/lib/db/types";

export const SELECTED_FIRM_COOKIE = "dk_firm";

export interface ClientFirm extends FirmPublic {
  /** "2 matters · 3 consultations" — what this firm is to this client. */
  meta: string;
  matter_count: number;
  appointment_count: number;
}

function countBy(rows: Array<{ firm_id: string | null }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.firm_id) continue;
    counts.set(row.firm_id, (counts.get(row.firm_id) ?? 0) + 1);
  }
  return counts;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Every firm acting for the signed-in client, newest relationship first.
 * RLS scopes both reads to this user, so this is the client's own list — not
 * a directory of firms on Docket.
 */
export async function clientFirms(supabase: SupabaseClient): Promise<ClientFirm[]> {
  const [{ data: matterRows }, { data: apptRows }] = await Promise.all([
    supabase.from("matters").select("firm_id").is("deleted_at", null),
    supabase.from("appointments").select("firm_id"),
  ]);

  const matters = countBy((matterRows ?? []) as Array<{ firm_id: string | null }>);
  const appointments = countBy((apptRows ?? []) as Array<{ firm_id: string | null }>);
  const ids = Array.from(new Set([...matters.keys(), ...appointments.keys()]));

  const firms = await Promise.all(ids.map((id) => firmById(id)));
  return firms
    .map((firm, i) => {
      if (!firm) return null;
      const matterCount = matters.get(ids[i]) ?? 0;
      const apptCount = appointments.get(ids[i]) ?? 0;
      const parts: string[] = [];
      if (matterCount) parts.push(plural(matterCount, "matter", "matters"));
      if (apptCount) parts.push(plural(apptCount, "consultation", "consultations"));
      return {
        ...firm,
        matter_count: matterCount,
        appointment_count: apptCount,
        meta: parts.join(" · ") || "No matters yet",
      } satisfies ClientFirm;
    })
    .filter((f): f is ClientFirm => f !== null)
    .sort((a, b) => b.matter_count + b.appointment_count - (a.matter_count + a.appointment_count));
}

/**
 * The firm the portal is painted as, and whose rows it shows.
 *
 * In order: the cookie, if it still names a firm acting for this client; the
 * host's firm, if that firm acts for them; otherwise their first firm. A
 * client with no firm at all — a fresh sign-up — gets the host's firm so the
 * app is not unbranded while they book their first consultation.
 */
export async function selectedFirm(
  supabase: SupabaseClient,
  firms?: ClientFirm[],
): Promise<FirmPublic | null> {
  const available = firms ?? (await clientFirms(supabase));
  const jar = await cookies();
  const chosen = jar.get(SELECTED_FIRM_COOKIE)?.value;

  if (chosen) {
    const match = available.find((f) => f.id === chosen || f.slug === chosen);
    if (match) return match;
  }

  const host = await currentFirm();
  if (host && available.some((f) => f.id === host.id)) return host;
  return available[0] ?? host;
}
