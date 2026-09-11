// Client PWA shell: the firm's brand tokens, and the tab bar.
//
// The shell centres the column and clears the tab bar. Horizontal margins
// belong to each screen, because a pushed screen's sticky header runs edge to
// edge while its body is inset — see AppScreen and PushedScreen.

import type { ReactNode } from "react";
import { currentFirm } from "@/lib/firm";
import { brandFontsUrl, brandStyle } from "@/lib/brand";
import { AppShell, TabBar } from "@/components/app";
import { ToastProvider } from "@/components/ui/toast";
import { ServiceWorkerRegistrar } from "@/components/portal/sw-registrar";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const firm = await currentFirm();
  const fontsUrl = brandFontsUrl(firm?.brand);

  return (
    <AppShell kind="client" style={brandStyle(firm?.brand)}>
      {fontsUrl && <link rel="stylesheet" href={fontsUrl} />}
      <ToastProvider>
        <ServiceWorkerRegistrar />
        <div className="mx-auto w-full max-w-lg pb-28">{children}</div>
        <TabBar shell="client" />
      </ToastProvider>
    </AppShell>
  );
}
