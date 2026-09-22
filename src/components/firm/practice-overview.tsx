import type { StaffContext } from "@/lib/firm-data";
import type { CauseListRow, FirmDeadlineRow, FirmThread } from "@/lib/db/types";
import { formatWhen } from "@/lib/time";
import { formatDay, todayIn } from "@/lib/days";
import { LedgerPanel, LedgerRow } from "@/components/shell/workspace";

/** Read-only summaries, under the same caller/RLS as their destination queues. */
export async function PracticeOverview({ ctx }: { ctx: StaffContext }) {
  const { supabase, firmId, timezone } = ctx;
  const today = todayIn(timezone);
  const query = `firm=${encodeURIComponent(firmId)}`;
  const [diary, deadlines, messages] = await Promise.all([
    supabase.from("firm_cause_list").select("*").eq("firm_id", firmId).gte("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(4),
    supabase.from("firm_deadlines").select("*").eq("firm_id", firmId).in("status", ["confirmed", "proposed"]).order("due_on").limit(4),
    supabase.from("firm_threads").select("*").eq("firm_id", firmId).order("last_message_at", { ascending: false }).limit(4),
  ]);
  const threads = (messages.data ?? []) as FirmThread[];
  const ids = threads.flatMap(t => t.matter_id ? [t.matter_id] : []);
  const titles = ids.length ? await supabase.from("matters").select("id, title").eq("firm_id", firmId).in("id", ids) : { data: [] };
  const names = new Map((titles.data ?? []).map((m: { id: string; title: string }) => [m.id, m.title]));
  return (
    <div className="ledger-grid">
      <LedgerPanel title="Court diary" href={`/firm/sittings?${query}`}>
        {diary.error ? <p className="ledger-empty">Court dates could not be loaded. Open the diary to retry.</p> : !diary.data?.length ? <p className="ledger-empty">No upcoming sittings recorded. Your next court dates will appear here.</p> : (diary.data as CauseListRow[]).map(e => (
          <LedgerRow key={e.court_event_id} href={`/firm/matters/${e.matter_id}?tab=timeline&${query}`} title={e.cause_title} detail={<>{e.court ?? "Court not recorded"}<br />{formatWhen(e.scheduled_at, timezone, { dateStyle: "medium", timeStyle: "short" })}</>} trailing={e.purpose ?? "Sitting"} />
        ))}
      </LedgerPanel>
      <LedgerPanel title="Deadlines" href={`/firm/sittings?${query}`}>
        {deadlines.error ? <p className="ledger-empty">Deadlines could not be loaded. Open the diary to retry.</p> : !deadlines.data?.length ? <p className="ledger-empty">No outstanding deadlines recorded.</p> : (deadlines.data as FirmDeadlineRow[]).map(d => (
          <LedgerRow key={d.id} href={`/firm/matters/${d.matter_id}?tab=deadlines&${query}`} title={d.title} detail={<>{d.cause_title}<br />{formatDay(d.due_on)}{d.status === "proposed" ? " · Awaiting confirmation" : ""}</>} trailing={<span className={d.due_on < today ? "font-semibold text-wrong-ink" : undefined}>{d.due_on < today ? "Overdue" : d.due_on === today ? "Due today" : "Upcoming"}</span>} />
        ))}
      </LedgerPanel>
      <LedgerPanel title="Client messages" href={`/firm/messages?${query}`}>
        {messages.error ? <p className="ledger-empty">Messages could not be loaded. Open your inbox to retry.</p> : !threads.length ? <p className="ledger-empty">No conversations yet. Client messages will appear here.</p> : threads.map(t => (
          <LedgerRow key={t.last_message_id} href={t.matter_id ? `/firm/matters/${t.matter_id}?tab=messages&${query}` : `/firm/messages?${query}`} title={(t.matter_id && names.get(t.matter_id)) || "Consultation conversation"} detail={<>{t.last_from_firm ? "Last reply from your firm" : "Awaiting your firm's reply"}<br />{formatWhen(t.last_message_at, timezone, { dateStyle: "medium", timeStyle: "short" })}</>} trailing={t.unread_for_me ? `${t.unread_for_me} unread` : "Read"} />
        ))}
      </LedgerPanel>
    </div>
  );
}
