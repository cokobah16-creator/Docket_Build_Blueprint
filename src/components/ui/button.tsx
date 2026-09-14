import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/spinner";

// Sizes are minimum heights, not vertical padding: a button that wraps to two
// lines on a narrow phone must still be one tap target, and 44px is the floor
// (WCAG 2.2 target size). `lg` is the full-width primary at the foot of a
// screen — the one thing the thumb is reaching for.

type Variant = "primary" | "secondary" | "ghost" | "quiet" | "danger" | "neutral";
type Size = "sm" | "md" | "lg";

// Hover and press are an overlay of the button's own text colour, not a darker
// shade of its fill. A tenant's brand colour is arbitrary, so nothing here can
// compute a safe darker green for it — but the foreground Docket already
// derived for that colour (white on a dark brand, near-black on a light one) is
// by definition the direction that reads as "pressed" on top of it, so layering
// that at 10% and then 20% responds correctly on any fill. The old
// `hover:opacity-90` did the opposite: it faded the control toward the page
// instead of toward the finger, and there was no pressed state at all.
//
// The overlay sits at a negative z-index inside the button's own stacking
// context (`isolate`), which paints it above the fill and below the label — so
// the label and the spinner keep their exact colour while the fill shifts.
const overlay =
  "relative isolate before:pointer-events-none before:absolute before:inset-0 before:-z-10 " +
  "before:rounded-[inherit] before:bg-current before:opacity-0 before:transition-opacity " +
  "before:duration-fast hover:before:opacity-10 active:before:opacity-20 disabled:before:opacity-0";

const base = cn(
  "inline-flex items-center justify-center gap-2 transition duration-fast",
  overlay,
  // The 1px drop is the half of the press a thumb can actually see: the colour
  // change is hidden underneath the fingertip that caused it, the movement is
  // not.
  "active:translate-y-px disabled:opacity-50",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
);

// `border-edge` rather than a hairline: this border is the only thing bounding
// the control, so it has to clear 3:1 (WCAG 1.4.11).
const bordered = "border border-edge bg-raised text-brand";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-brand-on focus-visible:outline-brand",
  secondary: "bg-brand-accent text-brand-on-accent focus-visible:outline-brand-accent",
  ghost: bordered,
  // The same treatment under the name the rest of the app hand-rolls it with
  // ("border border-gray-300 bg-white text-brand hover:bg-black/5", 40-odd
  // sites). `ghost` keeps its own name because 120 callers already say it.
  quiet: bordered,
  danger: "bg-danger text-danger-on focus-visible:outline-danger",
  // The staff console wears no firm's colours — see app/firm/(console)/layout.
  // A literal #141414 was a near-black button on a near-black page once dark
  // mode landed; `ink-strong` is that exact colour in light and inverts in dark.
  neutral: "bg-ink-strong text-paper focus-visible:outline-ink-strong",
};

const sizes: Record<Size, string> = {
  // `sm` is smaller type in a tighter box, not a smaller target: 44px is the
  // floor for all three, because the thumb does not get more accurate when the
  // button is secondary.
  sm: "min-h-11 rounded-control px-[13px] text-13 font-semibold",
  md: "min-h-11 rounded-control px-5 text-15 font-semibold",
  lg: "min-h-[50px] rounded-control px-6 text-15 font-semibold",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /**
   * The action is in flight: the button disables itself, announces aria-busy
   * and grows a spinner while keeping its label. The app hand-rolls this as a
   * text swap in some forty places, in fourteen different wordings, and only
   * seven of them set aria-busy — so a screen-reader user pressed Send and
   * heard nothing at all happen.
   */
  pending?: boolean;
  /** The full-width action at the foot of a screen or inside a sheet. */
  fullWidth?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  pending = false,
  fullWidth = false,
  className,
  type = "button",
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      className={cn(base, variants[variant], sizes[size], fullWidth && "w-full", className)}
      {...props}
    >
      {pending && <Spinner />}
      {children}
    </button>
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
  return cn(base, variants[variant], sizes[size], className);
}
