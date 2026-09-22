"use client";

// One "New" control in the command bar instead of a create button on every
// screen. It is a disclosure of links — each one a real screen that starts the
// thing it names — not an ARIA menu, because a list of navigations is exactly
// what a disclosure is for and a screen reader announces it as such.
//
// Escape and a click outside close it; focus goes back to the button.

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

export interface QuickAction {
  href: string;
  label: string;
  hint: string;
  icon: IconName;
}

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="workspace-bar-action"
      >
        <span>New</span>
        <Icon name="chevron-down" size={15} />
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[300px] max-w-[calc(100vw-32px)] overflow-hidden rounded-card border border-hairline bg-raised text-ink shadow-e3"
        >
          <p className="border-b border-hairline px-3 py-2 text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted">
            Start something
          </p>
          <ul>
            {actions.map((a) => (
              <li key={a.href}>
                <Link
                  href={a.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-start gap-2.5 px-3 py-2 hover:bg-hover focus-visible:bg-hover"
                >
                  <Icon name={a.icon} size={17} className="mt-0.5 shrink-0 text-ink-muted" />
                  <span className="min-w-0">
                    <span className="block text-13 font-semibold text-ink-strong">{a.label}</span>
                    <span className="block text-11 text-ink-muted">{a.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
