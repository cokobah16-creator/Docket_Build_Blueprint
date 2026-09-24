"use client";

// The analytics cookie question, asked once per site address.
//
// WHAT IT GOVERNS. One cookie: docket_did, the anonymous visitor id middleware.ts mints for the
// PostHog funnel. It is minted only after "Allow analytics", and every event and $identify is sent
// only after it too (src/lib/observability/consent.ts). The sign-in cookies, dk_firm and
// dk_staff_firm are strictly necessary and are set whatever the answer.
//
// WHERE IT SITS. z-40: over the page, under every overlay. Dialogs, bottom sheets, the firm
// switcher, toasts and the consultation room are all z-50, so the card never covers a sheet's
// buttons or a call's mute and leave; the room simply hides it until the call is over. The app
// shell's phone bottom bar is also z-40, so where that bar is drawn, app/globals.css lifts the card
// above it rather than over it, and on a wide screen it moves the card clear of the sidebar.
//
// WHEN IT SHOWS. Only when the server says analytics is configured (the analyticsEnabled prop,
// from POSTHOG_KEY in app/layout.tsx), and then only when no choice for the current version is
// stored. It reads the choice from document.cookie because the platform landing page is
// prerendered: no server code runs when it is served, so only the browser can know.
//
// THE TWO BUTTONS ARE THE SAME BUTTON. Same variant, same size, same width, side by side. Saying
// no is exactly as easy and as prominent as saying yes.
//
// CSP. Nothing here is an inline script and nothing reaches a new origin: the choice is saved by a
// server action (a same-origin POST), which also expires docket_did when the answer is no.

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  COOKIE_SETTINGS_EVENT,
  consentFromCookieHeader,
  type ConsentState,
} from "@/lib/consent-cookie";
import { setAnalyticsConsent } from "@/lib/actions/cookie-consent";

const UNDECIDED: ConsentState = { decided: false, analytics: false };

export function CookieBanner({ analyticsEnabled }: { analyticsEnabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [stored, setStored] = useState<ConsentState>(UNDECIDED);
  const [choosing, setChoosing] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  // Bumped when "Cookie settings" reopens the banner, so focus moves into it once it has rendered.
  const [focusRequest, setFocusRequest] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!analyticsEnabled) return;
    const current = consentFromCookieHeader(document.cookie);
    setStored(current);
    if (!current.decided) setOpen(true);

    const reopen = () => {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setStored(consentFromCookieHeader(document.cookie));
      setFailed(false);
      setOpen(true);
      setFocusRequest((n) => n + 1);
    };
    window.addEventListener(COOKIE_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, reopen);
  }, [analyticsEnabled]);

  useEffect(() => {
    if (open && focusRequest > 0) panel.current?.focus();
  }, [open, focusRequest]);

  function close() {
    setOpen(false);
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back?.isConnected) back.focus();
  }

  function choose(allow: boolean) {
    setFailed(false);
    setChoosing(allow);
    startTransition(async () => {
      try {
        await setAnalyticsConsent(allow);
        setStored({ decided: true, analytics: allow });
        close();
      } catch {
        setFailed(true);
      } finally {
        setChoosing(null);
      }
    });
  }

  // Escape puts the banner away only when a choice is already stored. On a first visit there is
  // nothing to fall back to, so the question stays until it is answered.
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && stored.decided && !pending) {
      event.stopPropagation();
      close();
    }
  }

  if (!analyticsEnabled || !open) return null;

  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      // dk-cookie-banner is the hook app/globals.css uses to lift the card above the phone bottom
      // bar and clear of the sidebar. See WHERE IT SITS above.
      className="dk-cookie-banner pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 focus:outline-none"
    >
      <div className="pointer-events-auto mx-auto max-w-[560px] rounded-card border border-hairline bg-raised p-4 text-ink shadow-e3">
        <h2 id={titleId} className="text-15 font-semibold text-ink-strong">
          Cookies
        </h2>
        <p className="mt-1 text-13 text-ink">
          If you allow it, Docket sets one analytics cookie of its own, docket_did, for one year.
          Sign-in cookies are always used, because the app needs them to work.
        </p>
        {stored.decided && (
          <p className="mt-1 text-13 text-ink-muted">
            Your choice now: {stored.analytics ? "Allow analytics" : "Only necessary"}.
          </p>
        )}
        {failed && (
          <p role="alert" className="mt-2 text-13 font-semibold text-ink-strong">
            Your choice was not saved. Try again.
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {([true, false] as const).map((allow) => (
            <Button
              key={String(allow)}
              variant="ghost"
              pending={pending && choosing === allow}
              disabled={pending && choosing !== allow}
              onClick={() => choose(allow)}
              className="w-full"
            >
              {allow ? "Allow analytics" : "Only necessary"}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Reopens the banner so a choice can be changed. Render it only where the banner can appear, that
 * is when analytics is configured; otherwise it would open nothing.
 */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={cn(className)}
      onClick={() => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))}
    >
      Cookie settings
    </button>
  );
}
