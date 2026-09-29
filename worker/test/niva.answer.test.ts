import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotConfiguredError } from "../src/errors";
import { cleanAnswer, run, userPrompt, type Conversation, type Source } from "../src/handlers/niva.answer";

const conversation: Conversation = { id: "c1", center_id: "center1", user_id: "u1", question: "What time is the derasar open today?", unanswered: true };
const sources: Source[] = [{ id: "s1", title: "Derasar timings", body_md: "Open 6 AM-12 PM and 4-8 PM daily.", rank: 0.9 }];

let server: Server;
let url = "";
let lastBody: Record<string, unknown> | null = null;
let nextReply: () => { stop_reason: string; content: { type: string; text?: string }[] };

beforeAll(async () => {
  server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      lastBody = JSON.parse(b);
      const reply = nextReply();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5", usage: { input_tokens: 5, output_tokens: 5 }, ...reply }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

function fakeCtx(env: Record<string, string>, queries: Record<string, unknown>) {
  const calls: { text: string; params: unknown[] }[] = [];
  const db = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      if (text.includes("niva_worker_get_conversation")) return [{ r: queries.conversation ?? null }];
      if (text.includes("niva_worker_search_sources")) return [{ r: queries.sources ?? [] }];
      if (text.includes("niva_worker_store_answer")) return [];
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { ctx: { env, db, log: { info() {}, warn() {}, error() {}, debug() {} } } as unknown as Parameters<typeof run>[1], calls };
}
const job = (payload: Record<string, unknown>) => ({ id: 1, payload, attempts: 1 }) as unknown as Parameters<typeof run>[0];

describe("niva.answer", () => {
  it("says honestly that it is not configured without ANTHROPIC_API_KEY", async () => {
    const { ctx } = fakeCtx({}, {});
    await expect(run(job({ conversation_id: "c1" }), ctx)).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("leaves the conversation unanswered (and never calls the model) when nothing was found", async () => {
    const { ctx, calls } = fakeCtx({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_BASE_URL: url }, { conversation, sources: [] });
    const out = (await run(job({ conversation_id: "c1" }), ctx)) as { answered: boolean; reason: string };
    expect(out).toEqual({ answered: false, reason: "no_matching_source" });
    expect(calls.some((c) => c.text.includes("niva_worker_store_answer"))).toBe(false);
  });

  it("asks the model with the system-prompt guardrails and the matched sources, and stores a confident answer", async () => {
    nextReply = () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ can_answer: true, answer: "The derasar is open 6 AM-12 PM and 4-8 PM.", cited_source_ids: ["s1"] }) }],
    });
    const { ctx, calls } = fakeCtx({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_BASE_URL: url }, { conversation, sources });
    const out = (await run(job({ conversation_id: "c1" }), ctx)) as { answered: boolean; sources: number };
    expect(out).toMatchObject({ answered: true, sources: 1 });
    expect(lastBody?.model).toBe("claude-opus-5");
    expect(String(lastBody?.system)).toContain("Pathshala teacher");
    expect(String(lastBody?.system)).toContain("NO access to any individual member's personal data");
    expect((lastBody?.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    const store = calls.find((c) => c.text.includes("niva_worker_store_answer"));
    expect(store?.params[1]).toBe("The derasar is open 6 AM-12 PM and 4-8 PM.");
    expect(JSON.parse(store?.params[2] as string)).toEqual([{ content_item_id: "s1", title: "Derasar timings" }]);
  });

  it("leaves the conversation unanswered when the model is not confident, rather than guessing", async () => {
    nextReply = () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ can_answer: false, answer: "", cited_source_ids: [] }) }] });
    const { ctx, calls } = fakeCtx({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_BASE_URL: url }, { conversation, sources });
    const out = (await run(job({ conversation_id: "c1" }), ctx)) as { answered: boolean; reason: string };
    expect(out).toEqual({ answered: false, reason: "model_unsure" });
    expect(calls.some((c) => c.text.includes("niva_worker_store_answer"))).toBe(false);
  });

  it("cleanAnswer keeps only sources actually offered", () => {
    expect(cleanAnswer({ can_answer: true, answer: " Hi ", cited_source_ids: ["s1", "not-offered"] }, sources)).toEqual({
      can_answer: true,
      answer: "Hi",
      cited_source_ids: ["s1"],
    });
    expect(cleanAnswer({}, sources)).toBeNull();
  });

  it("userPrompt includes the question and every candidate source", () => {
    const p = userPrompt(conversation.question, sources);
    expect(p).toContain(conversation.question);
    expect(p).toContain("[s1] Derasar timings");
  });
});
