import { describe, expect, it } from "vitest";

import {
  addUsage,
  aiCallFields,
  cacheControl,
  cacheMinimumTokens,
  cacheReadShare,
  estimateTokens,
  markCount,
  parseTokens,
  parseUsage,
  promptCacheEnabled,
  usageForResult,
  withPromptCaching,
  type CacheableRequest,
} from "@/lib/anthropic-cache";

// Text whose rough token count is at least `tokens` (the estimate counts 4.5 characters a token).
const long = (tokens: number, word = "rule") => `${word} `.repeat(Math.ceil((tokens * 4.5) / (word.length + 1)) + 4);

const MODEL = "claude-sonnet-5-5"; // caches from 512 tokens

const TOOLS = [
  { name: "events_look", description: long(200, "look"), input_schema: { type: "object", properties: {} } },
  { name: "people_peek", description: long(200, "peek"), input_schema: { type: "object", properties: {} } },
  { name: "events_change", description: long(200, "change"), input_schema: { type: "object", properties: {} } },
];
const STABLE = `You are Niva, the assistant for the staff of Jain Society, on Weaver.\n\n${long(600)}`;
const PER_REQUEST = "\n\nYou are helping one signed-in person who holds these roles: Treasurer. Today is 2026-10-11 (time zone America/New_York).";

function request(over: Partial<CacheableRequest> = {}): CacheableRequest {
  return {
    model: MODEL,
    system: STABLE + PER_REQUEST,
    tools: TOOLS,
    messages: [
      { role: "user", content: "find the Shah household" },
      { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "t1", name: "events_look", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: '{"result":1}' }] },
    ],
    ...over,
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const markers = (v: unknown): number => (JSON.stringify(v).match(/"cache_control"/g) ?? []).length;

/** The request with the markers taken off and the one-block wrappers undone: what the model reads. */
function plain(req: CacheableRequest): unknown {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "cache_control").map(([k, x]) => [k, strip(x)]));
    return v;
  };
  const r = strip(req) as CacheableRequest;
  const system = Array.isArray(r.system) ? (r.system as { text: string }[]).map((b) => b.text).join("") : r.system;
  const messages = r.messages.map((m) => {
    const c = m.content;
    return Array.isArray(c) && c.length === 1 && (c[0] as { type: string }).type === "text" ? { ...m, content: (c[0] as { text: string }).text } : m;
  });
  return { ...r, system, messages };
}

describe("the shortest prefix each model will cache", () => {
  it("reads the documented table, and the strictest value for a model it does not know", () => {
    for (const m of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-fable-5", "claude-haiku-5-5", "claude-mythos-5-1"]) expect(cacheMinimumTokens(m)).toBe(512);
    for (const m of ["claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet-4-5-20250929", "claude-opus-4-8", "claude-opus-4-1"]) expect(cacheMinimumTokens(m)).toBe(1024);
    for (const m of ["claude-opus-4-7", "claude-haiku-3-5"]) expect(cacheMinimumTokens(m)).toBe(2048);
    for (const m of ["claude-opus-4-6", "claude-opus-4-5", "claude-haiku-4-5", "claude-haiku-4-5-20251001"]) expect(cacheMinimumTokens(m)).toBe(4096);
    for (const m of ["claude-future-9", "", "some-other-model"]) expect(cacheMinimumTokens(m)).toBe(4096);
  });

  it("counts on the low side, so a prefix is only marked when it is surely long enough", () => {
    expect(estimateTokens("a".repeat(4500))).toBe(1000);
    expect(estimateTokens({ a: "b" })).toBe(Math.floor('{"a":"b"}'.length / 4.5));
    expect(estimateTokens(undefined)).toBe(0);
  });
});

describe("where the cache markers go", () => {
  it("marks the last tool, the end of the stable system text and the last block of the conversation, and nothing else", () => {
    const before = clone(request());
    const { request: out, marks } = withPromptCaching(request(), { systemStable: STABLE, marksMessages: true });

    expect(marks).toEqual({ tools: true, system: true, messages: true });
    expect(markCount(marks)).toBe(3);
    expect(markers(out)).toBe(3); // the API allows 4

    // tools: only the last one
    const tools = out.tools as { name: string; cache_control?: unknown }[];
    expect(tools.map((t) => t.cache_control)).toEqual([undefined, undefined, { type: "ephemeral" }]);
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));

    // system: the stable text carries the marker; what differs per request follows it, unmarked
    expect(out.system).toEqual([
      { type: "text", text: STABLE, cache_control: { type: "ephemeral" } },
      { type: "text", text: PER_REQUEST },
    ]);

    // messages: the last block of the last message only; the earlier turns are untouched
    expect(out.messages.slice(0, 2)).toEqual(before.messages.slice(0, 2));
    expect(out.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: '{"result":1}', cache_control: { type: "ephemeral" } }] });

    // the input was not changed
    expect(request()).toEqual(before);
  });

  it("changes nothing but the markers: the model reads exactly the same request", () => {
    const original = request();
    const { request: out } = withPromptCaching(original, { systemStable: STABLE, marksMessages: true });
    expect(plain(out)).toEqual(plain(original));
    expect(plain(out)).toEqual(original);
  });

  it("wraps a plain-text last message in one block to mark it, with the same words", () => {
    const original = request({ messages: [{ role: "user", content: "find the Shah household" }] });
    const { request: out, marks } = withPromptCaching(original, { systemStable: STABLE, marksMessages: true });
    expect(marks.messages).toBe(true);
    expect(out.messages).toEqual([{ role: "user", content: [{ type: "text", text: "find the Shah household", cache_control: { type: "ephemeral" } }] }]);
    expect(plain(out)).toEqual(original);
  });

  it("marks no message unless asked, and never one that is not a person's turn or has no words", () => {
    expect(withPromptCaching(request(), { systemStable: STABLE }).marks.messages).toBe(false);
    const assistantLast = request({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "Hello" }] }] });
    expect(withPromptCaching(assistantLast, { marksMessages: true }).marks.messages).toBe(false);
    expect(withPromptCaching(request({ messages: [{ role: "user", content: "" }] }), { marksMessages: true }).marks.messages).toBe(false);
    expect(withPromptCaching(request({ messages: [{ role: "user", content: [{ type: "text", text: "" }] }] }), { marksMessages: true }).marks.messages).toBe(false);
  });

  it("with no stable part given, the whole system prompt is the stable part", () => {
    const { request: out } = withPromptCaching(request({ system: STABLE }));
    expect(out.system).toEqual([{ type: "text", text: STABLE, cache_control: { type: "ephemeral" } }]);
  });

  it("marks nothing in the system prompt when the stable part is not the start of it, rather than cache text that varies", () => {
    const { marks } = withPromptCaching(request(), { systemStable: "something else entirely" });
    expect(marks.system).toBe(false);
    expect(withPromptCaching(request({ system: "" })).marks.system).toBe(false);
  });

  it("keeps an empty tool list and a missing system prompt as they are", () => {
    const { request: out, marks } = withPromptCaching(request({ tools: [], system: undefined, messages: [{ role: "user", content: long(700) }] }), { marksMessages: true });
    expect(marks).toEqual({ tools: false, system: false, messages: true });
    expect("tools" in out && out.tools).toEqual([]);
  });
});

describe("a prefix that is too short is left alone", () => {
  it("marks nothing and returns the very same request when everything is below the model's minimum", () => {
    const small = request({ system: "You are Niva.", tools: [{ name: "a", description: "b", input_schema: {} }], messages: [{ role: "user", content: "hi" }] });
    const { request: out, marks } = withPromptCaching(small, { systemStable: "You are Niva.", marksMessages: true });
    expect(out).toBe(small);
    expect(marks).toEqual({ tools: false, system: false, messages: false });
  });

  it("uses the model's own minimum: the same request is marked on one model and not on another", () => {
    const body = request({ tools: undefined, system: long(700), messages: [{ role: "user", content: "hi" }] });
    expect(withPromptCaching({ ...body, model: "claude-sonnet-5-5" }).marks.system).toBe(true);
    expect(withPromptCaching({ ...body, model: "claude-opus-4-8" }).marks.system).toBe(false); // 1024
    expect(withPromptCaching({ ...body, model: "claude-haiku-4-5" }).marks.system).toBe(false); // 4096
    expect(withPromptCaching({ ...body, model: "not-a-known-model" }).marks.system).toBe(false);
  });

  it("marks the parts that are long enough and skips the ones that are not", () => {
    // Tools alone are below the minimum, tools plus the system prompt are above it: only the system marker.
    const body = request({ tools: [{ name: "a", description: "short", input_schema: {} }], system: long(520) });
    expect(withPromptCaching(body).marks).toEqual({ tools: false, system: true, messages: false });
    // A long tool list alone: the tool marker, and (with a short system prompt after it) the system marker as well.
    const tools = request({ system: "Short." });
    expect(withPromptCaching(tools).marks).toEqual({ tools: true, system: true, messages: false });
  });
});

describe("nothing that varies is in the cached start", () => {
  it("is byte-for-byte the same for two people, two days and two pages; only the part after the marker differs", () => {
    const a = withPromptCaching(request({ system: STABLE + PER_REQUEST }), { systemStable: STABLE, marksMessages: true }).request;
    const b = withPromptCaching(
      request({
        system: STABLE + "\n\nYou are helping one signed-in person who holds these roles: Event lead. Today is 2027-01-02 (time zone UTC). The person is looking at the page /events/[id].",
        messages: [{ role: "user", content: "a completely different question, with an id 7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001" }],
      }),
      { systemStable: STABLE, marksMessages: true },
    ).request;

    // Everything up to and including the system marker.
    const prefix = (r: CacheableRequest) => JSON.stringify({ tools: r.tools, system: (r.system as unknown[])[0] });
    expect(prefix(a)).toBe(prefix(b));
    expect(prefix(a)).not.toMatch(/Treasurer|Event lead|2026-10-11|2027-01-02|America\/New_York|signed-in person|7d0f3b9a/);
    expect((a.system as unknown[])[1]).not.toEqual((b.system as unknown[])[1]);
  });

  it("puts the marker on the same blocks whatever the question was", () => {
    const run = (q: string) => withPromptCaching(request({ messages: [{ role: "user", content: q }] }), { systemStable: STABLE, marksMessages: true }).request;
    const x = JSON.stringify(run("one"));
    const y = JSON.stringify(run("two"));
    expect(markers(x)).toBe(markers(y));
    expect(JSON.parse(x).tools).toEqual(JSON.parse(y).tools);
  });
});

describe("the cache switch and the lifetime", () => {
  it("uses the 5-minute lifetime (no ttl field) unless the constant says otherwise", () => {
    expect(cacheControl()).toEqual({ type: "ephemeral" });
  });

  it("is on unless AI_PROMPT_CACHE says off", () => {
    expect(promptCacheEnabled({})).toBe(true);
    expect(promptCacheEnabled({ AI_PROMPT_CACHE: "on" })).toBe(true);
    expect(promptCacheEnabled({ AI_PROMPT_CACHE: "" })).toBe(true);
    for (const v of ["off", "OFF", " off ", "0", "false", "no"]) expect(promptCacheEnabled({ AI_PROMPT_CACHE: v })).toBe(false);
  });
});

describe("reading what a call used", () => {
  it("reads the four counts", () => {
    expect(parseUsage({ input_tokens: 12, output_tokens: 7, cache_creation_input_tokens: 3000, cache_read_input_tokens: 9000 })).toEqual({
      inputTokens: 12,
      outputTokens: 7,
      cacheCreationInputTokens: 3000,
      cacheReadInputTokens: 9000,
    });
  });

  it("reads a missing cache field as 0 (a request without markers, or an older answer), and so does a null one", () => {
    expect(parseUsage({ input_tokens: 12, output_tokens: 7 })).toEqual({ inputTokens: 12, outputTokens: 7, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
    expect(parseUsage({ input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: null, cache_read_input_tokens: null })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    expect(parseUsage({})).toEqual({ inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  });

  it("ignores values that are not counts, and says nothing when there is no usage object", () => {
    expect(parseUsage({ input_tokens: "5", output_tokens: -3, cache_read_input_tokens: Number.NaN, cache_creation_input_tokens: 2.9 })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 2,
      cacheReadInputTokens: 0,
    });
    for (const v of [undefined, null, "x", 5, [1, 2]]) expect(parseUsage(v)).toBeUndefined();
  });

  it("adds the calls of one message together", () => {
    const one = parseUsage({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 4000 });
    const two = parseUsage({ input_tokens: 20, output_tokens: 6, cache_read_input_tokens: 4000 });
    const total = addUsage(addUsage(undefined, one), two);
    expect(total).toEqual({ calls: 2, inputTokens: 30, outputTokens: 11, cacheCreationInputTokens: 4000, cacheReadInputTokens: 4000 });
    expect(addUsage(total, undefined)).toBe(total); // a call that sent no usage adds nothing
    expect(addUsage(undefined, undefined)).toBeUndefined();
  });

  it("says what share of the input came from the cache", () => {
    expect(cacheReadShare({ inputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 900 })).toBeCloseTo(0.9);
    expect(cacheReadShare({ inputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 })).toBe(0);
  });

  it("reads the counts back from the closing event, or nothing when they are not all there", () => {
    const t = { calls: 2, inputTokens: 1, outputTokens: 2, cacheCreationInputTokens: 3, cacheReadInputTokens: 4 };
    expect(parseTokens(t)).toEqual(t);
    expect(parseTokens({ ...t, calls: undefined })).toBeNull();
    expect(parseTokens({ ...t, outputTokens: -1 })).toBeNull();
    expect(parseTokens("x")).toBeNull();
    expect(parseTokens(null)).toBeNull();
  });
});

describe("the log line and the stored result", () => {
  it("has the model, the four counts and the marker count, and no content", () => {
    const fields = aiCallFields("niva.answer", "claude-opus-5-5", parseUsage({ input_tokens: 5, output_tokens: 6, cache_read_input_tokens: 7 }), { tools: false, system: true, messages: false });
    expect(fields).toEqual({ kind: "niva.answer", model: "claude-opus-5-5", input: 5, cache_write: 0, cache_read: 7, output: 6, cache_marks: 1 });
    // The service's logger blanks any field whose name looks like a secret (it matches "token"): these must not.
    expect(Object.keys(fields).join(" ")).not.toMatch(/token|secret|key|password/i);
  });

  it("writes null counts when the answer had no usage", () => {
    expect(aiCallFields("assistant", "m", undefined, { tools: false, system: false, messages: false })).toMatchObject({ input: null, cache_write: null, cache_read: null, output: null, cache_marks: 0 });
  });

  it("puts the summed counts in a job's result, and nothing when no call returned usage", () => {
    const total = addUsage(addUsage(undefined, parseUsage({ input_tokens: 1, output_tokens: 2 })), parseUsage({ input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 5 }));
    expect(usageForResult(total)).toEqual({ ai_usage: { calls: 2, input: 4, cache_write: 0, cache_read: 5, output: 6 } });
    expect(usageForResult(undefined)).toEqual({});
  });
});
