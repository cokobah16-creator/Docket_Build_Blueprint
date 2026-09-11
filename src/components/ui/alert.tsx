import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icon";

type Kind = "info" | "success" | "warning" | "error" | "notice";

// `notice` is the quiet sand ground the phone uses for things that are true
// but not wrong — the offline copy, the fifteen-minute booking hold. Amber is
// reserved for what is actually waiting on someone.

const kinds: Record<Kind, { classes: string; icon: IconName }> = {
  info: { classes: "border-[#BAE0F5] bg-[#F0F9FF] text-[#065986]", icon: "alert" },
  success: { classes: "border-[#A7D8BE] bg-[#ECFDF3] text-[#05603A]", icon: "check" },
  warning: { classes: "border-[#F3DDA4] bg-[#FFFAEB] text-[#92400E]", icon: "warning" },
  error: { classes: "border-[#E5C4C4] bg-[#FEF3F2] text-[#912018]", icon: "alert" },
  notice: { classes: "border-[#D9D2C4] bg-[#FBF7EE] text-[#5C4F35]", icon: "clock" },
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
        "flex items-start gap-2.5 rounded-[10px] border px-[13px] py-[11px] text-[12.5px] leading-[1.45]",
        kinds[kind].classes,
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
