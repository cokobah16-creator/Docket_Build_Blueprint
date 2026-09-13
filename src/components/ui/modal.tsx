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
      <div
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-lg rounded-card bg-white shadow-xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="font-heading text-base font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
