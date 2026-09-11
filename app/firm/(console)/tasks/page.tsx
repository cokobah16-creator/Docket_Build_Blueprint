// Every open task in the firm, in one queue — with its owner, its matter and how late it is.
//
// Tasks lived only on each matter's Tasks tab, and Today's "Overdue tasks" counter linked to the
// matters list, where nothing said which matter. This is the destination: the counter opens the
// overdue view here, every row names an owner or says "Unassigned" in the colour that means
// something is waiting, and Done is one tap.

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, EmptyState } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { firmStaff, requestedFirmId, staffContext, staffLabel } from "@/lib/firm-data";
import { relativeLabel } from "@/lib/relative";
import type { TaskRow } from "@/lib/db/types";
import { CloseTaskButton } from "./close-button";

export const metadata = { title: "Tasks" };

const LIMIT = 200;
type View = "open" | "overdue" | "mine" | "unassigned" | "done";
const VIEWS: Array<[View, string]> = [["open", "Open"], ["overdue", "Overdue"], ["mine", "Mine"], ["unassigned", "Unassigned"], ["done", "Done"]];

export default async function FirmTasks({ searchParams }: { searchParams: Promise<{ firm?: string; view?: string }> }) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));
  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
      </Alert>
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
  const { data, error } = await q.limit(LIMIT);
  const tasks = (data ?? []) as TaskRow[];

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
    cn("flex min-h-[44px] shrink-0 items-center rounded-full border px-4 text-sm", active ? "border-[#141414] bg-[#141414] text-white" : "border-gray-300 bg-white text-gray-700");

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Tasks</h1>
        <p className="mt-0.5 text-[12.5px] text-[#57534E]">{ctx.firmName} · {tasks.length}{tasks.length === LIMIT ? "+" : ""} {view === "done" ? "closed" : view} · due times in {tz}</p>
      </div>

      <nav aria-label="Which tasks" className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {VIEWS.map(([v, label]) => (
          <Link key={v} href={href(v)} className={chip(view === v)} aria-current={view === v ? "page" : undefined}>{label}</Link>
        ))}
      </nav>

      {error && <Alert kind="error" title="This screen could not read the tasks">{error.message}</Alert>}

      <Card>
        {tasks.length === 0 ? (
          <EmptyState
            title={view === "overdue" ? "Nothing is overdue" : view === "mine" ? "Nothing is assigned to you" : view === "unassigned" ? "Every open task has an owner" : view === "done" ? "Nothing closed yet" : "No open tasks"}
            hint="Tasks are added on a matter's Tasks tab."
          />
        ) : (
          <ul>
            {tasks.map((t) => {
              const late = overdue(t);
              return (
                <li key={t.id} className="flex items-start justify-between gap-3 border-t border-[#F0EEEA] px-[15px] py-3.5 first:border-t-0">
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold text-[#141414]">{t.title}</span>
                    {t.matter_id && (
                      <Link href={`/firm/matters/${t.matter_id}?tab=tasks`} className="mt-0.5 block truncate text-[12.5px] text-[#141414] underline underline-offset-2">
                        {matterTitle.get(t.matter_id) ?? "Open the matter"}
                      </Link>
                    )}
                    <span className="mt-1 block text-[11.5px] text-[#57534E]">
                      {t.assignee_id ? owner.get(t.assignee_id) ?? "A colleague" : <span className="font-semibold text-[#92400E]">Unassigned</span>}
                      {" · "}
                      {t.due_at
                        ? <span className={cn(late && "font-semibold text-[#B42318]")}>{late ? "Overdue, " : "Due "}{relativeLabel(t.due_at, nowMs)} · {fmt.format(new Date(t.due_at))}</span>
                        : "No due date"}
                    </span>
                  </span>
                  {t.status === "open" && <CloseTaskButton taskId={t.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
