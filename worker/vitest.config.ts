import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The pledge PDF code shared with the portal imports "pdf-lib"; this service installs its own copy, so resolve that one when it is there.
const ownPdfLib = fileURLToPath(new URL("./node_modules/pdf-lib", import.meta.url));

export default defineConfig({
  resolve: { alias: existsSync(ownPdfLib) ? { "pdf-lib": ownPdfLib } : {} },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
