import { cn } from "@/lib/cn";
import type { MatterStatus } from "@/lib/db/types";

// A firm names its own matter statuses and gives each a colour: one of the
// tone names below, or a hex value of its own. A named tone is a pale tint
// with a dark label; a hex colour is drawn as an outline in that colour on
// the card, because a firm's arbitrary hex on a tinted ground is contrast
// nobody has checked.
const TONES: Record<string, string> = {
  slate: "border-slate-300 bg-slate-50 text-slate-800",
  gray: "border-edge bg-sunken text-ink",
  grey: "border-edge bg-sunken text-ink",
  blue: "border-blue-300 bg-blue-50 text-blue-900",
  sky: "border-sky-300 bg-sky-50 text-sky-900",
  indigo: "border-indigo-300 bg-indigo-50 text-indigo-900",
  violet: "border-violet-300 bg-violet-50 text-violet-900",
  purple: "border-purple-300 bg-purple-50 text-purple-900",
  green: "border-emerald-300 bg-emerald-50 text-emerald-900",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
  teal: "border-teal-300 bg-teal-50 text-teal-900",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  orange: "border-orange-300 bg-orange-50 text-orange-900",
  red: "border-red-300 bg-red-50 text-red-900",
  rose: "border-rose-300 bg-rose-50 text-rose-900",
};

/** A matter's status as the firm labelled and coloured it. */
export function StatusChip({ status }: { status: MatterStatus }) {
  const colour = (status.colour ?? "").trim();
  const hex = colour.startsWith("#");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-13 font-medium",
        hex ? "bg-raised" : TONES[colour.toLowerCase()] ?? "border-edge bg-sunken text-ink",
      )}
      style={hex ? { borderColor: colour, color: colour } : undefined}
    >
      {status.label}
    </span>
  );
}
