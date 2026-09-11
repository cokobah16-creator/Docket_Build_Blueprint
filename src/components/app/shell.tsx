import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { ChevronLeftIcon } from "@/components/ui/icons";

// The phone shells.
//
// Docket has two of them and they are deliberately not the same colour. The
// client app wears the firm's brand — the client is dealing with their
// lawyers, not with Docket. The console wears none of it: it is the same
// working tool whichever firm you open it for, and colour in it means one
// thing only, that something is late, unpaid, or waiting on you.
//
// Both are built from these components; only the palette moves, because every
// colour below resolves to a --dk-app-* variable that app/globals.css
// redefines per shell. See design/pwa/README.md.

export type ShellKind = "client" | "console";

export function AppShell({
  kind,
  style,
  className,
  children,
}: {
  kind: ShellKind;
  style?: React.CSSProperties;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={style}
      className={cn(
        "dk-shell",
        kind === "client" ? "dk-shell-client" : "dk-shell-console",
        "font-body",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A screen body with its own margins, on the artboard's 14px rhythm.
 *
 * The shell centres and clears the tab bar; the horizontal and top margins
 * live here rather than in the layout because a pushed screen does not have
 * them: its sticky SubHeader runs edge to edge and only the content beneath it
 * is inset. Those screens use `PushedScreen` instead.
 */
export function AppScreen({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("dk-rise flex flex-col gap-3.5 px-4 pt-3.5", className)}>
      {children}
    </div>
  );
}

/**
 * A screen reached by pushing rather than by a tab: a full-bleed SubHeader,
 * then an inset body. Pass the header as `header` so it stays outside the
 * padded column and can stick to the top of the scroller.
 */
export function PushedScreen({
  header,
  className,
  children,
}: {
  header: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="dk-rise">
      {header}
      <div className={cn("flex flex-col gap-3.5 px-4 pb-2 pt-3.5", className)}>
        {children}
      </div>
    </div>
  );
}

/** The 23px screen heading: the firm's face in the client app, Archivo in the console. */
export function ScreenTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="font-app-head text-[23px] font-semibold leading-tight tracking-[-0.015em] text-dk-pri">
      {children}
    </h1>
  );
}

/**
 * The sticky bar on a pushed screen: a back control and a quiet label. It sits
 * over the scrolling content on a translucent ground, so it needs its own
 * hairline to separate from what passes underneath.
 */
export function SubHeader({
  backHref,
  backLabel,
  children,
}: {
  backHref: string;
  backLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 flex min-h-[50px] items-center gap-2.5 border-b border-dk-bar bg-white/90 px-3.5 py-2 backdrop-blur-xl">
      {/* The circle is the artboard's 36px; the target around it is 44px, which
          is the floor a thumb needs and what the bar's own 50px height allows. */}
      <Link
        href={backHref}
        aria-label={backLabel}
        className="-ml-1 grid h-11 w-11 flex-none place-items-center"
      >
        <span className="grid h-9 w-9 place-items-center rounded-full border border-dk-line bg-white text-dk-pri">
          <ChevronLeftIcon size={19} />
        </span>
      </Link>
      {children}
    </div>
  );
}

/** The monospaced reference a pushed screen carries instead of a title. */
export function SubHeaderRef({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px] text-dk-soft">{children}</span>;
}

export function SubHeaderTitle({ children }: { children: ReactNode }) {
  return (
    <span className="font-app-head text-[17px] font-semibold text-dk-pri">
      {children}
    </span>
  );
}

/** Small print under a section: the caveats, the disclaimers, the "where next". */
export function Footnote({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p className={cn("text-[11.5px] leading-relaxed text-dk-muted", className)}>
      {children}
    </p>
  );
}
