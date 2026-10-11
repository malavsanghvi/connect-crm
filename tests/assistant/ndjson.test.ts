import { describe, expect, it } from "vitest";

import { createNdjsonParser, parseChatEvent, parseNdjsonLine } from "@/lib/assistant/ndjson";

import { ndjsonText, sampleProposal } from "./fake-server";

describe("NDJSON line parser", () => {
  it("returns every event in a whole body", () => {
    const p = createNdjsonParser();
    const events = p.push(ndjsonText([{ type: "thread", threadId: "t1" }, { type: "text", text: "Hello" }, { type: "done" }]));
    expect(events).toEqual([{ type: "thread", threadId: "t1" }, { type: "text", text: "Hello" }, { type: "done" }]);
    expect(p.end()).toEqual([]);
    expect(p.badLines).toBe(0);
  });

  it("joins a line that arrives in pieces, cut anywhere", () => {
    const text = ndjsonText([{ type: "text", text: "Hello, wörld ✓" }, { type: "tool", command: "people.search", title: "Search", status: "running" }]);
    for (let size = 1; size <= 9; size += 1) {
      const p = createNdjsonParser();
      const out = [];
      for (let i = 0; i < text.length; i += size) out.push(...p.push(text.slice(i, i + size)));
      out.push(...p.end());
      expect(out).toHaveLength(2);
      expect(out[0]).toEqual({ type: "text", text: "Hello, wörld ✓" });
    }
  });

  it("keeps a half line until the rest comes, and reads a last line that has no newline at the end", () => {
    const p = createNdjsonParser();
    expect(p.push('{"type":"text","te')).toEqual([]);
    expect(p.push('xt":"one"}\n{"type":"text","text":"two"}')).toEqual([{ type: "text", text: "one" }]);
    expect(p.end()).toEqual([{ type: "text", text: "two" }]);
  });

  it("skips blank lines and Windows line endings without counting them as bad", () => {
    const p = createNdjsonParser();
    const events = p.push('\n{"type":"text","text":"a"}\r\n\r\n   \n{"type":"done"}\r\n');
    expect(events).toHaveLength(2);
    expect(p.badLines).toBe(0);
  });

  it("counts a bad line and carries on with the answer that is still arriving", () => {
    const p = createNdjsonParser();
    const events = p.push('{"type":"text","text":"before"}\nthis is not json\n{"type":"mystery"}\n{"type":"text","text":"after"}\n');
    expect(events.map((e) => (e.type === "text" ? e.text : e.type))).toEqual(["before", "after"]);
    expect(p.badLines).toBe(2);
  });

  it("does not repeat events after end()", () => {
    const p = createNdjsonParser();
    p.push('{"type":"done"}');
    expect(p.end()).toHaveLength(1);
    expect(p.end()).toEqual([]);
  });
});

describe("one line", () => {
  it("tells apart an event, a blank line and a bad line", () => {
    expect(parseNdjsonLine('{"type":"done"}')).toEqual({ event: { type: "done" } });
    expect(parseNdjsonLine("   ")).toEqual({ blank: true });
    expect(parseNdjsonLine("{oops")).toEqual({ bad: true });
    expect(parseNdjsonLine("[1,2]")).toEqual({ bad: true });
  });
});

describe("checking an event against the protocol", () => {
  it("accepts each event type with the fields the protocol names", () => {
    expect(parseChatEvent({ type: "thread", threadId: "t" })).toEqual({ type: "thread", threadId: "t" });
    expect(parseChatEvent({ type: "tool", command: "c", title: "T", status: "failed" })).toEqual({ type: "tool", command: "c", title: "T", status: "failed" });
    expect(parseChatEvent({ type: "result", command: "c", title: "T", data: { a: 1 } })).toEqual({ type: "result", command: "c", title: "T", data: { a: 1 } });
    expect(parseChatEvent({ type: "error", message: "Nope", retryable: true })).toEqual({ type: "error", message: "Nope", retryable: true });
    expect(parseChatEvent({ type: "done", usage: { used: 4, limit: null } })).toEqual({ type: "done", usage: { used: 4, limit: null } });
  });

  it("rejects events with the wrong shape", () => {
    expect(parseChatEvent({ type: "text" })).toBeNull();
    expect(parseChatEvent({ type: "tool", command: "c", title: "T", status: "sleeping" })).toBeNull();
    expect(parseChatEvent({ type: "result", command: "c", title: "T" })).toBeNull();
    expect(parseChatEvent({ type: "thread", threadId: "" })).toBeNull();
    expect(parseChatEvent(null)).toBeNull();
    expect(parseChatEvent("text")).toBeNull();
  });

  it("an error that does not say it can be retried is not offered a retry", () => {
    expect(parseChatEvent({ type: "error", message: "No" })).toEqual({ type: "error", message: "No", retryable: false });
  });

  it("a proposal without an id, hash or button text is unusable", () => {
    const ok = parseChatEvent({ type: "proposal", proposal: sampleProposal() });
    expect(ok?.type).toBe("proposal");
    expect(parseChatEvent({ type: "proposal", proposal: { ...sampleProposal(), id: "" } })).toBeNull();
    expect(parseChatEvent({ type: "proposal", proposal: { ...sampleProposal(), inputHash: undefined } })).toBeNull();
    expect(parseChatEvent({ type: "proposal", proposal: { ...sampleProposal(), confirmText: 3 } })).toBeNull();
  });

  it("keeps only text lines of a proposal", () => {
    const e = parseChatEvent({ type: "proposal", proposal: { ...sampleProposal(), lines: ["a", 5, null, "b"] } });
    expect(e?.type === "proposal" ? e.proposal.lines : null).toEqual(["a", "b"]);
  });
});
