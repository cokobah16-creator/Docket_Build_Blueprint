"use client";

// PWA helpers: iOS install instructions (Safari has no install prompt) and
// the low-data toggle. Both remember their state on the device only.

import { useEffect, useState } from "react";
import { isLowData, setLowData } from "@/lib/low-data";

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
    <div role="status" className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
      <p className="font-medium">Add {appName} to your home screen</p>
      <p className="mt-1">Tap the Share button <span aria-hidden="true">⎋</span> in Safari, then <strong>Add to Home Screen</strong>. You get a full-screen app and notifications.</p>
      <button type="button" className="mt-2 text-xs underline" onClick={() => { try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ } setShow(false); }}>
        Don't show again
      </button>
    </div>
  );
}

export function LowDataToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(isLowData()), []);
  return (
    <label className="flex items-center justify-between gap-4 text-sm text-gray-800">
      <span>
        <span className="block font-medium">Low-data mode</span>
        <span className="block text-xs text-gray-500">Previews and images load only when you tap them. Saved on this device.</span>
      </span>
      <input type="checkbox" className="h-5 w-5" checked={on} onChange={(e) => { setLowData(e.target.checked); setOn(e.target.checked); }} />
    </label>
  );
}
