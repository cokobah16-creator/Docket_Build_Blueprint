"use client";

// "Pay to confirm": what the client is paying and why (the `summary`, a
// <BeforeYouPay> register the page builds), how long the time is held, and how
// they want to pay, all decided inside Docket. Paystack then opens straight onto
// the chosen method rather than presenting its own menu.
//
// Docket never touches the money. The fee settles to the firm's own subaccount
// and only the provider's webhook can mark anything paid, so this screen is a
// choice and a handoff, nothing more.
//
// When the hold runs out the time is released (release_expired_holds() cancels
// the booking and its invoice within the minute), so the panel stops offering to
// pay for it. Paying for a time that is no longer yours is how a client ends up
// charged for nothing, and docs/CLIENT_GUIDE.md tells them not to.

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { PILL_TONES } from "@/components/ui/badge";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { BANK_TRANSFER_NOTE } from "@/lib/payment-breakdown";
import type { PaymentChannel } from "@/lib/providers/payments";

const METHODS: Array<{ key: PaymentChannel; label: string; hint: string; icon: IconName }> = [
  { key: "card", label: "Card", hint: "Verve, Mastercard or Visa", icon: "card" },
  {
    key: "bank_transfer",
    label: "Bank transfer",
    hint: "Paystack gives you an account number for this payment only",
    icon: "transfer",
  },
  { key: "ussd", label: "USSD", hint: "Dial a short code on this phone", icon: "ussd" },
];

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function PayPanel({
  amount,
  summary,
  holdExpiresAt,
  rebookHref,
  onPay,
}: {
  /** What Paystack will be asked for, formatted: it goes on the button. */
  amount: string;
  /** Who is being paid, for what, and how the total is made: a <BeforeYouPay>. */
  summary: ReactNode;
  /** The fifteen-minute hold, if this payment is holding a time. */
  holdExpiresAt: string | null;
  /** Where to book again once a hold has run out. */
  rebookHref?: string | null;
  /** Starts the provider checkout; redirects away, so it never resolves. */
  onPay: (channel: PaymentChannel) => Promise<{ error: string } | undefined>;
}) {
  const [channel, setChannel] = useState<PaymentChannel>("card");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!holdExpiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt]);

  const remaining = holdExpiresAt ? new Date(holdExpiresAt).getTime() - now : 0;
  const expired = Boolean(holdExpiresAt) && remaining <= 0;

  // When the hold ends, the payment choices and the Pay button unmount. Somebody on one of them by
  // keyboard or screen reader is dropped to the top of the page, so the next action takes the focus.
  // Only then: a page that opens after the hold has already ended never showed those controls, and
  // keeps the usual focus, so a screen reader starts at the title and the "Your hold has ended" alert.
  const rebookRef = useRef<HTMLAnchorElement>(null);
  const payShown = useRef(false);
  useEffect(() => {
    if (!expired) {
      payShown.current = true;
      return;
    }
    if (payShown.current && document.activeElement === document.body) rebookRef.current?.focus({ preventScroll: true });
  }, [expired]);

  return (
    <div className="flex flex-col gap-3.5">
      {holdExpiresAt && (
        <div className="flex items-center justify-between gap-2.5">
          <p className="text-13 font-semibold text-ink">Pay to confirm your booking</p>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-chip border px-2 py-0.5 font-mono text-11 font-semibold",
              expired ? PILL_TONES.wrong : PILL_TONES.waiting,
            )}
            // A timer, whose implicit aria-live is off: a polite region here read the clock out every
            // second over the breakdown. The end of the hold is spoken once, below.
            role="timer"
          >
            <Icon name="clock" size={12} strokeWidth={2.2} />
            {expired ? "Hold ended" : `Held for ${mmss(remaining)}`}
          </span>
        </div>
      )}

      {/* Always mounted, so the change is spoken; the Alert below appears with its text, which a
          screen reader may not announce. */}
      <p className="sr-only" aria-live="polite">{expired ? "Your hold has ended. Please choose a new time." : ""}</p>

      {summary}

      {expired ? (
        <>
          <Alert kind="warning" title="Your hold has ended">
            This time was released for someone else to book, so it can no longer be paid for. Please choose a new time.
          </Alert>
          {rebookHref && (
            <Link ref={rebookRef} href={rebookHref} className={buttonClasses("primary", "lg", "w-full")}>
              Choose a new time
            </Link>
          )}
        </>
      ) : (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-15 font-semibold text-ink">How would you like to pay?</legend>
            {METHODS.map((m) => {
              const on = channel === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setChannel(m.key)}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-3 rounded-control border bg-raised px-[15px] py-3.5",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                    on ? "border-brand" : "border-edge",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-control",
                        on ? "bg-brand text-brand-on" : "bg-sunken text-ink-muted",
                      )}
                    >
                      <Icon name={m.icon} size={18} />
                    </span>
                    <span className="min-w-0 text-left">
                      <span className="block text-15 font-semibold text-ink">{m.label}</span>
                      <span className="mt-0.5 block text-13 text-ink-muted">{m.hint}</span>
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-5 shrink-0 rounded-full",
                      on ? "border-[6px] border-brand" : "border-[1.5px] border-edge",
                    )}
                  />
                </button>
              );
            })}
          </fieldset>

          {channel === "bank_transfer" && (
            <p className="rounded-control bg-sunken px-3 py-2.5 text-13 leading-relaxed text-ink">{BANK_TRANSFER_NOTE}</p>
          )}

          {error && <Alert kind="error">{error}</Alert>}

          <Button
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await onPay(channel);
                if (r?.error) setError(r.error);
              })
            }
          >
            {pending ? "Opening Paystack…" : `Pay ${amount}`}
          </Button>
        </>
      )}
    </div>
  );
}
