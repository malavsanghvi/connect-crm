import { beforeEach, describe, expect, it } from "vitest";

import { chatReducer, initialChatState } from "@/lib/assistant/chat-state";
import {
  CHAT_URL,
  COMMANDS_URL,
  CONFIRM_URL,
  ChatStreamError,
  REJECT_URL,
  RUN_URL,
  confirmProposal,
  fetchCommands,
  getCommandsOnce,
  httpErrorMessage,
  rejectProposal,
  resetCommandsCache,
  runCommand,
  streamChat,
} from "@/lib/assistant/client";
import type { ChatEvent } from "@/lib/assistant/protocol";

import { commandsOn, fakeFetch, json, ndjsonText, sampleProposal, streamed } from "./fake-server";

beforeEach(() => resetCommandsCache());

describe("the command list", () => {
  it("reads who may use what, and whether chat is ready", async () => {
    const f = fakeFetch({ [COMMANDS_URL]: () => json(commandsOn({ aiReady: false })) });
    const res = await fetchCommands(f);
    expect(res).toMatchObject({ enabled: true, aiReady: false });
    expect(res?.commands.map((c) => c.key)).toContain("people.search");
    expect(res?.usage).toEqual({ used: 3, limit: 200, month: "2026-10" });
  });

  it("asks once per page load, however many parts of the page want it", async () => {
    const f = fakeFetch({ [COMMANDS_URL]: () => json(commandsOn()) });
    const [a, b, c] = await Promise.all([getCommandsOnce(f), getCommandsOnce(f), getCommandsOnce(f)]);
    await getCommandsOnce(f);
    expect(f.calls).toHaveLength(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("shows nothing (null) when anything is wrong, and never throws", async () => {
    expect(await fetchCommands(fakeFetch({}))).toBeNull(); // route not deployed: 404
    expect(await fetchCommands(fakeFetch({ [COMMANDS_URL]: () => json({ ok: false, error: "No" }, 403) }))).toBeNull();
    expect(await fetchCommands(fakeFetch({ [COMMANDS_URL]: () => new Response("<html>", { status: 200 }) }))).toBeNull();
    expect(await fetchCommands(fakeFetch({ [COMMANDS_URL]: () => json({ ok: true }) }))).toBeNull();
    expect(
      await fetchCommands((async () => {
        throw new Error("offline");
      }) as never),
    ).toBeNull();
  });

  it("reads a switched-off community as enabled:false", async () => {
    const res = await fetchCommands(fakeFetch({ [COMMANDS_URL]: () => json({ ok: true, enabled: false, aiReady: false, commands: [] }) }));
    expect(res?.enabled).toBe(false);
  });

  it("drops a command that is not understood but keeps the others", async () => {
    const res = await fetchCommands(
      fakeFetch({
        [COMMANDS_URL]: () => json({ ok: true, enabled: true, aiReady: true, commands: [{ key: "x" }, { key: "tasks.mine", title: "Show my tasks", level: "read", area: "tasks" }, { key: "y", title: "Y", level: "bogus", area: "a" }] }),
      }),
    );
    expect(res?.commands).toEqual([{ key: "tasks.mine", title: "Show my tasks", description: "", level: "read", area: "tasks", fields: [] }]);
  });
});

describe("run", () => {
  it("sends the key and input and returns a result", async () => {
    const f = fakeFetch({ [RUN_URL]: () => json({ ok: true, kind: "result", title: "My tasks", data: { count: 2 } }) });
    const res = await runCommand(f, { key: "tasks.mine", input: {} });
    expect(res).toEqual({ ok: true, kind: "result", title: "My tasks", data: { count: 2 }, text: undefined });
    expect(f.calls[0]).toMatchObject({ method: "POST", body: { key: "tasks.mine", input: {} } });
  });

  it("returns a proposal as a card", async () => {
    const f = fakeFetch({ [RUN_URL]: () => json({ ok: true, kind: "proposal", proposal: sampleProposal() }) });
    const res = await runCommand(f, { key: "events.set_field", input: { field: "venue", value: "Main Hall" } });
    expect(res).toMatchObject({ ok: true, kind: "proposal", proposal: { id: "p1" } });
  });

  it("passes on the server's sentence and the step-up flag", async () => {
    const f = fakeFetch({ [RUN_URL]: () => json({ ok: false, error: "You don't have access to Giving.", needsStepUp: true }, 403) });
    expect(await runCommand(f, { key: "k", input: {} })).toEqual({ ok: false, error: "You don't have access to Giving.", needsStepUp: true });
  });

  it("explains a lost connection and a 404 without jargon", async () => {
    const down = (async () => {
      throw new Error("offline");
    }) as never;
    expect(await runCommand(down, { key: "k", input: {} })).toEqual({ ok: false, error: "Could not run that — the server did not respond. Try again." });
    const missing = await runCommand(fakeFetch({ [RUN_URL]: () => new Response("", { status: 404 }) }), { key: "k", input: {} });
    expect(missing).toMatchObject({ ok: false, error: "Could not run that — Niva is not available here." });
  });

  it("a proposal that is missing its id is an error, not a card that cannot work", async () => {
    const f = fakeFetch({ [RUN_URL]: () => json({ ok: true, kind: "proposal", proposal: { ...sampleProposal(), id: "" } }) });
    expect(await runCommand(f, { key: "k", input: {} })).toMatchObject({ ok: false });
  });
});

describe("confirm and cancel", () => {
  it("sends the proposal id and its input hash", async () => {
    const f = fakeFetch({ [CONFIRM_URL]: () => json({ ok: true, message: "The venue is now Main Hall." }) });
    expect(await confirmProposal(f, { proposalId: "p1", inputHash: "hash-1" })).toEqual({ ok: true, message: "The venue is now Main Hall.", data: undefined });
    expect(f.calls[0].body).toEqual({ proposalId: "p1", inputHash: "hash-1" });
  });

  it("returns the step-up request with the fresh proposal", async () => {
    const f = fakeFetch({ [CONFIRM_URL]: () => json({ ok: false, error: "This needs a fresh 2FA check.", needsStepUp: true, retryProposal: sampleProposal({ id: "p2" }) }, 403) });
    const res = await confirmProposal(f, { proposalId: "p1", inputHash: "hash-1" });
    expect(res).toMatchObject({ ok: false, needsStepUp: true, retryProposal: { id: "p2" } });
  });

  it("a lost connection on confirm says it cannot tell whether it went through", async () => {
    const res = await confirmProposal((async () => {
      throw new Error("offline");
    }) as never, { proposalId: "p1", inputHash: "h" });
    expect(res).toMatchObject({ ok: false });
    expect(res.ok ? "" : res.error).toMatch(/may or may not have gone through/);
  });

  it("an answer that is not ok never counts as done", async () => {
    const f = fakeFetch({ [CONFIRM_URL]: () => json({ ok: true }) });
    expect((await confirmProposal(f, { proposalId: "p", inputHash: "h" })).ok).toBe(false);
  });

  it("cancelling reports whether the server threw the proposal away", async () => {
    expect(await rejectProposal(fakeFetch({ [REJECT_URL]: () => json({ ok: true }) }), { proposalId: "p", inputHash: "h" })).toBe(true);
    expect(await rejectProposal(fakeFetch({ [REJECT_URL]: () => json({ ok: false }) }), { proposalId: "p", inputHash: "h" })).toBe(false);
    expect(await rejectProposal(fakeFetch({}), { proposalId: "p", inputHash: "h" })).toBe(false);
  });
});

describe("the chat stream", () => {
  const body = ndjsonText([
    { type: "thread", threadId: "t1" },
    { type: "text", text: "Looking " },
    { type: "tool", command: "giving.pledges_behind", title: "Show who is behind on pledges", status: "running" },
    { type: "tool", command: "giving.pledges_behind", title: "Show who is behind on pledges", status: "done" },
    { type: "result", command: "giving.pledges_behind", title: "Behind on pledges", data: { households_behind: 2 } },
    { type: "text", text: "Two households are behind." },
    { type: "done", usage: { used: 4, limit: 200 } },
  ]);

  async function collect(f: ReturnType<typeof fakeFetch>) {
    const events: ChatEvent[] = [];
    await streamChat(f, { message: "Who is behind on pledges?", context: { path: "/giving/payments" } }, (e) => events.push(e));
    return events;
  }

  it("delivers the events as they arrive, whatever size the pieces are", async () => {
    for (const sizes of [[5000], [1], [7, 3, 11], [64]]) {
      const events = await collect(fakeFetch({ [CHAT_URL]: () => streamed(body, sizes) }));
      expect(events.map((e) => e.type)).toEqual(["thread", "text", "tool", "tool", "result", "text", "done"]);
    }
  });

  it("sends the question with where the person is, and nothing else", async () => {
    const f = fakeFetch({ [CHAT_URL]: () => streamed(body, [100]) });
    await collect(f);
    expect(f.calls[0].body).toEqual({ message: "Who is behind on pledges?", context: { path: "/giving/payments" } });
  });

  it("feeds a chat reducer to the same message list the panel shows", async () => {
    const f = fakeFetch({ [CHAT_URL]: () => streamed(body, [9, 4]) });
    let state = chatReducer(initialChatState, { type: "send", text: "Who is behind on pledges?" });
    await streamChat(f, { message: "Who is behind on pledges?" }, (event) => (state = chatReducer(state, { type: "event", event })));
    state = chatReducer(state, { type: "finished" });
    const answer = state.messages[1];
    expect(answer).toMatchObject({ role: "assistant", status: "done" });
    expect(answer.role === "assistant" ? answer.parts.map((p) => p.kind) : []).toEqual(["text", "tool", "result", "text"]);
    expect(state.threadId).toBe("t1");
    expect(state.busy).toBe(false);
  });

  it("a bad line in the middle does not stop the answer", async () => {
    const text = '{"type":"text","text":"a"}\nGARBAGE\n{"type":"text","text":"b"}\n{"type":"done"}\n';
    const events = await collect(fakeFetch({ [CHAT_URL]: () => streamed(text, [6]) }));
    expect(events.map((e) => e.type)).toEqual(["text", "text", "done"]);
  });

  it("a plain refusal is thrown as a sentence the person can read", async () => {
    const f = fakeFetch({ [CHAT_URL]: () => json({ ok: false, error: "Niva for admins is not switched on." }, 403) });
    await expect(collect(f)).rejects.toMatchObject({ name: "ChatStreamError", message: "Niva for admins is not switched on.", retryable: false });
  });

  it("a server error can be retried; a lost connection too", async () => {
    await expect(collect(fakeFetch({ [CHAT_URL]: () => new Response("boom", { status: 500 }) }))).rejects.toMatchObject({ retryable: true });
    const err = await streamChat(
      (async () => {
        throw new Error("offline");
      }) as never,
      { message: "hi" },
      () => {},
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ChatStreamError);
    expect(err.message).toBe("Could not reach Niva — the server did not respond. Try again.");
  });

  it("an abort ends quietly", async () => {
    const controller = new AbortController();
    const f = (async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }) as never;
    await expect(streamChat(f, { message: "hi" }, () => {}, controller.signal)).resolves.toBeUndefined();
  });

  it("uses the server's words for an error, and plain words when there are none", () => {
    expect(httpErrorMessage(403, { ok: false, error: "No access." }, "ask Niva")).toBe("No access.");
    expect(httpErrorMessage(401, null, "ask Niva")).toBe("Could not ask Niva — you have been signed out. Sign in again.");
    expect(httpErrorMessage(429, {}, "ask Niva")).toMatch(/too many requests/);
  });
});
