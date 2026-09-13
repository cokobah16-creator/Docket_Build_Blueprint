// The registry console gate, in one place.
//
// Every screen under /registry is a court registry's clerk or registrar looking at the registry's
// own cause list — never at a firm. The gate is the same shape as the staff console's and the
// platform's: session, second factor, and then the one row that says who this person is. Here
// that row is registry_members, and a platform admin is NOT let through — the platform's surface
// is /admin, and a registry's console shows a registry's own work.
//
// The four outcomes are four different problems:
//   · Supabase is not configured on this host        → say so
//   · nobody is signed in                            → /firm/login (the one sign-in for staff of
//     any kind; a registry clerk has an ordinary Docket account)
//   · signed in but the session is only aal1          → /firm/security/mfa, because every write
//     below asks registry_w() or registrar_w(), which need mfa_ok()
//   · signed in, MFA done, in no registry             → say so plainly
//
// The console wears Docket's own working-tool palette, not a firm's brand — there is no firm here.

import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { registryContext } from "@/lib/registry-data";

const CONSOLE_TOKENS = {
  "--dk-primary": "#141414",
  "--dk-accent": "#57534E",
  "--dk-surface": "#F5F4F1",
  "--dk-on-primary": "#ffffff",
  "--dk-on-accent": "#ffffff",
  "--dk-font-heading": "Archivo",
  "--dk-font-body": "Inter",
} as CSSProperties;

// Rendered per request, always: what to show is decided from the caller's own session.
export const dynamic = "force-dynamic";

export default async function RegistryLayout({ children }: { children: ReactNode }) {
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/firm/login");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") redirect("/firm/security/mfa");

  const ctx = await registryContext();
  if (!ctx) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert kind="error" title="Not a registry account">
          This account does not act for any court registry. A registry&rsquo;s registrar adds its
          clerks by email; the Docket platform adds the first registrar. Firm staff work at{" "}
          <Link href="/firm" className="font-medium underline">/firm</Link>.
        </Alert>
      </main>
    );
  }

  return (
    <div style={CONSOLE_TOKENS} className="min-h-screen bg-[#F5F4F1]">
      <header className="border-b border-[#DDD9D2] bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/registry" className="truncate font-heading text-base font-semibold text-[#141414]">{ctx.registry.name}</Link>
            <Badge tone="quiet">{ctx.role}</Badge>
            {ctx.registry.status === "suspended" && <Badge tone="quiet">suspended</Badge>}
          </div>
          <nav aria-label="Registry console" className="flex items-center gap-1">
            <Link href="/registry" className="min-h-[44px] rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-black/5">Cause list</Link>
            <Link href="/registry/import" className="min-h-[44px] rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-black/5">Stage a list</Link>
            <Link href="/firm/security/mfa" className="min-h-[44px] rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-black/5">Security</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>
    </div>
  );
}
