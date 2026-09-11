// Client PWA shell: the selected firm's brand tokens + bottom navigation.
//
// The brand comes from the firm the client is *reading* (src/lib/portal-firm),
// not from the request host — one client may be acting with several firms, and
// the app takes the name and colours of whichever one they have open.
//
// The shell carries no horizontal padding: a screen may run its header, its
// progress bar or its dark call surface edge to edge. Gutters come from
// <Screen> (src/components/portal/screen.tsx).

import type { ReactNode } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { currentFirm } from "@/lib/firm";
import { selectedFirm } from "@/lib/portal-firm";
import { brandFontsUrl, brandStyle } from "@/lib/brand";
import { BottomNav } from "@/components/ui/bottom-nav";
import { ToastProvider } from "@/components/ui/toast";
import { ServiceWorkerRegistrar } from "@/components/portal/sw-registrar";
import { ConnectionBadge } from "@/components/ui/connection";
import { Alert } from "@/components/ui/alert";
import { Screen } from "@/components/portal/screen";
import { ConsentGate } from "./consent-gate";

/**
 * What stands between a client and the firm's pages until they have accepted that firm's
 * current terms and privacy notice. Null when nothing does.
 *
 * It lives in the layout because it has to cover every route: it used to live on the home
 * screen only, so /app/matters, /app/messages and the rest were reachable with no consent at
 * all, on every host. The firm is whichever one the portal is painted as — the one whose rows
 * are on screen — and the check is per firm, since one client may act with several.
 */
async function consentGateFor(
  supabase: NonNullable<Awaited<ReturnType<typeof supabaseServer>>>,
  firm: NonNullable<Awaited<ReturnType<typeof selectedFirm>>>,
): Promise<ReactNode | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const termsVersion = firm.policies.terms?.version;
  const privacyVersion = firm.policies.privacy?.version;
  // '0-…' versions are the unpublished skeleton every new firm starts with (seed_firm_defaults).
  // There is nothing to accept yet, and nothing to read either: the firm has to publish first.
  if (termsVersion?.startsWith("0-") || privacyVersion?.startsWith("0-")) {
    return (
      <Screen>
        <Alert kind="info" title={`${firm.name} has not published its terms yet`}>
          The firm is still completing its setup on Docket. Its terms of service and privacy
          notice will appear here for your acceptance once published.
        </Alert>
      </Screen>
    );
  }
  if (!termsVersion || !privacyVersion) return null;

  const { data: consents } = await supabase
    .from("consent_records")
    .select("kind, version")
    .eq("firm_id", firm.id)
    .eq("user_id", user.id);
  const rows = (consents ?? []) as Array<{ kind: string; version: string }>;
  const accepted = (kind: string, version: string) => rows.some((r) => r.kind === kind && r.version === version);
  if (accepted("terms", termsVersion) && accepted("privacy", privacyVersion)) return null;

  return (
    <Screen>
      <ConsentGate
        firmId={firm.id}
        firmName={firm.name}
        termsVersion={termsVersion}
        privacyVersion={privacyVersion}
        termsUrl={(firm.policies.terms?.url as string | null) ?? null}
        privacyUrl={(firm.policies.privacy?.url as string | null) ?? null}
      />
    </Screen>
  );
}

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const supabase = await supabaseServer();
  const firm = supabase ? await selectedFirm(supabase) : await currentFirm();
  const fontsUrl = brandFontsUrl(firm?.brand);
  const gate = supabase && firm ? await consentGateFor(supabase, firm) : null;

  return (
    <div style={brandStyle(firm?.brand)} className="min-h-screen bg-brand-surface">
      {fontsUrl && <link rel="stylesheet" href={fontsUrl} />}
      <ToastProvider>
        <ServiceWorkerRegistrar />
        <div className="px-4 pt-2 empty:hidden"><ConnectionBadge /></div>
        {gate ? (
          // No tab bar behind the gate: there is nowhere to go until it is answered.
          <div className="mx-auto max-w-lg">{gate}</div>
        ) : (
          <>
            <div className="mx-auto max-w-lg pb-[calc(72px+env(safe-area-inset-bottom))]">
              {children}
            </div>
            <BottomNav />
          </>
        )}
      </ToastProvider>
    </div>
  );
}
