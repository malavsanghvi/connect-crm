// Community Connect's own provider keys, read from the database FIRST and from
// the environment second (onboarding Wave D, the platform setup wizard).
//
// The super admin saves keys in /platform/setup; they live in Supabase Vault
// (app.platform_secrets) and app.platform_settings. This module keeps an overlay
// of those values in memory and exposes one `env` object whose reads return the
// saved value when there is one, else the process environment. Every handler
// already reads its keys through ctx.env, so a key saved in the wizard is used
// on the next refresh (at most every 60 seconds) with no redeploy.
//
// A value is read from the vault only when its version changed (every read is
// logged in app.secret_access_log); names and versions come from
// app.worker_platform_config(), which never returns a value. WORKER_* variables
// (the database connection itself) are never overlaid.

import type { Env } from "./config";
import type { ReadContext } from "./db";
import type { Logger } from "./log";

export type PlatformSnapshot = {
  settings: Record<string, unknown>;
  secrets: Record<string, { fingerprint?: string; version?: string }>;
};

export type PlatformDb = {
  /** null when the database has no platform setup yet (before migration 0320). */
  platformConfig(): Promise<PlatformSnapshot | null>;
  readPlatformSecret(ctx: ReadContext, name: string): Promise<string | null>;
};

/** Env names only (the two domain settings are not environment variables). */
export function overlayable(name: string): boolean {
  return /^[A-Z][A-Z0-9_]+$/.test(name) && !name.startsWith("WORKER_");
}

/** Provider variable names the wizard knows about: reported (names only) so the wizard can say where each comes from. */
export const KNOWN_PLATFORM_NAMES = [
  "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "POSTMARK_SERVER_TOKEN", "POSTMARK_ACCOUNT_TOKEN", "POSTMARK_WEBHOOK_TOKEN",
  "MESSAGING_LINK_SECRET", "MESSAGING_EMAIL_PROVIDER", "MESSAGING_FROM_ADDRESS", "MESSAGING_FROM_NAME",
  "SEND_EMAIL_HOOK_SECRET", "SEND_SMS_HOOK_SECRET",
  "STRIPE_SECRET_KEY", "STRIPE_TEST_SECRET_KEY", "STRIPE_CLIENT_ID", "STRIPE_WEBHOOK_SECRET",
  "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_SANDBOX_CLIENT_ID", "PAYPAL_SANDBOX_CLIENT_SECRET", "PAYPAL_PARTNER_ID",
  "PAYPAL_BN_CODE", "PAYPAL_WEBHOOK_ID", "PAYPAL_SANDBOX_WEBHOOK_ID", "OAUTH_STATE_SECRET",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_MESSAGING_SERVICE_SID",
  "INTUIT_CLIENT_ID", "INTUIT_CLIENT_SECRET", "INTUIT_SANDBOX_CLIENT_ID", "INTUIT_SANDBOX_CLIENT_SECRET", "INTUIT_REDIRECT_URI",
  "ANTHROPIC_API_KEY", "EXPO_ACCESS_TOKEN",
];

export type PlatformConfig = {
  /** Reads: saved value first, then the process environment. */
  env: Env;
  /** Re-read the database if the last read is older than the TTL (or `force`). Never throws. */
  refresh(force?: boolean): Promise<void>;
  /** For the heartbeat: which names come from the wizard and which from the environment. Names only. */
  report(): { saved: string[]; env: string[]; error: string | null };
};

export function createPlatformConfig(
  base: Env,
  db: PlatformDb,
  opts: { workerId: string; log: Logger; ttlMs?: number; retryMs?: number; now?: () => number },
): PlatformConfig {
  const ttl = opts.ttlMs ?? 60000;
  const retry = opts.retryMs ?? 15000;
  const now = opts.now ?? (() => Date.now());
  const overlay = new Map<string, string>();
  const versions = new Map<string, string>();
  let lastOk: number | null = null;
  let lastTry: number | null = null;
  let lastError: string | null = null;
  let inFlight: Promise<void> | null = null;
  let warnedMissing = false;

  const get = (name: string): string | undefined => overlay.get(name) ?? base[name];
  const env: Env = new Proxy({} as Record<string, string | undefined>, {
    get: (_t, p) => (typeof p === "string" ? get(p) : undefined),
    has: (_t, p) => typeof p === "string" && (overlay.has(p) || p in base),
    ownKeys: () => [...new Set([...Object.keys(base), ...overlay.keys()])],
    getOwnPropertyDescriptor: (_t, p) =>
      typeof p === "string" && (overlay.has(p) || p in base) ? { enumerable: true, configurable: true, value: get(p), writable: false } : undefined,
  });

  async function load(): Promise<void> {
    lastTry = now();
    let snap: PlatformSnapshot | null;
    try {
      snap = await db.platformConfig();
    } catch (err) {
      lastError = `could not read the platform setup: ${err instanceof Error ? err.message : String(err)}`;
      opts.log.error("could not read the platform setup; keeping the last values and the environment", { error: err });
      return;
    }
    if (snap === null) {
      if (!warnedMissing) opts.log.warn("the database has no platform setup yet (migration 0320); using the environment only");
      warnedMissing = true;
      lastOk = now();
      lastError = null;
      return;
    }
    const seen = new Set<string>();
    for (const [key, value] of Object.entries(snap.settings ?? {})) {
      if (!overlayable(key) || typeof value !== "string" || value.trim() === "") continue;
      overlay.set(key, value.trim());
      seen.add(key);
    }
    const failures: string[] = [];
    for (const [name, meta] of Object.entries(snap.secrets ?? {})) {
      if (!overlayable(name)) continue;
      seen.add(name);
      const version = String(meta?.version ?? "");
      if (overlay.has(name) && versions.get(name) === version) continue;
      try {
        const value = await db.readPlatformSecret({ workerId: opts.workerId, jobId: null, purpose: "platform config (setup wizard)" }, name);
        if (value === null || value.trim() === "") {
          overlay.delete(name);
          versions.delete(name);
          continue;
        }
        overlay.set(name, value.trim());
        versions.set(name, version);
        opts.log.info("platform key loaded from the setup wizard", { name, fingerprint: meta?.fingerprint ?? null });
      } catch (err) {
        failures.push(name);
        opts.log.error("could not read a platform key; the previous value (or the environment) stays in use", { name, error: err });
      }
    }
    // Removed in the database: fall back to the environment again.
    for (const name of [...overlay.keys()]) {
      if (!seen.has(name)) {
        overlay.delete(name);
        versions.delete(name);
      }
    }
    lastError = failures.length ? `could not read ${failures.join(", ")} from the vault` : null;
    if (!failures.length) lastOk = now();
  }

  return {
    env,
    async refresh(force = false) {
      if (inFlight) return inFlight;
      const t = now();
      if (!force && lastOk !== null && t - lastOk < ttl) return;
      if (!force && lastOk === null && lastTry !== null && t - lastTry < retry) return;
      if (!force && lastOk !== null && lastError !== null && lastTry !== null && t - lastTry < retry) return;
      inFlight = load().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    report() {
      const has = (n: string) => typeof base[n] === "string" && base[n]!.trim() !== "";
      return {
        saved: [...overlay.keys()].sort(),
        env: KNOWN_PLATFORM_NAMES.filter(has),
        // No timestamp here: the heartbeat's info is audited when it changes, so it must stay stable.
        error: lastError,
      };
    },
  };
}
