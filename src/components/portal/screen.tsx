import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";

// The portal shell holds no horizontal padding of its own, so a screen can
// run a header, a progress bar or a dark call surface edge to edge. Screens
// that want the ordinary gutter wrap their content in <Screen>.

export function Screen({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-3.5 px-4 pb-6 pt-3.5", className)}>
      {children}
    </div>
  );
}

/** The big screen title — Appointments, Matters, Messages, Profile. */
export function ScreenTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="font-heading text-[23px] font-semibold leading-tight tracking-[-0.015em] text-brand">
      {children}
    </h1>
  );
}

/**
 * The sticky bar on a screen you arrived at from somewhere else: a back
 * chevron and whatever identifies where you are — a reference number, a step
 * counter, a plain title.
 *
 * `back` is a real href rather than history.back(): a client who opened the
 * waiting room from a push notification has no history to go back to, and a
 * dead chevron is worse than one that goes somewhere sensible.
 */
export function ScreenHeader({
  back,
  backLabel = "Back",
  title,
  subtitle,
  /**
   * `heading` is the screen's own name and becomes its <h1>; `mono` is a
   * reference number; `plain` is a step or a section the screen sits under.
   */
  titleAs = "plain",
  children,
}: {
  back: string;
  backLabel?: string;
  title?: string;
  subtitle?: string;
  titleAs?: "heading" | "mono" | "plain";
  children?: ReactNode;
}) {
  const Title = titleAs === "heading" ? "h1" : "p";
  return (
    <header className="sticky top-0 z-20 flex min-h-[50px] items-center gap-2.5 border-b border-[#EBE7E0] bg-white/[0.92] px-3.5 py-2.5 backdrop-blur-xl">
      <Link
        href={back}
        aria-label={backLabel}
        className="grid size-9 shrink-0 place-items-center rounded-full border border-gray-200 bg-white text-brand"
      >
        <Icon name="chevron-left" size={19} strokeWidth={2} />
      </Link>
      {(title || subtitle) && (
        <div className="min-w-0 flex-1">
          {title && (
            <Title
              className={cn(
                "truncate",
                titleAs === "heading" && "font-heading text-[17px] font-semibold text-brand",
                titleAs === "mono" && "font-mono text-[13px] text-gray-600",
                titleAs === "plain" && "text-[13px] font-semibold text-gray-900",
              )}
            >
              {title}
            </Title>
          )}
          {subtitle && <p className="mt-px truncate text-[11px] text-gray-500">{subtitle}</p>}
        </div>
      )}
      {children}
    </header>
  );
}

/** A row of facts — When, Lawyer, Format, Duration. Label left, value right. */
export function FactRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 text-[13.5px]">
      <dt className="shrink-0 text-gray-500">{label}</dt>
      <dd className="text-right font-semibold text-gray-900">{children}</dd>
    </div>
  );
}
