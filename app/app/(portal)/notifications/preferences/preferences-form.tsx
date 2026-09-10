"use client";

import { useState } from "react";
import { savePreferences } from "@/lib/actions/portal";
import { PREFERENCE_CHANNELS, PREFERENCE_EVENTS } from "@/lib/notifications-copy";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { NotificationPreference } from "@/lib/db/types";

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
    setMsg(r?.error ? { kind: "error", text: r.error } : { kind: "success", text: "Saved." });
  }

  return (
    <div className="space-y-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-2">Event</th>
              {PREFERENCE_CHANNELS.map((c) => <th key={c.channel} className="py-2 text-center">{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {PREFERENCE_EVENTS.map((e) => (
              <tr key={e.event}>
                <td className="py-2 pr-2 text-gray-800">{e.label}</td>
                {PREFERENCE_CHANNELS.map((c) => {
                  const k = `${e.event}|${c.channel}`;
                  return (
                    <td key={k} className="py-2 text-center">
                      <input type="checkbox" aria-label={`${e.label} by ${c.label}`} className="h-4 w-4" checked={state[k]} onChange={(ev) => setState((s) => ({ ...s, [k]: ev.target.checked }))} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save preferences"}</Button>
    </div>
  );
}
