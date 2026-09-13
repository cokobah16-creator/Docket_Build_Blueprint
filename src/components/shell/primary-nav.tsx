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
import {
  activeHref,
  overflowSections,
  primaryItems,
  type NavItem,
  type NavModel,
} from "@/components/shell/nav";

/**
 * Preserve the query the current screen is standing in, where it names context
 * rather than a position inside one screen.
 *
 * `?firm=` is which firm a multi-firm member is working in: carrying it means
 * the sidebar does not silently move them to another firm's diary. A tab or a
 * filter belongs to the screen it was set on, so it is left behind.
 */
const CARRIED = ["firm"];

function withContext(href: string, search: string): string {
  if (!search) return href;
  const from = new URLSearchParams(search);
  const keep = new URLSearchParams();
  for (const key of CARRIED) {
    const value = from.get(key);
    if (value) keep.set(key, value);
  }
  const qs = keep.toString();
  return qs ? `${href}?${qs}` : href;
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
}: {
  model: NavModel;
  tone?: "brand" | "neutral";
  label?: string;
  masthead?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  // The query string is read after mount rather than through useSearchParams,
  // which would opt every page using this nav into client-side rendering.
  useEffect(() => {
    setSearch(window.location.search);
  }, [pathname]);

  // A destination chosen in the sheet has been navigated to; close it.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [moreOpen]);

  const active = activeHref(model, pathname);
  const primary = primaryItems(model);
  const overflow = overflowSections(model);
  const ink = tone === "neutral" ? "text-[#141414]" : "text-brand";
  const activeFill = tone === "neutral" ? "bg-[#141414] text-white" : "bg-brand text-brand-on";
  const edge = tone === "neutral" ? "border-[#DDD9D2]" : "border-gray-200";
  const inMore = overflow.some((s) => s.items.some((i) => i.href === active));

  const href = (item: NavItem) => withContext(item.href, search);

  return (
    <>
      {/* ── desktop: a grouped sidebar ─────────────────────────────────── */}
      <nav
        aria-label={label}
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden w-[248px] shrink-0 flex-col overflow-y-auto border-r bg-white lg:flex",
          edge,
        )}
      >
        {masthead && <div className={cn("border-b px-4 py-3.5", edge)}>{masthead}</div>}
        <div className="flex-1 px-3 py-3">
          {model.sections.map((section, i) => (
            <div key={section.title ?? "main"} className={cn(i > 0 && "mt-5")}>
              {section.title && (
                <h2 className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-500">
                  {section.title}
                </h2>
              )}
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={href(item)}
                      aria-current={active === item.href ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors",
                        active === item.href
                          ? cn(activeFill, "font-semibold")
                          : cn("font-medium text-gray-700 hover:bg-black/[0.04]", `hover:${ink}`),
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
          "fixed inset-y-0 left-0 z-30 hidden w-[68px] shrink-0 flex-col items-center overflow-y-auto border-r bg-white py-3 md:flex lg:hidden",
          edge,
        )}
      >
        <ul className="flex flex-col items-center gap-1">
          {model.sections.flatMap((s) => s.items).map((item) => (
            <li key={item.href}>
              <Link
                href={href(item)}
                aria-current={active === item.href ? "page" : undefined}
                // The label is the accessible name and is shown under the icon
                // at this size too — a rail of unexplained glyphs is a guess.
                className={cn(
                  "flex w-[58px] flex-col items-center gap-1 rounded-lg px-1 py-2 text-center text-[9.5px] font-medium leading-tight transition-colors",
                  active === item.href ? activeFill : "text-gray-600 hover:bg-black/[0.04]",
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
          "fixed inset-x-0 bottom-0 z-40 border-t bg-white pb-[env(safe-area-inset-bottom)] md:hidden",
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
                aria-current={active === item.href ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-[3px] px-1 py-2 text-center text-[11.5px] leading-tight",
                  active === item.href ? cn("font-semibold", ink) : "text-gray-500",
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
                  inMore ? cn("font-semibold", ink) : "text-gray-500",
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
          <button
            type="button"
            aria-label="Close"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-gray-900/40"
          />
          <div
            id={sheetId}
            role="dialog"
            aria-modal="true"
            aria-label="More destinations"
            className="absolute inset-x-0 bottom-0 mx-auto max-h-[80dvh] max-w-lg animate-[dkRise_.22s_ease-out] overflow-y-auto rounded-t-[18px] bg-white pb-[calc(16px+env(safe-area-inset-bottom))] shadow-[0_-8px_32px_rgba(0,0,0,0.18)]"
          >
            <div aria-hidden="true" className="mx-auto mb-2 mt-2.5 h-1 w-[38px] rounded-full bg-gray-200" />
            {overflow.map((section) => (
              <div key={section.title ?? "more"} className="px-2 pb-1.5 pt-2">
                {section.title && (
                  <h2 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-500">
                    {section.title}
                  </h2>
                )}
                <ul>
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={href(item)}
                        aria-current={active === item.href ? "page" : undefined}
                        className={cn(
                          "flex min-h-[52px] items-center gap-3 rounded-xl px-3 text-[15px]",
                          active === item.href ? cn("font-semibold", ink) : "font-medium text-gray-800",
                        )}
                      >
                        <Icon name={item.icon} size={20} className="shrink-0 text-gray-500" />
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
                className="min-h-11 w-full rounded-[9px] border border-gray-300 text-sm font-medium text-gray-700"
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
