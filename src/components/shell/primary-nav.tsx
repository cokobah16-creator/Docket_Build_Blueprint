"use client";

// The same destinations, arranged three ways by CSS alone.
//
//   below 768px   a bottom bar of five, the fifth opening a More sheet
//   768–1023px    a narrow icon rail, labels on focus and in the accessible name
//   1024px and up a grouped sidebar with headings and written labels
//
// Only one of the three is ever displayed: the others are `display:none`, so
// they are out of the accessibility tree and out of the tab order too. Which
// one shows is decided by the viewport in CSS — never by a user-agent string,
// and never by measuring the window during render, which would disagree with
// what the server sent and cost a hydration error.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import { useDialogBehaviour, useWhenMatches } from "@/components/ui/dialog";
import {
  activeHref,
  overflowSections,
  primaryItems,
  type NavItem,
  type NavModel,
} from "@/components/shell/nav";

/**
 * Query carried on every destination, naming which firm a multi-firm member is
 * working in, so the sidebar cannot move them to another firm's diary.
 *
 * It arrives as a prop from the server, which is the only place that knows: the
 * firm is resolved per request from `?firm=` or from the cookie the middleware
 * set out of it (src/lib/firm-data.ts, middleware.ts). It used to be read from
 * `window.location.search` in an effect keyed on the pathname. Changing only
 * `?firm=` leaves the pathname alone, so that effect never ran again and every
 * link went on naming the firm the member had just left. Worse than cosmetic:
 * `requestedFirmId()` prefers the query over the cookie, so the stale value in
 * the link won, and the next click undid the switch.
 */
function withContext(href: string, context?: Record<string, string>): string {
  const entries = Object.entries(context ?? {}).filter(([, v]) => Boolean(v));
  if (entries.length === 0) return href;
  const qs = new URLSearchParams(entries).toString();
  return href.includes("?") ? `${href}&${qs}` : `${href}?${qs}`;
}

export function PrimaryNav({
  model,
  /** The console is near-monochrome; the portal wears the firm's brand. */
  tone = "brand",
  label = "Primary",
  /** Rendered at the top of the sidebar: the firm's name, a role badge. */
  masthead,
  /** Rendered at the foot of the sidebar: sign out, a version, a switcher. */
  footer,
  /** Query carried on every destination, from the server. See withContext. */
  context,
}: {
  model: NavModel;
  tone?: "brand" | "neutral";
  label?: string;
  masthead?: React.ReactNode;
  footer?: React.ReactNode;
  context?: Record<string, string>;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // A destination chosen in the sheet has been navigated to; close it.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Escape, a focus trap, an inert page behind it, and focus back to whatever
  // opened it when it goes.
  useDialogBehaviour({
    open: moreOpen,
    onClose: () => setMoreOpen(false),
    surface: sheetRef,
    initialFocus: closeRef,
  });

  // From 768px the sheet is `md:hidden`. A rotation into tablet width would
  // otherwise leave it display:none but still mounted: the page behind it still
  // inert and unscrollable, and the keyboard still trapped inside something
  // nobody can see. Crossing the breakpoint closes it, which runs the cleanup
  // above and hands the page back.
  useWhenMatches("(min-width: 768px)", () => setMoreOpen(false));

  const active = activeHref(model, pathname);
  const primary = primaryItems(model);
  const overflow = overflowSections(model);
  const ink = tone === "neutral" ? "text-[#141414]" : "text-brand";
  const activeFill = tone === "neutral" ? "bg-[#141414] text-white" : "bg-brand text-brand-on";
  const edge = tone === "neutral" ? "border-[#DDD9D2]" : "border-hairline";
  const inMore = overflow.some((s) => s.items.some((i) => i.href === active));

  const href = (item: NavItem) => withContext(item.href, context);

  return (
    <>
      {/* ── desktop: a grouped sidebar ─────────────────────────────────── */}
      <nav
        aria-label={label}
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden w-[248px] shrink-0 flex-col overflow-y-auto border-r bg-raised lg:flex",
          edge,
        )}
      >
        {masthead && <div className={cn("border-b px-4 py-3.5", edge)}>{masthead}</div>}
        <div className="flex-1 px-3 py-3">
          {model.sections.map((section, i) => (
            <div key={section.title ?? "main"} className={cn(i > 0 && "mt-5")}>
              {section.title && (
                <h2 className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  {section.title}
                </h2>
              )}
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={href(item)}
                      data-dk-nav="destination"
                      aria-current={active === item.href ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors",
                        active === item.href
                          ? cn(activeFill, "font-semibold")
                          : cn("font-medium text-ink hover:bg-black/[0.04]", `hover:${ink}`),
                      )}
                    >
                      <Icon name={item.icon} size={18} className="shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {footer && <div className={cn("border-t px-3 py-3", edge)}>{footer}</div>}
      </nav>

      {/* ── tablet: an icon rail ───────────────────────────────────────── */}
      <nav
        aria-label={label}
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden w-[68px] shrink-0 flex-col items-center overflow-y-auto border-r bg-raised py-3 md:flex lg:hidden",
          edge,
        )}
      >
        <ul className="flex flex-col items-center gap-1">
          {model.sections.flatMap((s) => s.items).map((item) => (
            <li key={item.href}>
              <Link
                href={href(item)}
                data-dk-nav="destination"
                aria-current={active === item.href ? "page" : undefined}
                // The label is the accessible name and is shown under the icon
                // at this size too — a rail of unexplained glyphs is a guess.
                className={cn(
                  "flex w-[58px] flex-col items-center gap-1 rounded-lg px-1 py-2 text-center text-[9.5px] font-medium leading-tight transition-colors",
                  active === item.href ? activeFill : "text-ink-muted hover:bg-black/[0.04]",
                )}
              >
                <Icon name={item.icon} size={20} className="shrink-0" />
                <span className="w-full truncate">{item.short ?? item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* ── phone: a bottom bar of five ────────────────────────────────── */}
      <nav
        aria-label={label}
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t bg-raised pb-[env(safe-area-inset-bottom)] md:hidden",
          edge,
        )}
      >
        <ul
          className="mx-auto grid max-w-lg items-stretch"
          style={{ gridTemplateColumns: `repeat(${primary.length + (overflow.length ? 1 : 0)}, minmax(0, 1fr))` }}
        >
          {primary.map((item) => (
            <li key={item.href}>
              <Link
                href={href(item)}
                data-dk-nav="destination"
                aria-current={active === item.href ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-[3px] px-1 py-2 text-center text-[11.5px] leading-tight",
                  active === item.href ? cn("font-semibold", ink) : "text-ink-muted",
                )}
              >
                <Icon name={item.icon} size={21} />
                <span className="w-full truncate">{item.short ?? item.label}</span>
              </Link>
            </li>
          ))}
          {overflow.length > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-expanded={moreOpen}
                aria-controls={sheetId}
                className={cn(
                  "flex min-h-14 w-full flex-col items-center justify-center gap-[3px] px-1 py-2 text-center text-[11.5px] leading-tight",
                  inMore ? cn("font-semibold", ink) : "text-ink-muted",
                )}
              >
                <Icon name="menu" size={21} />
                More
              </button>
            </li>
          )}
        </ul>
      </nav>

      {/* ── the More sheet ─────────────────────────────────────────────── */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* A backdrop is a place to tap, not a control: it carries no label
              and takes no focus, because Escape and the Close button are what
              dismiss this from a keyboard, and a nameless button in the tab
              order would only be a stop with nothing to say. */}
          <div aria-hidden="true" onClick={() => setMoreOpen(false)} className="absolute inset-0 bg-black/40" />
          <div
            ref={sheetRef}
            id={sheetId}
            role="dialog"
            aria-modal="true"
            aria-label="More destinations"
            tabIndex={-1}
            className="absolute inset-x-0 bottom-0 mx-auto max-h-[80dvh] max-w-lg animate-[dkRise_.22s_ease-out] overflow-y-auto rounded-t-[18px] bg-raised pb-[calc(16px+env(safe-area-inset-bottom))] shadow-[0_-8px_32px_rgba(0,0,0,0.18)] focus:outline-none"
          >
            <div aria-hidden="true" className="mx-auto mb-2 mt-2.5 h-1 w-[38px] rounded-full bg-hairline" />
            {overflow.map((section) => (
              <div key={section.title ?? "more"} className="px-2 pb-1.5 pt-2">
                {section.title && (
                  <h2 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                    {section.title}
                  </h2>
                )}
                <ul>
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={href(item)}
                        data-dk-nav="destination"
                        aria-current={active === item.href ? "page" : undefined}
                        className={cn(
                          "flex min-h-[52px] items-center gap-3 rounded-xl px-3 text-[15px]",
                          active === item.href ? cn("font-semibold", ink) : "font-medium text-ink",
                        )}
                      >
                        <Icon name={item.icon} size={20} className="shrink-0 text-ink-muted" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="px-4 pt-2">
              <button
                ref={closeRef}
                type="button"
                onClick={() => setMoreOpen(false)}
                className="min-h-11 w-full rounded-[9px] border border-edge text-sm font-medium text-ink"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
