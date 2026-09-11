"use client";

// The file's to-do list: what has to be done on this matter, by whom, by when.
//
// Rules enforced here: createTask() and closeTask() run as the signed-in staff
// member, so the tasks policy (staff_w) is the authorization and no service key
// is used. A due date is typed in the viewer's own zone and sent as a UTC
// instant, because the database keeps UTC. Anything already past its due date
// carries #B42318 and the word "Overdue" — the console's one use of colour,
// and never the only signal. The firm's overdue counter on Today counts
// exactly these rows.

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { closeTask, createTask } from "@/lib/actions/matters";
import { Alert } from "@/components/ui/alert";
import { AppButton } from "@/components/app/button";
import { ChevronDownIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { TaskRow } from "@/lib/db/types";

const field =
  "mt-1.5 min-h-[44px] w-full rounded-[9px] border border-dk-field bg-white px-3 py-[11px] text-[14px] text-dk-strong placeholder:text-dk-muted focus:border-dk-pri focus:outline-none";
const labelClass = "text-[13px] font-semibold text-dk-strong";
/** Required is said in words: colour here means late, unpaid or waiting on you. */
const requiredMark = <span className="font-normal text-dk-muted">(required)</span>;

/**
 * The UTC instant for a wall-clock date and time in `tz`. Two passes, because
 * the offset itself depends on the instant.
 */
function zonedInstant(ymd: string, hhmm: string, tz: string): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const wanted = Date.UTC(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, 0);
  let ts = wanted;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ts));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    ts -= asUtc - wanted;
  }
  return new Date(ts).toISOString();
}

/** "today", "in 3 days", "5 days ago" — how a deadline reads to a busy lawyer. */
function dueLabel(iso: string, nowMs: number): string {
  const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  const days = Math.round((new Date(iso).getTime() - nowMs) / 86_400_000);
  if (Math.abs(days) < 1) {
    const hours = Math.round((new Date(iso).getTime() - nowMs) / 3_600_000);
    return rtf.format(hours, "hour");
  }
  if (Math.abs(days) < 14) return rtf.format(days, "day");
  return rtf.format(Math.round(days / 7), "week");
}

export function TasksPanel({
  firmId, matterId, tasks, staff, timezone,
}: {
  firmId: string;
  matterId: string;
  tasks: TaskRow[];
  staff: Array<{ id: string; label: string }>;
  timezone: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [dueTime, setDueTime] = useState("17:00");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  // After mount only: a clock read during render would not match the server's.
  useEffect(() => setNow(Date.now()), []);

  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status !== "open");
  const nameById = new Map(staff.map((m) => [m.id, m.label]));
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await createTask({
      firmId,
      matterId,
      title: title.trim(),
      dueAt: dueDay ? zonedInstant(dueDay, dueTime || "17:00", timezone) : null,
      assigneeId: assignee || null,
    });
    setBusy(false);
    if (result?.error) { setError(result.error); return; }
    setTitle("");
    setDueDay("");
    setAssignee("");
    router.refresh();
  }

  async function close(taskId: string) {
    setError(null);
    setClosing(taskId);
    const result = await closeTask(taskId);
    setClosing(null);
    if (result?.error) { setError(result.error); return; }
    router.refresh();
  }

  const isOverdue = (t: TaskRow) => Boolean(now && t.due_at && new Date(t.due_at).getTime() < now);
  const overdueCount = open.filter(isOverdue).length;

  return (
    <div className="divide-y divide-dk-rule">
      {error && <div className="px-[15px] py-[15px]"><Alert kind="error" title="That was refused">{error}</Alert></div>}

      <section className="px-[15px] py-[15px]">
        <h3 className="font-app-head text-[15.5px] font-semibold text-dk-strong">Add a task</h3>
        <form onSubmit={add} className="mt-3 flex flex-col gap-3">
          <div>
            <label htmlFor="task-title" className={labelClass}>What has to be done {requiredMark}</label>
            <input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              placeholder="File the written address"
              className={field}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="task-due-day" className={labelClass}>Due</label>
              <input id="task-due-day" type="date" value={dueDay} onChange={(e) => setDueDay(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="task-due-time" className={labelClass}>By</label>
              <input id="task-due-time" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} disabled={!dueDay} className={field} />
            </div>
            <div>
              <label htmlFor="task-assignee" className={labelClass}>Who</label>
              <select id="task-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
                <option value="">Anyone in the firm</option>
                {staff.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11.5px] leading-snug text-dk-muted">Times are in {timezone}.</p>
          <AppButton type="submit" variant="primary-sm" disabled={busy || title.trim().length < 2}>
            {busy ? "Adding…" : "Add the task"}
          </AppButton>
        </form>
      </section>

      <section className="px-[15px] py-[15px]">
        <h3 className="font-app-head text-[15.5px] font-semibold text-dk-strong">
          Open{" "}
          {open.length > 0 && (
            <span className="text-[13px] font-normal text-dk-muted">
              ({open.length}
              {overdueCount > 0 ? `, ${overdueCount} overdue` : ""})
            </span>
          )}
        </h3>
        {open.length === 0 ? (
          <p className="mt-2 text-[12.5px] leading-relaxed text-dk-soft">
            Nothing outstanding on this matter. Add the next step above so it shows on Today and nobody has to remember it.
          </p>
        ) : (
          <ul className="mt-2.5 divide-y divide-dk-rule">
            {open.map((t) => {
              const overdue = isOverdue(t);
              return (
                <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className={cn("text-[13.5px] font-semibold leading-[1.35]", overdue ? "text-[#B42318]" : "text-dk-strong")}>
                      {t.title}
                    </p>
                    <p className={cn("mt-[3px] text-[11.5px] leading-[1.45]", overdue ? "font-semibold text-[#B42318]" : "text-dk-soft")}>
                      {t.due_at
                        ? `${overdue ? "Overdue — was due " : "Due "}${fmt.format(new Date(t.due_at))}${now ? ` (${dueLabel(t.due_at, now)})` : ""}`
                        : "No date fixed"}
                      {t.assignee_id ? ` · ${nameById.get(t.assignee_id) ?? "A colleague"}` : " · anyone in the firm"}
                    </p>
                  </div>
                  <AppButton variant="ghost-sm" disabled={closing === t.id} onClick={() => close(t.id)}>
                    {closing === t.id ? "Closing…" : "Mark done"}
                  </AppButton>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section className="px-[15px] py-[15px]">
          <details className="group">
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
              <span className="flex-1 text-[13px] font-semibold text-dk-pri underline underline-offset-2">
                Done ({done.length})
              </span>
              <span aria-hidden="true" className="flex-none text-dk-muted transition group-open:rotate-180">
                <ChevronDownIcon size={16} />
              </span>
            </summary>
            <ul className="mt-2.5 divide-y divide-dk-rule">
              {done.map((t) => (
                <li key={t.id} className="py-3">
                  <p className="text-[13px] leading-[1.35] text-dk-soft line-through">{t.title}</p>
                  <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-muted">
                    {t.due_at ? `Was due ${fmt.format(new Date(t.due_at))}` : "No date fixed"}
                    {t.assignee_id ? ` · ${nameById.get(t.assignee_id) ?? "A colleague"}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}
