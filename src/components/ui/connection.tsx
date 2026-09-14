"use client";

// Whether this device can reach the network right now — said where it matters: a badge in the
// header, and beside the button that would send. navigator.onLine is the browser's word; a
// reconnect is announced the same way. Nothing is guessed about the server.

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
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

/**
 * A small pill shown only while offline; silent otherwise. It wears the same
 * `waiting` ground every other "someone is being waited on" state wears, and it
 * carries the icon as well as the word — being offline is a state, and a state
 * is never colour alone.
 */
export function ConnectionBadge() {
  const { online, known } = useConnectionState();
  if (!known || online) return null;
  return (
    <span role="status" className="inline-flex items-center gap-1 rounded-full border border-waiting-line bg-waiting-bg px-2 py-0.5 text-11 font-semibold text-waiting-ink">
      <Icon name="offline" size={12} strokeWidth={2.4} />
      Offline
    </span>
  );
}

/** Beside a send button: the reason it is disabled. */
export function OfflineNote() {
  const { online, known } = useConnectionState();
  if (!known || online) return null;
  return <p className="text-13 text-waiting-ink">You are offline. What you type is kept on this device; send it when you are back.</p>;
}

/** On the login pages: a shared device keeps no draft across sign-ins. */
export function DraftSweeper() {
  useEffect(() => { clearAllDrafts(); }, []);
  return null;
}
