"use client";

// One sign-in, whichever firms act for you. Tapping the firm name on home
// opens this sheet; choosing a firm repaints the whole app — name, colours,
// typeface — and the rows follow.
//
// The list is rendered by the server and passed in, so the sheet holds no
// authority of its own: each choice is a form post to selectFirm, which
// re-checks the firm against this client before it sets anything.

import { useEffect, useId, useRef, useState } from "react";
import { selectFirm } from "@/lib/actions/portal";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

export interface FirmChoice {
  id: string;
  name: string;
  meta: string;
  /** The firm's own primary, for the initial tile — brand, not status. */
  primary: string;
  heading: string;
  initial: string;
}

export function FirmRow({
  firm,
  selected,
  className,
}: {
  firm: FirmChoice;
  selected: boolean;
  className?: string;
}) {
  return (
    <form action={selectFirm} className="contents">
      <input type="hidden" name="firmId" value={firm.id} />
      <button
        type="submit"
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-3 px-[17px] py-[13px] text-left",
          selected ? "bg-[#FBFAF7]" : "hover:bg-gray-50",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-[9px] text-[17px] font-semibold text-white"
          style={{ background: firm.primary, fontFamily: `${firm.heading}, Georgia, serif` }}
        >
          {firm.initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900">{firm.name}</span>
          <span className="mt-0.5 block text-xs text-gray-500">{firm.meta}</span>
        </span>
        {selected ? (
          <span
            className="grid size-[22px] shrink-0 place-items-center rounded-full text-white"
            style={{ background: firm.primary }}
          >
            <Icon name="check" size={15} strokeWidth={2.8} label="Selected" />
          </span>
        ) : (
          <span className="sr-only">Switch to this firm</span>
        )}
      </button>
    </form>
  );
}

/**
 * The home-screen trigger: the firm's name under the welcome, with the sheet
 * behind it. Rendered as a button so it announces itself as one; a client
 * acting for a single firm gets plain text instead — see the caller.
 */
export function FirmSwitcher({
  firms,
  selectedId,
  children,
}: {
  firms: FirmChoice[];
  selectedId: string | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sheetId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    // A sheet over the page should not let the page scroll behind it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={sheetId}
        className="flex items-center gap-1.5 text-left"
      >
        {children}
        <Icon name="chevron-down" size={13} strokeWidth={2} className="text-gray-400" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-gray-900/40"
          />
          <div
            id={sheetId}
            role="dialog"
            aria-modal="true"
            aria-label="Your firms"
            className="absolute inset-x-0 bottom-0 mx-auto max-w-lg animate-[dkRise_.22s_ease-out] rounded-t-[18px] bg-white pb-[calc(18px+env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_32px_rgba(0,0,0,0.18)]"
          >
            <div aria-hidden="true" className="mx-auto mb-3 mt-1.5 h-1 w-[38px] rounded-full bg-gray-200" />
            <div className="px-[18px] pb-2.5">
              <h2 className="font-heading text-[17px] font-semibold text-brand">Your firms</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                One sign-in. The app takes the name and colours of the firm you open.
              </p>
            </div>
            <ul>
              {firms.map((firm) => (
                <li key={firm.id}>
                  <FirmRow firm={firm} selected={firm.id === selectedId} className="px-[18px] py-3.5" />
                </li>
              ))}
            </ul>
            <div className="px-[18px] pt-2">
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
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
