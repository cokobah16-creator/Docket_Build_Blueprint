import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Sizes are minimum heights, not vertical padding: a button that wraps to two
// lines on a narrow phone must still be one tap target, and 44px is the floor
// (WCAG 2.2 target size). `lg` is the full-width primary at the foot of a
// screen — the one thing the thumb is reaching for.

type Variant = "primary" | "secondary" | "ghost" | "danger" | "neutral";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-brand-on hover:opacity-90 focus-visible:outline-brand disabled:opacity-50",
  secondary:
    "bg-brand-accent text-brand-on-accent hover:opacity-90 focus-visible:outline-brand-accent disabled:opacity-50",
  ghost:
    "bg-white text-brand border border-gray-300 hover:bg-black/5 disabled:opacity-50",
  danger:
    "bg-[#B42318] text-white hover:bg-red-800 focus-visible:outline-[#B42318] disabled:opacity-50",
  // The staff console wears no firm's colours — see app/firm/(console)/layout.
  neutral:
    "bg-[#141414] text-white hover:opacity-90 focus-visible:outline-[#141414] disabled:opacity-50",
};

const sizes: Record<Size, string> = {
  sm: "min-h-10 rounded-[9px] px-[13px] text-[12.5px] font-semibold",
  md: "min-h-11 rounded-[9px] px-5 text-sm font-semibold",
  lg: "min-h-[50px] rounded-[10px] px-6 text-[15px] font-semibold",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 transition",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

/**
 * The same shapes for a link. A navigation dressed as a button still has to
 * be an anchor, so it gets the classes rather than the component.
 */
export function buttonClasses(
  variant: Variant = "primary",
  size: Size = "md",
  className?: string,
): string {
  return cn(
    "inline-flex items-center justify-center gap-2 transition",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
    variants[variant],
    sizes[size],
    className,
  );
}
