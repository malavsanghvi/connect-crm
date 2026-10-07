// Virus scanning of uploads (migration 0589): what storage.scan and storage.scan_sweep share.
//
// The mode is the platform setting UPLOAD_SCAN_MODE (Platform › Setup › Background service), read here through the
// platform overlay and never from this process's environment (platform-config.ts DATABASE_ONLY_NAMES): the database's
// read rules follow the same setting, so the two can never disagree.
//   off      (the default) the handlers are not configured: the runner leaves every storage.scan job in the queue
//   monitor  check every upload and record the result; nothing is held back or removed
//   enforce  record, hold back (the database's read gate) and remove infected files
// Scanning also needs the Storage API (SUPABASE_URL + SUPABASE_SECRET_KEY: the worker's own key, owner decision) to
// fetch and remove files, and clamd (CLAMD_SOCKET, or CLAMD_HOST + CLAMD_PORT) to check them.

import { requireEnv, type Env, type Readiness } from "./config";
import { clamdTarget } from "./clamd";

export type ScanMode = "off" | "monitor" | "enforce";

export function scanMode(env: Env): ScanMode {
  const v = (env.UPLOAD_SCAN_MODE ?? "").trim().toLowerCase();
  return v === "monitor" || v === "enforce" ? v : "off";
}

export function scanConfigured(env: Env): Readiness {
  if (scanMode(env) === "off") {
    return { configured: false, reason: "Virus scanning is switched off (Platform › Setup › Background service › Virus scanning of uploads)" };
  }
  const storage = requireEnv(env, ["SUPABASE_URL", "SUPABASE_SECRET_KEY"], "Virus scanning");
  if (!storage.configured) return storage;
  if (!clamdTarget(env)) {
    return { configured: false, reason: "Virus scanning is not configured on the background service (CLAMD_HOST or CLAMD_SOCKET not set)" };
  }
  return { configured: true };
}
