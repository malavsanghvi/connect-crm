import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FIELDS, SECRET_NAMES, SETTING_KEYS, STEPS, callbackUrls, fieldProblem, isEnvName, missingFor, normalizeDomain, setupComplete, setupProgress,
} from "@/lib/platform-setup/catalog";
import { ANTHROPIC_FALLBACK_BETA, ANTHROPIC_TEST_MODEL, anthropicTestLine, geminiTestLine, redactSecrets, testStep } from "@/lib/platform-setup/checks";

// The LATEST migration that defines each list: 0320 made them and 0585 added the Gemini names, so a later one that copies
// an older list would be caught here.
const migrationsDir = join(__dirname, "..", "supabase", "migrations");
const sqlList = (fn: string) => {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const re = new RegExp(`function app\\.${fn}\\(\\)[\\s\\S]*?select array\\[([\\s\\S]*?)\\]`);
  let found: string[] = [];
  for (const f of files) {
    const m = readFileSync(join(migrationsDir, f), "utf8").match(re);
    if (m) found = [...(m[1] ?? "").matchAll(/'([^']+)'/g)].map((x) => x[1] as string).sort();
  }
  return found;
};

describe("platform setup catalog", () => {
  it("names exactly what the database accepts", () => {
    expect([...SECRET_NAMES].sort()).toEqual(sqlList("platform_secret_names"));
    expect([...SETTING_KEYS].sort()).toEqual(sqlList("platform_setting_keys"));
  });

  it("has the four required steps of the contract and never the bootstrap connection", () => {
    expect(STEPS.filter((s) => s.required).map((s) => s.key)).toEqual(["background", "portal", "email", "hooks"]);
    expect(STEPS).toHaveLength(11);
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
    expect(fieldProblem("GEMINI_API_KEY", "AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY")).toBeNull();
    expect(fieldProblem("GEMINI_API_KEY", "short")).toMatch(/too short/);
    expect(fieldProblem("GEMINI_API_KEY", "AIzaSy!!!!!!!!!!!!!!!!!!!!!!!!!!!")).toMatch(/does not look like a Gemini API key/);
    expect(fieldProblem("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image")).toBeNull();
    expect(fieldProblem("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")).toMatch(/Choose one of the listed models/);
    expect(fieldProblem("UPLOAD_SCAN_MODE", "monitor")).toBeNull();
    expect(fieldProblem("UPLOAD_SCAN_MODE", "Enforce")).toBeNull();
    expect(fieldProblem("UPLOAD_SCAN_MODE", "on")).toMatch(/Choose off, monitor or enforce/);
    expect(FIELDS.UPLOAD_SCAN_MODE?.options?.map((o) => o.value)).toEqual(["off", "monitor", "enforce"]);
    expect(STEPS.find((s) => s.key === "background")?.fields.map((f) => f.name)).toEqual(["UPLOAD_SCAN_MODE"]);
    expect(fieldProblem("NOPE", "x")).toMatch(/not a field/);
    expect(normalizeDomain("https://CRM.Example.org/")).toBe("crm.example.org");
    expect(normalizeDomain("*.cc.app", true)).toBe("cc.app");
    expect(normalizeDomain("HTTPS://App.Example.org:443/login")).toBe("app.example.org");
    expect(normalizeDomain("app.example.org.")).toBe("app.example.org");
  });

  it("says what a step still needs", () => {
    const has = (set: string[]) => (n: string) => set.includes(n);
    expect(missingFor("email", has(["RESEND_API_KEY", "MESSAGING_FROM_ADDRESS"]))).toEqual(["Link signing secret"]);
    expect(missingFor("email", has([]), (k) => (k === "MESSAGING_EMAIL_PROVIDER" ? "postmark" : null))).toContain("Postmark server token");
    expect(missingFor("payments", has(["STRIPE_CLIENT_ID", "STRIPE_TEST_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "OAUTH_STATE_SECRET"]))).toEqual([]);
    expect(missingFor("payments", has(["PAYPAL_SANDBOX_CLIENT_ID"]))).toHaveLength(2);
    expect(missingFor("texting", has(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]))).toEqual(["a number or a messaging service"]);
    expect(missingFor("push", has([]))).toEqual([]);
    expect(missingFor("art", has([]))).toEqual(["Gemini API key"]);
    expect(missingFor("art", has(["GEMINI_API_KEY"]))).toEqual([]);
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

describe("the AI test: a one-token message, read the way the worker reads a failed call", () => {
  const env = { ANTHROPIC_API_KEY: "sk-ant-api03-secretsecret", ANTHROPIC_BASE_URL: "http://mock/" };
  const apiError = (type: string, message: string) => JSON.stringify({ type: "error", error: { type, message }, request_id: "req_1" });

  it("sends one real message with the model and beta Niva uses, not a model listing", async () => {
    const sent: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];
    const res = await testStep("ai", async (url, init) => {
      sent.push({ url, init });
      return { status: 200, text: JSON.stringify({ id: "msg_1", type: "message", model: "claude-opus-5-5", content: [], stop_reason: "max_tokens" }) };
    }, env);
    expect(res).toEqual({ ok: true, lines: [{ label: "Anthropic answers a test message", ok: true, detail: "accepted: claude-opus-5-5 answered" }] });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("http://mock/v1/messages");
    expect(sent[0]!.init.method).toBe("POST");
    expect(sent[0]!.init.headers).toMatchObject({ "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-beta": ANTHROPIC_FALLBACK_BETA });
    expect(JSON.parse(sent[0]!.init.body!)).toEqual({ model: ANTHROPIC_TEST_MODEL, max_tokens: 1, fallbacks: "default", messages: [{ role: "user", content: "Reply with OK." }] });
    expect(ANTHROPIC_TEST_MODEL).toBe("claude-opus-5-5");
  });

  it("asks the CLAUDE_MODEL override when one is set", async () => {
    let body = "";
    await testStep("ai", async (_url, init) => {
      body = init.body ?? "";
      return { status: 200, text: "{}" };
    }, { ...env, CLAUDE_MODEL: "claude-opus-5" });
    expect(JSON.parse(body).model).toBe("claude-opus-5");
  });

  it("says the key is not set without calling anything", async () => {
    const res = await testStep("ai", async () => {
      throw new Error("must not be called");
    }, {});
    expect(res).toEqual({ ok: false, lines: [{ label: "Anthropic API key", ok: false, detail: "not set (ANTHROPIC_API_KEY)" }] });
  });

  const table: [string, number, string, RegExp][] = [
    ["a refused key", 401, apiError("authentication_error", "invalid x-api-key"), /^the key was refused \(invalid x-api-key\)$/],
    ["a key without permission", 403, apiError("permission_error", "Your API key does not have permission to use the specified resource."), /^the key was refused/],
    [
      "a spending limit (which a model listing would pass)",
      400,
      apiError("invalid_request_error", "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."),
      /^the key works, but the account's spending limit or credit ran out, so Niva and the suggestions are paused until 2026-11-01 00:00 UTC; raise the limit in the Anthropic console or wait for it to reset \(You have reached/,
    ],
    ["no credit", 402, apiError("billing_error", "Your credit balance is too low to access the Anthropic API."), /^the key works, but the account's spending limit or credit ran out, so Niva and the suggestions are paused; raise/],
    ["a model the account cannot use", 404, apiError("not_found_error", "model: claude-opus-5-5"), /^the model claude-opus-5-5 is not available to this account \(model: claude-opus-5-5\)$/],
    ["no fallback beta", 400, apiError("invalid_request_error", "Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header."), /^the account is not set up for the server-side fallback Niva uses/],
    ["rate limited", 429, apiError("rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit"), /^Anthropic is rate limiting this key right now; test again in a minute/],
    ["overloaded", 529, apiError("overloaded_error", "Overloaded"), /^Anthropic is busy or had a problem \(HTTP 529\); test again in a few minutes \(Overloaded\)$/],
    ["anything else", 400, apiError("invalid_request_error", "messages: at least one message is required"), /^the provider answered HTTP 400 \(messages: at least one message is required\)$/],
    ["a body that is not JSON", 502, "<html>Bad gateway</html>", /^Anthropic is busy or had a problem \(HTTP 502\); test again in a few minutes \(<html>Bad gateway<\/html>\)$/],
  ];
  it.each(table)("%s", async (_label, status, text, detail) => {
    const res = await testStep("ai", async () => ({ status, text }), env);
    expect(res.ok).toBe(false);
    expect(res.lines[0]?.label).toBe("Anthropic answers a test message");
    expect(res.lines[0]?.detail).toMatch(detail);
    expect(anthropicTestLine(status, text, "claude-opus-5-5", env)).toEqual(res.lines[0]);
  });

  it("never lets the key into the line", () => {
    const line = anthropicTestLine(401, apiError("authentication_error", `invalid x-api-key ${env.ANTHROPIC_API_KEY}`), "claude-opus-5-5", env);
    expect(line.detail).not.toContain(env.ANTHROPIC_API_KEY);
  });
});

describe("the AI flyer art test (Gemini): a free model lookup, never a picture", () => {
  const env = { GEMINI_API_KEY: "AIzaSy-test-key-123456789012345678901234", GEMINI_API_BASE: "http://mock/" };

  it("is a step, optional, with the key and the model as its fields", () => {
    const step = STEPS.find((x) => x.key === "art");
    expect(step).toMatchObject({ required: false, workerTest: true });
    expect(step?.fields.map((f) => f.name)).toEqual(["GEMINI_API_KEY", "GEMINI_IMAGE_MODEL"]);
    expect(FIELDS.GEMINI_API_KEY.kind).toBe("secret");
    expect(FIELDS.GEMINI_IMAGE_MODEL.kind).toBe("setting");
    // The model list shows the price before anything is asked, and never offers a model Google shuts down today.
    const options = FIELDS.GEMINI_IMAGE_MODEL.options?.map((o) => o.label) ?? [];
    expect(options.join(" | ")).toMatch(/Gemini 3\.1 Flash Lite Image — about 4¢ a picture/);
    expect(options.join(" | ")).not.toMatch(/2\.5/);
  });

  it("looks the model up with the key in a header (GET, so no picture is made)", async () => {
    const sent: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];
    const res = await testStep("art", async (url, init) => {
      sent.push({ url, init });
      return { status: 200, text: JSON.stringify({ name: "models/gemini-3.1-flash-lite-image" }) };
    }, env);
    expect(res).toEqual({
      ok: true,
      lines: [{ label: "Gemini knows the key and the model gemini-3.1-flash-lite-image", ok: true, detail: "accepted: Gemini 3.1 Flash Lite Image is available to this key (no picture was made, so the test is free). It does not check billing: image models have no free tier, so the Google Cloud project behind the key needs billing turned on, or pictures fail with a quota message" }],
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("http://mock/v1beta/models/gemini-3.1-flash-lite-image");
    expect(sent[0]!.init).toEqual({ method: "GET", headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  });

  it("asks about the model the platform chose", async () => {
    let url = "";
    await testStep("art", async (u) => {
      url = u;
      return { status: 200, text: "{}" };
    }, { ...env, GEMINI_IMAGE_MODEL: "gemini-3-pro-image" });
    expect(url).toBe("http://mock/v1beta/models/gemini-3-pro-image");
  });

  it("says the key is not set without calling anything", async () => {
    const res = await testStep("art", async () => {
      throw new Error("must not be called");
    }, {});
    expect(res).toEqual({ ok: false, lines: [{ label: "Gemini API key", ok: false, detail: "not set (GEMINI_API_KEY)" }] });
  });

  const table: [string, number, string, RegExp][] = [
    ["a key Google does not know (it answers 400, not 401)", 400, JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }), /^the key was refused \(API key not valid\. Please pass a valid API key\.\)$/],
    ["a key without permission", 403, JSON.stringify({ error: { message: "Requests from this API key are blocked." } }), /^the key was refused \(Requests from this API key are blocked\.\)$/],
    ["a model Google does not offer to this key", 404, JSON.stringify({ error: { message: "models/gemini-3.1-flash-lite-image is not found" } }), /^Google does not offer the model gemini-3\.1-flash-lite-image to this key \(models\/gemini-3\.1-flash-lite-image is not found\); choose another image model above$/],
    ["rate limited", 429, "{}", /^Google is rate limiting this key right now; test again in a minute$/],
    ["a Google error", 503, JSON.stringify({ error: { message: "The model is overloaded." } }), /^Google had a problem \(HTTP 503\); test again in a few minutes \(The model is overloaded\.\)$/],
    ["anything else", 400, JSON.stringify({ error: { message: "Bad request." } }), /^the provider answered HTTP 400 \(Bad request\.\)$/],
  ];
  it.each(table)("%s", async (_label, status, text, detail) => {
    const res = await testStep("art", async () => ({ status, text }), env);
    expect(res.ok).toBe(false);
    expect(res.lines[0]?.detail).toMatch(detail);
    expect(geminiTestLine(status, text, "gemini-3.1-flash-lite-image", env)).toEqual(res.lines[0]);
  });

  it("reports a network failure plainly, and never lets the key into a line", async () => {
    const res = await testStep("art", async () => {
      throw new Error(`connect ECONNREFUSED (key ${env.GEMINI_API_KEY})`);
    }, env);
    expect(res.lines[0]?.detail).toMatch(/^could not reach the provider: connect ECONNREFUSED/);
    expect(JSON.stringify(res)).not.toContain(env.GEMINI_API_KEY);
    expect(geminiTestLine(400, JSON.stringify({ error: { message: `API key not valid: ${env.GEMINI_API_KEY}` } }), "gemini-3.1-flash-lite-image", env).detail).not.toContain(env.GEMINI_API_KEY);
  });
});
