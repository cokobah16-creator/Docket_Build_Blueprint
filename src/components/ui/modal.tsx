"use client";

import { useRef, type ReactNode } from "react";
import { useDialogBehaviour } from "@/components/ui/dialog";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  // Escape, a focus trap, an inert page behind it, and focus handed back to
  // whatever opened it. This used to be Escape alone, which meant a document
  // preview could be dismissed by keyboard but not read by one: Tab walked
  // straight out of the dialog and into the page it was covering.
  useDialogBehaviour({ open, onClose, surface });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      {/* A sheet lifts off the page by being a lighter surface as well as by
          casting a shadow: `shadow-e3` is nearly invisible against a dark
          ground, so `bg-raised` is what keeps the dialog an object in dark
          mode. */}
      <div
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-lg rounded-sheet bg-raised shadow-e3 focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <h2 className="font-heading text-17 font-semibold text-ink-strong">{title}</h2>
          {/* Close was a 26px target, which is the control a thumb misses most
              often and the one it can least afford to miss twice. It is 44px
              now, and the negative margin takes the extra back out so the
              header keeps the height it was drawn at. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-my-2.5 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted transition duration-fast hover:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
