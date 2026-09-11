import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

// Phone buttons. Sizes are tap targets first: the full-width primary is 50px
// tall, nothing you are asked to hit is under 44px, and nothing relies on
// hover, because the device has no pointer.

export type AppButtonVariant = "primary" | "primary-sm" | "ghost" | "ghost-sm";

const variants: Record<AppButtonVariant, string> = {
  primary:
    "w-full min-h-[50px] rounded-[10px] bg-dk-pri px-5 text-[15px] font-semibold text-dk-on-pri",
  "primary-sm":
    "self-start min-h-[44px] rounded-[9px] bg-dk-pri px-5 text-[14px] font-semibold text-dk-on-pri",
  ghost:
    "flex-1 min-h-[48px] rounded-[10px] border border-dk-field bg-white px-4 text-[14px] font-medium text-dk-pri",
  // 44px, not the artboard's 40. It is the smallest control the app offers, it
  // is the one most often placed next to something else, and a thumb on a bus
  // is the constraint this design is for. Everything else about it is the
  // artboard's.
  "ghost-sm":
    "flex-none min-h-[44px] rounded-[9px] border border-dk-field bg-white px-[13px] text-[12.5px] font-semibold text-dk-pri whitespace-nowrap",
};

export function appButtonClass(
  variant: AppButtonVariant = "primary",
  className?: string,
): string {
  return cn(
    "inline-flex items-center justify-center gap-2 transition disabled:opacity-50",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dk-pri",
    variants[variant],
    className,
  );
}

export interface AppButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AppButtonVariant;
}

export function AppButton({
  variant = "primary",
  className,
  type = "button",
  ...props
}: AppButtonProps) {
  return <button type={type} className={appButtonClass(variant, className)} {...props} />;
}

export function AppButtonLink({
  href,
  variant = "primary",
  className,
  children,
  ...props
}: {
  href: string;
  variant?: AppButtonVariant;
  className?: string;
  children: ReactNode;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">) {
  return (
    <Link href={href} className={appButtonClass(variant, className)} {...props}>
      {children}
    </Link>
  );
}

/** The quiet "All" / "Details" control that sits in a card header or beside a pill. */
export function AppLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        // A standalone action, not a link inside a sentence: "All" is two
        // characters, so without a height of its own it was a ~20x17 target
        // sitting in a card header. The negative margin keeps the header's
        // own height unchanged.
        "-my-3 inline-flex min-h-[44px] items-center text-[12.5px] font-medium text-dk-pri underline underline-offset-2",
        className,
      )}
    >
      {children}
    </Link>
  );
}
