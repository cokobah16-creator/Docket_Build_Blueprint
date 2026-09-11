// Client PWA, before sign-in: the firm's colours, and no tab bar.
//
// /app/login and /app/join sit outside (portal), so without a layout of their
// own they were the only two client screens the brand never reached — no
// brandStyle() on an ancestor, so `text-brand` fell back to the root default
// and the shell tokens the phone kit reads were not defined at all, and no
// brandFontsUrl(), so the firm's heading face never loaded. They are the first
// two screens a client sees; they should be in the firm's house, not Docket's.
//
// It mirrors (portal)/layout.tsx apart from the bar itself: there is nothing to
// tab between until you are signed in, and a bar that pushed you into a screen
// that redirects straight back here would be a dead end. Both screens are a
// single centred card, so the centring lives here rather than in each of them.

import type { ReactNode } from "react";
import { currentFirm } from "@/lib/firm";
import { brandFontsUrl, brandStyle } from "@/lib/brand";
import { AppShell } from "@/components/app";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const firm = await currentFirm();
  const fontsUrl = brandFontsUrl(firm?.brand);

  return (
    <AppShell kind="client" style={brandStyle(firm?.brand)}>
      {fontsUrl && <link rel="stylesheet" href={fontsUrl} />}
      {/* Two elements, not one: the inset classes set padding outright and would
          otherwise swallow the column's own py-8 (see app/globals.css). */}
      <div className="dk-safe-top dk-safe-bottom">
        <main className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col justify-center px-4 py-8">
          {children}
        </main>
      </div>
    </AppShell>
  );
}
