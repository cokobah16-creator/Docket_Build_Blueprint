// Staff console gate: session required, MFA (aal2) required, firm
// membership required — before ANY console screen renders. The database
// enforces the same rule on writes; this gate just gets staff to the
// enrolment flow instead of letting them hit refusals.

import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

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

  return (
    <div className="min-h-screen bg-brand-surface">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/firm" className="font-heading text-base font-semibold text-brand">
              Staff console
            </Link>
            <Badge>{role}</Badge>
          </div>
          <nav aria-label="Console" className="flex items-center gap-4 text-sm">
            <Link href="/firm" className="font-medium text-gray-700 hover:text-brand">
              Today
            </Link>
            <Link href="/firm/inbox" className="font-medium text-gray-700 hover:text-brand">
              Service inbox
            </Link>
            <Link
              href="/firm/security/mfa"
              className="font-medium text-gray-700 hover:text-brand"
            >
              Security
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
