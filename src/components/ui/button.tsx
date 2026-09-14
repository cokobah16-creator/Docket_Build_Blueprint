import type { ButtonHTMLAttributes, MouseEvent } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/spinner";

// Sizes are minimum heights, not vertical padding: a button that wraps to two
// lines on a narrow phone must still be one tap target, and 44px is the floor
// (WCAG 2.2 target size). `lg` is the full-width primary at the foot of a
// screen — the one thing the thumb is reaching for.

type Variant = "primary" | "secondary" | "ghost" | "danger" | "neutral";
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
//
// The last two rules are `disabled:before:opacity-0` again for a button that is
// only ARIA-disabled — a `pending` one, which stays a live element so that it
// can keep focus. They are stacked onto :hover and :active instead of written
// once as a bare `aria-disabled:before:opacity-0` because that bare form ties
// with `hover:before:opacity-10` on specificity, and a tie is settled by the
// order Tailwind happens to emit the two variants in. `[aria-disabled]:hover`
// outranks `:hover` outright, so it wins wherever it lands in the sheet.
const overlay =
  "relative isolate before:pointer-events-none before:absolute before:inset-0 before:-z-10 " +
  "before:rounded-[inherit] before:bg-current before:opacity-0 before:transition-opacity " +
  "before:duration-fast hover:before:opacity-10 active:before:opacity-20 disabled:before:opacity-0 " +
  "aria-disabled:hover:before:opacity-0 aria-disabled:active:before:opacity-0";

const base = cn(
  "inline-flex items-center justify-center gap-2 transition duration-fast",
  overlay,
  // The 1px drop is the half of the press a thumb can actually see: the colour
  // change is hidden underneath the fingertip that caused it, the movement is
  // not.
  "active:translate-y-px disabled:opacity-50",
  // The same states again for the ARIA-disabled button. The dim can be written
  // plainly because nothing else on the element sets opacity, so there is no
  // tie to settle. The press drop is a new problem rather than a repeated one:
  // a real `disabled` element never matches :active, so there was nothing to
  // switch off, but an aria-disabled button is still a live button and does
  // match it — and a control that dips under the finger while refusing the
  // press is telling the finger something untrue.
  //
  // The cursor is the third thing plain `disabled` was doing here for free, and
  // the one that does not survive the swap on its own. Preflight sets
  // `button { cursor: pointer }` and then takes it back with
  // `:disabled { cursor: default }`; an aria-disabled button matches only the
  // first of those, so a pending button went on offering the pointing hand to a
  // mouse it was about to refuse. switch.tsx states the same rule for the same
  // reason.
  "aria-disabled:opacity-50 aria-disabled:active:translate-y-0 aria-disabled:cursor-default",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
);

// `border-edge` rather than a hairline: this border is the only thing bounding
// the control, so it has to clear 3:1 (WCAG 1.4.11).
//
// The label is INK, not the firm's colour, and one class string has to answer
// for two kinds of surface.
//
// 89 of these sit in the staff console and the registry console, which are
// Docket's own surfaces and which a tenant's colour must never reach. Neither
// app/firm/(console)/layout.tsx nor app/admin/layout.tsx carries data-brand, so
// --dk-primary there stays the :root default at globals.css:36 — #1c2b3a, and
// fixed in both themes, because all four rules that re-point it are scoped to
// [data-brand]. That is a navy label on a card that is rgb(36 34 31) in dark:
// 1.10:1, which is not a colour so much as a shape.
//
// The other thirty-odd sit in the portal and on a firm's public site, and those
// DO carry data-brand — app/app/(portal)/layout.tsx and
// app/(public)/[firm]/layout.tsx, as does the preview block in
// admin/settings/settings-forms.tsx, deliberately, so a firm can see its own
// colours before its clients do. There `text-brand` really would resolve to the
// firm's own colour, and that is no better: a firm's colour is only ever derived
// against its own fill — --dk-on-primary is computed for bg-brand — and nothing
// anywhere measures the colour itself against `bg-raised`. A brand label on this
// fill has no guaranteed ratio at all, in light or in dark.
//
// Ink clears 14:1 on this fill in both themes. The firm's colour is on the
// PRIMARY button, which is where a client looks for it; "Cancel" was never
// carrying the brand.
//
// The focus ring is stated for the same reason and must be stated at all: with
// no outline-color of its own the ring falls back to the label's colour, which
// differs by browser and, until this line, was the tenant's.
const bordered = "border border-edge bg-raised text-ink-strong focus-visible:outline-ink-strong";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-brand-on focus-visible:outline-brand",
  secondary: "bg-brand-accent text-brand-on-accent focus-visible:outline-brand-accent",
  // This is also what the forty-odd sites that still hand-roll the shape as
  // "border border-gray-300 bg-white text-brand hover:bg-black/5" should be
  // migrated onto. A second name, `quiet`, was added for them and has been
  // taken away again: it resolved to this same string, nothing ever asked for
  // it, and two names for one value is how two variants drift apart by accident
  // the first time somebody edits one of them. If a migration later wants a
  // genuinely lighter treatment, it can be added then, with a difference.
  ghost: bordered,
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
   * The action is in flight: the button announces aria-busy, grows a spinner,
   * keeps its label, and refuses to do anything. The app hand-rolls this as a
   * text swap in some forty places, in fourteen different wordings, and only
   * seven of them set aria-busy — so a screen-reader user pressed Send and
   * heard nothing at all happen.
   *
   * It marks the button aria-disabled and NOT `disabled`. See the note above
   * Button for why that distinction is the whole of the fix — and for the half
   * of the announcement this file deliberately does not own.
   */
  pending?: boolean;
  /** The full-width action at the foot of a screen or inside a sheet. */
  fullWidth?: boolean;
}

// `pending` marks the button aria-disabled rather than `disabled`, and that
// swap is the reason the prop earns its place.
//
// Every browser moves focus to <body> the moment the focused element becomes
// `disabled`. The button that goes pending is by definition the one the user
// just pressed, so on a long form a keyboard user is dropped at the top of the
// document mid-submit and has to tab all the way back down to find out what
// happened. `aria-disabled` leaves the element focusable and focus stays put.
// That is also what rescues the announcement the doc comment promises:
// aria-busy on a `disabled` control is dropped by most screen readers, while on
// a control that still holds focus it is reported.
//
// The price is that aria-disabled is a promise to assistive technology and
// nothing more. The button still fires, and a type="submit" one still submits
// its form — including by implicit submission, where Enter in a text field
// dispatches a click at the form's default button without the pointer ever
// going near it. So the promise has to be kept in JavaScript. onClick is the
// one place all of those paths meet, which is why the guard sits there: it
// cancels the submission, stops the event before an ancestor row or card's own
// onClick sees it, and returns without ever calling the caller's handler.
//
// What this does NOT do is announce the OUTCOME. "Sent", or "That failed", is
// the sentence the screen-reader user is really waiting for, and only the
// caller knows which one it is. A live region owned by the button could say
// nothing better than a generic "Working", and it could not live inside the
// button in any case: every scrap of text in there is spliced into the accessible
// name, and "Working Send message" is not a control anyone can ask for by name.
// The app wants ONE polite live region per form, sited next to the thing whose
// result it reports. That is a person's call about the forty call sites, not a
// decision this primitive can make for them, so it is left open on purpose.
export function Button({
  variant = "primary",
  size = "md",
  pending = false,
  fullWidth = false,
  className,
  type = "button",
  disabled,
  onClick,
  children,
  ...props
}: ButtonProps) {
  // Attached only while pending. Button is rendered by server components too —
  // app/firm/(console)/page.tsx and a dozen others hand it no handler at all —
  // and a function reaching a host element from there is a render-time error,
  // so the ordinary button goes on passing the caller's own onClick straight
  // through, undefined included.
  const click = pending
    ? (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
      }
    : onClick;

  return (
    <button
      type={type}
      aria-busy={pending || undefined}
      aria-disabled={pending || undefined}
      disabled={disabled}
      onClick={click}
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
