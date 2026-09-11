// Docket service worker: web push → notification → open the linked page;
// offline shell for navigations (network first, offline page as fallback);
// and an opt-in saved copy of the screens a client chose to keep readable.
//
// Nothing is cached behind the client's back. Every portal screen is private,
// RLS-scoped data, so the saved copy exists only after an explicit "Save now"
// on the profile, lives in its own cache, and is deleted whole the moment the
// client turns it off or signs out. Only screens that are safe to read from
// disk go in: matters, court dates and the home summary. Payments and uploads
// are never saved — they need a connection, and the app says so.
const OFFLINE_CACHE = "docket-offline-v1";
const SAVED_CACHE = "docket-saved-v1";
const OFFLINE_URL = "/offline.html";
const SAVED_AT_URL = "/__docket_saved_at";
const KEEP = [OFFLINE_CACHE, SAVED_CACHE];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

/** The saved copy, if this navigation is one the client asked us to keep. */
async function savedCopy(request) {
  const cache = await caches.open(SAVED_CACHE);
  return (await cache.match(request, { ignoreSearch: true })) || null;
}

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const saved = await savedCopy(event.request);
      if (saved) return saved;
      const offline = await caches.open(OFFLINE_CACHE);
      return offline.match(OFFLINE_URL);
    }),
  );
});

async function saveCopy(urls) {
  const cache = await caches.open(SAVED_CACHE);
  await cache.delete(SAVED_AT_URL);
  // A screen that will not load is not worth saving — keep only what answers.
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (res.ok) await cache.put(url, res.clone());
      } catch {
        /* leave this screen out of the copy */
      }
    }),
  );
  await cache.put(
    SAVED_AT_URL,
    new Response(JSON.stringify({ savedAt: new Date().toISOString() }), {
      headers: { "content-type": "application/json" },
    }),
  );
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "docket:save") {
    event.waitUntil(saveCopy(Array.isArray(data.urls) ? data.urls : []));
  } else if (data.type === "docket:forget") {
    event.waitUntil(caches.delete(SAVED_CACHE));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || "Docket";
  const options = {
    body: data.body || "",
    data: { url: data.url || "/app" },
    badge: "/icon-192.png",
    icon: "/icon-192.png",
    tag: data.url || undefined,
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
