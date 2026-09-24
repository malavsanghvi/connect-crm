import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle (.next/standalone) for the droplet deploy.
  output: "standalone",
  experimental: {
    // Setup uploads (W-9, determination letter: 10 MB; logos: 5 MB) go through
    // Server Actions; leave room for the multipart overhead.
    serverActions: { bodySizeLimit: "11mb" },
    proxyClientMaxBodySize: "11mb",
  },
};

export default nextConfig;
