import { describe, expect, it, vi } from "vitest";

import { createAnthropicClient, effortFor, type FetchLike } from "@/lib/assistant/anthropic-http";
import { ModelError, type ModelRequest } from "@/lib/assistant/model";

const REQUEST: ModelRequest = {
  model: "claude-sonnet-5-5",
  system: "You are Niva.",
  messages: [{ role: "user", content: "hi" }],
  tools: [{ name: "events_look", description: "Look.", input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } }],
  maxTokens: 1000,
};

const ok = (body: unknown) => ({ status: 200, text: async () => JSON.stringify(body) });
const bad = (status: number, type: string, message: string) => ({ status, text: async () => JSON.stringify({ type: "error", error: { type, message } }) });

function client(replies: ({ status: number; text(): Promise<string> } | Error)[], extra: { retries?: number; timeoutMs?: number } = {}) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const queue = [...replies];
  const fetchLike: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    const next = queue.shift();
    if (!next) throw new Error("no more replies");
    if (next instanceof Error) throw next;
    return next;
  };
  const sleep = vi.fn(async () => undefined);
  return { calls, sleep, api: createAnthropicClient({ apiKey: "sk-ant-secret-key", fetch: fetchLike, sleep, retryDelayMs: 1, ...extra }) };
}

describe("the model client", () => {
  it("sends the conversation, the tools and the key to the Messages API, and reads the answer", async () => {
    const c = client([ok({ content: [{ type: "text", text: "Hello" }, { type: "tool_use", id: "t1", name: "events_look", input: {} }], stop_reason: "tool_use", usage: { input_tokens: 12, output_tokens: 7 } })]);
    const out = await c.api.create(REQUEST);
    expect(out).toEqual({
      content: [{ type: "text", text: "Hello" }, { type: "tool_use", id: "t1", name: "events_look", input: {} }],
      stopReason: "tool_use",
      usage: { inputTokens: 12, outputTokens: 7 },
    });
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(c.calls[0].headers).toMatchObject({ "x-api-key": "sk-ant-secret-key", "anthropic-version": "2023-06-01", "content-type": "application/json" });
    expect(c.calls[0].body).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 1000,
      system: "You are Niva.",
      messages: [{ role: "user", content: "hi" }],
      tools: REQUEST.tools,
      tool_choice: { type: "auto" },
      output_config: { effort: "medium" },
    });
  });

  it("keeps the tools listed but forbids using them for the closing answer", async () => {
    const c = client([ok({ content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" })]);
    await c.api.create({ ...REQUEST, toolChoice: "none" });
    expect(c.calls[0].body.tools).toEqual(REQUEST.tools);
    expect(c.calls[0].body.tool_choice).toEqual({ type: "none" });
  });

  it("leaves out the tool list when there are no tools, and the effort setting for a model that has none", async () => {
    const c = client([ok({ content: [], stop_reason: "end_turn" })]);
    await c.api.create({ ...REQUEST, tools: [], model: "claude-haiku-4-5" });
    expect(c.calls[0].body).not.toHaveProperty("tools");
    expect(c.calls[0].body).not.toHaveProperty("tool_choice");
    expect(c.calls[0].body).not.toHaveProperty("output_config");
    expect(effortFor("claude-sonnet-5-5")).toBe("medium");
    expect(effortFor("claude-opus-5-5")).toBe("medium");
    expect(effortFor("claude-haiku-4-5")).toBeUndefined();
  });

  it("uses a different address when one is set (tests only)", async () => {
    const calls: string[] = [];
    const api = createAnthropicClient({ apiKey: "k", baseUrl: "http://localhost:9999/", fetch: async (url) => (calls.push(url), ok({ content: [], stop_reason: "end_turn" })) });
    await api.create(REQUEST);
    expect(calls).toEqual(["http://localhost:9999/v1/messages"]);
  });

  it.each([
    [401, "authentication_error", "invalid x-api-key", "auth"],
    [403, "permission_error", "no", "auth"],
    [400, "invalid_request_error", "You have reached your specified API usage limits.", "quota"],
    [402, "billing_error", "credit", "quota"],
    [404, "not_found_error", "model: claude-nope", "config"],
    [400, "invalid_request_error", "messages.0: something is wrong", "bad_request"],
  ] as const)("reads HTTP %i %s as %s and does not try again", async (status, type, message, kind) => {
    const c = client([bad(status, type, message), bad(status, type, message)]);
    const error = await c.api.create(REQUEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe(kind);
    expect((error as ModelError).status).toBe(status);
    expect(c.calls).toHaveLength(1);
    // The key never appears in what is logged.
    expect((error as ModelError).detail).not.toContain("sk-ant-secret-key");
  });

  it("tries a busy moment once more, then gives up as transient", async () => {
    const c = client([bad(529, "overloaded_error", "Overloaded"), ok({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" })]);
    expect((await c.api.create(REQUEST)).content).toEqual([{ type: "text", text: "ok" }]);
    expect(c.calls).toHaveLength(2);
    expect(c.sleep).toHaveBeenCalledTimes(1);

    const twice = client([bad(429, "rate_limit_error", "slow down"), bad(429, "rate_limit_error", "slow down"), bad(429, "rate_limit_error", "slow down")]);
    const error = (await twice.api.create(REQUEST).catch((e: unknown) => e)) as ModelError;
    expect(error.kind).toBe("transient");
    expect(twice.calls).toHaveLength(2);
  });

  it("treats no connection as transient and does not leak the key", async () => {
    const c = client([new Error("fetch failed sk-ant-secret-key"), new Error("fetch failed")]);
    const error = (await c.api.create(REQUEST).catch((e: unknown) => e)) as ModelError;
    expect(error).toBeInstanceOf(ModelError);
    expect(error.kind).toBe("transient");
    expect(error.status).toBeNull();
    expect(error.detail).not.toContain("sk-ant-secret-key");
  });

  it("gives up on a call that takes too long", async () => {
    const api = createAnthropicClient({
      apiKey: "k",
      timeoutMs: 20,
      retries: 0,
      fetch: (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    });
    const error = (await api.create(REQUEST).catch((e: unknown) => e)) as ModelError;
    expect(error.kind).toBe("transient");
    expect(error.detail).toMatch(/no answer within/);
  });

  it("stops at once when the caller cancels", async () => {
    const gone = new AbortController();
    gone.abort();
    const c = client([ok({ content: [], stop_reason: "end_turn" })]);
    const error = (await c.api.create(REQUEST, { signal: gone.signal }).catch((e: unknown) => e)) as ModelError;
    expect(error.kind).toBe("cancelled");
    expect(c.calls).toHaveLength(0);
  });

  it("calls an answer that is not JSON, or has no content, a bad request", async () => {
    const notJson = client([{ status: 200, text: async () => "<html>" }]);
    expect(((await notJson.api.create(REQUEST).catch((e: unknown) => e)) as ModelError).kind).toBe("bad_request");
    const empty = client([ok({ type: "message" })]);
    expect(((await empty.api.create(REQUEST).catch((e: unknown) => e)) as ModelError).kind).toBe("bad_request");
  });

  it("asks again without the effort setting if the model refuses it", async () => {
    const c = client([bad(400, "invalid_request_error", "output_config.effort: not supported for this model"), ok({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" })]);
    expect((await c.api.create(REQUEST)).stopReason).toBe("end_turn");
    expect(c.calls).toHaveLength(2);
    expect(c.calls[0].body).toHaveProperty("output_config");
    expect(c.calls[1].body).not.toHaveProperty("output_config");
  });

  it("returns blocks it does not know unchanged so they can be sent back", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "abc" };
    const c = client([ok({ content: [thinking, { type: "text", text: "x" }], stop_reason: "end_turn" })]);
    expect((await c.api.create(REQUEST)).content[0]).toEqual(thinking);
  });
});
