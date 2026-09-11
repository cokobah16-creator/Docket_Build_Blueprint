"use client";

// "Offline — showing your saved copy."
//
// Only shown when there is genuinely a saved copy behind the screen: telling
// someone they are offline is noise, telling them what they can still do with
// it is the point. When there is no saved copy the fetch simply fails and the
// service worker shows the offline page instead.

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { savedAt } from "@/lib/offline";

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

  const when = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(saved);

  return (
    <Alert kind="notice" icon="offline" title="Offline — showing your saved copy">
      Saved {when}. Court dates and the matter timeline are readable. Payments and
      uploads wait for a connection.
    </Alert>
  );
}
