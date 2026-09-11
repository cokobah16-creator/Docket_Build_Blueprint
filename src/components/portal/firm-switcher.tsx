"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { CheckIcon, ChevronDownIcon } from "@/components/ui/icons";

// One sign-in, whichever firms act for you.
//
// The tenant comes from the request host — the middleware resolves a custom
// domain or a {slug}.docket.app subdomain and stamps x-firm-id (blueprint §4).
// So picking another firm here is a navigation to that firm's own address,
// not a repaint in place: a firm's surface should not be reachable from
// another firm's domain. The app arrives already wearing the right colours
// because the layout reads the brand off the host it was served from.
//
// Each row is drawn in its own firm's primary colour, which is the only place
// in the client app where a colour other than the current firm's appears —
// it is what makes the list legible as a list of firms.

export interface FirmChoice {
  id: string;
  name: string;
  /** "2 matters · 3 consultations" */
  meta: string;
  primary: string | null;
  onPrimary: string;
  href: string;
  current: boolean;
}

function Mark({ firm }: { firm: FirmChoice }) {
  return (
    <span
      aria-hidden="true"
      style={
        firm.primary ? { backgroundColor: firm.primary, color: firm.onPrimary } : undefined
      }
      className={cn(
        "grid h-10 w-10 flex-none place-items-center rounded-[9px] font-app-head text-[17px] font-semibold",
        firm.primary ? undefined : "bg-dk-pri text-dk-on-pri",
      )}
    >
      {firm.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Row({ firm, className }: { firm: FirmChoice; className?: string }) {
  return (
    <a
      href={firm.href}
      aria-current={firm.current ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 text-left",
        firm.current && "bg-dk-tint",
        className,
      )}
    >
      <Mark firm={firm} />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-dk-strong">{firm.name}</span>
        {firm.meta && <span className="mt-0.5 block text-[12px] text-dk-muted">{firm.meta}</span>}
      </span>
      {firm.current && (
        <span
          style={firm.primary ? { backgroundColor: firm.primary, color: firm.onPrimary } : undefined}
          className={cn(
            "grid h-[22px] w-[22px] flex-none place-items-center rounded-full",
            firm.primary ? undefined : "bg-dk-pri text-dk-on-pri",
          )}
        >
          <CheckIcon size={15} />
          <span className="sr-only">Current firm</span>
        </span>
      )}
    </a>
  );
}

/** The "Your firms" card body on Profile. */
export function FirmList({ firms }: { firms: FirmChoice[] }) {
  return (
    <div className="divide-y divide-dk-rule">
      {firms.map((f) => (
        <Row key={f.id} firm={f} className="px-[17px] py-[13px]" />
      ))}
    </div>
  );
}

/**
 * The home-screen affordance: the firm's name under the greeting opens a sheet
 * of the others. With only one firm there is nothing to switch to, so the name
 * is plain text and no control is offered.
 */
export function FirmSwitcher({
  firmName,
  firms,
}: {
  firmName: string;
  firms: FirmChoice[];
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  const sheet = useRef<HTMLDivElement>(null);

  // aria-modal is a promise to a screen reader, not a mechanism: on its own the
  // page and the tab bar behind the scrim stayed in the focus order, so Tab
  // walked straight out of the sheet into controls hidden underneath it. The
  // same defect was fixed on the consent gate; this is the same remedy, and the
  // reason the sheet is portalled to <body> — it cannot inert an ancestor of
  // itself.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);

    const behind = [
      document.getElementById("app-content"),
      document.querySelector<HTMLElement>('nav[aria-label="Primary"]'),
    ].filter((el): el is HTMLElement => el !== null);
    behind.forEach((el) => el.setAttribute("inert", ""));
    sheet.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      behind.forEach((el) => el.removeAttribute("inert"));
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  if (firms.length < 2) {
    return <span className="text-[13px] text-dk-soft">{firmName}</span>;
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="-mx-1 -my-2 flex min-h-[44px] items-center gap-1.5 rounded px-1 py-2 text-[13px] text-dk-soft"
      >
        {firmName}
        <ChevronDownIcon size={13} className="text-gray-400" />
        <span className="sr-only">Switch firm</span>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="absolute inset-0 bg-[rgba(17,24,39,0.42)]"
          />
          <div
            ref={sheet}
            role="dialog"
            aria-modal="true"
            aria-label="Your firms"
            tabIndex={-1}
            className="dk-rise absolute inset-x-0 bottom-0 rounded-t-[18px] bg-white pb-[18px] pt-2 shadow-sheet focus:outline-none"
          >
            <div className="mx-auto mb-3 mt-1.5 h-1 w-[38px] rounded-full bg-dk-line" />
            <div className="px-[18px] pb-2.5">
              <p className="font-app-head text-[17px] font-semibold text-dk-pri">Your firms</p>
              <p className="mt-0.5 text-[12px] text-dk-muted">
                One sign-in. Opening a firm takes you to that firm&rsquo;s own address, where
                the app wears its name and colours.
              </p>
            </div>
            {firms.map((f) => (
              <Row key={f.id} firm={f} className="px-[18px] py-3.5" />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
