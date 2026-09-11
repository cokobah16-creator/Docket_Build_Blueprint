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
import { clientFirms, selectedFirm } from "@/lib/portal-firm";
import { brandFontsUrl, brandStyle } from "@/lib/brand";
import { BottomNav } from "@/components/ui/bottom-nav";
import { ToastProvider } from "@/components/ui/toast";
import { ServiceWorkerRegistrar } from "@/components/portal/sw-registrar";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const supabase = await supabaseServer();
  const firm = supabase ? await selectedFirm(supabase) : await currentFirm();
  const fontsUrl = brandFontsUrl(firm?.brand);

  return (
    <div style={brandStyle(firm?.brand)} className="min-h-screen bg-brand-surface">
      {fontsUrl && <link rel="stylesheet" href={fontsUrl} />}
      <ToastProvider>
        <ServiceWorkerRegistrar />
        <div className="mx-auto max-w-lg pb-[calc(72px+env(safe-area-inset-bottom))]">
          {children}
        </div>
        <BottomNav />
      </ToastProvider>
    </div>
  );
}
