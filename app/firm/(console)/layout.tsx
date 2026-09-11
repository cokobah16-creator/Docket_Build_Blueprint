// Staff console gate: session required, MFA (aal2) required, firm membership
// required — before ANY console screen renders. The database enforces the same
// rule on writes (staff_w = member + mfa_ok + firm not suspended); this gate
// just gets staff to the enrolment flow instead of letting them hit refusals.
//
// The console is one surface at two sizes. On a desktop it keeps the header
// and the horizontal row of links that reaches every screen. On a phone that
// row is replaced by the four-tab bar (Today, Consultations, Clients, Me) and
// the screens themselves carry their own headings — the artboard's lawyer
// shell, design/pwa.
//
// Everything inside is wrapped in AppShell kind="console", which is what makes
// the neutral palette resolve: --dk-app-pri is #141414 here, not the firm's
// colour, and no console token reads a firm token. A firm cannot repaint this
// screen by choosing a brand colour. See design/pwa/README.md.

import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { AppShell, TabBar } from "@/components/app";

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

/** The quiet grey chip the header uses for the role and the firm's standing. */
function HeaderChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={
        "inline-flex flex-none items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold " +
        (className ?? "bg-dk-rule text-dk-soft")
      }
    >
      {children}
    </span>
  );
}

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
    <AppShell kind="console" className="min-h-screen">
      {/* The console's own face. The client shell gets the firm's typefaces
          from brandFontsUrl(); this one is fixed, and without loading it the
          headings fall through to the system grotesque. */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&display=swap"
      />
      {/* Desktop chrome. Hidden on a phone, where the tab bar and each screen's
          own heading do this job. */}
      <header className="hidden border-b border-dk-line bg-white md:block">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/firm" className="truncate font-app-head text-base font-semibold text-dk-pri">
              {firm?.name ?? "Staff console"}
            </Link>
            <HeaderChip>{role}</HeaderChip>
            {firm?.status === "pending" && (
              <HeaderChip className="bg-[#FFFAEB] text-[#92400E]">awaiting verification</HeaderChip>
            )}
            {firm?.status === "suspended" && (
              <HeaderChip className="bg-[#FEF3F2] text-[#912018]">suspended</HeaderChip>
            )}
          </div>
          <Link href="/firm/security/mfa" className="shrink-0 text-[13.5px] font-medium text-dk-soft hover:text-dk-pri">
            Security
          </Link>
        </div>
        <nav aria-label="Console" className="mx-auto max-w-6xl overflow-x-auto px-4 pb-2">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block whitespace-nowrap rounded-lg px-3 py-2 text-[13.5px] font-medium text-dk-soft hover:bg-black/5 hover:text-dk-pri"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {firm?.status === "suspended" && (
        <div className="mx-auto w-full max-w-lg px-4 pt-4 md:max-w-6xl">
          <Alert kind="error" title="This firm is suspended">
            You can still read everything. Writing is refused by the database until Docket lifts the suspension.
          </Alert>
        </div>
      )}

      {/* One gutter for every console screen: the artboard's 16px margin and
          14px top rhythm on a phone, the desktop console's own padding above
          md. The pages below therefore lay themselves out without margins of
          their own. */}
      <main className="mx-auto w-full max-w-lg px-4 pb-28 pt-3.5 md:max-w-6xl md:pb-10 md:pt-6">
        {children}
      </main>

      <div className="md:hidden">
        <TabBar shell="console" />
      </div>
    </AppShell>
  );
}
