// The frame both roles sit in.
//
// One shell, three shapes. The sidebar is fixed and the content is inset past
// it with a margin, so the page scrolls on the document — a phone's URL bar
// collapses on scroll as it should, and `position: sticky` inside a page keeps
// working. An inner scroll container would break both.
//
// The reserved space matches the rail and sidebar widths in primary-nav.tsx:
// 68px from 768px, 248px from 1024px.

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PrimaryNav } from "@/components/shell/primary-nav";
import type { NavModel } from "@/components/shell/nav";

export function AppShell({
  nav,
  tone = "brand",
  navLabel,
  masthead,
  navFooter,
  /** The compact bar shown only on phones, where there is no sidebar. */
  header,
  /** Full-bleed and above the page: a suspension notice, a consent gate. */
  banner,
  /** How wide the content may grow. Reading screens stay narrower. */
  width = "wide",
  /** Query every destination carries, from the server. See PrimaryNav. */
  navContext,
  children,
}: {
  nav: NavModel;
  tone?: "brand" | "neutral";
  navLabel?: string;
  masthead?: ReactNode;
  navFooter?: ReactNode;
  header?: ReactNode;
  banner?: ReactNode;
  width?: "wide" | "reading";
  navContext?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-raised focus:px-4 focus:py-2.5 focus:text-15 focus:font-semibold focus:text-ink focus:shadow-lg focus:outline focus:outline-2 focus:outline-offset-2"
      >
        Skip to content
      </a>

      <PrimaryNav
        model={nav}
        tone={tone}
        label={navLabel}
        masthead={masthead}
        footer={navFooter}
        context={navContext}
      />

      <div className="md:pl-[68px] lg:pl-[248px]">
        {header}
        {banner}
        <main
          id="main"
          // The bottom bar is fixed over the document, so the page ends above
          // it rather than under it. No reserve once the bar is gone.
          className={cn(
            "mx-auto w-full px-4 pb-[calc(72px+env(safe-area-inset-bottom))] pt-3.5 md:px-6 md:pb-10 md:pt-5 lg:px-8",
            width === "reading" ? "max-w-3xl" : "max-w-[1400px]",
          )}
        >
          {children}
        </main>
      </div>
    </>
  );
}
