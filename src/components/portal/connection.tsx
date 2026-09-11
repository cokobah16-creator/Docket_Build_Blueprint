"use client";

import { useEffect, useState } from "react";
import { OfflineIcon } from "@/components/ui/icons";

// What the app can honestly say about being offline.
//
// The service worker is network-first for navigations and falls back to
// /offline.html; it caches no private data, on purpose — every screen behind
// the sign-in is somebody's legal matter, and putting that on the device at
// rest is a decision about client confidentiality rather than about layout.
// See design/pwa/README.md.
//
// So neither of these claims a saved copy. The banner says what is true — you
// are looking at the page you already had — and the Profile row says plainly
// that nothing is stored, rather than showing a comforting timestamp for a
// cache that does not exist.

function useOnline(): boolean {
  // Start optimistic: the server render has no navigator, and a banner that
  // flashes on every first paint would be worse than one that arrives a tick late.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine !== false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-[10px] border border-[#D9D2C4] bg-[#FBF7EE] px-3.5 py-3"
    >
      <OfflineIcon size={19} className="mt-px flex-none text-[#7A6A46]" />
      <div className="text-[12.5px] leading-snug text-[#5C4F35]">
        <p className="font-semibold text-[#3F3520]">You are offline</p>
        <p className="mt-0.5">
          This is the page you already had open. Opening anything new, paying and
          uploading all need a connection. Nothing you have already sent is lost.
        </p>
      </div>
    </div>
  );
}

type ShellState = "checking" | "ready" | "unavailable";

/**
 * The Profile row. It reports the one offline thing that is real: whether the
 * service worker is active, so a lost connection gets a Docket page instead of
 * the browser's error screen.
 */
export function OfflineCopyRow() {
  const [shell, setShell] = useState<ShellState>("checking");

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setShell("unavailable");
      return;
    }
    let live = true;
    navigator.serviceWorker.ready
      .then(() => live && setShell("ready"))
      .catch(() => live && setShell("unavailable"));
    return () => {
      live = false;
    };
  }, []);

  const status =
    shell === "ready" ? "Not stored" : shell === "unavailable" ? "Unavailable" : "Checking";

  return (
    <div className="flex items-start justify-between gap-3.5">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-dk-strong">Offline copy</p>
        <p className="mt-0.5 text-[12px] leading-snug text-dk-muted">
          {shell === "ready" ? (
            <>
              Your matters, court dates and messages are not kept on this device —
              they need a connection. Docket will show its own page rather than a
              browser error when you lose signal.
            </>
          ) : shell === "unavailable" ? (
            <>This browser cannot hold an offline page. Everything needs a connection.</>
          ) : (
            <>Checking what this device is holding.</>
          )}
        </p>
      </div>
      <span className="flex-none whitespace-nowrap rounded-full border border-[#D5D9DF] bg-[#F9FAFB] px-2.5 py-1 text-[11.5px] font-semibold text-[#475467]">
        {status}
      </span>
    </div>
  );
}
