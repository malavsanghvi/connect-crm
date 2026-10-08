import type { MetadataRoute } from "next";

import { siteOrigin } from "@/lib/site";

// The pages of the public website, at their public (www) addresses.
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  return [
    { url: `${origin}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${origin}/pricing`, changeFrequency: "monthly", priority: 0.9 },
  ];
}
