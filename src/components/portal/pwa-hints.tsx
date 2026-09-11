"use client";

// PWA helpers: iOS install instructions (Safari has no install prompt) and
// the low-data toggle. Both remember their state on the device only.

import { useEffect, useState } from "react";
import { isLowData, setLowData } from "@/lib/low-data";
import { Alert } from "@/components/ui/alert";
import { SettingRow, Switch } from "@/components/ui/switch";

const DISMISS_KEY = "docket:ios-hint-dismissed";

export function IosInstallHint({ appName }: { appName: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      const ua = navigator.userAgent;
      const isIos = /iPhone|iPad|iPod/.test(ua) && !(window as { MSStream?: unknown }).MSStream;
      const standalone = (navigator as { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
      const dismissed = localStorage.getItem(DISMISS_KEY) === "1";
      setShow(isIos && !standalone && !dismissed);
    } catch {
      setShow(false);
    }
  }, []);
  if (!show) return null;
  return (
    <Alert kind="info" icon="upload" title={`Add ${appName} to your home screen`}>
      Tap the Share button in Safari, then <strong>Add to Home Screen</strong>. You get a
      full-screen app and notifications.
      <button
        type="button"
        className="mt-1.5 block text-[11.5px] font-semibold underline underline-offset-2"
        onClick={() => { try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ } setShow(false); }}
      >
        Don&apos;t show again
      </button>
    </Alert>
  );
}

export function LowDataToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(isLowData()), []);
  return (
    <SettingRow
      title="Low-data mode"
      hint="Previews and images load only when you tap them. Saved on this device."
    >
      <Switch
        label="Low-data mode"
        checked={on}
        onChange={(next) => { setLowData(next); setOn(next); }}
      />
    </SettingRow>
  );
}
