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
  return (
    <section
      className={cn(
        "overflow-hidden rounded-card border border-gray-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]",
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
    <header className="flex items-center justify-between gap-4 border-b border-gray-100 px-[17px] py-[13px]">
      <h2 className="font-heading text-[15.5px] font-semibold text-gray-900">{title}</h2>
      {action}
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
    <div className={cn("border-t border-gray-100 px-[17px] py-[13px] first:border-t-0", className)}>
      {children}
    </div>
  );
}

/** Empty state with a clear call to action (blueprint: no dead ends). */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {hint && <p className="text-sm text-gray-500">{hint}</p>}
      {action}
    </div>
  );
}
