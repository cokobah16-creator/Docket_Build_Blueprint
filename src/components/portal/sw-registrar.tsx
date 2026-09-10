"use client";

import { useEffect } from "react";

/** Registers /sw.js once so the offline shell works before push opt-in. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
