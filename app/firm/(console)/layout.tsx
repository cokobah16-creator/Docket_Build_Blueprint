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
// It is the same console at every size, not a different product per device: a
// grouped sidebar on a desk, an icon rail on a tablet, and four thumbs plus
// More on a phone. Width changes the arrangement and nothing else — a lawyer on
// a phone is still a lawyer, with the same destinations and the same rights.

import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath, mfaPath } from "@/lib/auth-redirect-server";
import type { CSSProperties, ReactNode } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ConnectionBadge } from "@/components/ui/connection";
import { ServiceWorkerRegistrar } from "@/components/portal/sw-registrar";
import { AppShell } from "@/components/shell/app-shell";
import { CONSOLE_NAV } from "@/components/shell/nav";
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
  if (!user) redirect(await loginPath("staff"));

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") redirect(await mfaPath());

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
  const firmName = firm?.name ?? ctx.firmName;

  /** Which firm, and who you are in it. Written once, placed twice. */
  const identity = (
    <>
      <Link
        href="/firm"
        className="block truncate font-heading text-[15px] font-bold tracking-[-0.02em] text-[#141414]"
      >
        {firmName}
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge>{role}</Badge>
        {firm?.status === "pending" && <Badge tone="waiting" icon="clock">awaiting verification</Badge>}
        {firm?.status === "suspended" && <Badge tone="wrong" icon="alert">suspended</Badge>}
      </div>
    </>
  );

  /**
   * A member of several firms changes which one they are in, from anywhere.
   *
   * A plain anchor, deliberately, where the rest of the console uses <Link>.
   * Changing firm changes what this layout itself says — the name at the top,
   * the role badge, the firm every destination belongs to — and Next.js reuses
   * a layout across a client-side navigation that stays inside it. A soft
   * switch therefore left the sidebar describing the firm the member had just
   * left while the page beneath it showed the new one. This is the one journey
   * in the console where the whole document has to be built again, so it is.
   */
  const switcher = others.length > 0 && (
    <nav aria-label="Switch firm" className="text-[12px] leading-relaxed text-[#57534E]">
      <span className="block">Switch to</span>
      {others.map((f) => (
        <a
          key={f.id}
          href={`/firm?firm=${encodeURIComponent(f.id)}`}
          className="mt-1 flex min-h-9 items-center rounded-lg px-2 -mx-2 font-medium text-[#141414] hover:bg-black/[0.04]"
        >
          <span className="truncate">{f.name}</span>
        </a>
      ))}
    </nav>
  );

  return (
    <div style={CONSOLE_TOKENS} className="min-h-[100dvh] bg-brand-surface">
      <link rel="stylesheet" href={CONSOLE_FONTS} />
      {/* The offline shell for the console too: without it a dropped connection shows the browser's own error page. */}
      <ServiceWorkerRegistrar />

      <AppShell
        nav={CONSOLE_NAV}
        tone="neutral"
        navLabel="Console"
        // A member of one firm needs no `?firm=` on anything: there is nothing
        // to be ambiguous about, and the cookie the middleware set carries the
        // answer anyway. A member of several gets it named on every link, from
        // this render, so the sidebar always points at the firm on screen even
        // if another tab has since moved the cookie somewhere else.
        navContext={others.length > 0 ? { firm: ctx.firmId } : undefined}
        masthead={
          <div className="min-w-0">
            {identity}
            <div className="mt-2 flex items-center gap-2">
              <ConnectionBadge />
              {/* Every write depends on it, so the MFA state is never hidden. */}
              <Link href="/firm/security/mfa" aria-label="Security and two-factor">
                <Badge tone="settled" icon="check">MFA</Badge>
              </Link>
            </div>
          </div>
        }
        navFooter={switcher || undefined}
        header={
          // The phone has no sidebar, so the firm's name lives in a bar of its
          // own. Hidden from tablet up, where the rail and sidebar carry it.
          // The two links here are a name and a badge — small things to read,
          // but each is given the full 44px of height the bar can spare, so
          // they are ordinary targets rather than precision work.
          <header className="sticky top-0 z-20 flex min-h-[52px] items-center justify-between gap-3 border-b border-[#E6E2DB] bg-white/[0.94] px-4 py-1 backdrop-blur-xl md:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                href="/firm"
                className="flex min-h-11 min-w-0 items-center truncate font-heading text-[15px] font-bold tracking-[-0.02em] text-[#141414]"
              >
                {firmName}
              </Link>
              <Badge>{role}</Badge>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ConnectionBadge />
              {firm?.status === "pending" && <Badge tone="waiting" icon="clock">pending</Badge>}
              {firm?.status === "suspended" && <Badge tone="wrong" icon="alert">suspended</Badge>}
              <Link
                href="/firm/security/mfa"
                aria-label="Security and two-factor"
                className="flex min-h-11 items-center"
              >
                <Badge tone="settled" icon="check">MFA</Badge>
              </Link>
            </div>
          </header>
        }
        banner={
          <>
            {/* On a phone the sidebar's switcher is not on screen; say it here. */}
            {others.length > 0 && (
              <nav
                aria-label="Switch firm"
                className="border-b border-[#E6E2DB] bg-[#FAF9F7] px-4 py-2 text-[12px] text-[#57534E] md:hidden"
              >
                Showing <span className="font-semibold text-[#141414]">{ctx.firmName}</span>
                {" · switch to "}
                {others.map((f, i) => (
                  <span key={f.id}>
                    {i > 0 && ", "}
                    {/* An anchor for the same reason as the sidebar's switcher above. */}
                    <a href={`/firm?firm=${encodeURIComponent(f.id)}`} className="font-medium text-[#141414] underline underline-offset-2">
                      {f.name}
                    </a>
                  </span>
                ))}
              </nav>
            )}
            {firm?.status === "suspended" && (
              <div className="px-4 pt-4 md:px-6 lg:px-8">
                <Alert kind="error" title="This firm is suspended">
                  You can still read everything. Writing is refused by the database until Docket lifts the suspension.
                </Alert>
              </div>
            )}
          </>
        }
      >
        {children}
      </AppShell>
    </div>
  );
}
