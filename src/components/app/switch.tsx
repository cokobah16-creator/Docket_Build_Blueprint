"use client";

import { cn } from "@/lib/cn";

// The phone app's switch: a 46×28 track with a 22px knob, filling with the
// shell's primary colour when on. It is a real `role="switch"` rather than a
// styled checkbox so that a screen reader announces the state and the space
// bar toggles it.
//
// The track is the artboard's 46×28, so the button that carries it is padded
// out to 44px tall and the padding is pulled back with a negative margin —
// the target is 44px, the drawing is 28px, and nothing moves. An earlier
// version of this comment claimed that and the markup did not do it.

export function AppSwitch({
  checked,
  onChange,
  label,
  describedBy,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Announced name. Use when the visible label is not tied to this control. */
  label: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="-my-2 flex h-11 flex-none items-center py-2 disabled:opacity-50"
    >
      <span
        className={cn(
          "flex h-7 w-[46px] items-center rounded-full p-[3px] transition-colors duration-200",
          checked ? "justify-end bg-dk-pri" : "justify-start bg-gray-300",
        )}
      >
        <span className="block h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)]" />
      </span>
    </button>
  );
}

/** A switch in a card row: name, explanation, control on the right. */
export function AppSwitchRow({
  title,
  hint,
  checked,
  onChange,
  id,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  id: string;
}) {
  // The words are part of the control. This row replaced a full-width
  // `<label>` wrapping a checkbox, and without that the only thing that
  // toggled was the switch — the title and hint beside it became dead space
  // that looks tappable and is not.
  //
  // The handler is on the text rather than on the whole row, so a click on
  // the switch does not also bubble up here and toggle a second time. The
  // switch is still the only thing in the accessibility tree: the text is
  // already its accessible name and description, so it is aria-hidden from
  // the button's point of view and inert to the keyboard.
  return (
    <div className="flex items-start justify-between gap-3.5">
      <div
        onClick={() => onChange(!checked)}
        className="min-w-0 cursor-pointer"
      >
        <p className="text-[13.5px] font-semibold text-dk-strong">{title}</p>
        <p id={`${id}-hint`} className="mt-0.5 text-[12px] leading-snug text-dk-muted">
          {hint}
        </p>
      </div>
      <AppSwitch checked={checked} onChange={onChange} label={title} describedBy={`${id}-hint`} />
    </div>
  );
}
