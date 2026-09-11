"use client";

// PWA helpers: iOS install instructions (Safari has no install prompt) and
// the low-data toggle. Both remember their state on the device only.

import { useEffect, useState } from "react";
import { isLowData, setLowData } from "@/lib/low-data";
import { AppSwitchRow } from "@/components/app";

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
    <div role="status" className="rounded-[10px] border border-[#D9D2C4] bg-[#FBF7EE] px-3.5 py-3 text-[12.5px] leading-snug text-[#5C4F35]">
      <p className="font-semibold text-[#3F3520]">Add {appName} to your home screen</p>
      <p className="mt-0.5">
        Safari has no install button: tap Share, then <strong>Add to Home Screen</strong>. You
        get a full-screen app, and notifications that iOS will not deliver to a browser tab.
      </p>
      <button
        type="button"
        className="mt-1 inline-flex min-h-[44px] items-center text-[11.5px] font-semibold underline underline-offset-2"
        onClick={() => { try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ } setShow(false); }}
      >
        Don&rsquo;t show again
      </button>
    </div>
  );
}

export function LowDataToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(isLowData()), []);
  return (
    <AppSwitchRow
      id="low-data"
      title="Low-data mode"
      hint="Previews and images load only when you tap them. Saved on this device."
      checked={on}
      onChange={(next) => { setLowData(next); setOn(next); }}
    />
  );
}
