"use client";

// "Pay to confirm": the amount, how long the slot is held, and how the client
// wants to pay — all decided inside Docket. The provider then opens straight
// onto the chosen method rather than presenting its own menu.
//
// Docket never touches the money. The fee settles to the firm's own subaccount
// and only the provider's webhook can mark anything paid, so this screen is a
// choice and a handoff, nothing more.

import { useEffect, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import type { PaymentChannel } from "@/lib/providers/payments";

const METHODS: Array<{ key: PaymentChannel; label: string; hint: string; icon: IconName }> = [
  { key: "card", label: "Card", hint: "Verve, Mastercard or Visa", icon: "card" },
  { key: "bank_transfer", label: "Bank transfer", hint: "One-time account · confirms in under a minute", icon: "transfer" },
  { key: "ussd", label: "USSD", hint: "Dial from the phone you are holding", icon: "ussd" },
];

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function PayPanel({
  amount,
  invoiceNumber,
  description,
  holdExpiresAt,
  firmName,
  onPay,
}: {
  amount: string;
  invoiceNumber: string;
  description: string;
  /** The fifteen-minute hold, if this payment is holding a slot. */
  holdExpiresAt: string | null;
  firmName: string;
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

  return (
    <div className="flex flex-col gap-3.5">
      {holdExpiresAt && (
        <div className="flex items-center justify-between gap-2.5">
          <p className="text-[13px] font-semibold text-gray-900">Pay to confirm</p>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11.5px] font-semibold",
              expired
                ? "border-[#E5C4C4] bg-[#FEF3F2] text-[#912018]"
                : "border-[#F3DDA4] bg-[#FFFAEB] text-[#92400E]",
            )}
            aria-live="polite"
          >
            <Icon name="clock" size={12} strokeWidth={2.2} />
            {expired ? "hold expired" : `${mmss(remaining)} held`}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1 rounded-card border border-gray-200 bg-white p-4">
        <p className="text-xs uppercase tracking-[0.07em] text-gray-500">Amount due</p>
        <p className="font-heading text-[34px] font-semibold leading-none tracking-[-0.02em] text-brand">{amount}</p>
        <p className="mt-1.5 text-[12.5px] text-gray-600">
          <span className="font-mono">{invoiceNumber}</span> · {description}
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs uppercase tracking-[0.07em] text-gray-500">
          How would you like to pay?
        </legend>
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
                "flex w-full items-center justify-between gap-3 rounded-[11px] border bg-white px-[15px] py-3.5",
                on ? "border-brand" : "border-gray-200",
              )}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-lg",
                    on ? "bg-brand text-brand-on" : "bg-gray-100 text-gray-500",
                  )}
                >
                  <Icon name={m.icon} size={18} />
                </span>
                <span className="min-w-0 text-left">
                  <span className="block text-sm font-semibold text-gray-900">{m.label}</span>
                  <span className="mt-0.5 block text-xs text-gray-500">{m.hint}</span>
                </span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "size-5 shrink-0 rounded-full",
                  on ? "border-[6px] border-brand" : "border-[1.5px] border-gray-300",
                )}
              />
            </button>
          );
        })}
      </fieldset>

      {error && <Alert kind="error">{error}</Alert>}
      {expired && (
        <Alert kind="warning">
          The hold on this slot has run out. You can still pay, but the time may have been taken.
        </Alert>
      )}

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
        {pending ? "Taking payment…" : `Pay ${amount}`}
      </Button>

      <p className="flex items-start gap-2.5 text-[11.5px] leading-relaxed text-gray-500">
        <Icon name="shield" size={15} className="mt-px shrink-0 text-gray-400" />
        Paystack takes the payment and settles it to {firmName}&apos;s own subaccount. Docket never
        holds client money.
      </p>
    </div>
  );
}
