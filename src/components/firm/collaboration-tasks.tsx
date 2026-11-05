"use client";

// Shared tasks on a live arrangement, from whichever side you are on. Either firm may set a task
// for either firm; the firm it is assigned to marks it done and the firm that set it may cancel
// it. create_collaboration_task() and close_collaboration_task() decide each of those again, and
// both refuse once the arrangement is no longer live.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/days";
import { closeCollaborationTask, createCollaborationTask } from "@/lib/actions/network";
import type { CollaborationTaskRow } from "@/lib/db/types";

const field = "mt-1 block min-h-11 w-full rounded-lg border border-edge bg-raised px-3 text-base text-ink";

export function CollaborationTasks({
  collaborationId, myFirmId, otherFirmId, otherFirmName, tasks, live, today,
}: {
  collaborationId: string;
  myFirmId: string;
  otherFirmId: string;
  otherFirmName: string;
  tasks: CollaborationTaskRow[];
  live: boolean;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", detail: "", dueOn: "", assignTo: otherFirmId });

  const openTasks = tasks.filter((t) => t.status === "open");
  const closed = tasks.filter((t) => t.status !== "open");
  const who = (id: string) => (id === myFirmId ? "us" : otherFirmName);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy("add");
    setError(null);
    const r = await createCollaborationTask(collaborationId, form.assignTo, { title: form.title, detail: form.detail, dueOn: form.dueOn });
    setBusy(null);
    if (r?.error) {
      setError(r.error);
      return;
    }
    setForm({ title: "", detail: "", dueOn: "", assignTo: otherFirmId });
    setOpen(false);
    router.refresh();
  }

  async function close(id: string, status: "done" | "cancelled") {
    setBusy(id);
    setError(null);
    const r = await closeCollaborationTask(id, status);
    setBusy(null);
    if (r?.error) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  if (!live && tasks.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg bg-sunken p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-13 font-semibold text-ink-strong">
          Shared tasks{openTasks.length ? ` (${openTasks.length} open)` : ""}
        </p>
        {live && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? "Cancel" : "Set a task"}</Button>
        )}
      </div>

      {error && <div className="mt-2"><Alert kind="error" title="That was refused">{error}</Alert></div>}

      {open && live && (
        <form onSubmit={add} className="mt-2 space-y-2">
          <label className="block text-13 text-ink">What has to be done
            <input required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={field} />
          </label>
          <label className="block text-13 text-ink">Detail (optional)
            <input maxLength={2000} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} className={field} />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-13 text-ink">For
              <select value={form.assignTo} onChange={(e) => setForm({ ...form, assignTo: e.target.value })} className={field}>
                <option value={otherFirmId}>{otherFirmName}</option>
                <option value={myFirmId}>Our firm</option>
              </select>
            </label>
            <label className="block text-13 text-ink">Due (optional)
              <input type="date" min={today} value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} className={field} />
            </label>
          </div>
          <Button type="submit" size="sm" disabled={busy === "add"}>{busy === "add" ? "Setting…" : "Set the task"}</Button>
        </form>
      )}

      {tasks.length === 0 ? (
        <p className="mt-1 text-13 text-ink-muted">No tasks yet. Both firms see every task set here.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {[...openTasks, ...closed].map((t) => {
            const overdue = t.status === "open" && t.due_on !== null && t.due_on < today;
            return (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={t.status === "open" ? "text-13 font-medium text-ink" : "text-13 text-ink-muted line-through"}>{t.title}</p>
                  <p className="text-11 text-ink-muted">
                    For {who(t.assigned_firm_id)} · set by {who(t.firm_id)}
                    {t.due_on ? ` · due ${formatDay(t.due_on)}` : ""}
                    {overdue ? " · overdue" : ""}
                    {t.status !== "open" ? ` · ${t.status}` : ""}
                  </p>
                  {t.detail && <p className="mt-0.5 text-13 text-ink-muted">{t.detail}</p>}
                </div>
                {live && t.status === "open" && (
                  <div className="flex gap-1.5">
                    {t.assigned_firm_id === myFirmId && (
                      <Button size="sm" disabled={busy === t.id} onClick={() => void close(t.id, "done")}>Done</Button>
                    )}
                    {t.firm_id === myFirmId && (
                      <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => void close(t.id, "cancelled")}>Cancel</Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
