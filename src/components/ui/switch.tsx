"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

// A real checkbox under a drawn track, so it keeps the keyboard, the focus
// ring and the screen-reader announcement a styled <div> would throw away.

/**
 * The id of the <SettingRow> hint a control is sitting next to, so the control can
 * point aria-describedby at it.
 *
 * A row's hint is where the qualifier lives — which surface the setting touches,
 * what it costs, what it does not do — and it was rendered as a sibling <p> that
 * nothing referred to. So a screen-reader user heard the switch's label and none of
 * the sentence that makes the label mean anything: on the brand form, "Let your
 * public site follow a visitor\'s dark mode" without the half that says it is only
 * that site and not the portal or this console.
 *
 * It goes through context rather than a prop because the row owns the text and the
 * control owns the reference, and nothing in between should have to carry an id it
 * does not use. All three switches in the app sit inside a row, so all three are
 * described now without a single call site changing.
 */
const SettingHintId = createContext<string | undefined>(undefined);

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Announced to a screen reader; the visible text sits in <SettingRow>. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const describedBy = useContext(SettingHintId);
  return (
    <span
      className={cn(
        "relative inline-flex h-7 w-[46px] shrink-0 items-center rounded-full p-[3px] transition-colors duration-fast",
        checked ? "bg-brand" : "bg-edge",
        disabled && "opacity-50",
        className,
      )}
    >
      {/* The track is drawn 28px tall because that is what a switch looks like,
          but the thing a thumb actually hits is this input, and 28 is sixteen
          pixels under the floor tests/fixtures/ergonomics.mjs enforces. It
          reaches 8px past the track top and bottom instead of stopping at it:
          44px of target around a 28px drawing, with nothing drawn moved. */}
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        aria-describedby={describedBy}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute inset-x-0 -inset-y-2 z-10 cursor-pointer opacity-0 disabled:cursor-default"
      />
      {/* The knob stays literally white in both themes. It is a moving part
          rather than a surface, and it has to read against an arbitrary firm's
          brand colour on one side of the track and a neutral on the other;
          `bg-raised` is a dark grey in dark mode and would sink into a dark
          brand the moment the switch was turned on.

          Its focus ring is ink at offset 4, and both halves of that are
          load-bearing. It was `outline-brand`, which drew the firm's colour on
          top of a track that is `bg-brand` the moment the switch is on — a
          focus indicator the same colour as the thing it indicates. And at
          offset 2 a 22px knob's ring spans 26px to 30px across, so all but its
          last pixel lay inside the 28px track and had the fill to contrast
          against rather than the page. Offset 4 spans 30px to 34px, clear of
          the track entirely, where ink is 15:1 in both themes whatever colour
          the firm chose. */}
      <span
        aria-hidden="true"
        className={cn(
          "size-[22px] rounded-full bg-white shadow-e2 transition-transform duration-fast",
          "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ink",
          checked ? "translate-x-[18px]" : "translate-x-0",
        )}
      />
    </span>
  );
}

/** Label and explanation on the left, the control on the right. */
export function SettingRow({
  title,
  hint,
  divided = true,
  children,
}: {
  title: string;
  hint?: ReactNode;
  /** First row in a card has nothing above it to divide from. */
  divided?: boolean;
  children: ReactNode;
}) {
  // Generated even when there is no hint, because a hook cannot be conditional;
  // the id is simply never attached to anything in that case and the control's
  // aria-describedby stays undefined.
  const hintId = useId();
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3.5",
        divided && "border-t border-hairline pt-[15px]",
      )}
    >
      <div className="min-w-0">
        <p className="text-13 font-semibold text-ink-strong">{title}</p>
        {hint && (
          <p id={hintId} className="mt-0.5 text-11 text-ink-muted">
            {hint}
          </p>
        )}
      </div>
      <SettingHintId.Provider value={hint ? hintId : undefined}>{children}</SettingHintId.Provider>
    </div>
  );
}
