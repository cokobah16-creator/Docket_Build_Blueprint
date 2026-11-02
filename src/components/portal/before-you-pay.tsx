import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { cn } from "@/lib/cn";
import { BANK_TRANSFER_NOTE, breakdownMoney, type Breakdown, type BreakdownRow } from "@/lib/payment-breakdown";

// "Before you pay": who the client is paying, what for, and how the total is
// made, on every screen where money leaves their account. Attorneys Klinique
// shows its clients the same three answers before every payment, and a client
// who can see them does not have to trust the button.
//
// A ruled register, not a pile of cards (DESIGN.md, "Card, list or table"): facts
// about one payment read top to bottom, amounts right-aligned in tabular figures
// so the sum can be checked by eye. Rows come from buildBreakdown() and appear
// only when they carry an amount.
//
// No hooks, so a server page, the client-side pay panel and the booking wizard
// can all render it.

function MoneyRow({ b, row }: { b: Breakdown; row: BreakdownRow }) {
  const strong = row.kind === "total" || row.kind === "due";
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-2", strong ? "text-15" : "text-13")}>
      <dt className={cn(strong ? "font-semibold text-ink" : "text-ink-muted")}>{row.label}</dt>
      <dd className={cn("text-right tabular-nums", strong ? "font-semibold text-ink-strong" : "text-ink")}>
        {row.kind === "paid" && !b.settled ? "−" : ""}
        {breakdownMoney(b, row.minor)}
      </dd>
    </div>
  );
}

export function BeforeYouPay({
  breakdown: b,
  variant = "pay",
  policyText,
  showBankTransferNote = false,
  title,
  className,
  children,
}: {
  breakdown: Breakdown;
  /** `receipt` once it is paid: the same register, worded as what was paid. */
  variant?: "pay" | "receipt";
  /** The firm's published cancellation text, shown open: it is a consequence, read before the tap. */
  policyText?: string | null;
  /** Whether the client has picked bank transfer, where people pay twice. */
  showBankTransferNote?: boolean;
  title?: string;
  className?: string;
  /** Anything the screen adds under the register. */
  children?: ReactNode;
}) {
  const receipt = variant === "receipt";
  return (
    <Card className={className}>
      <CardHeader title={title ?? (receipt ? "What you paid" : "Before you pay")} />
      <CardBody className="flex flex-col gap-3">
        <dl className="flex flex-col divide-y divide-hairline">
          <div className="flex flex-col gap-0.5 pb-2">
            <dt className="text-11 font-semibold uppercase tracking-[0.07em] text-ink-muted">
              {receipt ? "Paid to" : "You are paying"}
            </dt>
            <dd className="text-15 font-semibold text-ink">{b.payeeLine}</dd>
          </div>
          {b.purpose && (
            <div className="flex flex-col gap-0.5 py-2">
              <dt className="text-11 font-semibold uppercase tracking-[0.07em] text-ink-muted">For</dt>
              <dd className="text-15 text-ink">{b.purpose}</dd>
            </div>
          )}
          {b.free ? (
            <div className="flex items-baseline justify-between gap-4 py-2 text-15">
              <dt className="font-semibold text-ink">To pay</dt>
              <dd className="font-semibold text-ink-strong">Nothing to pay</dd>
            </div>
          ) : (
            b.rows.map((row, i) => <MoneyRow key={`${row.kind}-${i}`} b={b} row={row} />)
          )}
        </dl>

        {!receipt && !b.free && <p className="text-13 leading-relaxed text-ink-muted">{b.payeeSentence}</p>}

        {!receipt && policyText && (
          <div className="flex flex-col gap-1 rounded-control bg-sunken px-3 py-2.5">
            <p className="text-13 font-semibold text-ink">If plans change</p>
            <p className="text-13 leading-relaxed text-ink">{policyText}</p>
          </div>
        )}

        {!receipt && showBankTransferNote && !b.free && (
          <Disclosure summary="Paying by bank transfer" framed={false}>
            <p className="text-13 leading-relaxed text-ink">{BANK_TRANSFER_NOTE}</p>
          </Disclosure>
        )}

        {children}
      </CardBody>
    </Card>
  );
}
