// The saved copy: what the client can still read with no network.
//
// The service worker holds the cache (public/sw.js); this is the window side
// of the same contract. Nothing here runs on the server.

export const SAVED_CACHE = "docket-saved-v1";
export const SAVED_AT_URL = "/__docket_saved_at";

/** The screens worth keeping: readable, and true for longer than a minute. */
export function savedCopyUrls(matterIds: string[]): string[] {
  return [
    "/app",
    "/app/matters",
    "/app/court-dates",
    ...matterIds.map((id) => `/app/matters/${id}`),
  ];
}

async function controller(): Promise<ServiceWorker | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.active ?? navigator.serviceWorker.controller;
}

/** When the copy on this device was taken, or null if there isn't one. */
export async function savedAt(): Promise<Date | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(SAVED_CACHE);
    const res = await cache.match(SAVED_AT_URL);
    if (!res) return null;
    const { savedAt: iso } = (await res.json()) as { savedAt?: string };
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Take a copy now. Resolves once the worker reports back, so the profile can
 * show the new saved-at time rather than guessing at it.
 */
export async function saveCopy(urls: string[]): Promise<Date | null> {
  const worker = await controller();
  if (!worker) return null;
  worker.postMessage({ type: "docket:save", urls });

  // The worker has no reply channel for this; poll briefly for the stamp it
  // writes last, so "Saved" only appears once there is something saved.
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    const at = await savedAt();
    if (at) return at;
  }
  return null;
}

export async function forgetCopy(): Promise<void> {
  const worker = await controller();
  worker?.postMessage({ type: "docket:forget" });
  if (typeof caches !== "undefined") {
    try {
      await caches.delete(SAVED_CACHE);
    } catch {
      /* the worker will get to it */
    }
  }
}
