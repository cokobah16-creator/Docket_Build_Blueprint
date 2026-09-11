"use client";

// Whether this device can reach the network right now — said where it matters: a badge in the
// header, and beside the button that would send. navigator.onLine is the browser's word; a
// reconnect is announced the same way. Nothing is guessed about the server.

import { useEffect, useState } from "react";
import { clearAllDrafts } from "@/lib/drafts";

export function useConnectionState(): { online: boolean; known: boolean } {
  const [online, setOnline] = useState(true);
  const [known, setKnown] = useState(false);
  useEffect(() => {
    const sync = () => { setOnline(navigator.onLine); setKnown(true); };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);
  return { online, known };
}

/** A small pill shown only while offline; silent otherwise. */
export function ConnectionBadge() {
  const { online, known } = useConnectionState();
  if (!known || online) return null;
  return (
    <span role="status" className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-600" />
      Offline
    </span>
  );
}

/** Beside a send button: the reason it is disabled. */
export function OfflineNote() {
  const { online, known } = useConnectionState();
  if (!known || online) return null;
  return <p className="text-xs text-amber-900">You are offline. What you type is kept on this device; send it when you are back.</p>;
}

/** On the login pages: a shared device keeps no draft across sign-ins. */
export function DraftSweeper() {
  useEffect(() => { clearAllDrafts(); }, []);
  return null;
}
