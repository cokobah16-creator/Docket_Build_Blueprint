// Staff console gate: session required, MFA (aal2) required, firm membership
// required — before ANY console screen renders. The database enforces the same
// rule on writes (staff_w = member + mfa_ok + firm not suspended); this gate
// just gets staff to the enrolment flow instead of letting them hit refusals.
//
// The console wears no firm's colours. Those belong to the client app, where a
// client is reading their own firm's pages; here they would only make the same
// tool look different to every person using it. Colour in this shell means one
// thing — something is late, unpaid, or waiting on you — so the ground is
// near-monochrome and the status pills are the only saturated things on screen.
//
// Navigation is four bottom tabs (Today · Consultations · Clients · Me), with
// the rest of the firm's work behind Me: a lawyer uses this in a corridor.

import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ConsoleNav } from "@/components/firm/console-nav";

/** Docket's own working-tool palette — deliberately not a firm's brand. */
const CONSOLE_TOKENS = {
  "--dk-primary": "#141414",
  "--dk-accent": "#57534E",
  "--dk-surface": "#F5F4F1",
  "--dk-on-primary": "#ffffff",
  "--dk-on-accent": "#ffffff",
  "--dk-font-heading": "Archivo",
  "--dk-font-body": "Inter",
} as CSSProperties;

const CONSOLE_FONTS =
  "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap";

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
    <div style={CONSOLE_TOKENS} className="min-h-screen bg-brand-surface">
      <link rel="stylesheet" href={CONSOLE_FONTS} />
      <div className="mx-auto max-w-lg pb-[calc(72px+env(safe-area-inset-bottom))]">
        <header className="sticky top-0 z-30 flex min-h-[50px] items-center justify-between gap-3 border-b border-[#E6E2DB] bg-white/[0.94] px-4 py-2.5 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/firm" className="truncate font-heading text-[15px] font-bold tracking-[-0.02em] text-[#141414]">
              {firm?.name ?? "Staff console"}
            </Link>
            <Badge>{role}</Badge>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {firm?.status === "pending" && <Badge tone="waiting" icon="clock">awaiting verification</Badge>}
            {firm?.status === "suspended" && <Badge tone="wrong" icon="alert">suspended</Badge>}
            {/* Every write depends on it, so the MFA state is never hidden. */}
            <Link href="/firm/security/mfa" aria-label="Security and two-factor">
              <Badge tone="settled" icon="check">MFA</Badge>
            </Link>
          </div>
        </header>

        {firm?.status === "suspended" && (
          <div className="px-4 pt-4">
            <Alert kind="error" title="This firm is suspended">
              You can still read everything. Writing is refused by the database until Docket lifts the suspension.
            </Alert>
          </div>
        )}

        <main className="px-4 py-3.5">{children}</main>
      </div>
      <ConsoleNav />
    </div>
  );
}
