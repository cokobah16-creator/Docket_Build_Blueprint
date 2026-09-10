// Client PWA shell: tenant brand tokens + bottom navigation.

import type { ReactNode } from "react";
import { currentFirm } from "@/lib/firm";
import { brandFontsUrl, brandStyle } from "@/lib/brand";
import { BottomNav } from "@/components/ui/bottom-nav";
import { ToastProvider } from "@/components/ui/toast";
import { ServiceWorkerRegistrar } from "@/components/portal/sw-registrar";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const firm = await currentFirm();
  const fontsUrl = brandFontsUrl(firm?.brand);

  return (
    <div style={brandStyle(firm?.brand)} className="min-h-screen bg-brand-surface">
      {fontsUrl && <link rel="stylesheet" href={fontsUrl} />}
      <ToastProvider>
        <ServiceWorkerRegistrar />
        <div className="mx-auto max-w-lg px-4 pb-24 pt-6">{children}</div>
        <BottomNav />
      </ToastProvider>
    </div>
  );
}
