import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FIELDS, SECRET_NAMES, SETTING_KEYS, STEPS, callbackUrls, fieldProblem, isEnvName, missingFor, normalizeDomain, setupComplete, setupProgress,
} from "@/lib/platform-setup/catalog";
import { redactSecrets, testStep } from "@/lib/platform-setup/checks";

const migration = readFileSync(join(__dirname, "..", "supabase", "migrations", "0320_platform_setup.sql"), "utf8");
const sqlList = (fn: string) => {
  const m = migration.match(new RegExp(`function app\\.${fn}\\(\\)[\\s\\S]*?select array\\[([\\s\\S]*?)\\]`));
  return [...(m?.[1] ?? "").matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
};

describe("platform setup catalog", () => {
  it("names exactly what the database accepts", () => {
    expect([...SECRET_NAMES].sort()).toEqual(sqlList("platform_secret_names"));
    expect([...SETTING_KEYS].sort()).toEqual(sqlList("platform_setting_keys"));
  });

  it("has the four required steps of the contract and never the bootstrap connection", () => {
    expect(STEPS.filter((s) => s.required).map((s) => s.key)).toEqual(["background", "portal", "email", "hooks"]);
    expect(STEPS).toHaveLength(10);
    expect(Object.keys(FIELDS)).not.toContain("WORKER_DATABASE_URL");
    expect(isEnvName("WORKER_DATABASE_URL")).toBe(false);
    expect(isEnvName("portal_domain")).toBe(false);
    expect(isEnvName("STRIPE_SECRET_KEY")).toBe(true);
  });

  it("validates values in plain English", () => {
    expect(fieldProblem("STRIPE_TEST_SECRET_KEY", "sk_live_abcdefgh")).toMatch(/test Stripe secret key/);
    expect(fieldProblem("STRIPE_TEST_SECRET_KEY", "sk_test_abcdefgh")).toBeNull();
    expect(fieldProblem("STRIPE_SECRET_KEY", " sk_live_abcdefgh")).toMatch(/space/);
    expect(fieldProblem("portal_domain", "https://CRM.Example.org/")).toBeNull();
    expect(fieldProblem("portal_domain", "crm example")).toMatch(/domain name/);
    expect(fieldProblem("wildcard_domain", "*.communityconnect.app")).toBeNull();
    expect(fieldProblem("SEND_EMAIL_HOOK_SECRET", "v1,whsec_c29tZXRoaW5nc2VjcmV0MTIz")).toBeNull();
    expect(fieldProblem("SEND_EMAIL_HOOK_SECRET", "not-a-hook-secret")).toMatch(/hook secret/);
    expect(fieldProblem("TWILIO_FROM_NUMBER", "832-555-0100")).toMatch(/international/);
    expect(fieldProblem("OAUTH_STATE_SECRET", "short-but-8+")).toMatch(/32 characters/);
    expect(fieldProblem("NOPE", "x")).toMatch(/not a field/);
    expect(normalizeDomain("https://CRM.Example.org/")).toBe("crm.example.org");
    expect(normalizeDomain("*.cc.app", true)).toBe("cc.app");
  });

  it("says what a step still needs", () => {
    const has = (set: string[]) => (n: string) => set.includes(n);
    expect(missingFor("email", has(["RESEND_API_KEY", "MESSAGING_FROM_ADDRESS"]))).toEqual(["Link signing secret"]);
    expect(missingFor("email", has([]), (k) => (k === "MESSAGING_EMAIL_PROVIDER" ? "postmark" : null))).toContain("Postmark server token");
    expect(missingFor("payments", has(["STRIPE_CLIENT_ID", "STRIPE_TEST_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "OAUTH_STATE_SECRET"]))).toEqual([]);
    expect(missingFor("payments", has(["PAYPAL_SANDBOX_CLIENT_ID"]))).toHaveLength(2);
    expect(missingFor("texting", has(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]))).toEqual(["a number or a messaging service"]);
    expect(missingFor("push", has([]))).toEqual([]);
  });

  it("is complete only when required steps are done and optional ones done or parked", () => {
    const rows = STEPS.map((s) => ({ key: s.key, required: s.required, status: "done" as const }));
    expect(setupComplete(rows)).toBe(true);
    expect(setupComplete(rows.map((r) => (r.required ? r : { ...r, status: "parked" as const })))).toBe(true);
    expect(setupComplete(rows.map((r) => (r.key === "email" ? { ...r, status: "not_started" as const } : r)))).toBe(false);
    expect(setupComplete(rows.map((r) => (r.key === "ai" ? { ...r, status: "not_started" as const } : r)))).toBe(false);
    expect(setupComplete([])).toBe(false);
    expect(setupProgress(rows.map((r) => (r.key === "hooks" ? { ...r, status: "not_started" as const } : r))).requiredOpen).toBe(1);
  });

  it("lists the provider redirect addresses", () => {
    expect(callbackUrls("/api/oauth/intuit/callback", "crm.cc.app", "cc.app")).toEqual([
      "https://crm.cc.app/api/oauth/intuit/callback",
      "https://<organization>.cc.app/api/oauth/intuit/callback — one per organization address (providers do not accept wildcards)",
    ]);
  });
});

describe("platform setup tests (the worker runs them)", () => {
  it("never lets a key into a result", async () => {
    const env = { STRIPE_TEST_SECRET_KEY: "sk_test_secret_value_123", STRIPE_API_BASE: "http://mock", OAUTH_STATE_SECRET: "y".repeat(40) };
    const res = await testStep("payments", async () => ({ status: 401, text: JSON.stringify({ error: { message: "Invalid API Key provided: sk_test_secret_value_123" } }) }), env);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain("sk_test_secret_value_123");
    expect(redactSecrets("x re_abcdefgh123 y", { RESEND_API_KEY: "re_abcdefgh123" })).toBe("x [redacted] y");
  });

  it("reports a network failure plainly", async () => {
    const res = await testStep("ai", async () => {
      throw new Error("connect ECONNREFUSED");
    }, { ANTHROPIC_API_KEY: "sk-ant-abc12345" });
    expect(res.lines[0]?.detail).toMatch(/could not reach the provider/);
  });
});
