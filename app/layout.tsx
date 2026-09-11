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
  // No appleWebApp.title: apple-mobile-web-app-title overrides the manifest's
  // short_name, and this layout wraps every tenant. Hardcoding it here put
  // "Docket" on the home screen of an app whose install banner had just said
  // "Add Bello & Co to your home screen". Without it iOS takes the per-firm
  // short_name that app/manifest.ts already computes.
  appleWebApp: { capable: true, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen text-gray-900 antialiased">{children}</body>
    </html>
  );
}
