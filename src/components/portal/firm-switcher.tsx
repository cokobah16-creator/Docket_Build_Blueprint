"use client";

// One sign-in, whichever firms act for you. Tapping the firm name on home
// opens this sheet; choosing a firm repaints the whole app — name, colours,
// typeface — and the rows follow.
//
// The list is rendered by the server and passed in, so the sheet holds no
// authority of its own: each choice is a form post to selectFirm, which
// re-checks the firm against this client before it sets anything.

import { useId, useRef, useState } from "react";
import { selectFirm } from "@/lib/actions/portal";
import { buttonClasses } from "@/components/ui/button";
import { useDialogBehaviour } from "@/components/ui/dialog";
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
        // The selected row is told apart by its labelled tick and aria-current, not by a tint: a
        // button with a ground of its own is judged as a bounded control (DESIGN.md), and a
        // tint faint enough to sit quietly in a list never clears 3:1.
        className={cn(
          "flex min-h-11 w-full items-center gap-3 px-[17px] py-[13px] text-left transition duration-fast hover:bg-hover",
          "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-control text-17 font-semibold text-white"
          style={{ background: firm.primary, fontFamily: `${firm.heading}, Georgia, serif` }}
        >
          {firm.initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-15 font-semibold text-ink">{firm.name}</span>
          <span className="mt-0.5 block text-13 text-ink-muted">{firm.meta}</span>
        </span>
        {selected ? (
          // The selected firm is the one the portal is painted as, so its tick takes the brand
          // tokens, whose foreground is worked out to read on that firm's colour.
          <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-brand text-brand-on">
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
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape, a focus trap, a page behind that neither scrolls nor reads out, and focus back on
  // the firm name when the sheet goes (src/components/ui/dialog.ts). The surface is the whole
  // overlay, backdrop included, because the hook makes everything outside the surface inert,
  // and an inert backdrop could not be tapped to close the sheet.
  useDialogBehaviour({ open, onClose: () => setOpen(false), surface: overlayRef, initialFocus: closeRef });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={sheetId}
        className="-mx-1 flex min-h-11 items-center gap-1.5 rounded-control px-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {children}
        {/* Said aloud, so the button is announced as what it does and not only as a firm's name. */}
        <span className="sr-only"> Switch firm</span>
        <Icon name="chevron-down" size={13} strokeWidth={2} className="shrink-0 text-ink-muted" />
      </button>

      {open && (
        <div ref={overlayRef} className="fixed inset-0 z-50">
          {/* A backdrop is a place to tap, not a control: it takes no focus and carries no
              label, because Escape and the Close button are what dismiss the sheet from a
              keyboard. */}
          <div aria-hidden="true" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/40" />
          <div
            id={sheetId}
            role="dialog"
            aria-modal="true"
            aria-label="Your firms"
            className="absolute inset-x-0 bottom-0 mx-auto max-h-[80dvh] max-w-lg animate-[dkRise_.22s_ease-out] overflow-y-auto rounded-t-sheet bg-raised pb-[calc(18px+env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_32px_rgba(0,0,0,0.18)]"
          >
            <div aria-hidden="true" className="mx-auto mb-3 mt-1.5 h-1 w-[38px] rounded-full bg-hairline" />
            <div className="px-[18px] pb-2.5">
              <h2 className="font-heading text-17 font-semibold text-brand">Your firms</h2>
              <p className="mt-0.5 text-13 text-ink-muted">
                You sign in once to see every firm. The app takes the name and colours of the firm you open.
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
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} className={buttonClasses("ghost", "md", "w-full")}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
