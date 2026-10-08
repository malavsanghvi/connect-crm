import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { isPublicSiteHost, siteOrigin } from "@/lib/site";

/** The website (www.<domain>) is for search engines; the portal and every other address is not. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host");
  if (isPublicSiteHost(host)) {
    return { rules: { userAgent: "*", allow: "/" }, sitemap: `${siteOrigin()}/sitemap.xml` };
  }
  return { rules: { userAgent: "*", disallow: "/" } };
}
