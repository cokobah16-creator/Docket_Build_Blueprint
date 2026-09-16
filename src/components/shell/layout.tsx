// Page-level arrangements.
//
// Every one of these renders its children ONCE and moves them with CSS Grid.
// None of them takes a width, a device or a media-query result as a prop, so
// none of them can render a different tree on the server than in the browser,
// and a rotation or a resize rearranges live markup rather than remounting it
// — which is what keeps a half-typed message where it was.

import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";

/** The title block at the top of a screen: what this is, then what you can do. */
export function PageHeader({
  title,
  description,
  /** Buttons. They sit under the title on a phone and beside it from tablet up. */
  actions,
  /** A back link, shown only where there is somewhere to go back to. */
  back,
  backLabel,
  tone = "brand",
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: string;
  backLabel?: string;
  tone?: "brand" | "neutral";
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      {back && (
        <Link
          href={back}
          className={cn(
            "inline-flex min-h-11 w-fit items-center gap-1.5 -ml-1 pl-1 pr-2 text-13 font-medium",
            tone === "neutral" ? "text-[#141414]" : "text-brand",
          )}
        >
          <Icon name="chevron-left" size={15} strokeWidth={2} />
          {backLabel ?? "Back"}
        </Link>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="min-w-0">
          <h1
            className={cn(
              // Grows with the room: 22px on a phone, 26px from tablet up.
              "font-heading text-21 font-bold leading-tight tracking-[-0.02em] md:text-26",
              tone === "neutral" ? "text-[#141414]" : "font-semibold text-brand",
            )}
          >
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-13 leading-relaxed text-ink-muted md:text-13">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/**
 * A screen that is one column on a phone and gains a companion column when
 * there is room: counters beside a feed, an overview beside a timeline.
 *
 * `aside` comes SECOND in the DOM, so a phone reads the main work first and a
 * keyboard reaches it first. Grid puts it back on the right at width.
 */
export function WithAside({
  aside,
  /** Where the companion column earns its place. */
  from = "xl",
  /** Keep the companion visible while the main column scrolls past it. */
  sticky = true,
  className,
  children,
}: {
  aside: ReactNode;
  from?: "lg" | "xl";
  sticky?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 md:gap-5",
        from === "lg"
          ? "lg:grid-cols-[minmax(0,1fr)_320px]"
          : "xl:grid-cols-[minmax(0,1fr)_340px]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
      <aside className={cn("flex min-w-0 flex-col gap-4", sticky && "xl:sticky xl:top-5 xl:self-start")}>
        {aside}
      </aside>
    </div>
  );
}

/**
 * A grid of cards that adds columns as the window allows, rather than at fixed
 * breakpoints — so a counter row is two across on a phone and four on a wide
 * screen without a rule for each size.
 */
export function CardGrid({
  min = "260px",
  className,
  children,
}: {
  min?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("grid gap-3 md:gap-4", className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}, 100%), 1fr))` }}
    >
      {children}
    </div>
  );
}

/**
 * A list beside the thing it selects.
 *
 * On a phone only one pane exists at a time, because the route says which: the
 * index route renders the list, a detail route renders the detail with a back
 * link. From 1024px both are on screen at once, which is why the detail route
 * renders the list too — hidden below that width, so nothing is duplicated on
 * the phone and nothing is missing on the desktop.
 *
 * The panes scroll together with the page rather than in their own boxes. A
 * separate scroll container inside a phone browser fights the URL bar and the
 * on-screen keyboard; one document scroll does not.
 */
export function ListDetail({
  list,
  detail,
  /** True on the index route, where the list is the whole screen on a phone. */
  listIsScreen = false,
  listLabel = "Conversations",
}: {
  list: ReactNode;
  detail: ReactNode;
  listIsScreen?: boolean;
  listLabel?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] lg:items-start lg:gap-5">
      <section
        aria-label={listLabel}
        className={cn("min-w-0 lg:sticky lg:top-5", listIsScreen ? "" : "hidden lg:block")}
      >
        {list}
      </section>
      <section className={cn("min-w-0", listIsScreen && "hidden lg:block")}>{detail}</section>
    </div>
  );
}
