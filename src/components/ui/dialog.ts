"use client";

// What a dialog owes the person using it, in one place.
//
// While it is open: Escape closes it, Tab cannot leave it, the page behind it
// does not scroll and cannot be reached by keyboard or screen reader, and when
// it closes the focus goes back to whatever opened it. Those five belong
// together — a dialog with a focus trap but no focus return strands the
// keyboard at the top of the document, and one that blocks scrolling but not
// tabbing reads out the page behind it as though it were still there.

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function useDialogBehaviour({
  open,
  onClose,
  surface,
  /** Focused when the dialog opens. Defaults to the first focusable thing in it. */
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  surface: RefObject<HTMLElement | null>;
  initialFocus?: RefObject<HTMLElement | null>;
}): void {
  // Held in a ref so a caller passing a fresh arrow function on every render
  // does not tear the whole dialog down and build it again mid-interaction.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const root = surface.current;
    const opener = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const items = focusableWithin(root);
      if (items.length === 0) {
        // Nothing to land on: keep focus on the dialog rather than letting it
        // escape to the page behind.
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);

    // The page behind stops scrolling, and stops being read out.
    //
    // The dialog is rendered where it sits in the tree rather than through a
    // portal, so "everything else" is not simply the body's other children: it
    // is every sibling at every level between the dialog and the body. Walking
    // up and marking each one is what actually takes the page behind out of the
    // tab order and the accessibility tree. `inert` does both where it is
    // supported; aria-hidden covers assistive technology where it is not.
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    const hidden: HTMLElement[] = [];
    for (let node: HTMLElement | null = root; node && node !== body; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement?.children ?? [])) {
        if (sibling instanceof HTMLElement && sibling !== node) {
          hidden.push(sibling);
          sibling.setAttribute("inert", "");
          sibling.setAttribute("aria-hidden", "true");
        }
      }
    }

    const target = initialFocus?.current ?? (root ? focusableWithin(root)[0] : null) ?? root;
    target?.focus();

    return () => {
      document.removeEventListener("keydown", onKey, true);
      body.style.overflow = previousOverflow;
      for (const el of hidden) {
        el.removeAttribute("inert");
        el.removeAttribute("aria-hidden");
      }
      // Back to whatever opened it — but only if focus is still inside the
      // dialog that is going away, so a deliberate move elsewhere is respected.
      // Without this the keyboard is left at the top of the document, which on
      // a phone means the next Tab starts the whole page again.
      const active = document.activeElement;
      if (opener?.isConnected && (!active || active === body || Boolean(root?.contains(active)))) {
        opener.focus?.();
      }
    };
  }, [open, surface, initialFocus]);
}

/**
 * Runs `fn` whenever the viewport starts matching `query`, and once on mount if
 * it already does.
 *
 * This is for dismissing something a wider layout has already taken off the
 * screen — a phone's sheet after a rotation into a tablet. It never decides
 * what to render: that is a media query's job, and measuring the window during
 * render would disagree with what the server sent.
 */
export function useWhenMatches(query: string, fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => {
      if (mql.matches) ref.current();
    };
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
}
