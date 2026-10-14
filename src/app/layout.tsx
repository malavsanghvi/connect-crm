import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { brandColor } from "@/lib/brand-colors";

import "./globals.css";

// The Weaver brand kit's two faces (brand/tokens.json, "type"): Bricolage Grotesque for display, Hanken Grotesk for everything
// else. They are loaded once here, for the portal and the website alike; src/styles/brand-tokens.css puts these variables at the
// front of --font-display and --font-sans.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
});

// The one face outside the kit: identifiers (receipt, pledge and member numbers) stay in a monospace (docs/BRAND_CONFORMANCE.md, D3).

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: { default: "Weaver", template: "%s · Weaver" },
  description:
    "Weaver admin portal: households, memberships, giving and accounting for your community. You see only what your role allows.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: brandColor("navy"),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${hanken.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-canvas text-ink">{children}</body>
    </html>
  );
}
