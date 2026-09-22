// Every thread the firm is in, newest activity first — and, on one tap, only the ones the firm
// owes a reply to, or only the ones this person has not read.
//
// Both facts come from firm_threads (migration 25). "Awaiting reply" is derived from who spoke
// last and is the same for every colleague; "unread" is per reader. They are shown apart because
// they are different: a secretary having read a message does not mean the lawyer has answered it.
// The Today tile counts the first; the pill on each row is the second.

import { WorkspaceUnavailable } from "@/components/ui/unavailable";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { MessagesThread } from "@/components/portal/messages-thread";
import { ListDetail, PageHeader } from "@/components/shell/layout";
import type { MessageRow } from "@/lib/db/types";
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

export default async function FirmMessages({ searchParams }: { searchParams: Promise<{ firm?: string; view?: string; thread?: string }> }) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));
  if (!ctx) {
    return (
      <WorkspaceUnavailable audience="staff" />
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
    cn("flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-4 text-15", active ? "border-[#141414] bg-[#141414] text-white" : "border-edge bg-raised text-ink");

  const target = (t: FirmThread) =>
    t.matter_id ? `/firm/matters/${t.matter_id}?tab=messages` : `/firm/appointments/${t.appointment_id}`;
  const title = (t: FirmThread) => {
    if (t.matter_id) { const m = matterById.get(t.matter_id); return m ? m.title : "A matter"; }
    const a = t.appointment_id ? apptById.get(t.appointment_id) : null;
    return a ? `Consultation ${a.reference}${a.client?.full_name ? ` · ${a.client.full_name}` : ""}` : "A consultation";
  };

  /** Which thread ?thread= names. A thread is its matter, or its consultation. */
  const threadKey = (t: FirmThread) => (t.matter_id ? `m-${t.matter_id}` : `a-${t.appointment_id}`);
  /** Back to the list, keeping the firm and the filter that were in force. */
  const backHref = href(view);

  // ── the thread on the right ───────────────────────────────────────────────
  // ?thread=m-<matterId> or a-<appointmentId>. It stays on this route rather
  // than navigating to the matter, so the list keeps its place beside it; the
  // pane still links through to the file itself for everything else.
  const open = threads.find((t) => threadKey(t) === sp.thread) ?? null;
  const openMessages = open
    ? (((await supabase
        .from("messages")
        .select("id, firm_id, matter_id, appointment_id, sender_id, body, attachments, read_at, created_at")
        .eq(open.matter_id ? "matter_id" : "appointment_id", (open.matter_id ?? open.appointment_id) as string)
        .order("created_at", { ascending: true })
        .limit(200)).data ?? []) as MessageRow[])
    : [];
  const names = Object.fromEntries(staff.map((m) => [m.user_id, staffLabel(m)]));

  const threadHref = (t: FirmThread) => {
    const p = new URLSearchParams();
    if (sp.firm) p.set("firm", sp.firm);
    if (view !== "all") p.set("view", view);
    p.set("thread", threadKey(t));
    return `/firm/messages?${p.toString()}`;
  };

  const list = (
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
            const isOpen = threadKey(t) === sp.thread;
            return (
              <li key={t.last_message_id}>
                <Link
                  href={threadHref(t)}
                  aria-current={isOpen ? "page" : undefined}
                  className={cn(
                    "flex items-start justify-between gap-3 border-t border-[#F0EEEA] px-[15px] py-3.5 first:border-t-0",
                    isOpen ? "bg-[#F0EEEA]" : "hover:bg-sunken",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-13 font-semibold text-[#141414]">{title(t)}</span>
                    <span className="mt-0.5 block truncate text-13 text-[#57534E]">
                      <span className="font-medium text-[#141414]">{senderName(last?.sender_id ?? null)}:</span> {preview}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-11 text-[#57534E]">
                      {relativeLabel(t.last_message_at, nowMs)}
                      {!t.last_from_firm && <Badge tone="waiting" icon="clock">Awaiting reply</Badge>}
                    </span>
                  </span>
                  {t.unread_for_me > 0 && (
                    <span aria-label={`${t.unread_for_me} unread`} className="grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full bg-[#141414] px-1.5 text-11 font-bold text-white">
                      {t.unread_for_me}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {all.length === LIMIT && (
        <p className="border-t border-[#F0EEEA] px-[15px] py-3 text-13 text-[#57534E]">
          Showing the {LIMIT} threads with the most recent activity.
        </p>
      )}
    </Card>
  );

  const detail = open ? (
    <Card>
      <CardHeader
        title={title(open)}
        action={
          <Link href={target(open)} className="text-13 font-medium text-[#141414] underline underline-offset-2">
            Open the {open.matter_id ? "matter" : "consultation"}
          </Link>
        }
      />
      <MessagesThread
        firmId={ctx.firmId}
        matterId={open.matter_id}
        appointmentId={open.appointment_id}
        userId={ctx.userId}
        initial={openMessages}
        timezone={ctx.timezone}
        senderNames={names}
        firmName={ctx.firmName}
      />
    </Card>
  ) : (
    <Card className="grid min-h-[320px] place-items-center p-8 text-center">
      <div className="max-w-xs">
        <Icon name="mail" size={28} className="mx-auto text-ink-disabled" />
        <p className="mt-3 text-15 font-semibold text-[#141414]">
          {threads.length > 0 ? "Choose a conversation" : "No conversations yet"}
        </p>
        <p className="mt-1 text-13 leading-relaxed text-[#57534E]">
          Every thread belongs to a matter or a consultation, and opens beside this list.
        </p>
      </div>
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* On a phone an open thread is the whole screen, with a way back to the
          list. From 1024px the list is already beside it, so the bar is gone. */}
      {open ? (
        <div className="lg:hidden">
          <PageHeader
            tone="neutral"
            title={title(open)}
            back={backHref}
            backLabel="All messages"
            actions={
              <Link href={target(open)} className="text-13 font-medium text-[#141414] underline underline-offset-2">
                Open the {open.matter_id ? "matter" : "consultation"}
              </Link>
            }
          />
        </div>
      ) : null}

      <div className={cn(open && "hidden lg:block")}>
        <PageHeader
          tone="neutral"
          title="Messages"
          description={`${ctx.firmName} · ${awaiting === 0 ? "nothing awaiting a reply" : `${awaiting} awaiting a reply`} · ${unread === 0 ? "nothing unread by you" : `${unread} unread by you`}`}
        />
      </div>

      <nav aria-label="Which threads" className={cn("-mx-4 flex gap-2 overflow-x-auto px-4 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8", open && "hidden lg:flex")}>
        <Link href={href("all")} className={chip(view === "all")} aria-current={view === "all" ? "page" : undefined}>All</Link>
        <Link href={href("awaiting")} className={chip(view === "awaiting")} aria-current={view === "awaiting" ? "page" : undefined}>Awaiting reply{awaiting > 0 && <span className="opacity-70">· {awaiting}</span>}</Link>
        <Link href={href("unread")} className={chip(view === "unread")} aria-current={view === "unread" ? "page" : undefined}>Unread by me{unread > 0 && <span className="opacity-70">· {unread}</span>}</Link>
      </nav>

      {error && <Alert kind="error" title="Conversations could not be loaded">Nothing has been changed and no message was lost. Refresh the page to try again.</Alert>}

      <ListDetail listIsScreen={!open} list={list} detail={detail} />

      {/* Said plainly, because the two are not the same thing and must not be
          read as one: process served on the firm is a record with its own
          acknowledgement, not a conversation anyone replies to. */}
      <p className={cn("text-11 leading-relaxed text-[#57534E]", open && "hidden lg:block")}>
        These are client conversations. Process served on this firm is kept apart, in the{" "}
        <Link href="/firm/inbox" className="font-medium text-[#141414] underline underline-offset-2">service inbox</Link>.
      </p>
    </div>
  );
}
