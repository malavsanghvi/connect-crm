import { describe, expect, it, vi } from "vitest";

import { createAnthropicClient, effortFor, requestBody, type FetchLike } from "@/lib/assistant/anthropic-http";
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

function client(replies: ({ status: number; text(): Promise<string> } | Error)[], extra: { retries?: number; timeoutMs?: number; promptCache?: boolean } = {}) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const logs: string[] = [];
  const queue = [...replies];
  const fetchLike: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    const next = queue.shift();
    if (!next) throw new Error("no more replies");
    if (next instanceof Error) throw next;
    return next;
  };
  const sleep = vi.fn(async () => undefined);
  return { calls, logs, sleep, api: createAnthropicClient({ apiKey: "sk-ant-secret-key", fetch: fetchLike, sleep, retryDelayMs: 1, log: (line) => logs.push(line), ...extra }) };
}

describe("the model client", () => {
  it("sends the conversation, the tools and the key to the Messages API, and reads the answer", async () => {
    const c = client([ok({ content: [{ type: "text", text: "Hello" }, { type: "tool_use", id: "t1", name: "events_look", input: {} }], stop_reason: "tool_use", usage: { input_tokens: 12, output_tokens: 7 } })]);
    const out = await c.api.create(REQUEST);
    expect(out).toEqual({
      content: [{ type: "text", text: "Hello" }, { type: "tool_use", id: "t1", name: "events_look", input: {} }],
      stopReason: "tool_use",
      usage: { inputTokens: 12, outputTokens: 7, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
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

// ---------------------------------------------------------------------------
// Prompt caching: the stable start of each request is marked, the words are not touched, and what each call used is logged.
// ---------------------------------------------------------------------------
const long = (tokens: number, word = "rule") => `${word} `.repeat(Math.ceil((tokens * 4.5) / (word.length + 1)) + 4);
const STABLE = `You are Niva, the assistant for the staff of Jain Society, on Weaver.\n\n${long(600)}`;
const PER_REQUEST = "\n\nYou are helping one signed-in person who holds these roles: Treasurer. Today is 2026-10-11 (time zone America/New_York).";
const TOOLS = ["events_look", "people_peek", "events_change"].map((name) => ({
  name,
  description: long(200, name.slice(0, 4)),
  input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
}));
const BIG: ModelRequest = {
  model: "claude-sonnet-5-5",
  system: STABLE + PER_REQUEST,
  systemStable: STABLE,
  messages: [{ role: "user", content: "find the Shah household" }],
  tools: TOOLS as ModelRequest["tools"],
  maxTokens: 1000,
};
const STEP2: ModelRequest = {
  ...BIG,
  messages: [
    ...BIG.messages,
    { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "t1", name: "events_look", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: '{"result":1}' }] },
  ],
};

const markersIn = (v: unknown): number => (JSON.stringify(v).match(/"cache_control"/g) ?? []).length;
type Sent = { system: unknown; messages: { role: string; content: unknown }[] };
/** A sent body with the markers taken off and the one-block wrappers undone: what the model reads. */
function whatTheModelReads(body: unknown): Sent {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v)
          .filter(([k]) => k !== "cache_control")
          .map(([k, x]) => [k, strip(x)]),
      );
    }
    return v;
  };
  const b = strip(body) as Sent;
  const system = Array.isArray(b.system) ? (b.system as { text: string }[]).map((x) => x.text).join("") : b.system;
  const messages = b.messages.map((m) =>
    Array.isArray(m.content) && m.content.length === 1 && (m.content[0] as { type: string }).type === "text" ? { ...m, content: (m.content[0] as { text: string }).text } : m,
  );
  return { ...b, system, messages };
}

describe("the model client: prompt caching", () => {
  it("marks the last tool, the end of the stable system text and the last block of the conversation", async () => {
    const c = client([ok({ content: [], stop_reason: "end_turn" })]);
    await c.api.create(STEP2);
    const body = c.calls[0].body as {
      system: { text: string; cache_control?: unknown }[];
      tools: { name: string; cache_control?: unknown }[];
      messages: { content: { cache_control?: unknown }[] }[];
    };

    expect(markersIn(body)).toBe(3);
    expect(body.tools.map((t) => t.cache_control)).toEqual([undefined, undefined, { type: "ephemeral" }]);
    expect(body.system).toEqual([
      { type: "text", text: STABLE, cache_control: { type: "ephemeral" } },
      { type: "text", text: PER_REQUEST },
    ]);
    expect(body.messages[0]).toEqual({ role: "user", content: "find the Shah household" });
    expect(body.messages[2].content.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages[1].content.some((b) => b.cache_control)).toBe(false);
  });

  it("sends the model exactly the same request as without caching: only the markers (and their one-block wrappers) differ", async () => {
    const done = () => ok({ content: [], stop_reason: "end_turn" });
    const on = client([done(), done()]);
    const off = client([done(), done()], { promptCache: false });
    for (const req of [BIG, STEP2]) {
      await on.api.create(req);
      await off.api.create(req);
    }
    for (const i of [0, 1]) {
      expect(markersIn(off.calls[i].body)).toBe(0);
      expect(markersIn(on.calls[i].body)).toBe(3);
      expect(whatTheModelReads(on.calls[i].body)).toEqual(whatTheModelReads(off.calls[i].body));
      // and the plain body is the request as the client has always sent it
      expect(off.calls[i].body).toMatchObject({ system: BIG.system, tools: BIG.tools, tool_choice: { type: "auto" } });
      // the keys, in the same order
      expect(Object.keys(on.calls[i].body)).toEqual(Object.keys(off.calls[i].body));
    }
  });

  it("gives each step of the tool loop the same start as the step before, so it can read what that step wrote", () => {
    const first = JSON.parse(requestBody(BIG, true).json) as Sent & { tools: unknown };
    const second = JSON.parse(requestBody(STEP2, true).json) as Sent & { tools: unknown };
    expect(second.tools).toEqual(first.tools);
    expect(second.system).toEqual(first.system);
    // The conversation so far reads the same (the first step marked its last block; the second no longer has it last).
    expect(whatTheModelReads(second).messages[0]).toEqual(whatTheModelReads(first).messages[0]);
  });

  it("marks no message for the closing call (it cannot be followed by another step), but still the tools and the system text", async () => {
    const c = client([ok({ content: [], stop_reason: "end_turn" })]);
    await c.api.create({ ...STEP2, toolChoice: "none" });
    const body = c.calls[0].body as { tool_choice: unknown; messages: unknown[] };
    expect(markersIn(body)).toBe(2);
    expect(markersIn(body.messages)).toBe(0);
    expect(body.tool_choice).toEqual({ type: "none" });
  });

  it("leaves a short request exactly as it was: nothing marked, the system prompt still a string", async () => {
    const c = client([ok({ content: [], stop_reason: "end_turn" })]);
    await c.api.create({ ...REQUEST, systemStable: "You are Niva." });
    expect(markersIn(c.calls[0].body)).toBe(0);
    expect(c.calls[0].body.system).toBe("You are Niva.");
    expect(c.calls[0].body.messages).toEqual(REQUEST.messages);
  });

  it("marks nothing for a model whose minimum the prompt does not reach", async () => {
    const c = client([ok({ content: [], stop_reason: "end_turn" })]);
    await c.api.create({ ...BIG, model: "claude-haiku-4-5" }); // caches from 4096 tokens
    expect(markersIn(c.calls[0].body)).toBe(0);
  });

  it("keeps the markers when it asks again after a busy moment or without the effort setting", async () => {
    const c = client([bad(529, "overloaded_error", "Overloaded"), bad(400, "invalid_request_error", "output_config.effort: not supported"), ok({ content: [], stop_reason: "end_turn" })]);
    await c.api.create(BIG);
    expect(c.calls.map((x) => markersIn(x.body))).toEqual([3, 3, 3]);
  });

  it("reads the cache counts from the answer, and a missing cache field as 0", async () => {
    const c = client([
      ok({ content: [], stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: 9, cache_creation_input_tokens: 5000, cache_read_input_tokens: 12000 } }),
      ok({ content: [], stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: 9 } }),
      ok({ content: [], stop_reason: "end_turn" }),
    ]);
    expect((await c.api.create(BIG)).usage).toEqual({ inputTokens: 40, outputTokens: 9, cacheCreationInputTokens: 5000, cacheReadInputTokens: 12000 });
    expect((await c.api.create(BIG)).usage).toEqual({ inputTokens: 40, outputTokens: 9, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
    expect((await c.api.create(BIG)).usage).toBeUndefined();
  });

  it("writes one line per call with the counts and no content", async () => {
    const c = client([
      ok({
        content: [{ type: "text", text: "The Shah household is H-102." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 40, output_tokens: 9, cache_creation_input_tokens: 0, cache_read_input_tokens: 12000 },
      }),
    ]);
    await c.api.create(BIG);
    expect(c.logs).toHaveLength(1);
    expect(JSON.parse(c.logs[0])).toEqual({
      msg: "ai call",
      kind: "assistant",
      model: "claude-sonnet-5-5",
      input: 40,
      cache_write: 0,
      cache_read: 12000,
      output: 9,
      cache_marks: 3,
      stop_reason: "end_turn",
    });
    for (const secret of ["Shah", "H-102", "Niva", "Treasurer", "sk-ant-secret-key"]) expect(c.logs[0]).not.toContain(secret);
  });

  it("writes no line for a call that failed", async () => {
    const c = client([bad(401, "authentication_error", "invalid x-api-key")]);
    await c.api.create(BIG).catch(() => undefined);
    expect(c.logs).toEqual([]);
  });
});
