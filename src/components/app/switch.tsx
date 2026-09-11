"use client";

import { cn } from "@/lib/cn";

// The phone app's switch: a 46×28 track with a 22px knob, filling with the
// shell's primary colour when on. It is a real `role="switch"` rather than a
// styled checkbox so that a screen reader announces the state and the space
// bar toggles it; the whole control is 46×28 with a 44px tap area around it.

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
      className={cn(
        "flex h-7 w-[46px] flex-none items-center rounded-full p-[3px] transition-colors duration-200 disabled:opacity-50",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dk-pri",
        checked ? "justify-end bg-dk-pri" : "justify-start bg-gray-300",
      )}
    >
      <span className="block h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)]" />
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
  return (
    <div className="flex items-start justify-between gap-3.5">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-dk-strong">{title}</p>
        <p id={`${id}-hint`} className="mt-0.5 text-[12px] leading-snug text-dk-muted">
          {hint}
        </p>
      </div>
      <AppSwitch checked={checked} onChange={onChange} label={title} describedBy={`${id}-hint`} />
    </div>
  );
}
