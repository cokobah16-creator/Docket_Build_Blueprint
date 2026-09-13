"use client";

// Rescuing what was typed before the JavaScript arrived.
//
// Every screen here is server-rendered, so its forms are on the glass and take
// keystrokes about a second before React attaches to them. A controlled field
// throws those keystrokes away: React's state is empty, the box is not, and the
// first render wins. The fix is to let the DOM keep the value — the field is
// uncontrolled, so React never writes over it — and then to do two things by
// hand that a controlled field would have done for free:
//
//   earlyFieldValue()  read what arrived early, so it can be folded into state
//   useFieldSync()     put back changes the person did not make: a restored
//                      draft, a form cleared after it was sent
//
// Fields are addressed by id rather than by ref because the component that owns
// the state is often not the component that renders the input, and threading a
// ref through two layers to read one string is more machinery than it is worth.
// Every id used here is one the form already needed for its <label for=…>.

import { useEffect, useRef } from "react";

type Field = HTMLInputElement | HTMLTextAreaElement;

/** What is in the field right now, wherever it came from. "" if it is not there. */
export function earlyFieldValue(id: string): string {
  if (typeof document === "undefined") return "";
  return (document.getElementById(id) as Field | null)?.value ?? "";
}

/**
 * Writes `value` into the uncontrolled field when the two disagree.
 *
 * Only on a genuine difference, so it never fights someone mid-word: while they
 * type, state and field already agree and nothing is written. It moves the
 * caret to the end, which is correct for the cases it exists for — a draft
 * being restored, a form being emptied after a send — and never happens during
 * ordinary typing.
 */
export function useFieldSync(id: string, value: string): void {
  // Not on the first run. React runs a child's effects before its parent's, so
  // on mount this would fire before the component holding the state has had a
  // chance to read what was typed early — and would helpfully erase it. On
  // mount the field is the source of truth; from then on, state is.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const el = document.getElementById(id) as Field | null;
    if (el && el.value !== value) el.value = value;
  }, [id, value]);
}
