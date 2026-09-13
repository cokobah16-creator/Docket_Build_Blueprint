import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

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
          hiding behind, so a "full height" screen is taller than the glass. */}
      <body className="min-h-[100dvh] text-gray-900 antialiased">{children}</body>
    </html>
  );
}
