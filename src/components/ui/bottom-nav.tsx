"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icon";

// Client PWA bottom navigation: Home · Appointments · Matters · Messages ·
// Profile (blueprint §95). Large tap targets for phones.

const items: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/app", label: "Home", icon: "home" },
  { href: "/app/appointments", label: "Appointments", icon: "calendar" },
  { href: "/app/matters", label: "Matters", icon: "folder" },
  { href: "/app/messages", label: "Messages", icon: "mail" },
  { href: "/app/profile", label: "Profile", icon: "user" },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5 items-stretch">
        {items.map((item) => {
          const active =
            item.href === "/app"
              ? pathname === "/app"
              : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-[3px] px-1 py-2 text-center text-[11.5px] leading-tight",
                  active ? "font-semibold text-brand" : "text-gray-500",
                )}
              >
                <Icon name={item.icon} size={21} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
