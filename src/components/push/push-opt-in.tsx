"use client";

// Web push opt-in: registers the service worker, subscribes with the VAPID
// public key, and stores the subscription in push_subscriptions (RLS: own
// rows only). The dispatcher Edge Function sends through it.

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SettingRow } from "@/components/ui/switch";

type State = "checking" | "unsupported" | "no-key" | "idle" | "subscribed" | "denied" | "busy" | "error";

function toKey(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function storeSubscription(sub: any): Promise<string | null> {
  const supabase = supabaseBrowser();
  if (!supabase) return "Not configured.";
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "Sign in first.";
  const json = sub.toJSON();
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      { user_id: user.id, endpoint: json.endpoint, keys: json.keys, user_agent: navigator.userAgent.slice(0, 200) },
      { onConflict: "endpoint" },
    );
  return error ? error.message : null;
}

export function PushOptIn({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setState("unsupported"); return; }
    if (!vapid) { setState("no-key"); return; }
    if (Notification.permission === "denied") { setState("denied"); return; }
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          await storeSubscription(existing);
          setState("subscribed");
        } else setState("idle");
      } catch {
        setState("idle");
      }
    })();
  }, [vapid]);

  async function enable() {
    if (!vapid) return;
    setState("busy");
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState("denied"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(vapid) });
      const err = await storeSubscription(sub);
      if (err) { setMessage(err); setState("error"); return; }
      setState("subscribed");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not enable notifications.");
      setState("error");
    }
  }

  if (state === "checking" || state === "unsupported" || state === "no-key") return null;

  const hint = "Court updates and consultation reminders on this device.";
  if (state === "subscribed") {
    if (compact) return null;
    return (
      <SettingRow title="Push notifications" hint={hint} divided={false}>
        <Badge tone="settled" icon="check">On</Badge>
      </SettingRow>
    );
  }
  if (compact) {
    return (
      <div className="flex items-center gap-3">
        {state === "denied" ? (
          <p className="text-[12.5px] text-[#92400E]">Notifications are blocked for this site. Allow them in your browser settings to turn them on.</p>
        ) : (
          <Button size="sm" variant="ghost" onClick={enable} disabled={state === "busy"}>
            {state === "busy" ? "Turning on…" : "Turn on notifications"}
          </Button>
        )}
        {message && <p className="text-[12.5px] text-red-800">{message}</p>}
      </div>
    );
  }
  return (
    <SettingRow
      title="Push notifications"
      hint="Reminders 24 hours, 1 hour and 10 minutes before each consultation, and when there is an update."
      divided={false}
    >
      <div className="flex flex-col items-end gap-1.5">
        {state === "denied" ? (
          <Badge tone="waiting" icon="alert">Blocked</Badge>
        ) : (
          <Button size="sm" onClick={enable} disabled={state === "busy"}>
            {state === "busy" ? "Turning on…" : "Turn on"}
          </Button>
        )}
        {state === "denied" && (
          <p className="max-w-[180px] text-right text-[11px] leading-[1.4] text-gray-500">
            Allow notifications for this site in your browser settings.
          </p>
        )}
        {message && <p className="max-w-[180px] text-right text-[11px] text-red-800">{message}</p>}
      </div>
    </SettingRow>
  );
}
