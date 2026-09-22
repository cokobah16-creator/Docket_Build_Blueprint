"use client";

// Chrome shared by the matter workbench: the tab row and the copy-a-link
// button the invoices and parties tabs both need.
//
// Rules enforced here: the tabs are ordinary links, so every tab is a fresh
// server render whose reads run as the signed-in staff member — nothing is
// pulled into the browser that RLS has not already allowed. The row is one
// thumb-scrollable line at 390px with 44px targets, and the open tab is
// scrolled into view so the lawyer never loses their place.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface TabSpec {
  key: string;
  label: string;
  /** A count shown beside the label — open tasks, documents — when there is one. */
  count?: number;
}

export function MatterTabs({
  tabs, active, basePath, extraQuery = "",
}: {
  tabs: TabSpec[];
  active: string;
  basePath: string;
  /** Already-encoded extra parameters to keep on every tab, e.g. "&firm=…". */
  extraQuery?: string;
}) {
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  return (
    <nav aria-label="Matter sections" className="-mx-4 overflow-x-auto border-b border-hairline px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1">
        {tabs.map((t) => {
          const current = t.key === active;
          return (
            <li key={t.key}>
              <Link
                ref={current ? activeRef : undefined}
                href={`${basePath}?tab=${t.key}${extraQuery}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "-mb-px flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-13 font-medium",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:[outline-offset:-2px] focus-visible:outline-ink-strong",
                  current
                    ? "border-ink-strong font-semibold text-ink-strong"
                    : "border-transparent text-ink-muted hover:border-edge hover:text-ink",
                )}
              >
                {t.label}
                {typeof t.count === "number" && t.count > 0 && (
                  <span className="rounded-chip bg-sunken px-1.5 text-11 font-semibold text-ink-muted">{t.count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Copies a link to the clipboard. `path` is resolved against the origin the
 * console is being served from, so the same code works on a custom domain and
 * on a preview deployment. When the browser refuses clipboard access (an
 * insecure context, an older Android WebView) the link is shown for the lawyer
 * to copy by hand rather than failing silently.
 */
export function CopyButton({
  path, value, label = "Copy link", className,
}: {
  path?: string;
  value?: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const [text, setText] = useState("");

  async function copy() {
    const resolved = value ?? (path ? `${window.location.origin}${path}` : "");
    if (!resolved) return;
    setText(resolved);
    try {
      await navigator.clipboard.writeText(resolved);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("manual");
    }
  }

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <button
        type="button"
        onClick={copy}
        className="inline-flex min-h-11 items-center rounded-control border border-edge bg-raised px-3 text-13 font-semibold text-ink-strong hover:bg-hover"
      >
        {state === "copied" ? "Copied" : label}
      </button>
      {state === "manual" && (
        <input
          readOnly
          value={text}
          aria-label="Link to copy"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-edge px-3 py-2 text-base text-ink sm:w-80"
        />
      )}
    </span>
  );
}
