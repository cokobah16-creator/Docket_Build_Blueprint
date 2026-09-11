"use client";

// The administration navigation, as a client component for one reason: it has to carry `?firm=`.
//
// A person who belongs to more than one firm switches with that parameter, and every screen under
// /firm/admin honours it. A plain <Link href="/firm/admin/settings"> would drop it, putting them
// silently back on their first membership — editing one firm while believing they were editing
// another. useSearchParams() is the only way a link can see it, and that needs the client.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";

const NAV: Array<{ href: string; label: string }> = [
  { href: "/firm/admin", label: "Firm" },
  { href: "/firm/admin/settings", label: "Settings" },
  { href: "/firm/admin/services", label: "Services" },
  { href: "/firm/admin/intake", label: "Intake" },
  { href: "/firm/admin/people", label: "People" },
  { href: "/firm/admin/import", label: "Import" },
  { href: "/firm/admin/audit", label: "Audit" },
];

export function AdminNav() {
  const pathname = usePathname();
  const firm = useSearchParams().get("firm");
  const suffix = firm ? `?firm=${encodeURIComponent(firm)}` : "";

  return (
    <nav aria-label="Firm administration" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex items-center gap-1">
        {NAV.map((item) => {
          const current = item.href === "/firm/admin" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={`${item.href}${suffix}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "block min-h-[44px] whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium",
                  current ? "bg-black/5 text-brand" : "text-gray-700 hover:bg-black/5 hover:text-brand",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
