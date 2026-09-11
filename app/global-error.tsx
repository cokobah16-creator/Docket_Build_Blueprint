"use client";

// The last boundary. This one catches a throw in the root layout itself, which means the root
// layout never rendered — so, as Next.js requires, this file supplies its own <html> and <body>.
//
// It also imports the stylesheet the root layout would have imported. Without that line the
// tokens in app/globals.css (:root --dk-primary and the rest) are absent and every Tailwind
// class here resolves to nothing, leaving the one screen a person sees when Docket is at its
// worst as unstyled text. The tokens it brings are the platform defaults, not any firm's:
// nothing tenant-specific can be known here (law 6).
//
// As in app/error.tsx: no stack, no error.digest, and the captureException call cannot reach
// Sentry from the browser because SENTRY_DSN is server-side only by design. See that file.

import { useEffect } from "react";
import { captureException } from "@/lib/observability";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, { where: "app root boundary" }).catch(() => undefined);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen text-gray-900 antialiased">
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-4 py-10">
          <Alert kind="error" title="Docket did not load">
            Something went wrong on our side before the page could be built. Try again in a
            moment. If it keeps failing, contact the firm directly.
          </Alert>

          <div className="flex flex-col gap-3">
            <Button size="lg" className="w-full" onClick={() => reset()}>
              Try again
            </Button>
            {/* A plain link, not next/link: the router lives below the root layout that just
                failed, so an anchor is the way out that cannot itself be broken. */}
            <a
              href="/"
              className="inline-flex w-full items-center justify-center rounded-lg border border-gray-300 px-6 py-3.5 text-base font-medium text-brand hover:bg-black/5"
            >
              Go to the home page
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
