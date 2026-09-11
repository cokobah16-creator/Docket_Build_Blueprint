"use client";

// The event × channel matrix.
//
// It is the one thing in the phone app that scrolls sideways: twelve events
// against three channels does not fit a phone's width, and stacking it into
// twelve little cards loses the grid that makes it readable at a glance. So
// the table keeps its shape and takes its own horizontal scroller, the event
// names never wrap, and each checkbox sits in a 44px target so a thumb can
// find it.

import { useState } from "react";
import { savePreferences } from "@/lib/actions/portal";
import { PREFERENCE_CHANNELS, PREFERENCE_EVENTS } from "@/lib/notifications-copy";
import { AppButton } from "@/components/app";
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
    <div className="flex flex-col gap-3.5">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <caption className="sr-only">
            Which notifications to send on which channel
          </caption>
          <thead>
            <tr className="border-b border-dk-rule">
              <th
                scope="col"
                className="whitespace-nowrap py-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-dk-muted"
              >
                Event
              </th>
              {PREFERENCE_CHANNELS.map((c) => (
                <th
                  key={c.channel}
                  scope="col"
                  className="w-11 whitespace-nowrap px-1 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.07em] text-dk-muted"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-dk-rule">
            {PREFERENCE_EVENTS.map((e) => (
              <tr key={e.event}>
                <th
                  scope="row"
                  className="whitespace-nowrap py-1 pr-3 text-left text-[13px] font-medium text-dk-body"
                >
                  {e.label}
                </th>
                {PREFERENCE_CHANNELS.map((c) => {
                  const k = `${e.event}|${c.channel}`;
                  return (
                    <td key={k} className="px-1 py-1 text-center">
                      {/* The label is the 44px target; the input keeps its own
                          announced name, since the column heading alone would
                          not say which row it belongs to. */}
                      <label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          aria-label={`${e.label} by ${c.label}`}
                          className="h-[18px] w-[18px] accent-dk-pri"
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
        </table>
      </div>
      <AppButton onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save preferences"}
      </AppButton>
    </div>
  );
}
