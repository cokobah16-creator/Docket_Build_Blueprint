"use client";

import { useState } from "react";
import { savePreferences } from "@/lib/actions/portal";
import { PREFERENCE_CHANNELS, PREFERENCE_EVENTS } from "@/lib/notifications-copy";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { NotificationPreference } from "@/lib/db/types";

// Fifteen rows read as one long list, so they are grouped by what they are about. The groups are
// this screen's alone: the event labels themselves are shared with the console's settings and
// stay as they are. An event missing from every group still shows, under "Other".
const GROUPS: Array<{ title: string; events: string[] }> = [
  {
    title: "Consultations",
    events: [
      "appointment_confirmed", "appointment_held", "appointment_checkin_due", "appointment_reminder_24h",
      "appointment_reminder_1h", "appointment_reminder_10m", "appointment_rescheduled", "appointment_cancelled",
    ],
  },
  { title: "Money", events: ["invoice_issued", "payment_confirmed"] },
  { title: "Matters", events: ["matter_update", "court_date_t3", "court_date_t1", "document_ready_to_sign"] },
  { title: "Messages", events: ["new_message"] },
];

function grouped() {
  const known = new Set(GROUPS.flatMap((g) => g.events));
  const byEvent = new Map(PREFERENCE_EVENTS.map((e) => [e.event, e]));
  const groups = GROUPS.map((g) => ({
    title: g.title,
    events: g.events.map((ev) => byEvent.get(ev)).filter((e): e is (typeof PREFERENCE_EVENTS)[number] => Boolean(e)),
  }));
  const other = PREFERENCE_EVENTS.filter((e) => !known.has(e.event));
  if (other.length > 0) groups.push({ title: "Other", events: other });
  return groups.filter((g) => g.events.length > 0);
}

export function PreferencesForm({ initial }: { initial: NotificationPreference[] }) {
  const [state, setState] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const e of PREFERENCE_EVENTS) for (const c of PREFERENCE_CHANNELS) m[`${e.event}|${c.channel}`] = true;
    for (const p of initial) m[`${p.event}|${p.channel}`] = p.enabled;
    return m;
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const prefs = Object.entries(state).map(([k, enabled]) => {
      const [event, channel] = k.split("|");
      return { event, channel: channel as "push" | "email" | "sms", enabled };
    });
    const r = await savePreferences(prefs);
    setBusy(false);
    setMsg(r?.error ? { kind: "error", text: r.error } : { kind: "success", text: "Your notification preferences are saved." });
  }

  return (
    <div className="space-y-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="overflow-x-auto">
        <table className="w-full text-15">
          <thead>
            <tr className="text-left text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted">
              <th scope="col" className="py-2 pr-2">Notification</th>
              {PREFERENCE_CHANNELS.map((c) => <th key={c.channel} scope="col" className="w-12 py-2 text-center">{c.label}</th>)}
            </tr>
          </thead>
          {/* One <tbody> per group, so its heading row is a real row-group header. */}
          {grouped().map((g) => (
            <tbody key={g.title}>
              <tr>
                <th scope="rowgroup" colSpan={PREFERENCE_CHANNELS.length + 1} className="pb-1 pt-4 text-left text-13 font-semibold text-ink-strong">
                  {g.title}
                </th>
              </tr>
              {g.events.map((e) => (
                <tr key={e.event} className="border-t border-hairline">
                  <td className="py-1 pr-2 text-ink">{e.label}</td>
                  {PREFERENCE_CHANNELS.map((c) => {
                    const k = `${e.event}|${c.channel}`;
                    return (
                      <td key={k} className="py-0.5 text-center">
                        {/* The 44px square is the target and shows the focus ring; the box is
                            drawn at 20px inside it, so a thumb never has to find 16px. */}
                        <label className="inline-grid size-11 cursor-pointer place-items-center rounded-control hover:bg-hover focus-within:outline focus-within:outline-2 focus-within:outline-brand">
                          <input
                            type="checkbox"
                            aria-label={`${e.label} by ${c.label}`}
                            className="size-5 cursor-pointer accent-brand focus:outline-none"
                            checked={state[k]}
                            onChange={(ev) => setState((s) => ({ ...s, [k]: ev.target.checked }))}
                          />
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save preferences"}</Button>
    </div>
  );
}
