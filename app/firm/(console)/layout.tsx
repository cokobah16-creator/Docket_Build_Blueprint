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
import { ServiceWorkerRegistrar } from "@/components/portal/sw-registrar";
import { ConnectionBadge } from "@/components/ui/connection";
import { redirect } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ConsoleNav } from "@/components/firm/console-nav";
import { requestedFirmId, staffContext } from "@/lib/firm-data";

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

  // The same resolution every console page makes: the firm named by ?firm=, else the one this
  // member last chose, else their first membership. The header used to name memberships[0]
  // whatever the page below it was showing, so a two-firm member read one firm's name over the
  // other firm's diary.
  const ctx = await staffContext(await requestedFirmId());

  if (!ctx) {
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

  const role = ctx.role;
  const { data: overview } = await supabase
    .from("firm_overview")
    .select("name, status")
    .eq("firm_id", ctx.firmId)
    .maybeSingle();
  const firm = (overview ?? null) as { name: string; status: string } | null;
  // A member of several firms can change which one the console is showing from any screen.
  // The link carries ?firm= once; the middleware remembers it for every link after.
  const otherIds = ctx.memberships.filter((m) => m.firm_id !== ctx.firmId).map((m) => m.firm_id);
  const { data: otherRows } = otherIds.length
    ? await supabase.from("firms").select("id, name").in("id", otherIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const others = (otherRows ?? []) as Array<{ id: string; name: string }>;

  return (
    <div style={CONSOLE_TOKENS} className="min-h-screen bg-brand-surface">
      <link rel="stylesheet" href={CONSOLE_FONTS} />
      {/* The offline shell for the console too: without it a dropped connection shows the browser's own error page. */}
      <ServiceWorkerRegistrar />
      <div className="mx-auto max-w-lg pb-[calc(72px+env(safe-area-inset-bottom))]">
        <header className="sticky top-0 z-30 flex min-h-[50px] items-center justify-between gap-3 border-b border-[#E6E2DB] bg-white/[0.94] px-4 py-2.5 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/firm" className="truncate font-heading text-[15px] font-bold tracking-[-0.02em] text-[#141414]">
              {firm?.name ?? ctx.firmName}
            </Link>
            <Badge>{role}</Badge>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ConnectionBadge />
            {firm?.status === "pending" && <Badge tone="waiting" icon="clock">awaiting verification</Badge>}
            {firm?.status === "suspended" && <Badge tone="wrong" icon="alert">suspended</Badge>}
            {/* Every write depends on it, so the MFA state is never hidden. */}
            <Link href="/firm/security/mfa" aria-label="Security and two-factor">
              <Badge tone="settled" icon="check">MFA</Badge>
            </Link>
          </div>
        </header>

        {others.length > 0 && (
          <nav aria-label="Switch firm" className="border-b border-[#E6E2DB] bg-[#FAF9F7] px-4 py-2 text-[12px] text-[#57534E]">
            Showing <span className="font-semibold text-[#141414]">{ctx.firmName}</span>
            {" · switch to "}
            {others.map((f, i) => (
              <span key={f.id}>
                {i > 0 && ", "}
                <Link href={`/firm?firm=${encodeURIComponent(f.id)}`} className="font-medium text-[#141414] underline underline-offset-2">
                  {f.name}
                </Link>
              </span>
            ))}
          </nav>
        )}

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
