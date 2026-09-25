import "server-only";

import { workerQuery, workerDbConfigured } from "@/lib/messaging/server-db";

import { isEnvName } from "./catalog";

// Community Connect's own provider keys on the PORTAL server: the value saved in
// the platform setup wizard first (app.platform_secrets in Supabase Vault,
// app.platform_settings), the server's environment second. So a key saved in
// the wizard works on the next request after the cache expires (60 s), with no
// redeploy, and every existing environment variable keeps working.
//
// Reads go through the connect_worker role (src/lib/messaging/server-db.ts) —
// never the Supabase secret key, never a browser. A value is fetched from the
// vault only when its version changed (each fetch is logged in
// app.secret_access_log); the metadata call returns names and versions only.
//
// The state lives on globalThis: Next.js may load this module more than once
// (route handlers, server actions), and they must share one cache.

type Snapshot = { settings: Record<string, unknown>; secrets: Record<string, { fingerprint?: string; version?: string }> };
type State = {
  values: Map<string, string>;
  versions: Map<string, string>;
  loadedAt: number | null;
  triedAt: number | null;
  error: string | null;
  inFlight: Promise<void> | null;
  warnedMissing: boolean;
};

const TTL_MS = 60_000;
const RETRY_MS = 15_000;
const KEY = "__ccPlatformConfig";

function state(): State {
  const g = globalThis as unknown as Record<string, State | undefined>;
  g[KEY] ??= { values: new Map(), versions: new Map(), loadedAt: null, triedAt: null, error: null, inFlight: null, warnedMissing: false };
  return g[KEY]!;
}

async function load(s: State): Promise<void> {
  s.triedAt = Date.now();
  if (!workerDbConfigured()) {
    // Nothing to read without the connect_worker connection: the environment alone applies.
    s.loadedAt = Date.now();
    return;
  }
  let snap: Snapshot | null;
  try {
    const rows = await workerQuery<{ c: Snapshot }>("select app.worker_platform_config() as c", []);
    snap = rows?.[0]?.c ?? null;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "42883") {
      if (!s.warnedMissing) console.error("[platform-config] the database has no platform setup yet (migration 0320); using the environment only");
      s.warnedMissing = true;
      s.loadedAt = Date.now();
      return;
    }
    s.error = `could not read the platform setup: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[platform-config] ${s.error}; keeping the last values and the environment`);
    return;
  }
  if (!snap) {
    s.loadedAt = Date.now();
    return;
  }
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(snap.settings ?? {})) {
    if (!isEnvName(key) || typeof value !== "string" || !value.trim()) continue;
    s.values.set(key, value.trim());
    seen.add(key);
  }
  const failed: string[] = [];
  for (const [name, meta] of Object.entries(snap.secrets ?? {})) {
    if (!isEnvName(name)) continue;
    seen.add(name);
    const version = String(meta?.version ?? "");
    if (s.values.has(name) && s.versions.get(name) === version) continue;
    try {
      const rows = await workerQuery<{ v: string | null }>("select app.worker_read_platform_secret($1, $2) as v", [name, "portal server: platform config (setup wizard)"]);
      const value = rows?.[0]?.v ?? null;
      if (!value || !value.trim()) {
        s.values.delete(name);
        s.versions.delete(name);
        continue;
      }
      s.values.set(name, value.trim());
      s.versions.set(name, version);
    } catch (err) {
      failed.push(name);
      console.error(`[platform-config] could not read ${name} from the vault; the previous value (or the environment) stays in use:`, err instanceof Error ? err.message : err);
    }
  }
  for (const name of [...s.values.keys()]) {
    if (!seen.has(name)) {
      s.values.delete(name);
      s.versions.delete(name);
    }
  }
  s.error = failed.length ? `could not read ${failed.join(", ")} from the vault` : null;
  if (!failed.length) s.loadedAt = Date.now();
}

/** Refresh the cache when it is older than 60 s (or `force`). Never throws. */
export async function loadPlatformConfig(force = false): Promise<void> {
  const s = state();
  if (s.inFlight) return s.inFlight;
  const now = Date.now();
  if (!force && s.loadedAt !== null && now - s.loadedAt < TTL_MS) return;
  if (!force && s.triedAt !== null && now - s.triedAt < RETRY_MS && (s.loadedAt === null || s.error !== null)) return;
  s.inFlight = load(s).finally(() => {
    s.inFlight = null;
  });
  return s.inFlight;
}

/** A platform value: saved in the wizard, else the environment, else "". Call loadPlatformConfig() first in the request. */
export function platformValue(name: string): string {
  return (state().values.get(name) ?? process.env[name] ?? "").trim();
}

/** The merged view as an env-shaped object (for code that takes an `env`). */
export function platformEnvSnapshot(): Record<string, string | undefined> {
  return { ...process.env, ...Object.fromEntries(state().values) };
}

/** Load (if stale) and return the merged view. */
export async function platformEnv(): Promise<Record<string, string | undefined>> {
  await loadPlatformConfig();
  return platformEnvSnapshot();
}

/** For the wizard: where the portal server gets each name from. Names only. */
export function platformSources(names: string[]): Record<string, "saved" | "env" | "missing"> {
  const s = state();
  return Object.fromEntries(names.map((n) => [n, s.values.has(n) ? "saved" : (process.env[n] ?? "").trim() ? "env" : "missing"]));
}

export function platformConfigError(): string | null {
  return state().error;
}
