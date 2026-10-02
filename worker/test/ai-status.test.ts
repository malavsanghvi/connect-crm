import { describe, expect, it } from "vitest";

import { ANTHROPIC_KINDS, anthropicKeySource, createAiStatus, recordAnthropicNoAnswer, recordAnthropicResponse } from "../src/ai-status";
import { anthropicClient, attemptOf, recordingFetch, sdkRetries } from "../src/anthropic";
import { HANDLERS } from "../src/handlers";
import { createRegistry, readiness } from "../src/runner";
import { handlerInfo, healthOf, heartbeatAi } from "../src/server";

const body = (status: number, type: string, message: string) => JSON.stringify({ type: "error", error: { type, message }, request_id: "req_test" });
const LIMIT = "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.";

/** A status with a clock the test moves. */
function clocked(start = "2026-10-02T10:00:00Z") {
  let t = new Date(start).getTime();
  const status = createAiStatus(() => new Date(t));
  return { status, advance: (ms: number) => (t += ms) };
}

describe("AI status", () => {
  it("is untested until the first call, then ok; working calls do not change the report", () => {
    const { status, advance } = clocked();
    expect(status.report()).toEqual({
      state: "untested", since: null, last_ok_at: null, last_error_at: null, last_error_kind: null, last_error: null, paused_until: null,
    });
    recordAnthropicResponse(status, 200, "");
    const first = status.report();
    expect(first).toMatchObject({ state: "ok", since: "2026-10-02T10:00:00.000Z", last_ok_at: null });
    advance(60_000);
    recordAnthropicResponse(status, 200, "");
    // The heartbeat's info is audited on every change: while calls keep working, it must stay the same.
    expect(status.report()).toEqual(first);
  });

  it("a spending limit pauses with the time access comes back, and keeps the last working call", () => {
    const { status, advance } = clocked();
    recordAnthropicResponse(status, 200, "");
    advance(5 * 60_000);
    recordAnthropicResponse(status, 400, body(400, "invalid_request_error", LIMIT));
    expect(status.report()).toEqual({
      state: "paused",
      since: "2026-10-02T10:05:00.000Z",
      last_ok_at: "2026-10-02T10:00:00.000Z",
      last_error_at: "2026-10-02T10:05:00.000Z",
      last_error_kind: "quota",
      last_error: `400 invalid_request_error: ${LIMIT}`,
      paused_until: "2026-11-01T00:00:00.000Z",
    });
    // A later answer that names no time keeps the time; the pause began when it began.
    advance(60_000);
    recordAnthropicResponse(status, 402, body(402, "billing_error", "Your credit balance is too low to access the Anthropic API."));
    expect(status.report()).toMatchObject({ state: "paused", since: "2026-10-02T10:05:00.000Z", paused_until: "2026-11-01T00:00:00.000Z", last_error_kind: "quota" });
    // The limit is raised: the next call works and the pause ends; the last error stays for staff to see.
    advance(60_000);
    recordAnthropicResponse(status, 200, "");
    expect(status.report()).toMatchObject({ state: "ok", since: "2026-10-02T10:07:00.000Z", last_ok_at: null, paused_until: null, last_error_kind: "quota" });
  });

  it("names a refused key, a missing model and an unreachable service; a rejected request leaves the state alone", () => {
    const { status } = clocked();
    recordAnthropicResponse(status, 401, body(401, "authentication_error", "invalid x-api-key"));
    expect(status.report()).toMatchObject({ state: "key_refused", last_error_kind: "auth" });
    recordAnthropicResponse(status, 404, body(404, "not_found_error", "model: claude-opus-5-5"));
    expect(status.report()).toMatchObject({ state: "unavailable", last_error_kind: "config" });
    recordAnthropicResponse(status, 529, body(529, "overloaded_error", "Overloaded"));
    expect(status.report()).toMatchObject({ state: "unreachable", last_error_kind: "transient" });
    recordAnthropicNoAnswer(status, Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
    expect(status.report()).toMatchObject({ state: "unreachable", last_error: "timed out: The operation was aborted." });
    recordAnthropicResponse(status, 200, "");
    recordAnthropicResponse(status, 400, body(400, "invalid_request_error", "messages: roles must alternate"));
    expect(status.report()).toMatchObject({ state: "ok", last_error_kind: "bad_request" });
  });

  it("never reports a key, and keeps the error short", () => {
    const { status } = clocked();
    recordAnthropicResponse(status, 401, body(401, "authentication_error", `invalid x-api-key sk-ant-api03-SECRETSECRET ${"x".repeat(400)}`));
    const r = status.report();
    expect(r.last_error).not.toContain("SECRETSECRET");
    expect(r.last_error!.length).toBeLessThanOrEqual(300);
  });

  it("says where the key comes from, by name only", () => {
    expect(anthropicKeySource({ saved: ["ANTHROPIC_API_KEY"], env: ["ANTHROPIC_API_KEY"] })).toEqual({ key_source: "saved", env_key_unused: true });
    expect(anthropicKeySource({ saved: ["ANTHROPIC_API_KEY"], env: [] })).toEqual({ key_source: "saved", env_key_unused: false });
    expect(anthropicKeySource({ saved: ["STRIPE_CLIENT_ID"], env: ["ANTHROPIC_API_KEY"] })).toEqual({ key_source: "environment", env_key_unused: false });
    expect(anthropicKeySource({ saved: [], env: [] })).toEqual({ key_source: "none", env_key_unused: false });
  });
});

describe("recordingFetch", () => {
  it("records each answer and still hands the caller the whole body", async () => {
    const { status } = clocked();
    const answers = [new Response(body(400, "invalid_request_error", LIMIT), { status: 400 }), new Response('{"id":"msg_1"}', { status: 200 })];
    const f = recordingFetch(status, async () => answers.shift()!);
    const limited = await f("https://api.anthropic.com/v1/messages");
    expect(status.report().state).toBe("paused");
    expect(JSON.parse(await limited.text()).error.message).toBe(LIMIT);
    await f("https://api.anthropic.com/v1/messages");
    expect(status.report().state).toBe("ok");
  });

  it("records no connection as unreachable and rethrows", async () => {
    const { status } = clocked();
    const f = recordingFetch(status, async () => {
      throw new TypeError("fetch failed");
    });
    await expect(f("https://api.anthropic.com/v1/messages")).rejects.toThrow("fetch failed");
    expect(status.report()).toMatchObject({ state: "unreachable", last_error: "no connection: fetch failed" });
  });
});

describe("recordingFetch with the SDK's own retry", () => {
  const MESSAGE = JSON.stringify({
    id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
    content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
  });
  const ok = () => new Response(MESSAGE, { status: 200, headers: { "content-type": "application/json" } });
  // retry-after-ms keeps the SDK's wait before its retry to a millisecond.
  const busy = (extra: Record<string, string> = {}) =>
    new Response(body(529, "overloaded_error", "Overloaded"), { status: 529, headers: { "content-type": "application/json", "retry-after-ms": "1", ...extra } });

  /** A real SDK client (the handlers' anthropicClient) over answers the test hands out in order. */
  function client(answers: (() => Response | Promise<Response>)[], maxRetries = 1) {
    const { status, advance } = clocked();
    const tries: (number | null)[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      tries.push(attemptOf(input, init));
      const next = answers.shift();
      if (!next) throw new Error("no more answers");
      return next();
    };
    const c = anthropicClient({ ANTHROPIC_API_KEY: "sk-ant-test" }, { status, fetch, maxRetries });
    const ask = () => c.messages.create({ model: "claude-opus-5-5", max_tokens: 1, messages: [{ role: "user", content: "Reply with OK." }] });
    return { status, advance, tries, ask };
  }

  it("a busy moment the SDK's retry gets past leaves the report as it was", async () => {
    const { status, advance, tries, ask } = client([ok, () => busy(), ok]);
    await ask();
    const before = status.report();
    advance(60_000);
    await ask();
    expect(tries).toEqual([0, 0, 1]);
    // No blip in the audited heartbeat: same state, same "since", no new last error.
    expect(status.report()).toEqual(before);
  });

  it("so does a dropped connection the retry gets past", async () => {
    const { status, advance, ask } = client([ok, () => Promise.reject(new TypeError("fetch failed")), ok]);
    await ask();
    const before = status.report();
    advance(60_000);
    await ask();
    expect(status.report()).toEqual(before);
  });

  it("a call that fails on every try is recorded once, by its last", async () => {
    const { status, advance, tries, ask } = client([ok, () => busy(), () => busy()]);
    await ask();
    advance(60_000);
    await expect(ask()).rejects.toThrow();
    expect(tries).toEqual([0, 0, 1]);
    expect(status.report()).toMatchObject({
      state: "unreachable", since: "2026-10-02T10:01:00.000Z", last_ok_at: "2026-10-02T10:00:00.000Z",
      last_error_kind: "transient", last_error: "529 overloaded_error: Overloaded",
    });
  });

  it("a try the SDK will not repeat is recorded at once", async () => {
    // Anthropic says not to retry it.
    const said = client([() => busy({ "x-should-retry": "false" })]);
    await expect(said.ask()).rejects.toThrow();
    expect(said.tries).toEqual([0]);
    expect(said.status.report().state).toBe("unreachable");
    // A spending limit is never retried by the SDK.
    const limited = client([() => new Response(body(400, "invalid_request_error", LIMIT), { status: 400, headers: { "content-type": "application/json" } })]);
    await expect(limited.ask()).rejects.toThrow();
    expect(limited.tries).toEqual([0]);
    expect(limited.status.report()).toMatchObject({ state: "paused", paused_until: "2026-11-01T00:00:00.000Z" });
    // A client that does not retry at all.
    const once = client([() => busy()], 0);
    await expect(once.ask()).rejects.toThrow();
    expect(once.status.report().state).toBe("unreachable");
  });

  it("reads the try's number and the SDK's retry rule", () => {
    expect(attemptOf("https://x", { headers: { "X-Stainless-Retry-Count": "2" } })).toBe(2);
    expect(attemptOf(new Request("https://x", { headers: { "x-stainless-retry-count": "0" } }))).toBe(0);
    expect(attemptOf("https://x", {})).toBeNull();
    expect(attemptOf("https://x", { headers: { "x-stainless-retry-count": "one" } })).toBeNull();
    const res = (status: number, h: Record<string, string> = {}) => new Response(null, { status, headers: h });
    expect([408, 409, 429, 500, 529].map((s) => sdkRetries(res(s)))).toEqual([true, true, true, true, true]);
    expect([400, 401, 402, 404, 413].map((s) => sdkRetries(res(s)))).toEqual([false, false, false, false, false]);
    expect(sdkRetries(res(529, { "x-should-retry": "false" }))).toBe(false);
    expect(sdkRetries(res(400, { "x-should-retry": "true" }))).toBe(true);
  });
});

describe("heartbeat info", () => {
  const reg = createRegistry(HANDLERS);

  it("lists every kind that calls Anthropic", () => {
    // Every handler that needs the Anthropic key is in ANTHROPIC_KINDS, so its entry carries the status.
    const needsAnthropic = Object.entries(readiness(reg, {}))
      .filter(([, v]) => !v.configured && /Anthropic/.test(v.reason))
      .map(([k]) => k)
      .sort();
    expect(needsAnthropic).toEqual([...ANTHROPIC_KINDS].sort());
  });

  it("adds the AI status and the key's source to those kinds' entries only", () => {
    const { status } = clocked();
    recordAnthropicResponse(status, 400, body(400, "invalid_request_error", LIMIT));
    const env = { ANTHROPIC_API_KEY: "sk-ant-env-key" };
    const info = handlerInfo(readiness(reg, env), heartbeatAi(status, { saved: ["ANTHROPIC_API_KEY"], env: ["ANTHROPIC_API_KEY"] }));
    expect(info["niva.answer"]).toEqual({
      configured: true,
      ai: {
        state: "paused",
        since: "2026-10-02T10:00:00.000Z",
        last_ok_at: null,
        last_error_at: "2026-10-02T10:00:00.000Z",
        last_error_kind: "quota",
        last_error: `400 invalid_request_error: ${LIMIT}`,
        paused_until: "2026-11-01T00:00:00.000Z",
        key_source: "saved",
        env_key_unused: true,
      },
    });
    expect(info["import.suggest_mapping"]?.ai).toEqual(info["niva.answer"]?.ai);
    expect(info["qbo.match_suggest_ai"]?.ai?.state).toBe("paused");
    expect(info["demo.ping"]).toEqual({ configured: true });
    expect(info["storage.retention"]).toMatchObject({ configured: false, reason: expect.any(String) });
    expect("ai" in info["storage.retention"]!).toBe(false);
    expect(JSON.stringify(info)).not.toContain("sk-ant-env-key");
  });

  it("a kind that is not configured still says so, with the AI status beside it", () => {
    const { status } = clocked();
    const info = handlerInfo(readiness(reg, {}), heartbeatAi(status, { saved: [], env: [] }));
    expect(info["niva.answer"]).toMatchObject({ configured: false, reason: expect.stringContaining("ANTHROPIC_API_KEY"), ai: { state: "untested", key_source: "none" } });
  });

  it("the local health answer carries it too", () => {
    const { status } = clocked();
    const now = new Date("2026-10-02T10:00:00Z");
    expect(healthOf({ stopping: false, lastBeatOk: now, lastBeatError: null, heartbeatMs: 60000, inFlight: 0, now, ai: status.report() }).body.ai).toMatchObject({ state: "untested" });
  });
});
