"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// A real checkbox under a drawn track, so it keeps the keyboard, the focus
// ring and the screen-reader announcement a styled <div> would throw away.

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
  return (
    <span
      className={cn(
        "relative inline-flex h-7 w-[46px] shrink-0 items-center rounded-full p-[3px] transition-colors",
        checked ? "bg-brand" : "bg-gray-300",
        disabled && "opacity-50",
        className,
      )}
    >
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-default"
      />
      <span
        aria-hidden="true"
        className={cn(
          "size-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform",
          "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand",
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
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3.5",
        divided && "border-t border-gray-100 pt-[15px]",
      )}
    >
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-gray-900">{title}</p>
        {hint && <p className="mt-0.5 text-xs leading-[1.45] text-gray-500">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
