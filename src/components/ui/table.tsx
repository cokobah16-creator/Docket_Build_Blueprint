import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// The record table. Operational screens are read in rows and columns, so this
// is deliberately denser than a card: 13px body, 8px vertical cell padding, a
// sunken header band. Wide content scrolls inside its own container; the page
// never scrolls horizontally on a phone. A screen whose table has more than
// four or five columns should also render a stacked list below `md` rather
// than asking a thumb to scroll sideways — see the matters list for the shape.

export function Table({
  children,
  className,
  /** Below this the table scrolls inside its box rather than squeezing columns. */
  minWidth = "36rem",
  caption,
}: {
  children: ReactNode;
  className?: string;
  minWidth?: string;
  /** Read by screen readers as the table's name. Visually hidden. */
  caption?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left text-13" style={{ minWidth }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-hairline bg-sunken text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-hairline">{children}</tbody>;
}

export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("align-top hover:bg-hover", className)}>{children}</tr>;
}

export function TH({ children, className, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { children?: ReactNode }) {
  return (
    <th scope="col" className={cn("whitespace-nowrap px-3 py-2 font-semibold", className)} {...props}>
      {children}
    </th>
  );
}

export function TD({ children, className, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { children?: ReactNode }) {
  return (
    <td className={cn("px-3 py-2 text-ink", className)} {...props}>
      {children}
    </td>
  );
}
