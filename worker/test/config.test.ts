import { describe, expect, it } from "vitest";

import { loadConfig, providerStatus, requireEnv } from "../src/config";

describe("platform secrets from env", () => {
  it("a provider is configured only when a full group of variables is set", () => {
    expect(providerStatus({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_CLIENT_ID: "ca_x" }, "stripe")).toEqual({ configured: true });
    const s = providerStatus({ STRIPE_SECRET_KEY: "sk_test_x" }, "stripe");
    expect(s).toEqual({ configured: false, reason: "Stripe is not configured on the background service (needs STRIPE_SECRET_KEY + STRIPE_CLIENT_ID)" });
    expect(providerStatus({ POSTMARK_SERVER_TOKEN: "t" }, "email").configured).toBe(true);
    expect(providerStatus({ RESEND_API_KEY: "  " }, "email").configured).toBe(false);
  });
  it("the reason names missing variables, never a value", () => {
    const r = requireEnv({ SUPABASE_URL: "http://x", SUPABASE_SECRET_KEY: "" }, ["SUPABASE_URL", "SUPABASE_SECRET_KEY"], "Storage retention");
    expect(r).toEqual({ configured: false, reason: "Storage retention is not configured on the background service (SUPABASE_SECRET_KEY not set)" });
  });
  it("refuses to start without WORKER_DATABASE_URL, and checks numbers", () => {
    expect(() => loadConfig({})).toThrow(/WORKER_DATABASE_URL is not set/);
    expect(() => loadConfig({ WORKER_DATABASE_URL: "postgres://x", WORKER_CONCURRENCY: "0" })).toThrow(/WORKER_CONCURRENCY must be/);
    const c = loadConfig({ WORKER_DATABASE_URL: "postgres://x", WORKER_ID: "w1" });
    expect(c).toMatchObject({ workerId: "w1", healthHost: "127.0.0.1", healthPort: 3010, concurrency: 4, heartbeatMs: 60000 });
  });
});
