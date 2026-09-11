"use client";

// Report a browser error to Docket's own endpoint.
//
// The boundaries cannot call captureException() directly: it reads SENTRY_DSN, which is a server
// variable and undefined in the browser, so the call would quietly do nothing. This posts to
// /api/report instead, which reports server-side with the key that never leaves the server.
//
// It never throws and never blocks. A page that has already failed is not improved by a second
// failure on top of it.

export function reportBrowserError(error: Error & { digest?: string }, where: string): void {
  try {
    void fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: error.name,
        message: error.message,
        where,
        digest: error.digest,
      }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* nothing here is worth breaking a page for */
  }
}
