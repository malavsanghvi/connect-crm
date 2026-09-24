import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle (.next/standalone) for the droplet deploy.
  output: "standalone",
};

export default nextConfig;
