import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Padding is tighter than a desktop card's: on a 390px phone every pixel of
// gutter is a pixel a cause title cannot use.

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  // A card's separation from the page is the surface first and the shadow
  // second: `shadow-e1` is all but invisible on a dark ground, so it is
  // `bg-raised` sitting one step above `bg-paper` that keeps the card an object
  // in both themes. Neither token alone is enough, which is why both are here.
  return (
    <section
      className={cn(
        "overflow-hidden rounded-card border border-hairline bg-raised shadow-e1",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-hairline px-[17px] py-[13px]">
      <h2 className="font-heading text-17 font-semibold text-ink-strong">{title}</h2>
      {/* A card's action is a word or two — "All", "Pay". A word is a small
          thing for a thumb to find, so the slot grows the hit area to 44px and
          takes the extra back out in negative margin, leaving the header the
          height it was drawn at. */}
      {action && (
        <div className="-my-2.5 -mr-2 flex shrink-0 items-center [&>a]:flex [&>a]:min-h-11 [&>a]:items-center [&>a]:min-w-11 [&>a]:justify-center [&>a]:px-2 [&>button]:flex [&>button]:min-h-11 [&>button]:items-center [&>button]:min-w-11 [&>button]:justify-center [&>button]:px-2">
          {action}
        </div>
      )}
    </header>
  );
}

export function CardBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("px-[17px] py-[15px]", className)}>{children}</div>;
}

/** A row inside a card's stacked list — hairline above every row but the first. */
export function CardRow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("border-t border-hairline px-[17px] py-[13px] first:border-t-0", className)}>
      {children}
    </div>
  );
}

/**
 * An empty state answers three questions: what this is, why it is empty, and
 * what to do next. `title` says what is (not) here, `hint` says why and what
 * follows, `action` is the next step. No illustration and no encouragement —
 * a lawyer looking at an empty list wants the reason and the door.
 */
export function EmptyState({
  title,
  hint,
  action,
  align = "center",
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  /** `start` for an empty panel inside a dense screen, where centring floats. */
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-4 py-8",
        align === "center" ? "items-center text-center" : "items-start text-left",
      )}
    >
      <p className="text-15 font-semibold text-ink-strong">{title}</p>
      {hint && <p className="max-w-[60ch] text-13 text-ink-muted">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
