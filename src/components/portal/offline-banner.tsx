"use client";

// "You are offline", and what can still be done.
//
// Only shown when there is genuinely a saved copy behind the screen: telling
// someone they are offline is noise, telling them what they can still do with
// it is the point. When there is no saved copy the fetch simply fails and the
// service worker shows the offline page instead.

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { savedAt } from "@/lib/offline";
import { whenWords } from "@/lib/notifications-copy";

/**
 * When the copy was saved, in this device's own zone and with that zone named:
 * "Monday 2 November 2026 at 10:05 WAT". The banner only exists on the device,
 * so the device's clock is the right one to read it by.
 */
export function savedWords(at: Date): string {
  let tz: string | undefined;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    tz = undefined;
  }
  return whenWords(at, tz);
}

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [saved, setSaved] = useState<Date | null>(null);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    void savedAt().then(setSaved);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline || !saved) return null;

  return (
    <Alert kind="notice" icon="offline" title="You are offline">
      You are reading the copy saved on {savedWords(saved)}. Your matters and court
      dates are here to read. Paying and uploading need a connection.
    </Alert>
  );
}
