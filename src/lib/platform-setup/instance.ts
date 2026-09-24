import { randomBytes } from "node:crypto";

// A random id for this running portal process. The setup wizard fetches
// https://<portal address>/api/tenancy/instance and compares it with its own id,
// which proves the address reaches THIS server (not just any server). The id
// says nothing about the server; it changes on every restart.
const KEY = "__ccPortalInstance";

export function portalInstanceId(): string {
  const g = globalThis as unknown as Record<string, string | undefined>;
  g[KEY] ??= randomBytes(12).toString("hex");
  return g[KEY]!;
}
