import { describe, expect, it } from "vitest";

import { CUT_SHORT_MESSAGE, canRetry, chatReducer, initialChatState, isWaitingForFirstPart, type ChatAction, type ChatState } from "@/lib/assistant/chat-state";
import type { ChatEvent } from "@/lib/assistant/protocol";

import { sampleProposal } from "./fake-server";

const run = (actions: ChatAction[], from: ChatState = initialChatState) => actions.reduce(chatReducer, from);
const ev = (event: ChatEvent): ChatAction => ({ type: "event", event });
const lastBot = (s: ChatState) => {
  const m = [...s.messages].reverse().find((x) => x.role === "assistant");
  if (!m || m.role !== "assistant") throw new Error("no assistant message");
  return m;
};

describe("chat reducer", () => {
  it("a question adds the person's message and an empty streaming answer", () => {
    const s = run([{ type: "send", text: "  Who is behind on pledges?  " }]);
    expect(s.busy).toBe(true);
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(s.messages[0]).toMatchObject({ role: "user", text: "Who is behind on pledges?" });
    expect(lastBot(s).status).toBe("streaming");
    expect(isWaitingForFirstPart(s)).toBe(true);
  });

  it("ignores an empty question and a second question while one is arriving", () => {
    expect(run([{ type: "send", text: "   " }])).toEqual(initialChatState);
    const once = run([{ type: "send", text: "one" }]);
    expect(run([{ type: "send", text: "two" }], once)).toBe(once);
  });

  it("joins pieces of text into one paragraph", () => {
    const s = run([{ type: "send", text: "hi" }, ev({ type: "text", text: "Hel" }), ev({ type: "text", text: "lo" }), ev({ type: "text", text: " there" })]);
    expect(lastBot(s).parts).toEqual([{ kind: "text", text: "Hello there" }]);
    expect(isWaitingForFirstPart(s)).toBe(false);
  });

  it("a tool chip goes running, then done; the answer text after it starts a new paragraph", () => {
    const s = run([
      { type: "send", text: "hi" },
      ev({ type: "text", text: "Let me look." }),
      ev({ type: "tool", command: "giving.pledges_behind", title: "Show who is behind on pledges", status: "running" }),
      ev({ type: "tool", command: "giving.pledges_behind", title: "Show who is behind on pledges", status: "done" }),
      ev({ type: "result", command: "giving.pledges_behind", title: "Behind on pledges", data: { total_open: "$1.00" } }),
      ev({ type: "text", text: "Two households." }),
    ]);
    expect(lastBot(s).parts).toEqual([
      { kind: "text", text: "Let me look." },
      { kind: "tool", command: "giving.pledges_behind", title: "Show who is behind on pledges", status: "done" },
      { kind: "result", command: "giving.pledges_behind", title: "Behind on pledges", data: { total_open: "$1.00" } },
      { kind: "text", text: "Two households." },
    ]);
  });

  it("two runs of the same command get two chips; a failure marks the running one", () => {
    const s = run([
      { type: "send", text: "hi" },
      ev({ type: "tool", command: "c", title: "T", status: "running" }),
      ev({ type: "tool", command: "c", title: "T", status: "done" }),
      ev({ type: "tool", command: "c", title: "T", status: "running" }),
      ev({ type: "tool", command: "c", title: "T", status: "failed" }),
    ]);
    expect(lastBot(s).parts.map((p) => (p.kind === "tool" ? p.status : p.kind))).toEqual(["done", "failed"]);
  });

  it("a proposal becomes a part, and done ends the answer and records the usage and thread", () => {
    const s = run([
      { type: "send", text: "hi" },
      ev({ type: "thread", threadId: "t-9" }),
      ev({ type: "proposal", proposal: sampleProposal() }),
      ev({ type: "done", usage: { used: 5, limit: 200 } }),
    ]);
    expect(lastBot(s).parts[0]).toMatchObject({ kind: "proposal", proposal: { id: "p1" } });
    expect(lastBot(s).status).toBe("done");
    expect(s.busy).toBe(false);
    expect(s.threadId).toBe("t-9");
    expect(s.usage).toEqual({ used: 5, limit: 200 });
  });

  it("an error event shows the sentence and whether to offer Try again", () => {
    const s = run([{ type: "send", text: "hi" }, ev({ type: "text", text: "Partly" }), ev({ type: "error", message: "Niva could not finish.", retryable: true })]);
    expect(lastBot(s)).toMatchObject({ status: "error", error: { message: "Niva could not finish.", retryable: true } });
    expect(lastBot(s).parts).toEqual([{ kind: "text", text: "Partly" }]);
    expect(s.busy).toBe(false);
    expect(canRetry(s)).toBe(true);
  });

  it("a stream that closes without saying done was cut short", () => {
    const s = run([{ type: "send", text: "hi" }, ev({ type: "text", text: "Partly" }), { type: "finished" }]);
    expect(lastBot(s)).toMatchObject({ status: "error", error: { message: CUT_SHORT_MESSAGE, retryable: true } });
    // But a stream that did finish properly is left alone.
    const ok = run([{ type: "send", text: "hi" }, ev({ type: "done" }), { type: "finished" }]);
    expect(lastBot(ok).status).toBe("done");
  });

  it("a request that failed outright (no connection) marks the answer", () => {
    const s = run([{ type: "send", text: "hi" }, { type: "failed", message: "Could not reach Niva.", retryable: true }]);
    expect(lastBot(s).error?.message).toBe("Could not reach Niva.");
    expect(s.busy).toBe(false);
  });

  it("Stop keeps what arrived, and events that come late are ignored", () => {
    const s = run([{ type: "send", text: "hi" }, ev({ type: "text", text: "Part" }), { type: "stopped" }, ev({ type: "text", text: " late" })]);
    expect(lastBot(s)).toMatchObject({ status: "stopped", parts: [{ kind: "text", text: "Part" }] });
    expect(s.busy).toBe(false);
    expect(canRetry(s)).toBe(true);
  });

  it("Try again replaces the failed answer with a fresh one for the same question", () => {
    const failed = run([{ type: "send", text: "Who?" }, ev({ type: "error", message: "No", retryable: true })]);
    expect(failed.lastAsked).toBe("Who?");
    const again = chatReducer(failed, { type: "retry" });
    expect(again.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(lastBot(again)).toMatchObject({ status: "streaming", parts: [] });
    expect(again.busy).toBe(true);
    // Nothing to retry when the answer was fine.
    const fine = run([{ type: "send", text: "Who?" }, ev({ type: "done" })]);
    expect(chatReducer(fine, { type: "retry" })).toBe(fine);
  });

  it("palette results appear in the panel without a model, and do not become 'the answer' to retry", () => {
    const s = run([{ type: "local_result", asked: "Show my tasks", command: "tasks.mine", title: "My tasks", data: { count: 0 } }]);
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(lastBot(s).local).toBe(true);
    expect(lastBot(s).parts.map((p) => p.kind)).toEqual(["tool", "result"]);
    expect(canRetry(s)).toBe(false);
  });

  it("a palette result added while an answer is arriving does not steal its events", () => {
    const s = run([
      { type: "send", text: "hi" },
      { type: "local_result", asked: "Show my tasks", command: "tasks.mine", title: "My tasks", data: {} },
      ev({ type: "text", text: "Streaming still" }),
      ev({ type: "done" }),
    ]);
    const bots = s.messages.filter((m) => m.role === "assistant");
    expect(bots).toHaveLength(2);
    expect(bots[0]).toMatchObject({ status: "done", parts: [{ kind: "text", text: "Streaming still" }] });
    expect(bots[1]).toMatchObject({ local: true });
  });

  it("a palette proposal is shown as a card in the panel", () => {
    const s = run([{ type: "local_proposal", asked: "Change a detail of an event", proposal: sampleProposal() }]);
    expect(lastBot(s).parts).toEqual([{ kind: "proposal", proposal: sampleProposal() }]);
  });

  it("a new conversation clears the list but not while an answer is arriving", () => {
    const busy = run([{ type: "send", text: "hi" }]);
    expect(chatReducer(busy, { type: "reset" })).toBe(busy);
    const done = run([{ type: "send", text: "hi" }, ev({ type: "done" }), { type: "reset" }]);
    expect(done.messages).toEqual([]);
    expect(done.threadId).toBeUndefined();
  });

  it("message ids are never reused", () => {
    const s = run([{ type: "send", text: "a" }, ev({ type: "done" }), { type: "send", text: "b" }]);
    const ids = s.messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
