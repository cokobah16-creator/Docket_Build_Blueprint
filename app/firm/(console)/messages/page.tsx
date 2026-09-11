// Every thread the firm is in, newest activity first — and, on one tap, only the ones the firm
// owes a reply to, or only the ones this person has not read.
//
// Both facts come from firm_threads (migration 25). "Awaiting reply" is derived from who spoke
// last and is the same for every colleague; "unread" is per reader. They are shown apart because
// they are different: a secretary having read a message does not mean the lawyer has answered it.
// The Today tile counts the first; the pill on each row is the second.

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, EmptyState } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { firmStaff, requestedFirmId, staffContext, staffLabel } from "@/lib/firm-data";
import { relativeLabel } from "@/lib/relative";
import type { FirmThread } from "@/lib/db/types";

export const metadata = { title: "Messages" };

const LIMIT = 100;
type View = "all" | "awaiting" | "unread";

interface MatterLabel { id: string; title: string; reference: string }
interface ApptLabel { id: string; reference: string; client: { full_name: string | null } | null }
interface LastMessage { id: string; body: string | null; sender_id: string | null }

export default async function FirmMessages({ searchParams }: { searchParams: Promise<{ firm?: string; view?: string }> }) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));
  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
      </Alert>
    );
  }
  const view: View = sp.view === "awaiting" || sp.view === "unread" ? sp.view : "all";
  const { supabase, firmId } = ctx;

  const { data: threadRows, error } = await supabase
    .from("firm_threads")
    .select("*")
    .eq("firm_id", firmId)
    .order("last_message_at", { ascending: false })
    .limit(LIMIT);
  const all = (threadRows ?? []) as FirmThread[];
  const threads = all.filter((t) => (view === "all" ? true : view === "awaiting" ? !t.last_from_firm : t.unread_for_me > 0));

  // Names for the rows: the matter or the consultation each thread belongs to, and who said the
  // last thing. Three small reads, only for the threads on screen.
  const matterIds = Array.from(new Set(threads.map((t) => t.matter_id).filter((x): x is string => Boolean(x))));
  const apptIds = Array.from(new Set(threads.map((t) => t.appointment_id).filter((x): x is string => Boolean(x))));
  const matters = matterIds.length
    ? (((await supabase.from("matters").select("id, title, reference").in("id", matterIds)).data ?? []) as MatterLabel[])
    : [];
  const appts = apptIds.length
    ? (((await supabase.from("appointments").select("id, reference, client:profiles!appointments_client_id_fkey(full_name)").in("id", apptIds)).data ?? []) as unknown as ApptLabel[])
    : [];
  const lasts = threads.length
    ? (((await supabase.from("messages").select("id, body, sender_id").in("id", threads.map((t) => t.last_message_id))).data ?? []) as LastMessage[])
    : [];
  const staff = await firmStaff(supabase, firmId);
  const staffById = new Map(staff.map((m) => [m.user_id, staffLabel(m)]));
  const senderIds = Array.from(new Set(lasts.map((l) => l.sender_id).filter((x): x is string => Boolean(x) && !staffById.has(x as string))));
  const senders = senderIds.length
    ? (((await supabase.from("profiles").select("id, full_name").in("id", senderIds)).data ?? []) as Array<{ id: string; full_name: string | null }>)
    : [];
  const senderName = (id: string | null) =>
    id === ctx.userId ? "You" : (id && (staffById.get(id) ?? senders.find((s) => s.id === id)?.full_name)) || "Client";

  const matterById = new Map(matters.map((m) => [m.id, m]));
  const apptById = new Map(appts.map((a) => [a.id, a]));
  const lastById = new Map(lasts.map((l) => [l.id, l]));
  const nowMs = Date.now();
  const awaiting = all.filter((t) => !t.last_from_firm).length;
  const unread = all.filter((t) => t.unread_for_me > 0).length;

  const href = (v: View) => {
    const p = new URLSearchParams();
    if (sp.firm) p.set("firm", sp.firm);
    if (v !== "all") p.set("view", v);
    const qs = p.toString();
    return qs ? `/firm/messages?${qs}` : "/firm/messages";
  };
  const chip = (active: boolean) =>
    cn("flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm", active ? "border-[#141414] bg-[#141414] text-white" : "border-gray-300 bg-white text-gray-700");

  const target = (t: FirmThread) =>
    t.matter_id ? `/firm/matters/${t.matter_id}?tab=messages` : `/firm/appointments/${t.appointment_id}`;
  const title = (t: FirmThread) => {
    if (t.matter_id) { const m = matterById.get(t.matter_id); return m ? m.title : "A matter"; }
    const a = t.appointment_id ? apptById.get(t.appointment_id) : null;
    return a ? `Consultation ${a.reference}${a.client?.full_name ? ` · ${a.client.full_name}` : ""}` : "A consultation";
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Messages</h1>
        <p className="mt-0.5 text-[12.5px] text-[#57534E]">
          {ctx.firmName} · {awaiting === 0 ? "nothing awaiting a reply" : `${awaiting} awaiting a reply`} · {unread === 0 ? "nothing unread by you" : `${unread} unread by you`}
        </p>
      </div>

      <nav aria-label="Which threads" className="-mx-4 flex gap-2 overflow-x-auto px-4">
        <Link href={href("all")} className={chip(view === "all")} aria-current={view === "all" ? "page" : undefined}>All</Link>
        <Link href={href("awaiting")} className={chip(view === "awaiting")} aria-current={view === "awaiting" ? "page" : undefined}>Awaiting reply{awaiting > 0 && <span className="opacity-70">· {awaiting}</span>}</Link>
        <Link href={href("unread")} className={chip(view === "unread")} aria-current={view === "unread" ? "page" : undefined}>Unread by me{unread > 0 && <span className="opacity-70">· {unread}</span>}</Link>
      </nav>

      {error && <Alert kind="error" title="This screen could not read the threads">{error.message}</Alert>}

      <Card>
        {threads.length === 0 ? (
          <EmptyState
            title={view === "awaiting" ? "Nothing is waiting on the firm" : view === "unread" ? "You have read everything" : "No messages yet"}
            hint={view === "all" ? "Threads live on matters and consultations; they appear here as they start." : "The other views may have more."}
          />
        ) : (
          <ul>
            {threads.map((t) => {
              const last = lastById.get(t.last_message_id);
              const preview = last?.body ? last.body.replace(/\s+/g, " ").slice(0, 110) : "Attachment";
              return (
                <li key={t.last_message_id}>
                  <Link href={target(t)} className="flex items-start justify-between gap-3 border-t border-[#F0EEEA] px-[15px] py-3.5 first:border-t-0 hover:bg-gray-50">
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-semibold text-[#141414]">{title(t)}</span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-[#57534E]">
                        <span className="font-medium text-[#141414]">{senderName(last?.sender_id ?? null)}:</span> {preview}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[#57534E]">
                        {relativeLabel(t.last_message_at, nowMs)}
                        {!t.last_from_firm && <Badge tone="waiting" icon="clock">Awaiting reply</Badge>}
                      </span>
                    </span>
                    {t.unread_for_me > 0 && (
                      <span aria-label={`${t.unread_for_me} unread`} className="grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full bg-[#141414] px-1.5 text-[11px] font-bold text-white">
                        {t.unread_for_me}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {all.length === LIMIT && (
        <p className="text-[12px] text-[#57534E]">Showing the {LIMIT} threads with the most recent activity.</p>
      )}
    </div>
  );
}
