// Bundle the worker into one CommonJS file, dist/server.js: the droplet's
// connect@.service template runs `node server.js` in the release directory,
// so the release needs no node_modules.
import { writeFile } from "node:fs/promises";

import { build } from "esbuild";

await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: "linked",
  // pg only loads its optional native binding when asked to; never bundle it.
  external: ["pg-native"],
  define: { "process.env.WORKER_VERSION_BUILT": JSON.stringify(process.env.GITHUB_SHA?.slice(0, 12) ?? "dev") },
  logLevel: "info",
});

// The worker's own package.json says "type": "module"; the bundle is CommonJS.
await writeFile("dist/package.json", JSON.stringify({ type: "commonjs" }) + "\n");
