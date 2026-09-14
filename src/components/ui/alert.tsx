import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icon";
import { PILL_TONES, type PillTone } from "@/components/ui/badge";

type Kind = "info" | "success" | "warning" | "error" | "notice";

// An alert says the same six things a pill says, so it is drawn from the same
// six grounds rather than from a second set of hexes that drifted out of step
// with the first. `notice` is the quiet sand ground the phone uses for things
// that are true but not wrong — the offline copy, the fifteen-minute booking
// hold — which is the `over` tone; amber stays reserved for what is actually
// waiting on someone.

const kinds: Record<Kind, { tone: PillTone; icon: IconName }> = {
  info: { tone: "informing", icon: "alert" },
  success: { tone: "settled", icon: "check" },
  warning: { tone: "waiting", icon: "warning" },
  error: { tone: "wrong", icon: "alert" },
  notice: { tone: "over", icon: "clock" },
};

export function Alert({
  kind = "info",
  title,
  icon,
  children,
  className,
}: {
  kind?: Kind;
  title?: string;
  /** Override the icon where a more specific one says it better. */
  icon?: IconName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-card border px-[13px] py-[11px] text-13",
        PILL_TONES[kinds[kind].tone],
        className,
      )}
    >
      <Icon
        name={icon ?? kinds[kind].icon}
        size={17}
        strokeWidth={kind === "success" ? 2.4 : 1.7}
        className="mt-px shrink-0"
      />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className={cn(title && "mt-0.5")}>{children}</div>
      </div>
    </div>
  );
}
