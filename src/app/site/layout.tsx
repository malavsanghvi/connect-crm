import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, siteOrigin } from "@/lib/site";

// The public website (www.weaverams.org). The portal's root layout says "do not index"; this one overrides it.
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  // Absolute: the portal's root layout would otherwise add " · Weaver". Each page sets its own absolute title.
  title: { absolute: `${SITE_NAME}: ${SITE_TAGLINE}` },
  description: SITE_DESCRIPTION,
  robots: { index: true, follow: true },
  openGraph: { type: "website", siteName: SITE_NAME, title: `${SITE_NAME}: ${SITE_TAGLINE}`, description: SITE_DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: `${SITE_NAME}: ${SITE_TAGLINE}`, description: SITE_DESCRIPTION },
};

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: SITE_DESCRIPTION,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site-root flex min-h-screen flex-col bg-canvas text-ink">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-navy px-5 py-3 font-bold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to the content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c") }} />
    </div>
  );
}
