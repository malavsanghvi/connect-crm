import type { NextConfig } from "next";

import { siteRewrites } from "./src/lib/site-hosts";

const nextConfig: NextConfig = {
  // Self-contained server bundle (.next/standalone) for the droplet deploy.
  output: "standalone",
  // The flyer maker reads its bundled fonts from disk (src/lib/events/flyer-fonts.ts), so they must reach the
  // standalone server for the routes that render flyers: the render route and the builder page (its "Use this
  // flyer" Server Action). Keys are picomatch globs over route paths, so the brackets of [id] are escaped.
  outputFileTracingIncludes: {
    "/api/events/\\[id\\]/flyer": ["./assets/flyer-fonts/**/*"],
    "/events/builder": ["./assets/flyer-fonts/**/*"],
  },
  // The public website: on www.<domain>, "/" and "/pricing" are the pages under /site (src/lib/site-hosts.ts).
  async rewrites() {
    return { beforeFiles: siteRewrites() };
  },
  experimental: {
    // Setup uploads (W-9, determination letter: 10 MB; logos: 5 MB) go through
    // Server Actions; leave room for the multipart overhead.
    serverActions: { bodySizeLimit: "11mb" },
    proxyClientMaxBodySize: "11mb",
  },
};

export default nextConfig;
