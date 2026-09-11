"use client";

// Web push opt-in: registers the service worker, subscribes with the VAPID
// public key, and stores the subscription in push_subscriptions (RLS: own
// rows only). The dispatcher Edge Function sends through it.

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { AppButton } from "@/components/app";

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
  if (state === "subscribed" && compact) return null;

  return (
    <div className="flex items-start justify-between gap-3.5">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-dk-strong">Push notifications</p>
        <p className="mt-0.5 text-[12px] leading-snug text-dk-muted">
          {state === "denied"
            ? "Blocked for this site. Allow notifications in your browser settings to turn them on."
            : "Court updates and consultation reminders on this device. A consultation is flagged 24 hours, 1 hour and 10 minutes before; a court date 3 days and 1 day before."}
        </p>
        {message && <p className="mt-1 text-[12px] text-red-800">{message}</p>}
      </div>
      {state === "subscribed" ? (
        <span className="flex-none whitespace-nowrap rounded-full border border-[#A7D8BE] bg-[#ECFDF3] px-2.5 py-1 text-[11.5px] font-semibold text-[#05603A]">
          On
        </span>
      ) : state === "denied" ? (
        <span className="flex-none whitespace-nowrap rounded-full border border-[#F3DDA4] bg-[#FFFAEB] px-2.5 py-1 text-[11.5px] font-semibold text-[#92400E]">
          Blocked
        </span>
      ) : (
        <AppButton variant="ghost-sm" onClick={enable} disabled={state === "busy"}>
          {state === "busy" ? "Turning on…" : "Turn on"}
        </AppButton>
      )}
    </div>
  );
}
