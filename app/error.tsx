"use client";

// The route error boundary. Anything that throws below app/ — a tenant page, the portal, the
// firm console — lands here instead of showing the visitor a blank screen.
//
// WHAT IS DELIBERATELY NOT ON THIS SCREEN
// React hands this component `error.digest` (a hash of the server-side message) and, in
// development, a stack. Neither is rendered. Law 3 says nothing fake, not "show everything":
// a digest tells a client nothing they can act on and a stack says where Docket broke. The
// person gets a plain sentence and two ways forward (law 10 — no dead ends).
//
// TENANT-NEUTRAL BY POSITION, NOT BY CHOICE (law 6). This boundary sits ABOVE
// app/(public)/[firm]/layout.tsx, so when a tenant page throws, that layout — and the brand
// variables it sets from firms.brand — is gone with it. There is no firm to name here, so
// nothing is named: the screen uses the platform defaults in app/globals.css.
//
// WHAT captureException DOES HERE, HONESTLY
// This file is "use client", so the call below runs in the browser, and src/lib/observability
// keeps SENTRY_DSN server-side on purpose (it is not a NEXT_PUBLIC_ variable, and src/lib/csp.ts
// deliberately lists no Sentry origin in connect-src). In the browser it therefore finds no DSN
// and returns null without making a request. It is called anyway because this is the one place
// that knows a boundary was hit, and the day Docket adds a first-party report route this is the
// line that feeds it. Until then, browser-side failures are reported by nothing.

import { useEffect } from "react";
import Link from "next/link";
import { reportBrowserError } from "@/lib/report-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Through Docket's own endpoint, which reports server-side. A browser cannot report to
    // Sentry here: the DSN is a server variable and the policy does not allow that origin.
    reportBrowserError(error, "app route boundary");
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-4 py-10">
      <Alert kind="error" title="This page did not load">
        Something went wrong on our side. If you were part-way through something, check whether it
        went through before starting it again. If the page keeps failing, sign out and back in, or
        speak to whoever looks after this account.
      </Alert>

      <div className="flex flex-col gap-3">
        <Button size="lg" className="w-full" onClick={() => reset()}>
          Try this page again
        </Button>
        {/* This is the only boundary in the app, so it catches the public site, the client
            portal, the firm console and the platform console alike. "Back" returns to wherever
            the person actually was, which is the one way forward that is right on all four. */}
        <button
          type="button"
          onClick={() => window.history.back()}
          className="inline-flex w-full items-center justify-center rounded-lg border border-gray-300 px-6 py-3.5 text-base font-medium text-brand hover:bg-black/5"
        >
          Go back
        </button>
      </div>
    </main>
  );
}
