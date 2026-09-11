// Client messages: one row per thread — every matter and every consultation
// that has one. The row is the artboard's: title, a mono reference beside the
// firm, the last line of the conversation truncated, and the unread count in
// the firm's own primary.

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { clientTimezone, firmNamesFor } from "@/lib/portal-data";
import { AppCard, AppCardList, AppEmpty, AppScreen, Footnote, ScreenTitle } from "@/components/app";
import { PaperclipIcon } from "@/components/ui/icons";
import type { MessageRow } from "@/lib/db/types";

export const metadata = { title: "Messages" };

interface Thread { key: string; href: string; title: string; subtitle: string; reference: string; last: MessageRow | null; unread: number }

export default async function MessagesPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  const [{ data: matterRows }, { data: apptRows }, { data: msgRows }, tz] = await Promise.all([
    supabase.from("matters").select("id, firm_id, reference, title").is("deleted_at", null).order("opened_at", { ascending: false }).limit(50),
    supabase.from("appointments").select("id, firm_id, reference, starts_at, status").order("starts_at", { ascending: false }).limit(20),
    supabase.from("messages").select("id, firm_id, matter_id, appointment_id, sender_id, body, attachments, read_at, created_at").order("created_at", { ascending: false }).limit(300),
    clientTimezone(supabase, user.id),
  ]);
  const matters = (matterRows ?? []) as Array<{ id: string; firm_id: string; reference: string; title: string }>;
  const appts = (apptRows ?? []) as Array<{ id: string; firm_id: string; reference: string; starts_at: string; status: string }>;
  const messages = (msgRows ?? []) as MessageRow[];
  const firmNames = await firmNamesFor([...matters.map((m) => m.firm_id), ...appts.map((a) => a.firm_id)]);
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz });

  const threads: Thread[] = [
    ...matters.map((m) => {
      const mine = messages.filter((x) => x.matter_id === m.id);
      return { key: `m-${m.id}`, href: `/app/matters/${m.id}?tab=messages`, title: m.title, subtitle: firmNames[m.firm_id] ?? "Your firm", reference: m.reference, last: mine[0] ?? null, unread: mine.filter((x) => x.sender_id !== user.id && !x.read_at).length };
    }),
    ...appts.filter((a) => messages.some((x) => x.appointment_id === a.id) || ["confirmed", "rescheduled"].includes(a.status)).map((a) => {
      const mine = messages.filter((x) => x.appointment_id === a.id);
      return { key: `a-${a.id}`, href: `/app/messages/appointment/${a.id}`, title: `Consultation ${a.reference}`, subtitle: `${fmt.format(new Date(a.starts_at))} · ${firmNames[a.firm_id] ?? "Your firm"}`, reference: "", last: mine[0] ?? null, unread: mine.filter((x) => x.sender_id !== user.id && !x.read_at).length };
    }),
  ].sort((a, b) => (b.last?.created_at ?? "").localeCompare(a.last?.created_at ?? ""));

  return (
    <AppScreen>
      <ScreenTitle>Messages</ScreenTitle>

      <AppCard>
        {threads.length === 0 ? (
          <AppEmpty title="No conversations yet" hint="Each matter and consultation has its own secure thread with your firm." />
        ) : (
          <AppCardList>
            {threads.map((t) => (
              <Link key={t.key} href={t.href} className="flex items-start justify-between gap-3 px-4 py-3.5">
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold leading-[1.35] text-dk-strong">{t.title}</span>
                  <span className="mt-[3px] block text-[12px] leading-snug text-dk-muted">
                    {t.reference && <span className="font-mono">{t.reference}</span>}
                    {t.reference ? " · " : ""}
                    {t.subtitle}
                  </span>
                  {t.last && (
                    <span className="mt-1 flex items-center gap-1.5 text-[12px] leading-snug text-dk-soft">
                      {!t.last.body && <PaperclipIcon size={13} className="flex-none" />}
                      <span className="truncate">
                        {t.last.sender_id === user.id ? "You: " : ""}
                        {t.last.body ?? "Attachment"}
                      </span>
                    </span>
                  )}
                </span>
                {t.unread > 0 && (
                  <span className="flex-none">
                    <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-dk-pri px-1.5 text-[11px] font-bold leading-none text-dk-on-pri">
                      {t.unread}
                    </span>
                    <span className="sr-only">unread</span>
                  </span>
                )}
              </Link>
            ))}
          </AppCardList>
        )}
      </AppCard>

      <Footnote>Each matter and consultation has its own secure thread with your firm.</Footnote>
    </AppScreen>
  );
}
