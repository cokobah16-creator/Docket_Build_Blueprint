// Every open task in the firm, in one queue — with its owner, its matter and how late it is.
//
// Tasks lived only on each matter's Tasks tab, and Today's "Overdue tasks" counter linked to the
// matters list, where nothing said which matter. This is the destination: the counter opens the
// overdue view here, every row names an owner or says "Unassigned" in the colour that means
// something is waiting, and Done is one tap.

import { WorkspaceUnavailable } from "@/components/ui/unavailable";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, EmptyState } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { firmStaff, requestedFirmId, staffContext, staffLabel } from "@/lib/firm-data";
import { relativeLabel } from "@/lib/relative";
import { formatDay, todayIn } from "@/lib/days";
import type { TaskRow } from "@/lib/db/types";
import { CloseTaskButton } from "./close-button";

export const metadata = { title: "Tasks" };

const LIMIT = 200;
type View = "open" | "overdue" | "mine" | "unassigned" | "done" | "next";
const VIEWS: Array<[View, string]> = [["open", "Open"], ["overdue", "Overdue"], ["mine", "Mine"], ["unassigned", "Unassigned"], ["next", "Next actions"], ["done", "Done"]];

/** A live matter's next action, as the queue shows it. */
interface NextActionRow { id: string; title: string; reference: string; next_action: string; next_action_owner_id: string | null; next_action_due: string | null }

export default async function FirmTasks({ searchParams }: { searchParams: Promise<{ firm?: string; view?: string }> }) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));
  if (!ctx) {
    return (
      <WorkspaceUnavailable audience="staff" />
    );
  }
  const view: View = VIEWS.some(([v]) => v === sp.view) ? (sp.view as View) : "open";
  const { supabase, firmId, timezone: tz } = ctx;
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  let q = supabase.from("tasks").select("*").eq("firm_id", firmId);
  if (view === "done") q = q.neq("status", "open").order("created_at", { ascending: false });
  else {
    q = q.eq("status", "open");
    if (view === "overdue") q = q.lt("due_at", nowIso);
    if (view === "mine") q = q.eq("assignee_id", ctx.userId);
    if (view === "unassigned") q = q.is("assignee_id", null);
    q = q.order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true });
  }
  const { data, error } = view === "next" ? { data: [], error: null } : await q.limit(LIMIT);
  const tasks = (data ?? []) as TaskRow[];

  // Next actions are on the matter, not in tasks: one per live matter, with an owner and a due
  // day since migration 26. Shown here because this is where the firm looks for its work.
  const nextActions: NextActionRow[] = view === "next"
    ? (((await supabase.from("matters").select("id, title, reference, next_action, next_action_owner_id, next_action_due")
        .eq("firm_id", firmId).is("deleted_at", null).is("closed_at", null).not("next_action", "is", null)
        .order("next_action_due", { ascending: true, nullsFirst: false }).limit(LIMIT)).data ?? []) as NextActionRow[])
    : [];
  const today = todayIn(tz);

  const matterIds = Array.from(new Set(tasks.map((t) => t.matter_id).filter((x): x is string => Boolean(x))));
  const matters = matterIds.length
    ? (((await supabase.from("matters").select("id, title").in("id", matterIds)).data ?? []) as Array<{ id: string; title: string }>)
    : [];
  const matterTitle = new Map(matters.map((m) => [m.id, m.title]));
  const staff = await firmStaff(supabase, firmId);
  const owner = new Map(staff.map((m) => [m.user_id, staffLabel(m)]));
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz });
  const overdue = (t: TaskRow) => Boolean(t.due_at && new Date(t.due_at).getTime() < nowMs && t.status === "open");

  const href = (v: View) => {
    const p = new URLSearchParams();
    if (sp.firm) p.set("firm", sp.firm);
    if (v !== "open") p.set("view", v);
    const qs = p.toString();
    return qs ? `/firm/tasks?${qs}` : "/firm/tasks";
  };
  const chip = (active: boolean) =>
    cn("flex min-h-11 shrink-0 items-center rounded-control border px-3 text-13 font-medium", active ? "border-ink-strong bg-ink-strong text-paper" : "border-hairline bg-raised text-ink hover:border-edge");

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <h1 className="text-21 font-semibold tracking-[-0.01em] text-ink-strong md:text-26">Tasks</h1>
        <p className="mt-0.5 text-13 text-ink-muted">{ctx.firmName} · {tasks.length}{tasks.length === LIMIT ? "+" : ""} {view === "done" ? "closed" : view} · due times in {tz}</p>
      </div>

      <nav aria-label="Which tasks" className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {VIEWS.map(([v, label]) => (
          <Link key={v} href={href(v)} className={chip(view === v)} aria-current={view === v ? "page" : undefined}>{label}</Link>
        ))}
      </nav>

      {error && <Alert kind="error" title="Tasks could not be loaded">Nothing has been changed. Refresh the page to try again; if it keeps happening, tell your firm&apos;s administrator.</Alert>}

      {view === "next" ? (
        <Card>
          {nextActions.length === 0 ? (
            <EmptyState title="No matter has a next action recorded" hint="Set one on the matter's Details tab, with who is on it and the day it is due by." />
          ) : (
            <ul>
              {nextActions.map((m) => {
                const late = Boolean(m.next_action_due && m.next_action_due < today);
                return (
                  <li key={m.id} className="border-t border-hairline px-3 py-3.5 first:border-t-0">
                    <span className="block text-13 font-semibold text-ink-strong">{m.next_action}</span>
                    <Link href={`/firm/matters/${m.id}?tab=edit`} className="mt-0.5 block truncate text-13 text-ink-strong underline underline-offset-2">
                      {m.title} <span className="font-mono text-ink-muted">{m.reference}</span>
                    </Link>
                    <span className="mt-1 block text-11 text-ink-muted">
                      {m.next_action_owner_id ? owner.get(m.next_action_owner_id) ?? "A colleague" : <span className="font-semibold text-waiting-ink">Nobody on it</span>}
                      {" · "}
                      {m.next_action_due
                        ? <span className={cn(late && "font-semibold text-wrong-ink")}>{late ? "Overdue, was due " : "Due "}{formatDay(m.next_action_due)}</span>
                        : "No due day"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : (
      <section aria-label="Tasks" className="overflow-hidden rounded-card border border-hairline bg-raised">
        {tasks.length === 0 ? (
          <EmptyState
            title={view === "overdue" ? "Nothing is overdue" : view === "mine" ? "Nothing is assigned to you" : view === "unassigned" ? "Every open task has an owner" : view === "done" ? "Nothing closed yet" : "No open tasks"}
            hint="Tasks belong to a matter. Open the matter and use its Tasks tab to add one, with an owner and a due date."
            action={<Link href="/firm/matters" className={buttonClasses("ghost", "sm")}>Go to matters</Link>}
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table minWidth="48rem" caption="Tasks">
                <THead>
                  <tr>
                    <TH className="w-[34%]">Task</TH>
                    <TH>Matter</TH>
                    <TH>Assignee</TH>
                    <TH>Due</TH>
                    <TH>Status</TH>
                    <TH className="text-right"><span className="sr-only">Action</span></TH>
                  </tr>
                </THead>
                <TBody>
                  {tasks.map((t) => {
                    const late = overdue(t);
                    return (
                      <TR key={t.id}>
                        <TD className="font-semibold text-ink-strong">{t.title}</TD>
                        <TD>
                          {t.matter_id
                            ? <Link href={`/firm/matters/${t.matter_id}?tab=tasks`} className="underline-offset-2 hover:underline">{matterTitle.get(t.matter_id) ?? "Open the matter"}</Link>
                            : <span className="text-ink-muted">No matter</span>}
                        </TD>
                        <TD>{t.assignee_id ? owner.get(t.assignee_id) ?? "A colleague" : <span className="font-semibold text-waiting-ink">Unassigned</span>}</TD>
                        <TD className="whitespace-nowrap">
                          {t.due_at
                            ? <span className={cn(late && "font-semibold text-wrong-ink")}>{fmt.format(new Date(t.due_at))}<span className="block text-11 font-normal text-ink-muted">{relativeLabel(t.due_at, nowMs)}</span></span>
                            : <span className="text-ink-muted">No due date</span>}
                        </TD>
                        <TD>{t.status !== "open" ? <StatusPill status="completed" label="Done" /> : late ? <StatusPill status="overdue" /> : <StatusPill status="pending" label="Open" />}</TD>
                        <TD className="text-right">{t.status === "open" && <CloseTaskButton taskId={t.id} />}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
            <ul className="divide-y divide-hairline md:hidden">
              {tasks.map((t) => {
                const late = overdue(t);
                return (
                  <li key={t.id} className="flex items-start justify-between gap-3 px-3 py-3">
                    <span className="min-w-0">
                      <span className="block text-15 font-semibold text-ink-strong">{t.title}</span>
                      {t.matter_id && (
                        <Link href={`/firm/matters/${t.matter_id}?tab=tasks`} className="mt-0.5 block truncate text-13 text-ink underline underline-offset-2">
                          {matterTitle.get(t.matter_id) ?? "Open the matter"}
                        </Link>
                      )}
                      <span className="mt-1 block text-13 text-ink-muted">
                        {t.assignee_id ? owner.get(t.assignee_id) ?? "A colleague" : <span className="font-semibold text-waiting-ink">Unassigned</span>}
                        {" · "}
                        {t.due_at
                          ? <span className={cn(late && "font-semibold text-wrong-ink")}>{late ? "Overdue, " : "Due "}{relativeLabel(t.due_at, nowMs)}</span>
                          : "No due date"}
                      </span>
                    </span>
                    {t.status === "open" && <CloseTaskButton taskId={t.id} />}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      )}
    </div>
  );
}
