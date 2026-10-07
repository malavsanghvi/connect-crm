import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAiStatus } from "../src/ai-status";
import { CLAUDE_MODEL, FALLBACK_BETA } from "../src/anthropic";
import { clamdTarget } from "../src/clamd";
import { PermanentError } from "../src/errors";
import { HANDLERS } from "../src/handlers";
import * as testProvider from "../src/handlers/platform.test_provider";
import { probeClamd, resetClamdHealth } from "../src/handlers/storage.scan";
import { recordingReq } from "../src/handlers/platform.test_provider";
import { createHttp } from "../src/http";
import { createPlatformConfig, DATABASE_ONLY_NAMES, overlayable } from "../src/platform-config";
import { createRegistry, jobContext, readiness } from "../src/runner";
import { ANTHROPIC_FALLBACK_BETA, ANTHROPIC_TEST_MODEL, redactSecrets } from "../../src/lib/platform-setup/checks";
import { startFakeClamd } from "./fake-clamd";
import { captureLog, fakeDb, job } from "./helpers";

const require = createRequire(import.meta.url);
const { createPlatformMock } = require("../../e2e/mocks/platform-mock.cjs") as {
  createPlatformMock: (o?: Record<string, unknown>) => {
    listen(port?: number): Promise<string>;
    close(): Promise<void>;
    state: { requests: { method: string; path: string; auth: string }[] };
  };
};

describe("platform config: the database first, the environment second", () => {
  it("overlays saved settings and secrets over the environment and reads a secret only when its version changes", async () => {
    let t = 1_000_000;
    const platform = {
      settings: { STRIPE_CLIENT_ID: "ca_saved", portal_domain: "crm.example.test", WORKER_DATABASE_URL: "postgres://nope" } as Record<string, unknown>,
      secrets: { STRIPE_TEST_SECRET_KEY: { value: "sk_test_saved_1234", version: "1" } } as Record<string, { value: string; version?: string }>,
    };
    const { db, calls } = fakeDb({ platform });
    const { log, lines } = captureLog();
    const cfg = createPlatformConfig({ STRIPE_TEST_SECRET_KEY: "sk_test_env_9999", STRIPE_CLIENT_ID: "ca_env", PAYPAL_PARTNER_ID: "ENV", WORKER_DATABASE_URL: "postgres://real" },
      db, { workerId: "w1", log, now: () => t });
    await cfg.refresh(true);
    expect(cfg.env.STRIPE_TEST_SECRET_KEY).toBe("sk_test_saved_1234");
    expect(cfg.env.STRIPE_CLIENT_ID).toBe("ca_saved");
    expect(cfg.env.PAYPAL_PARTNER_ID).toBe("ENV");
    expect(cfg.env.WORKER_DATABASE_URL).toBe("postgres://real");
    expect(cfg.env.portal_domain).toBeUndefined();
    expect({ ...cfg.env }.STRIPE_CLIENT_ID).toBe("ca_saved");
    expect(cfg.report()).toEqual({ saved: ["STRIPE_CLIENT_ID", "STRIPE_TEST_SECRET_KEY"], env: ["STRIPE_TEST_SECRET_KEY", "STRIPE_CLIENT_ID", "PAYPAL_PARTNER_ID"], error: null });
    expect(calls.filter((c) => c.fn === "readPlatformSecret")).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toContain("sk_test_saved_1234");

    // Within 60 s nothing is re-read; after it the config is read, but the unchanged secret is not.
    t += 30_000;
    await cfg.refresh();
    expect(calls.filter((c) => c.fn === "platformConfig")).toHaveLength(1);
    t += 31_000;
    await cfg.refresh();
    expect(calls.filter((c) => c.fn === "platformConfig")).toHaveLength(2);
    expect(calls.filter((c) => c.fn === "readPlatformSecret")).toHaveLength(1);

    // Rotated in the wizard: the new version is read on the next refresh.
    platform.secrets.STRIPE_TEST_SECRET_KEY = { value: "sk_test_rotated_5678", version: "2" };
    t += 61_000;
    await cfg.refresh();
    expect(cfg.env.STRIPE_TEST_SECRET_KEY).toBe("sk_test_rotated_5678");
    expect(calls.filter((c) => c.fn === "readPlatformSecret")).toHaveLength(2);
  });

  it("keeps working on the environment when the database has no platform setup or cannot be read", async () => {
    const { db } = fakeDb({ platform: null });
    const { log } = captureLog();
    const cfg = createPlatformConfig({ ANTHROPIC_API_KEY: "sk-ant-env" }, db, { workerId: "w", log });
    await cfg.refresh(true);
    expect(cfg.env.ANTHROPIC_API_KEY).toBe("sk-ant-env");

    const broken = fakeDb({ platform: { secrets: { ANTHROPIC_API_KEY: { value: "sk-ant-saved" } } } }).db;
    broken.platformConfig = async () => {
      throw new Error("connection refused");
    };
    const { log: log2, lines } = captureLog();
    const cfg2 = createPlatformConfig({ ANTHROPIC_API_KEY: "sk-ant-env" }, broken, { workerId: "w", log: log2 });
    await cfg2.refresh(true);
    expect(cfg2.env.ANTHROPIC_API_KEY).toBe("sk-ant-env");
    expect(cfg2.report().error).toMatch(/could not read the platform setup/);
    expect(lines.some((l) => l.level === "error")).toBe(true);
  });

  it("makes a handler configured by a key saved in the wizard alone (no env var)", async () => {
    const { db } = fakeDb({ platform: { settings: { STRIPE_CLIENT_ID: "ca_saved" }, secrets: { STRIPE_TEST_SECRET_KEY: { value: "sk_test_saved_1234" } } } });
    const { log } = captureLog();
    const cfg = createPlatformConfig({}, db, { workerId: "w", log });
    const reg = createRegistry(HANDLERS);
    expect(readiness(reg, cfg.env)["payments.webhook.stripe"]?.configured).toBe(false);
    await cfg.refresh(true);
    expect(readiness(reg, cfg.env)["payments.webhook.stripe"]?.configured).toBe(true);
  });

  it("never overlays the worker's own settings", () => {
    expect(overlayable("WORKER_DATABASE_URL")).toBe(false);
    expect(overlayable("portal_domain")).toBe(false);
    expect(overlayable("STRIPE_SECRET_KEY")).toBe(true);
  });

  it("takes the virus scanning mode from the database alone, never from the environment (0589)", async () => {
    const platform = { settings: {} as Record<string, unknown> };
    const { db } = fakeDb({ platform });
    const { log } = captureLog();
    let t = 1_000_000;
    const clamd = await startFakeClamd();
    resetClamdHealth();
    const env = { UPLOAD_SCAN_MODE: "enforce", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x", CLAMD_HOST: "127.0.0.1", CLAMD_PORT: String(clamd.port) };
    const cfg = createPlatformConfig(env, db, { workerId: "w", log, now: () => t });
    await cfg.refresh(true);
    expect(DATABASE_ONLY_NAMES.has("UPLOAD_SCAN_MODE")).toBe(true);
    expect(cfg.env.UPLOAD_SCAN_MODE).toBeUndefined();
    expect("UPLOAD_SCAN_MODE" in cfg.env).toBe(false);
    expect({ ...cfg.env }.UPLOAD_SCAN_MODE).toBeUndefined();
    const reg = createRegistry(HANDLERS);
    expect(readiness(reg, cfg.env)["storage.scan"]).toMatchObject({ configured: false, reason: expect.stringContaining("switched off") });
    // Saved in Platform › Setup: the overlay carries it (within a minute), and scanning is configured.
    platform.settings.UPLOAD_SCAN_MODE = "monitor";
    t += 61_000;
    await cfg.refresh();
    expect(cfg.env.UPLOAD_SCAN_MODE).toBe("monitor");
    // ... and so does clamd answering (the circuit breaker asks it first; until it has, the checks wait).
    expect(readiness(reg, cfg.env)["storage.scan"]).toMatchObject({ configured: false, reason: expect.stringContaining("waiting for clamd") });
    await probeClamd(clamdTarget(cfg.env)!);
    expect(readiness(reg, cfg.env)["storage.scan"]).toEqual({ configured: true });
    expect(readiness(reg, cfg.env)["storage.scan_sweep"]).toEqual({ configured: true });
    expect(cfg.report().env).not.toContain("UPLOAD_SCAN_MODE");
    resetClamdHealth();
    await clamd.close();
  });
});

describe("platform.test_provider", () => {
  let mock: ReturnType<typeof createPlatformMock>;
  let base: string;
  beforeAll(async () => {
    mock = createPlatformMock();
    base = await mock.listen(0);
  });
  afterAll(() => mock.close());

  const run = async (step: string, env: Record<string, string>) => {
    const { db } = fakeDb();
    const { log } = captureLog();
    const ctx = jobContext({ db, reg: createRegistry(HANDLERS), env, http: createHttp(), log, workerId: "w" }, job({ kind: "platform.test_provider", center_id: null }), log);
    return (await testProvider.run(job({ kind: "platform.test_provider", payload: { step } }), ctx)) as { ok: boolean; lines: { label: string; ok: boolean; detail: string }[]; records?: unknown[] };
  };

  it("checks Stripe and PayPal with the keys it will use, and a refused key says so without the key", async () => {
    const good = await run("payments", {
      STRIPE_TEST_SECRET_KEY: "sk_test_mock_platform_key", STRIPE_CLIENT_ID: "ca_x", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_API_BASE: base,
      PAYPAL_SANDBOX_CLIENT_ID: "sb_mock_client", PAYPAL_SANDBOX_CLIENT_SECRET: "sb_mock_secret", PAYPAL_SANDBOX_API_BASE: base,
      OAUTH_STATE_SECRET: "x".repeat(40),
    });
    expect(good.ok).toBe(true);
    expect(mock.state.requests.some((r) => r.path === "/v1/balance" && r.auth === "Bearer sk_test_mock_platform_key")).toBe(true);
    const bad = await run("payments", { STRIPE_TEST_SECRET_KEY: "sk_test_wrong_key_123456", STRIPE_API_BASE: base, OAUTH_STATE_SECRET: "x".repeat(40) });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).toContain("the key was refused");
    expect(JSON.stringify(bad)).not.toContain("sk_test_wrong_key_123456");
  });

  it("checks Twilio, Anthropic and email, and adds the platform's sending domain with its DNS records", async () => {
    expect((await run("texting", { TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000001", TWILIO_AUTH_TOKEN: "mock_twilio_token", TWILIO_FROM_NUMBER: "+18325550100", TWILIO_API_BASE: base })).ok).toBe(true);
    expect((await run("ai", { ANTHROPIC_API_KEY: "sk-ant-mock-key-000", ANTHROPIC_BASE_URL: base })).ok).toBe(true);
    expect(mock.state.requests.at(-1)).toMatchObject({ method: "POST", path: "/v1/messages", auth: "sk-ant-mock-key-000" });
    expect((await run("ai", { ANTHROPIC_API_KEY: "sk-ant-bad", ANTHROPIC_BASE_URL: base })).ok).toBe(false);
    const email = await run("email", { RESEND_API_KEY: "re_mock_key_0001", RESEND_API_BASE: base, MESSAGING_FROM_ADDRESS: "no-reply@mail.cc.test" });
    expect(email.lines[0]?.ok).toBe(true);
    expect(email.ok).toBe(false); // the domain was just added and is not verified yet
    expect(JSON.stringify(email.records)).toContain("resend._domainkey.mail.cc.test");
    expect((await run("email", { RESEND_API_KEY: "re_mock_key_0001", RESEND_API_BASE: base })).ok).toBe(false);
  });

  it("tests AI with a real one-token message, so a key blocked by its spending limit fails the test", async () => {
    const limited = await run("ai", { ANTHROPIC_API_KEY: "sk-ant-mock-limited-000", ANTHROPIC_BASE_URL: base });
    expect(limited.ok).toBe(false);
    expect(limited.lines[0]?.detail).toMatch(/^the key works, but the account's spending limit or credit ran out, so Niva and the suggestions are paused until 2026-11-01 00:00 UTC/);
    expect(JSON.stringify(limited)).not.toContain("sk-ant-mock-limited-000");
  });

  it("asks the model Niva uses, with the beta Niva sends", () => {
    expect(ANTHROPIC_TEST_MODEL).toBe(CLAUDE_MODEL);
    expect(ANTHROPIC_FALLBACK_BETA).toBe(FALLBACK_BETA);
  });

  it("records what the AI test got in the service's AI status", async () => {
    const status = createAiStatus(() => new Date("2026-10-02T10:00:00Z"));
    const limit = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "You have reached your specified API usage limits." } });
    const answers = [{ status: 400, text: limit }, { status: 200, text: "{}" }];
    const req = recordingReq(async () => answers.shift()!, status);
    await req("http://mock/v1/messages", { method: "POST", headers: {} });
    expect(status.report().state).toBe("paused");
    await req("http://mock/v1/messages", { method: "POST", headers: {} });
    expect(status.report().state).toBe("ok");
    const down = recordingReq(async () => {
      throw new Error("connect ECONNREFUSED");
    }, status);
    await expect(down("http://mock/v1/messages", { method: "POST", headers: {} })).rejects.toThrow("ECONNREFUSED");
    expect(status.report().state).toBe("unreachable");
  });

  it("refuses a payload without a testable step", async () => {
    await expect(run("portal", {})).rejects.toBeInstanceOf(PermanentError);
  });

  it("redacts every configured secret from provider answers", () => {
    expect(redactSecrets("bad key sk_test_abc123 and re_mock_key_0001 here", { RESEND_API_KEY: "re_mock_key_0001" })).toBe("bad key [redacted] and [redacted] here");
  });
});
