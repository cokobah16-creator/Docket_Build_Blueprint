import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { brandStyle } from "@/lib/brand";
import { analyticsConfigured } from "@/lib/consent-cookie";
import { CookieBanner } from "@/components/ui/cookie-banner";
import "./globals.css";
import "./marketing-os.css";

export const metadata: Metadata = {
  title: {
    default: "Docket",
    template: "%s · Docket",
  },
  description:
    "Book a consultation, meet your lawyer face to face, and track your matter — on your phone.",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Docket" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The notch and the home indicator: surfaces paint under them, and the
  // safe-area insets keep controls out from under them.
  viewportFit: "cover",
  // The on-screen keyboard shrinks the layout viewport rather than covering it,
  // so `dvh` and the fixed bottom bar both know it is there — otherwise the
  // message composer ends up under the keys with no way to scroll it up.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/* dvh rather than vh: on a phone vh is the tall viewport the URL bar is
          hiding behind, so a "full height" screen is taller than the glass.

          data-brand with Docket's own defaults, so that a route with no firm
          behind it — sign-in, join, a password reset — still has a brand colour
          that follows the reader's theme. Without this, `bg-brand` on those
          pages resolved to the :root fallback, a fixed navy that measured 1.2:1
          on the dark ground the body now paints. brandStyle(null) is the same
          code path every firm's wrapper goes through, so the dark pair here is
          liftForDark()'s answer rather than a second copy of it that could
          drift. A firm's wrapper still wins inside its own subtree: custom
          properties resolve from the nearest declaration, and its data-brand is
          closer. */}
      <body data-brand style={brandStyle(null)} className="min-h-[100dvh] text-ink antialiased">
        {children}
        {/* Mounted once, here, so every surface asks the same question the same way. It renders
            nothing unless POSTHOG_KEY is set and no choice is stored. The prop is read on the
            server, because POSTHOG_KEY never reaches the browser. */}
        <CookieBanner analyticsEnabled={analyticsConfigured()} />
      </body>
    </html>
  );
}
