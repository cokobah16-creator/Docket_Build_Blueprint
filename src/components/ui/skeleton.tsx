import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

// The shape of a screen that has not arrived yet.
//
// Every server-rendered navigation in this app is currently a dead pause: the
// browser has committed to the new URL, the old screen is still on the glass,
// and nothing says anything is happening until the data comes back. On a
// mid-range phone on a metered connection that is seconds, and a client who
// taps "Matters" and watches the old screen sit there taps it again. These
// blocks are what stands in the meantime, laid out in the shape of the screen
// being waited for, so the arrival is a fill rather than a jump.
//
// None of this is content, so none of it is read out: every block is
// aria-hidden and the CONTAINER carries aria-busy="true" — see any loading.tsx.
// A screen reader is told once that the region is busy instead of being walked
// through two dozen empty boxes that say nothing.
//
// The travelling band is `.dk-shimmer` in app/globals.css, which leaves the
// flat bg-sunken tint behind for anyone who has asked for less motion.

const RADII = {
  chip: "rounded-chip",
  control: "rounded-control",
  card: "rounded-card",
  full: "rounded-full",
} as const;

export interface SkeletonProps {
  className?: string;
  /** A CSS length; a bare number is px. Left off, the block takes its width from its parent. */
  width?: CSSProperties["width"];
  /** The same. A block with no height and no h-* class is a block with no height. */
  height?: CSSProperties["height"];
  /**
   * Which corner this is standing in for — an avatar is `full`, a button is
   * `control`. It is a prop rather than a class a caller passes because
   * src/lib/cn.ts is a plain join: a `rounded-full` in className would not beat
   * the default, it would race it and let Tailwind's emit order decide.
   */
  radius?: keyof typeof RADII;
}

export function Skeleton({ className, width, height, radius = "chip" }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      style={{ width, height }}
      className={cn("dk-shimmer block bg-sunken", RADII[radius], className)}
    />
  );
}

/** Lines of prose that have not loaded — a card body, a description, a notice. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  const count = Math.max(1, Math.round(lines));
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: count }, (_, i) => (
        // The last line is short because the last line of a paragraph is short.
        // Equal-width lines read as a table, and the eye starts looking for
        // columns that are never going to appear.
        <Skeleton key={i} height={12} className={i === count - 1 ? "w-3/5" : "w-full"} />
      ))}
    </div>
  );
}

/**
 * A card-shaped placeholder. The chrome and the two padding values are
 * card.tsx's own and are kept in step with it by hand: Card renders a
 * `<section>` and takes no aria-hidden, and a placeholder has to be hidden
 * outright rather than depend on every block inside it being hidden one by one.
 *
 * `children` replaces the body — pass SkeletonRows for a card that is a list,
 * exactly as a real Card takes CardRows instead of a CardBody.
 */
export function SkeletonCard({
  lines = 3,
  header = true,
  className,
  children,
}: {
  lines?: number;
  header?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "overflow-hidden rounded-card border border-hairline bg-raised shadow-e1",
        className,
      )}
    >
      {header && (
        <div className="border-b border-hairline px-[17px] py-[13px]">
          <Skeleton width={150} height={15} />
        </div>
      )}
      {children ?? (
        <div className="px-[17px] py-[15px]">
          <SkeletonText lines={lines} />
        </div>
      )}
    </div>
  );
}

/**
 * A row in a card's stacked list: the leading icon or avatar, two lines of
 * text, and the meta that sits hard right — a date, an amount, a status.
 *
 * Its height is the height of the rows it stands in for, so a list of five does
 * not grow or shrink when the real rows land underneath the thumb that is
 * already reaching for the first one.
 */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex items-center gap-3 border-t border-hairline px-[17px] py-[13px] first:border-t-0",
        className,
      )}
    >
      <Skeleton width={34} height={34} radius="control" className="shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton height={13} className="w-2/3" />
        <Skeleton height={11} className="w-2/5" />
      </div>
      <Skeleton width={46} height={11} className="shrink-0" />
    </div>
  );
}
