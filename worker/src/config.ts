// Everything the worker reads from its environment. Community Connect's own
// provider app keys ("platform secrets") come only from here; an
// organization's credentials come only from the vault (ctx.secret).

import os from "node:os";

export type Provider = "stripe" | "paypal" | "intuit" | "email" | "twilio" | "anthropic";

/** Env var names each provider needs; "anyOf" groups mean one full group is enough. */
export const PROVIDERS: Record<Provider, { label: string; anyOf: string[][] }> = {
  stripe: { label: "Stripe", anyOf: [["STRIPE_SECRET_KEY", "STRIPE_CLIENT_ID"]] },
  paypal: { label: "PayPal", anyOf: [["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]] },
  intuit: { label: "QuickBooks (Intuit)", anyOf: [["INTUIT_CLIENT_ID", "INTUIT_CLIENT_SECRET"]] },
  email: { label: "Email sending", anyOf: [["RESEND_API_KEY"], ["POSTMARK_SERVER_TOKEN"]] },
  twilio: { label: "Twilio", anyOf: [["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]] },
  anthropic: { label: "Anthropic (Niva, mapping suggestions)", anyOf: [["ANTHROPIC_API_KEY"]] },
};

export type Env = Readonly<Record<string, string | undefined>>;

export type Readiness = { configured: true } | { configured: false; reason: string };

const has = (env: Env, name: string) => typeof env[name] === "string" && env[name]!.trim() !== "";

/** Whether a set of env vars is present; the reason names the missing variables, never a value. */
export function requireEnv(env: Env, names: string[], what: string): Readiness {
  const missing = names.filter((n) => !has(env, n));
  return missing.length === 0
    ? { configured: true }
    : { configured: false, reason: `${what} is not configured on the background service (${missing.join(", ")} not set)` };
}

export function providerStatus(env: Env, provider: Provider): Readiness {
  const p = PROVIDERS[provider];
  if (p.anyOf.some((group) => group.every((n) => has(env, n)))) return { configured: true };
  const needed = p.anyOf.map((g) => g.join(" + ")).join(", or ");
  return { configured: false, reason: `${p.label} is not configured on the background service (needs ${needed})` };
}

export type WorkerConfig = {
  databaseUrl: string;
  databaseCa: string | undefined;
  workerId: string;
  healthPort: number;
  healthHost: string;
  pollMs: number;
  heartbeatMs: number;
  concurrency: number;
  shutdownMs: number;
  logLevel: "debug" | "info" | "warn" | "error";
};

function int(env: Env, name: string, dflt: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max} (got "${raw}")`);
  return n;
}

/** Reads the worker's own settings; throws a plain sentence when one is missing or wrong. */
export function loadConfig(env: Env): WorkerConfig {
  const databaseUrl = env.WORKER_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("WORKER_DATABASE_URL is not set: the background service needs the connect_worker connection string (docs/DEPLOY.md).");
  }
  const level = (env.WORKER_LOG_LEVEL ?? "info").trim();
  if (!["debug", "info", "warn", "error"].includes(level)) throw new Error(`WORKER_LOG_LEVEL must be debug, info, warn or error (got "${level}")`);
  return {
    databaseUrl,
    databaseCa: env.WORKER_DATABASE_CA?.trim() || undefined,
    workerId: env.WORKER_ID?.trim() || `${os.hostname()}-${process.pid}`,
    healthPort: int(env, "WORKER_HEALTH_PORT", 3010, 1, 65535),
    healthHost: "127.0.0.1",
    pollMs: int(env, "WORKER_POLL_MS", 5000, 100, 600000),
    heartbeatMs: int(env, "WORKER_HEARTBEAT_MS", 60000, 1000, 600000),
    concurrency: int(env, "WORKER_CONCURRENCY", 4, 1, 32),
    shutdownMs: int(env, "WORKER_SHUTDOWN_MS", 25000, 0, 600000),
    logLevel: level as WorkerConfig["logLevel"],
  };
}
