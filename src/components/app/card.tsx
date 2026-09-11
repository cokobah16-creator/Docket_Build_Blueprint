import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// The card is the phone app's only container: a white panel on the shell's
// ground, a 12px radius, one hairline round it and lighter hairlines between
// its rows. Everything on a screen is either a card, a heading, or small print.

export function AppCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-card border border-dk-line bg-white shadow-card",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function AppCardHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-3.5 border-b border-dk-rule px-[17px] py-[13px]">
      <h2 className="font-app-head text-[15.5px] font-semibold text-dk-strong">
        {title}
      </h2>
      {action}
    </header>
  );
}

export function AppCardBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("px-[17px] py-[15px]", className)}>{children}</div>;
}

/**
 * A list of rows inside a card. The divider sits *between* rows, so a card
 * whose first row follows a header gets the header's own bottom rule and no
 * second line under it, and a headerless card starts flush.
 */
export function AppCardList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("divide-y divide-dk-rule", className)}>{children}</div>
  );
}

/** A label/value line — the shape the appointment and review screens are made of. */
export function AppDetail({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 text-[13.5px]">
      <span className="flex-none text-dk-muted">{label}</span>
      <span className="text-right font-semibold text-dk-strong">{children}</span>
    </div>
  );
}

/** No dead ends: an empty card says what will fill it, and offers the way. */
export function AppEmpty({
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
      <p className="text-[13.5px] font-semibold text-dk-strong">{title}</p>
      {hint && <p className="text-[12.5px] leading-relaxed text-dk-muted">{hint}</p>}
      {action}
    </div>
  );
}
