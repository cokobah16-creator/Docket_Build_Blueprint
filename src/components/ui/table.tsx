import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Wide content scrolls inside its own container; the page never scrolls
// horizontally on a phone.
//
// `density` is set once on the table rather than on every cell because a
// table is one thing: a row that is tighter than its neighbours reads as a
// mistake. "compact" is for a preview or a log of many short rows — an
// import's row-by-row outcome, the DNS records a firm has to copy out — where
// the reader is scanning, not reading. It is applied through a descendant
// selector on the <table> so that this file stays free of React context, which
// a server component cannot provide; the selector outranks the cell's own
// padding utility, which is the point.

type Density = "comfortable" | "compact";

const DENSITY: Record<Density, string> = {
  comfortable: "",
  compact: "text-13 [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2",
};

export function Table({
  children,
  className,
  density = "comfortable",
}: {
  children: ReactNode;
  /** Goes on the scrolling wrapper, not the table: a border, a max height. */
  className?: string;
  density?: Density;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className={cn("w-full min-w-[36rem] border-collapse text-left text-15", DENSITY[density])}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <thead className={cn("border-b border-hairline text-11 uppercase tracking-wide text-ink-muted", className)}>
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-hairline">{children}</tbody>;
}

export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("hover:bg-sunken", className)}>{children}</tr>;
}

export function TH({ children, className, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { children?: ReactNode }) {
  return (
    <th scope="col" className={cn("px-4 py-3 font-medium", className)} {...props}>
      {children}
    </th>
  );
}

export function TD({ children, className, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { children?: ReactNode }) {
  return (
    <td className={cn("px-4 py-3", className)} {...props}>
      {children}
    </td>
  );
}
