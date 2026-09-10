import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Status colors are consistent across the app and never the only signal:
// every pill carries an icon and a label (master prompt §42, WCAG 2.2).

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

const styles: Record<Status, { classes: string; icon: string; label: string }> = {
  pending: { classes: "bg-amber-50 text-amber-900 border-amber-200", icon: "◔", label: "Pending" },
  awaiting_payment: { classes: "bg-amber-50 text-amber-900 border-amber-200", icon: "₦", label: "Awaiting payment" },
  confirmed: { classes: "bg-emerald-50 text-emerald-900 border-emerald-200", icon: "✓", label: "Confirmed" },
  rescheduled: { classes: "bg-sky-50 text-sky-900 border-sky-200", icon: "⇄", label: "Rescheduled" },
  completed: { classes: "bg-emerald-50 text-emerald-900 border-emerald-200", icon: "✓", label: "Completed" },
  cancelled: { classes: "bg-gray-100 text-gray-700 border-gray-200", icon: "✕", label: "Cancelled" },
  no_show: { classes: "bg-red-50 text-red-900 border-red-200", icon: "✕", label: "No show" },
  paid: { classes: "bg-emerald-50 text-emerald-900 border-emerald-200", icon: "✓", label: "Paid" },
  partially_paid: { classes: "bg-amber-50 text-amber-900 border-amber-200", icon: "◑", label: "Partially paid" },
  overdue: { classes: "bg-red-50 text-red-900 border-red-200", icon: "!", label: "Overdue" },
  issued: { classes: "bg-sky-50 text-sky-900 border-sky-200", icon: "◦", label: "Issued" },
  draft: { classes: "bg-gray-100 text-gray-700 border-gray-200", icon: "◦", label: "Draft" },
  active: { classes: "bg-emerald-50 text-emerald-900 border-emerald-200", icon: "●", label: "Active" },
  closed: { classes: "bg-gray-100 text-gray-700 border-gray-200", icon: "■", label: "Closed" },
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
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        s.classes,
        className,
      )}
    >
      <span aria-hidden="true">{s.icon}</span>
      {label ?? s.label}
    </span>
  );
}

export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-brand",
        className,
      )}
    >
      {children}
    </span>
  );
}
