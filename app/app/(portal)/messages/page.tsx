import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { clientTimezone, firmNamesFor } from "@/lib/portal-data";
import { Card, CardBody, EmptyState } from "@/components/ui/card";
import type { MessageRow } from "@/lib/db/types";

export const metadata = { title: "Messages" };

interface Thread { key: string; href: string; title: string; subtitle: string; last: MessageRow | null; unread: number }

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
      return { key: `m-${m.id}`, href: `/app/matters/${m.id}?tab=messages`, title: m.title, subtitle: `${m.reference} · ${firmNames[m.firm_id] ?? "Your firm"}`, last: mine[0] ?? null, unread: mine.filter((x) => x.sender_id !== user.id && !x.read_at).length };
    }),
    ...appts.filter((a) => messages.some((x) => x.appointment_id === a.id) || ["confirmed", "rescheduled"].includes(a.status)).map((a) => {
      const mine = messages.filter((x) => x.appointment_id === a.id);
      return { key: `a-${a.id}`, href: `/app/messages/appointment/${a.id}`, title: `Consultation ${a.reference}`, subtitle: `${fmt.format(new Date(a.starts_at))} · ${firmNames[a.firm_id] ?? "Your firm"}`, last: mine[0] ?? null, unread: mine.filter((x) => x.sender_id !== user.id && !x.read_at).length };
    }),
  ].sort((a, b) => (b.last?.created_at ?? "").localeCompare(a.last?.created_at ?? ""));

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold text-brand">Messages</h1>
      <Card>
        {threads.length === 0 ? (
          <EmptyState title="No conversations yet" hint="Each matter and consultation has its own secure thread with your firm." />
        ) : (
          <CardBody className="divide-y divide-gray-100 p-0">
            {threads.map((t) => (
              <Link key={t.key} href={t.href} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-gray-50">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{t.title}</p>
                  <p className="truncate text-xs text-gray-500">{t.subtitle}</p>
                  {t.last && <p className="mt-1 truncate text-xs text-gray-600">{t.last.sender_id === user.id ? "You: " : ""}{t.last.body ?? "📎 attachment"} · {fmt.format(new Date(t.last.created_at))}</p>}
                </div>
                {t.unread > 0 && <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">{t.unread}</span>}
              </Link>
            ))}
          </CardBody>
        )}
      </Card>
    </div>
  );
}
