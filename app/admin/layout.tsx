// The platform console gate, in one place.
//
// Every screen under /admin is the Docket operator looking at other people's firms, so the gate
// belongs to the layout rather than to each page: a page that forgets it would be a page that
// leaks. It is the same shape as the staff console gate in app/firm/(console)/layout.tsx, with
// one extra step at the end.
//
// The four outcomes are deliberately four different answers, because they are four different
// problems and only one of them is the person's fault:
//   · Supabase is not configured on this host        → say so; nothing here can work
//   · nobody is signed in                            → /firm/login
//   · signed in but the session is only aal1          → /firm/security/mfa, because every write
//     below calls an RPC that checks mfa_ok() and would refuse anyway
//   · signed in, MFA done, not a platform admin       → say so plainly and point at /firm
//
// The platform_admins row is the authority. There is no environment allowlist and no email
// pattern: is_platform_admin() in the database reads the same table, and it — not this file —
// is what actually stops a write.

import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

const NAV: Array<{ href: string; label: string }> = [
  { href: "/admin", label: "Firms" },
  { href: "/admin#domains", label: "Domains" },
  { href: "/admin/health", label: "Health" },
  { href: "/admin/reference", label: "Reference" },
];

// RENDERED PER REQUEST, ALWAYS.
//
// This page decides what to show from the caller's own session, so a single build-time render
// shared by everyone is always wrong for somebody. Next.js prerendered it anyway — a session
// read that resolves to "nobody" during the build looks, from the outside, exactly like a page
// with no request-time input — and a prerendered page is also a page whose inline bootstrap
// scripts carry no nonce, which the content security policy in src/lib/csp.ts then refuses.
// Two separate faults with one cause; force-dynamic settles both.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await supabaseServer();
  if (!supabase) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert kind="warning" title="Not configured">
          Supabase environment variables are not set on this deployment. See <code>.env.example</code>.
        </Alert>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/firm/login");

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") redirect("/firm/security/mfa");

  // platform_admins_self restricts this table to `user_id = auth.uid()`, so this query can only
  // ever return the caller's own row — asking about anybody else returns nothing.
  const { data: adminRow } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!adminRow) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert kind="error" title="Platform admins only">
          This account is not a Docket platform administrator. Platform admins are added by the
          operator directly in the database; firm staff work in the console at{" "}
          <Link href="/firm" className="font-medium underline">
            /firm
          </Link>
          .
        </Alert>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-brand-surface">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/admin" className="truncate font-heading text-base font-semibold text-brand">
              Docket platform
            </Link>
            <Badge>platform admin</Badge>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <Link href="/firm" className="text-sm font-medium text-gray-600 hover:text-brand">
              Firm console
            </Link>
            <Link href="/firm/security/mfa" className="text-sm font-medium text-gray-600 hover:text-brand">
              Security
            </Link>
          </div>
        </div>
        {/* One scrollable row so the whole console is reachable with a thumb at 390px. */}
        <nav aria-label="Platform console" className="mx-auto max-w-6xl overflow-x-auto px-4 pb-2">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block min-h-[44px] whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-black/5 hover:text-brand"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
