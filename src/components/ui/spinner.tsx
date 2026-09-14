import { cn } from "@/lib/cn";

// The one-control wait, as against the whole-screen wait the skeletons cover:
// a button that has been pressed and is talking to the server.
//
// It takes currentColor and the size convention from icon.tsx, so it drops into
// a button, a row or a badge beside a word of label without either of them
// having to be measured against the other.
//
// IT DOES NOT SPIN FOR ANYONE WHO HAS ASKED FOR LESS MOTION. The global reduce
// block in app/globals.css only clamps a duration, which for a rotation happens
// to look like not spinning — but that is luck, not intent, and it would stop
// being true the day this grows a second animated property. So the animation is
// attached through `motion-safe:` and is simply absent under reduce, leaving
// the same ring standing still: a state, not a half-drawn control.

export function Spinner({
  size = 17,
  strokeWidth = 2.2,
  label,
  className,
}: {
  /**
   * Square size in px. 17 sits on a line of 15px body text or inside a button;
   * 21 is icon.tsx's navigation default, which is bigger than this ever needs.
   */
  size?: number;
  strokeWidth?: number;
  /**
   * Given a label the spinner becomes a live status with that name. Left off it
   * is decorative and hidden, which is right inside a button: the button's own
   * aria-busy already says the action is in flight, and an sr-only "Loading"
   * would be spliced into the button's accessible name — "Loading Send message"
   * is not a control anyone can ask for by name.
   */
  label?: string;
  className?: string;
}) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-hidden={label ? undefined : true}
      className={cn("inline-flex shrink-0 items-center", className)}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        focusable="false"
        aria-hidden="true"
        className="motion-safe:animate-spin"
      >
        {/* The track, and the quarter that travels around it. Held still they
            are an ordinary ring with one arc drawn darker — which is why the
            reduced-motion state needs nothing drawn for it separately. */}
        <circle cx="12" cy="12" r="9" className="opacity-25" />
        <path d="M21 12a9 9 0 0 0-9-9" />
      </svg>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
