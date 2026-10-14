// Bundle the worker into one CommonJS file, dist/server.js: the droplet's
// connect@.service template runs `node server.js` in the release directory,
// so the release needs no node_modules.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

// The shared pledge PDF code (src/lib/pledge-pdf) lives in the portal's source tree, where "pdf-lib" would be looked up in the
// portal's node_modules. This service installs it for itself (worker/package.json), so the build uses that copy; with only the
// portal's node_modules present (a local run) the normal lookup is left alone.
const ownPdfLib = resolve("node_modules/pdf-lib");

await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: "linked",
  alias: existsSync(ownPdfLib) ? { "pdf-lib": ownPdfLib } : {},
  // pg only loads its optional native binding when asked to; never bundle it.
  external: ["pg-native"],
  define: { "process.env.WORKER_VERSION_BUILT": JSON.stringify(process.env.GITHUB_SHA?.slice(0, 12) ?? "dev") },
  logLevel: "info",
});

// The worker's own package.json says "type": "module"; the bundle is CommonJS.
await writeFile("dist/package.json", JSON.stringify({ type: "commonjs" }) + "\n");
