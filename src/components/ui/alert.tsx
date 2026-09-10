import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Kind = "info" | "success" | "warning" | "error";

const kinds: Record<Kind, { classes: string; icon: string }> = {
  info: { classes: "border-sky-200 bg-sky-50 text-sky-900", icon: "ℹ" },
  success: { classes: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: "✓" },
  warning: { classes: "border-amber-200 bg-amber-50 text-amber-900", icon: "!" },
  error: { classes: "border-red-200 bg-red-50 text-red-900", icon: "✕" },
};

export function Alert({
  kind = "info",
  title,
  children,
  className,
}: {
  kind?: Kind;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", kinds[kind].classes, className)}
    >
      <span aria-hidden="true" className="font-semibold">
        {kinds[kind].icon}
      </span>
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}
