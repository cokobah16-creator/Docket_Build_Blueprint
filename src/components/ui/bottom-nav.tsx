"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

// Client PWA bottom navigation: Home · Appointments · Matters · Messages ·
// Profile (blueprint §95). Large tap targets for phones.

const items = [
  { href: "/app", label: "Home", icon: "⌂" },
  { href: "/app/appointments", label: "Appointments", icon: "📅" },
  { href: "/app/matters", label: "Matters", icon: "🗂" },
  { href: "/app/messages", label: "Messages", icon: "✉" },
  { href: "/app/profile", label: "Profile", icon: "👤" },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-between">
        {items.map((item) => {
          const active =
            item.href === "/app"
              ? pathname === "/app"
              : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs",
                  active ? "font-semibold text-brand" : "text-gray-500",
                )}
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
