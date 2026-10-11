import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/commands/hooks", () => ({ onCommandEvent: vi.fn() }));

import { requestBody } from "@/lib/assistant/anthropic-http";
import { chat, type ChatDeps } from "@/lib/assistant/chat";
import type { ModelRequest } from "@/lib/assistant/model";
import { systemPrompt, systemPromptParts, type PromptFacts } from "@/lib/assistant/prompt";
import type { ChatEvent } from "@/lib/assistant/protocol";

import { callTools, FakeModel, say, toolCall } from "./fake-model";
import { executed, setup } from "./test-commands";

const FACTS: PromptFacts = { centerName: "Jain Society", roles: ["Treasurer", "Event lead"], today: "2026-10-10", timeZone: "America/Chicago" };

describe("the system prompt in two parts", () => {
  it("reads exactly as before the split: the two parts together are the prompt", () => {
    const { stable, perRequest } = systemPromptParts(FACTS);
    expect(stable + perRequest).toBe(systemPrompt(FACTS));
    // the same sentences as ever, just in a different place: who Niva is and the rules, then who is asking and today
    expect(stable).toContain("You are Niva, the assistant for the staff of Jain Society, on Weaver.");
    expect(stable).toContain("Rules you always follow:");
    expect(stable).toContain('Say "pledge", never "bid"');
    expect(perRequest).toContain("You are helping one signed-in person who holds these roles: Treasurer, Event lead. Today is 2026-10-10 (time zone America/Chicago).");
  });

  it("keeps everything that differs between people, days and pages out of the part that is cached", () => {
    const here = { ...FACTS, context: { path: "/events/[id]", entityKind: "event", entityId: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001" } };
    const there: PromptFacts = { ...FACTS, roles: ["Event manager"], today: "2027-01-02", timeZone: "UTC", context: { path: "/giving" } };
    const a = systemPromptParts(here);
    const b = systemPromptParts(there);
    expect(a.stable).toBe(b.stable);
    expect(a.perRequest).not.toBe(b.perRequest);
    for (const volatile of ["Treasurer", "Event lead", "Event manager", "2026-10-10", "2027-01-02", "America/Chicago", "UTC", "/events/[id]", "/giving", "7d0f3b9a", "signed-in person who holds"]) {
      expect(a.stable).not.toContain(volatile);
    }
    expect(a.perRequest).toContain("/events/[id]");
    expect(a.perRequest).toContain("7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001");
  });

  it("differs between communities only in the community's name", () => {
    expect(systemPromptParts({ ...FACTS, centerName: "Other Society" }).stable.replace("Other Society", "Jain Society")).toBe(systemPromptParts(FACTS).stable);
  });
});

// ---------------------------------------------------------------------------
type Line = { threadId: string; role: string; text: string; key?: string };
const fakeLog = () => ({ lines: [] as Line[], history: async () => [], append: async () => ({}) });
const fakeMeter = () => ({ check: async () => ({ state: "allowed" as const, used: 5, limit: 300 }), status: async () => null });

function deps(model: ChatDeps["model"], over: Partial<ChatDeps> = {}): ChatDeps {
  return { ctx: setup(), model, modelId: "claude-sonnet-5-5", meter: fakeMeter(), log: fakeLog(), ...over };
}

async function events(d: ChatDeps, message: string, extra: { context?: { path: string; entityKind?: string; entityId?: string } } = {}): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of chat(d, { message, ...extra })) out.push(e);
  return out;
}

const usage = (over: Partial<Record<"input_tokens" | "output_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens", number>> = {}) => ({
  inputTokens: over.input_tokens ?? 0,
  outputTokens: over.output_tokens ?? 0,
  cacheCreationInputTokens: over.cache_creation_input_tokens ?? 0,
  cacheReadInputTokens: over.cache_read_input_tokens ?? 0,
});

beforeEach(() => {
  executed.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const markersIn = (v: unknown): number => (JSON.stringify(v).match(/"cache_control"/g) ?? []).length;
const stripMarkers = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x: unknown) => (k === "cache_control" ? undefined : x)));

describe("the chat loop and prompt caching", () => {
  it("hands the client the stable start of the system prompt, and it is the same at every step and for every question", async () => {
    const model = new FakeModel([callTools(toolCall("events_look", { q: "a" }, "t1")), callTools(toolCall("events_look", { q: "b" }, "t2")), say("Done.")]);
    await events(deps(model), "what is on?", { context: { path: "/events/[id]", entityKind: "event", entityId: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001" } });
    const other = new FakeModel([say("Hi.")]);
    await events(deps(other), "a different question", { context: { path: "/giving" } });

    const all: ModelRequest[] = [...model.requests, ...other.requests];
    expect(all).toHaveLength(4);
    const stable = all[0].systemStable;
    expect(stable).toBeTruthy();
    for (const req of all) {
      expect(req.system.startsWith(stable!)).toBe(true);
      expect(req.systemStable).toBe(stable);
      // nothing about this person, this day, this page or this message in the start
      for (const volatile of ["Event manager", "2026-10-10", "/events/[id]", "/giving", "7d0f3b9a", "what is on", "a different question"]) expect(req.systemStable).not.toContain(volatile);
      expect(JSON.stringify(req.tools)).toBe(JSON.stringify(all[0].tools)); // the same tool list, in the same order
    }
    // what is in the system prompt is unchanged: all of it, with the part that differs after the start
    expect(model.requests[0].system).toContain("Event manager");
    expect(model.requests[0].system).toContain("2026-10-10");
  });

  it("sends each step the bytes of the step before, then something new at the end: what the cache needs", async () => {
    const model = new FakeModel([callTools(toolCall("events_look", { q: "a" }, "t1")), callTools(toolCall("events_look", { q: "b" }, "t2")), say("Done.")]);
    await events(deps(model), "what is on?");
    expect(model.requests).toHaveLength(3);

    const bodies = model.requests.map((r) => JSON.parse(requestBody(r, true).json) as { system: unknown; tools: unknown; messages: unknown[] });
    for (const [i, b] of bodies.entries()) {
      // the system text is marked (the test tools are too few to be worth marking on their own), and the last block of the conversation
      expect(markersIn(b.system)).toBe(1);
      expect(markersIn(b.messages)).toBe(1);
      expect(JSON.stringify(b.system)).toBe(JSON.stringify(bodies[0].system));
      // each step starts with the whole conversation of the step before
      if (i > 0) {
        const before = stripMarkers(bodies[i - 1].messages) as { role: string; content: unknown }[];
        const now = stripMarkers(bodies[i].messages) as { role: string; content: unknown }[];
        const same = (m: { role: string; content: unknown }) => ({ role: m.role, content: typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content });
        expect(now.slice(0, before.length).map(same)).toEqual(before.map(same));
        expect(now.length).toBeGreaterThan(before.length);
      }
    }
  });

  it("marks no message block when the steps have run out and the model may only answer", async () => {
    const model = new FakeModel([callTools(toolCall("events_look", { q: "a" }, "t1")), say("Here is what I found.")]);
    await events(deps(model, { maxSteps: 1 }), "go");
    expect(model.requests.map((r) => r.toolChoice)).toEqual(["auto", "none"]);
    const bodies = model.requests.map((r) => JSON.parse(requestBody(r, true).json) as { messages: unknown[] });
    expect(markersIn(bodies[0].messages)).toBe(1);
    expect(markersIn(bodies[1].messages)).toBe(0);
  });

  it("adds up what the calls of a message used and reports it on the closing event", async () => {
    const model = new FakeModel([
      { ...callTools(toolCall("events_look", { q: "a" }, "t1")), usage: usage({ input_tokens: 40, output_tokens: 10, cache_creation_input_tokens: 9000 }) },
      { ...callTools(toolCall("events_look", { q: "b" }, "t2")), usage: usage({ input_tokens: 60, output_tokens: 12, cache_creation_input_tokens: 300, cache_read_input_tokens: 9000 }) },
      { ...say("Done."), usage: usage({ input_tokens: 80, output_tokens: 20, cache_read_input_tokens: 9300 }) },
    ]);
    const list = await events(deps(model), "go");
    expect(list.at(-1)).toEqual({
      type: "done",
      usage: { used: 5, limit: 300 },
      tokens: { calls: 3, inputTokens: 180, outputTokens: 42, cacheCreationInputTokens: 9300, cacheReadInputTokens: 18300 },
    });
  });

  it("says nothing about tokens when the AI service sent no usage, and the closing event is as it always was", async () => {
    const list = await events(deps(new FakeModel([say("Hello.")])), "hi");
    expect(list.at(-1)).toEqual({ type: "done", usage: { used: 5, limit: 300 } });
  });

  it("counts the calls that did send usage even when another did not", async () => {
    const model = new FakeModel([callTools(toolCall("events_look", {}, "t1")), { ...say("Done."), usage: usage({ input_tokens: 7, output_tokens: 3 }) }]);
    const list = await events(deps(model), "go");
    expect((list.at(-1) as { tokens?: unknown }).tokens).toEqual({ calls: 1, inputTokens: 7, outputTokens: 3, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  });
});
