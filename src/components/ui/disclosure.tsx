import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";

// Secondary detail, folded away until it is wanted: "If plans change", "Paying
// by bank transfer", "About this matter". One main thing on a screen means the
// rest has somewhere to go that is not another card in the stack.
//
// Native <details>, on purpose. It opens and closes with no JavaScript, so it
// works before hydration, on a slow phone and on a page whose script the content
// security policy refused; it is keyboard and screen-reader operable as it
// stands; and it needs no state, so a server component can use it.
//
// The summary is the control, so it is a 44px target (DESIGN.md, "Tap targets")
// with a visible focus ring, and the marker is replaced by a chevron that turns
// when the panel opens, because a bare triangle is easy to miss as a control.

export function Disclosure({
  summary,
  hint,
  children,
  defaultOpen = false,
  framed = true,
  className,
}: {
  /** What is inside, as a person would ask for it: "If plans change". */
  summary: ReactNode;
  /** One short line under the summary, still visible when closed. */
  hint?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** `false` inside a card that already draws the boundary. */
  framed?: boolean;
  className?: string;
}) {
  return (
    <details
      className={cn("group", framed && "rounded-card border border-hairline bg-raised", className)}
      open={defaultOpen || undefined}
    >
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-card text-left",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-strong",
          "[&::-webkit-details-marker]:hidden",
          framed ? "px-4 py-2.5" : "py-2.5",
        )}
      >
        <span className="min-w-0">
          <span className="block text-15 font-semibold text-ink">{summary}</span>
          {hint && <span className="mt-0.5 block text-13 text-ink-muted">{hint}</span>}
        </span>
        <Icon
          name="chevron-down"
          size={18}
          className="shrink-0 text-ink-muted transition-transform duration-fast group-open:rotate-180"
        />
      </summary>
      <div className={cn("text-15 text-ink", framed ? "border-t border-hairline px-4 py-3" : "pb-3")}>{children}</div>
    </details>
  );
}
