"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icon";

// The console's four thumbs: Today, Consultations, Clients, Me. Everything
// else the firm does — sittings, matters, the service inbox, invoices,
// availability — lives behind Me, because a lawyer standing in a corridor
// has four reliable taps, not nine.

const items: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/firm", label: "Today", icon: "calendar-today" },
  { href: "/firm/appointments", label: "Consultations", icon: "video" },
  { href: "/firm/clients", label: "Clients", icon: "clients" },
  { href: "/firm/me", label: "Me", icon: "building" },
];

/** The sections that sit behind Me, so Me stays lit while you are in them. */
const BEHIND_ME = ["/firm/me", "/firm/sittings", "/firm/matters", "/firm/messages", "/firm/tasks", "/firm/uploads", "/firm/inbox", "/firm/invoices", "/firm/availability", "/firm/overview", "/firm/security", "/firm/admin"];

function isActive(href: string, pathname: string): boolean {
  if (href === "/firm") return pathname === "/firm";
  if (href === "/firm/me") return BEHIND_ME.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ConsoleNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Console"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#DDD9D2] bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4 items-stretch">
        {items.map((item) => {
          const active = isActive(item.href, pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-[3px] px-1 py-2 text-center text-[11.5px] leading-tight",
                  active ? "font-semibold text-[#141414]" : "text-gray-500",
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
