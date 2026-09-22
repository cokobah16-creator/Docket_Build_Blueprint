import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icon";

// Status colors are consistent across the app and never the only signal:
// every pill carries an icon and a label (master prompt §42, WCAG 2.2).
//
// Four grounds carry every state, so a glance is enough: green is settled,
// amber is waiting on someone, red is wrong, grey is over. The values are
// Docket's own and live in app/globals.css as --l-*/--d-* pairs — they must not
// move with a firm's brand colour, or "confirmed" would mean something
// different at every firm, and they flip for dark mode on their own, which is
// why no rule here carries a `dark:` prefix.

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
  | "closed"
  // The legal lifecycle. A filing, a document or a court process moves through
  // these, and they read the same on every screen that shows one.
  | "ready"
  | "submitted"
  | "received"
  | "under_review"
  | "accepted"
  | "rejected"
  | "correction_required"
  | "filed"
  | "scheduled"
  | "archived"
  | "urgent"
  | "confidential";

/**
 * The grounds a pill may sit on. Anything new picks one rather than inventing —
 * alerts and toasts read this same table, so a tone is drawn once.
 */
export const PILL_TONES = {
  settled: "border-settled-line bg-settled-bg text-settled-ink",
  waiting: "border-waiting-line bg-waiting-bg text-waiting-ink",
  wrong: "border-wrong-line bg-wrong-bg text-wrong-ink",
  over: "border-over-line bg-over-bg text-over-ink",
  quiet: "border-quiet-line bg-quiet-bg text-quiet-ink",
  informing: "border-informing-line bg-informing-bg text-informing-ink",
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
  ready: { tone: "informing", icon: "check", label: "Ready for submission" },
  submitted: { tone: "informing", icon: "upload", label: "Submitted" },
  received: { tone: "informing", icon: "inbox", label: "Received" },
  under_review: { tone: "waiting", icon: "clock", label: "Under review" },
  accepted: { tone: "settled", icon: "check", label: "Accepted" },
  rejected: { tone: "wrong", icon: "close", label: "Rejected" },
  correction_required: { tone: "wrong", icon: "warning", label: "Correction required" },
  filed: { tone: "settled", icon: "file", label: "Filed" },
  scheduled: { tone: "informing", icon: "calendar", label: "Scheduled" },
  archived: { tone: "quiet", icon: "square", label: "Archived" },
  urgent: { tone: "wrong", icon: "alert", label: "Urgent" },
  confidential: { tone: "over", icon: "shield", label: "Confidential" },
};

/** Whether a string from the database names a status this table knows. */
export function isStatus(value: string | null | undefined): value is Status {
  return Boolean(value && value in styles);
}

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
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip border px-2 py-0.5 text-11 font-semibold",
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
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-chip border px-2 py-0.5 text-11 font-semibold",
        PILL_TONES[tone],
        className,
      )}
    >
      {icon && <Icon name={icon} size={12} strokeWidth={2.6} />}
      {children}
    </span>
  );
}

// ── a firm's own matter statuses ──────────────────────────────────────────
// matter_statuses.colour is a colour NAME a firm chose ("green", "amber") or a
// hex. Three screens each carried their own table of pastel Tailwind classes
// for it, so "Filed in Court" was a different green on each. The name now picks
// one of the same six grounds every other status uses, and the label — never
// the colour — carries the meaning. A hex a firm typed is shown only as a small
// swatch beside the label, on a neutral ground, because nothing guarantees it
// clears contrast as text.

const MATTER_TONES: Record<string, PillTone> = {
  green: "settled", emerald: "settled", teal: "settled",
  amber: "waiting", orange: "waiting", yellow: "waiting",
  red: "wrong", rose: "wrong",
  blue: "informing", sky: "informing", indigo: "informing", violet: "informing", purple: "informing",
  slate: "quiet", gray: "quiet", grey: "quiet",
};

export function MatterStatusChip({
  status,
  className,
}: {
  status: { label: string; colour: string | null; is_terminal?: boolean | null };
  className?: string;
}) {
  const colour = (status.colour ?? "").trim();
  const hex = /^#[0-9a-f]{3,8}$/i.test(colour);
  const tone: PillTone = status.is_terminal ? "over" : hex ? "quiet" : MATTER_TONES[colour.toLowerCase()] ?? "quiet";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip border px-2 py-0.5 text-11 font-semibold",
        PILL_TONES[tone],
        className,
      )}
    >
      {hex && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colour }} />}
      {status.label}
    </span>
  );
}
