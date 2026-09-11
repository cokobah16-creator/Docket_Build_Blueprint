import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icon";

// Status colors are consistent across the app and never the only signal:
// every pill carries an icon and a label (master prompt §42, WCAG 2.2).
//
// Four grounds carry every state, so a glance is enough: green is settled,
// amber is waiting on someone, red is wrong, grey is over. The literal hex
// values are Docket's own — they must not move with a firm's brand colour,
// or "confirmed" would mean something different at every firm.

export type Status =
  | "pending"
  | "awaiting_payment"
  | "confirmed"
  | "rescheduled"
  | "completed"
  | "cancelled"
  | "no_show"
  | "paid"
  | "partially_paid"
  | "overdue"
  | "issued"
  | "draft"
  | "active"
  | "closed";

/** The grounds a pill may sit on. Anything new picks one rather than inventing. */
export const PILL_TONES = {
  settled: "border-[#A7D8BE] bg-[#ECFDF3] text-[#05603A]",
  waiting: "border-[#F3DDA4] bg-[#FFFAEB] text-[#92400E]",
  wrong: "border-[#E5C4C4] bg-[#FEF3F2] text-[#912018]",
  over: "border-[#D5D9DF] bg-[#F9FAFB] text-[#475467]",
  quiet: "border-gray-200 bg-gray-100 text-gray-600",
  informing: "border-[#BAE0F5] bg-[#F0F9FF] text-[#065986]",
} as const;

export type PillTone = keyof typeof PILL_TONES;

const styles: Record<Status, { tone: PillTone; icon: IconName; label: string }> = {
  pending: { tone: "waiting", icon: "clock", label: "Pending" },
  awaiting_payment: { tone: "waiting", icon: "card", label: "Awaiting payment" },
  confirmed: { tone: "settled", icon: "check", label: "Confirmed" },
  rescheduled: { tone: "informing", icon: "transfer", label: "Rescheduled" },
  completed: { tone: "over", icon: "check", label: "Completed" },
  cancelled: { tone: "quiet", icon: "close", label: "Cancelled" },
  no_show: { tone: "wrong", icon: "close", label: "No show" },
  paid: { tone: "settled", icon: "check", label: "Paid" },
  partially_paid: { tone: "waiting", icon: "half", label: "Partially paid" },
  overdue: { tone: "wrong", icon: "alert", label: "Overdue" },
  issued: { tone: "informing", icon: "dot", label: "Issued" },
  draft: { tone: "quiet", icon: "dot", label: "Draft" },
  active: { tone: "settled", icon: "dot", label: "Active" },
  closed: { tone: "quiet", icon: "square", label: "Closed" },
};

export function StatusPill({
  status,
  label,
  className,
}: {
  status: Status;
  label?: string;
  className?: string;
}) {
  const s = styles[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-semibold",
        PILL_TONES[s.tone],
        className,
      )}
    >
      <Icon name={s.icon} size={12} strokeWidth={2.6} />
      {label ?? s.label}
    </span>
  );
}

/** A pill with no status behind it — a role, a count, a plain fact. */
export function Badge({
  children,
  tone = "quiet",
  icon,
  className,
}: {
  children: ReactNode;
  tone?: PillTone;
  icon?: IconName;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-semibold",
        PILL_TONES[tone],
        className,
      )}
    >
      {icon && <Icon name={icon} size={12} strokeWidth={2.6} />}
      {children}
    </span>
  );
}
