"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import type { IconProps } from "@/components/ui/icons";
import {
  CalendarIcon,
  FolderIcon,
  HomeIcon,
  MailIcon,
  TodayIcon,
  UserIcon,
  UsersIcon,
  VideoIcon,
  BuildingIcon,
} from "@/components/ui/icons";

// The bottom bar, for both shells.
//
// Five tabs in the client app (blueprint §5.15), four in the console. The tab
// is the whole target — 56px tall and a full column wide — because a thumb on
// a bus is the design constraint that matters.

interface Tab {
  href: string;
  label: string;
  Icon: (p: IconProps) => React.JSX.Element;
}

const clientTabs: Tab[] = [
  { href: "/app", label: "Home", Icon: HomeIcon },
  { href: "/app/appointments", label: "Appointments", Icon: CalendarIcon },
  { href: "/app/matters", label: "Matters", Icon: FolderIcon },
  { href: "/app/messages", label: "Messages", Icon: MailIcon },
  { href: "/app/profile", label: "Profile", Icon: UserIcon },
];

const consoleTabs: Tab[] = [
  { href: "/firm", label: "Today", Icon: TodayIcon },
  { href: "/firm/appointments", label: "Consultations", Icon: VideoIcon },
  { href: "/firm/clients", label: "Clients", Icon: UsersIcon },
  { href: "/firm/me", label: "Me", Icon: BuildingIcon },
];

export function TabBar({ shell }: { shell: "client" | "console" }) {
  const pathname = usePathname();
  const tabs = shell === "client" ? clientTabs : consoleTabs;
  const root = shell === "client" ? "/app" : "/firm";

  return (
    <nav
      aria-label="Primary"
      className="dk-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-dk-line bg-white"
    >
      <ul
        className={cn(
          "mx-auto grid max-w-lg",
          shell === "client" ? "grid-cols-5" : "grid-cols-4",
        )}
      >
        {tabs.map(({ href, label, Icon }) => {
          const active =
            href === root ? pathname === root : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-[3px] px-0.5 py-[7px] text-[11.5px]",
                  active ? "font-semibold text-dk-pri" : "text-gray-500",
                )}
              >
                <Icon size={21} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
