"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { rescheduleAppointment } from "@/lib/actions/video";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { AppointmentSlot } from "@/lib/db/types";

export function RescheduleForm({
  appointmentId, firmId, lawyerId, serviceId, timezone,
}: { appointmentId: string; firmId: string; lawyerId: string | null; serviceId: string | null; timezone: string }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<AppointmentSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!date || !lawyerId || !serviceId) { setSlots([]); return; }
    const supabase = supabaseBrowser();
    if (!supabase) return;
    let cancelled = false;
    setLoading(true);
    setStartsAt("");
    supabase
      .rpc("available_slots", { p_firm: firmId, p_lawyer: lawyerId, p_service: serviceId, p_date: date, p_ignore: appointmentId })
      .then(({ data, error: rpcError }: { data: AppointmentSlot[] | null; error: { message: string } | null }) => {
        if (cancelled) return;
        setLoading(false);
        if (rpcError) { setError(rpcError.message); setSlots([]); return; }
        setSlots(data ?? []);
      });
    return () => { cancelled = true; };
  }, [appointmentId, date, firmId, lawyerId, serviceId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await rescheduleAppointment(appointmentId, startsAt, reason);
    setBusy(false);
    if (r?.error) { setError(r.error); return; }
    setDone(true);
    router.refresh();
  }

  if (!lawyerId || !serviceId) return <p className="text-sm text-gray-500">This appointment has no lawyer or service, so it cannot be moved here.</p>;
  if (done) return <Alert kind="success">Moved. The client has been notified and reminders were reset.</Alert>;

  const fmt = new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: timezone });
  const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {error && <Alert kind="error">{error}</Alert>}
      <div>
        <label htmlFor="rs_date" className="text-sm font-medium text-gray-900">New date</label>
        <input id="rs_date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor="rs_slot" className="text-sm font-medium text-gray-900">Time ({timezone})</label>
        <select id="rs_slot" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={field} disabled={!date || loading}>
          <option value="">{loading ? "Loading slots…" : slots.length ? "Choose a time" : date ? "No free slots that day" : "Pick a date first"}</option>
          {slots.map((s) => (
            <option key={s.starts_at} value={s.starts_at}>{fmt.format(new Date(s.starts_at))} – {fmt.format(new Date(s.ends_at))}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="rs_reason" className="text-sm font-medium text-gray-900">Reason (audit only)</label>
        <input id="rs_reason" type="text" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
      </div>
      <Button type="submit" variant="ghost" disabled={!startsAt || busy}>{busy ? "Moving…" : "Move appointment"}</Button>
      <p className="text-xs text-gray-500">Only slots the booking engine would offer are shown. The client is notified and reminders start again.</p>
    </form>
  );
}
