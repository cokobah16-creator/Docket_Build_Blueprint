import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { accentInk } from "@/lib/brand";
import { CheckIcon, ClockIcon, WarningIcon } from "@/components/ui/icons";
import type { Status } from "@/components/ui/badge";

// Status pills.
//
// Four appearances carry every status the app shows, because a client does not
// need the schema's vocabulary — they need to know whether a thing is settled,
// done with, waiting on them, or off. A fifth, danger, is kept for the two
// states that are actually bad news.
//
// Colour is never the only signal (WCAG 2.2, master prompt §42): every pill
// carries an icon and a word.

type Kind = "confirmed" | "completed" | "awaiting" | "cancelled" | "danger";

const kinds: Record<Kind, string> = {
  confirmed: "border-[#A7D8BE] bg-[#ECFDF3] text-[#05603A]",
  completed: "border-[#D5D9DF] bg-[#F9FAFB] text-[#475467]",
  awaiting: "border-[#F3DDA4] bg-[#FFFAEB] text-[#92400E]",
  cancelled: "border-[#E5E7EB] bg-[#F3F4F6] text-[#4B5563]",
  danger: "border-[#E5C4C4] bg-[#FEF3F2] text-[#912018]",
};

const icons: Record<Kind, typeof CheckIcon> = {
  confirmed: CheckIcon,
  completed: CheckIcon,
  awaiting: ClockIcon,
  cancelled: WarningIcon,
  danger: WarningIcon,
};

const forStatus: Record<Status, { kind: Kind; label: string }> = {
  pending: { kind: "awaiting", label: "Pending" },
  awaiting_payment: { kind: "awaiting", label: "Awaiting payment" },
  confirmed: { kind: "confirmed", label: "Confirmed" },
  rescheduled: { kind: "confirmed", label: "Rescheduled" },
  completed: { kind: "completed", label: "Completed" },
  cancelled: { kind: "cancelled", label: "Cancelled" },
  no_show: { kind: "danger", label: "No show" },
  paid: { kind: "confirmed", label: "Paid" },
  partially_paid: { kind: "awaiting", label: "Partially paid" },
  overdue: { kind: "danger", label: "Overdue" },
  issued: { kind: "completed", label: "Issued" },
  draft: { kind: "completed", label: "Draft" },
  active: { kind: "confirmed", label: "Active" },
  closed: { kind: "completed", label: "Closed" },
};

export function AppPill({
  kind,
  children,
  className,
}: {
  kind: Kind;
  children: React.ReactNode;
  className?: string;
}) {
  const Glyph = icons[kind];
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-semibold",
        kinds[kind],
        className,
      )}
    >
      <Glyph size={13} />
      {children}
    </span>
  );
}

export function AppStatusPill({
  status,
  label,
  className,
}: {
  status: Status;
  label?: string;
  className?: string;
}) {
  const s = forStatus[status] ?? forStatus.draft;
  return (
    <AppPill kind={s.kind} className={className}>
      {label ?? s.label}
    </AppPill>
  );
}

/** The hex shapes src/lib/brand.ts can read; any other colour is used as given. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The outline pill a matter's own status uses.
 *
 * A firm names *and* colours its matter statuses (matter_statuses.colour), so
 * when one carries a colour it is swapped in over the two accent tokens this
 * pill reads: the colour itself draws the border, and a darkened version of it
 * carries the label — exactly what --dk-app-acc-ink does for the shell's own
 * accent, and for the same reason, that a colour picked to be drawn is usually
 * too light to be read. Before this the firm's raw hex was used as the label
 * colour directly, which is how a pale status ended up as unreadable type on
 * white. A status with no colour falls back to the shell's accent, which is
 * the firm's too.
 */
export function AppAccentPill({
  colour,
  children,
}: {
  colour?: string | null;
  children: React.ReactNode;
}) {
  const style = colour
    ? ({
        "--dk-app-acc": colour,
        "--dk-app-acc-ink": HEX.test(colour) ? accentInk(colour) : colour,
      } as CSSProperties)
    : undefined;
  return (
    <span
      style={style}
      className="flex-none whitespace-nowrap rounded-full border border-dk-acc px-2.5 py-[3px] text-[11.5px] font-semibold text-dk-acc-ink"
    >
      {children}
    </span>
  );
}
