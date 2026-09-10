// Staff console gate: session required, MFA (aal2) required, firm membership
// required — before ANY console screen renders. The database enforces the same
// rule on writes (staff_w = member + mfa_ok + firm not suspended); this gate
// just gets staff to the enrolment flow instead of letting them hit refusals.
//
// The navigation is one horizontally scrollable row so the whole console is
// reachable with a thumb on a 390px phone — a lawyer uses this in a corridor.

import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

const NAV: Array<{ href: string; label: string }> = [
  { href: "/firm", label: "Today" },
  { href: "/firm/sittings", label: "Sittings" },
  { href: "/firm/matters", label: "Matters" },
  { href: "/firm/appointments", label: "Consultations" },
  { href: "/firm/clients", label: "Clients" },
  { href: "/firm/invoices", label: "Invoices" },
  { href: "/firm/inbox", label: "Service inbox" },
  { href: "/firm/availability", label: "Availability" },
  { href: "/firm/overview", label: "Overview" },
];

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const supabase = await supabaseServer();
  if (!supabase) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert kind="warning" title="Not configured">
          Supabase environment variables are not set. See <code>.env.example</code>.
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

  const { data: membershipRows } = await supabase
    .from("firm_members")
    .select("firm_id, role");
  const memberships = (membershipRows ?? []) as Array<{ firm_id: string; role: string }>;

  if (memberships.length === 0) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert kind="error" title="No firm membership">
          This account is not a member of any firm. Ask a firm owner or admin
          to add you — or, if you are setting up a firm on Docket,{" "}
          <Link href="/firm/start" className="font-medium underline">
            register your firm
          </Link>
          .
        </Alert>
      </main>
    );
  }

  const role = memberships[0]?.role ?? "staff";
  const { data: overview } = await supabase
    .from("firm_overview")
    .select("name, status")
    .eq("firm_id", memberships[0].firm_id)
    .maybeSingle();
  const firm = (overview ?? null) as { name: string; status: string } | null;

  return (
    <div className="min-h-screen bg-brand-surface">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/firm" className="truncate font-heading text-base font-semibold text-brand">
              {firm?.name ?? "Staff console"}
            </Link>
            <Badge>{role}</Badge>
            {firm?.status === "pending" && <Badge className="bg-amber-100 text-amber-900">awaiting verification</Badge>}
            {firm?.status === "suspended" && <Badge className="bg-red-100 text-red-900">suspended</Badge>}
          </div>
          <Link href="/firm/security/mfa" className="shrink-0 text-sm font-medium text-gray-600 hover:text-brand">
            Security
          </Link>
        </div>
        <nav aria-label="Console" className="mx-auto max-w-6xl overflow-x-auto px-4 pb-2">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-black/5 hover:text-brand"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      {firm?.status === "suspended" && (
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <Alert kind="error" title="This firm is suspended">
            You can still read everything. Writing is refused by the database until Docket lifts the suspension.
          </Alert>
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
