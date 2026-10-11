import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/commands/hooks", () => ({ onCommandEvent: vi.fn() }));
vi.mock("@/lib/session", () => ({ loadSession: vi.fn() }));
vi.mock("@/lib/commands/context", () => ({ createCommandContext: vi.fn() }));
vi.mock("@/lib/assistant/key", () => ({ assistantApiKey: vi.fn(), assistantModelClient: vi.fn() }));
vi.mock("@/lib/assistant/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/assistant/store")>();
  return { ...real, databaseUsageMeter: vi.fn(), databaseConversationLog: vi.fn() };
});

import { GET as commandsGET } from "@/app/api/assistant/commands/route";
import { POST as chatPOST } from "@/app/api/assistant/chat/route";
import { POST as confirmPOST } from "@/app/api/assistant/confirm/route";
import { POST as rejectPOST } from "@/app/api/assistant/reject/route";
import { POST as runPOST } from "@/app/api/assistant/run/route";
import { sameOrigin } from "@/lib/assistant/http";
import { assistantApiKey, assistantModelClient } from "@/lib/assistant/key";
import type { ChatEvent, CommandsResponse, ConfirmResponse, RunResponse } from "@/lib/assistant/protocol";
import { ASSISTANT_OFF, NO_AI_KEY } from "@/lib/assistant/settings";
import { databaseConversationLog, databaseUsageMeter } from "@/lib/assistant/store";
import { createCommandContext } from "@/lib/commands/context";
import { InMemoryProposalStore } from "@/lib/commands/proposals";
import { isPublicPath } from "@/lib/supabase/proxy";
import { loadSession } from "@/lib/session";

import { CHILDREN, fakeSession, testContext } from "../commands/helpers";
import { FakeModel, say } from "./fake-model";
import { change, executed, MANAGER, ruleSet, testRegistry } from "./test-commands";

// ---------------------------------------------------------------------------
// A signed-in person, and the requests they make
// ---------------------------------------------------------------------------
type Who = { rules?: unknown; permissions?: string[]; grants?: unknown[]; aal?: string; isOwner?: boolean; proposals?: InMemoryProposalStore };

const NOW = () => new Date("2026-10-10T15:00:00Z");
let store: InMemoryProposalStore;

function signIn(who: Who = {}) {
  const session = fakeSession({
    permissions: who.permissions ?? MANAGER,
    grants: who.grants ?? [{ role_key: "event_manager" }],
    isOwner: who.isOwner ?? false,
    aal: who.aal ?? "aal2",
    center: { ...fakeSession().center, rules: who.rules ?? ruleSet(false) },
  });
  store = who.proposals ?? new InMemoryProposalStore({ now: NOW });
  vi.mocked(loadSession).mockResolvedValue({ status: "ok", session });
  vi.mocked(createCommandContext).mockImplementation(async () => testContext({ session, registry: testRegistry(), via: "assistant", minorNames: CHILDREN.full, proposals: store, now: NOW }));
  return session;
}

const URL_BASE = "http://portal.test/api/assistant";
const get = (path: string) => new Request(`${URL_BASE}/${path}`, { method: "GET" });
function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${URL_BASE}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "portal.test", origin: "http://portal.test", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const json = async <T,>(res: Response): Promise<T> => (await res.json()) as T;
async function lines(res: Response): Promise<ChatEvent[]> {
  return (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as ChatEvent);
}

beforeEach(() => {
  executed.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(loadSession).mockReset();
  vi.mocked(createCommandContext).mockReset();
  vi.mocked(assistantApiKey).mockReset().mockResolvedValue("");
  vi.mocked(assistantModelClient).mockReset().mockResolvedValue(null);
  vi.mocked(databaseUsageMeter).mockReset().mockReturnValue({ check: async () => ({ state: "allowed", used: 1, limit: 300 }), status: async () => ({ used: 41, limit: 300, month: "2026-10-01" }) });
  vi.mocked(databaseConversationLog).mockReset().mockReturnValue({ history: async () => [], append: async () => ({}) });
});

// ---------------------------------------------------------------------------
describe("who may use the routes", () => {
  it("answers a signed-out person with 401 and a sentence, not a redirect", async () => {
    vi.mocked(loadSession).mockResolvedValue({ status: "signed_out" });
    for (const res of [await commandsGET(get("commands")), await runPOST(post("run", { key: "events.look" })), await chatPOST(post("chat", { message: "hi" })), await confirmPOST(post("confirm", {})), await rejectPOST(post("reject", {}))]) {
      expect(res.status).toBe(401);
      expect(await json(res)).toEqual({ ok: false, error: "Your session has ended. Sign in again to use Niva." });
    }
    expect(isPublicPath("/api/assistant/chat")).toBe(true);
    expect(isPublicPath("/api/assistant")).toBe(true);
    expect(isPublicPath("/api/assistants")).toBe(false);
  });

  it("answers 503 when the sign-in could not be loaded", async () => {
    vi.mocked(loadSession).mockResolvedValue({ status: "error", message: "database down" });
    const res = await commandsGET(get("commands"));
    expect(res.status).toBe(503);
    expect((await json<{ error: string }>(res)).error).toBe("Niva could not load your sign-in. Reload the page and try again.");
  });

  it("is for staff only", async () => {
    signIn({ grants: [] });
    const res = await runPOST(post("run", { key: "events.look" }));
    expect(res.status).toBe(403);
    expect((await json<{ error: string }>(res)).error).toMatch(/don't have access to this area/);
    signIn({ grants: [], isOwner: true, rules: ruleSet(false) });
    expect((await commandsGET(get("commands"))).status).toBe(200);
  });

  it("asks staff of a community that requires 2FA to pass it first", async () => {
    signIn({ aal: "aal1", rules: { security: { require_2fa_for_staff: true }, assistant: { enabled: true } } });
    const res = await commandsGET(get("commands"));
    expect(res.status).toBe(403);
    expect((await json<{ error: string }>(res)).error).toMatch(/security check/);
    signIn({ aal: "aal1", rules: { security: { require_2fa_for_staff: false }, assistant: { enabled: true } } });
    expect((await commandsGET(get("commands"))).status).toBe(200);
  });

  it("refuses a POST that did not come from this site, or that is not JSON", async () => {
    signIn({ rules: ruleSet(false) });
    const elsewhere = await runPOST(post("run", { key: "events.look" }, { origin: "https://evil.example" }));
    expect(elsewhere.status).toBe(403);
    expect((await json<{ error: string }>(elsewhere)).error).toMatch(/did not come from the Weaver page/);
    const text = await runPOST(post("run", { key: "events.look" }, { "content-type": "text/plain" }));
    expect(text.status).toBe(415);
    const broken = await runPOST(post("run", "{not json"));
    expect(broken.status).toBe(400);
    expect(executed).toEqual([]);
  });

  it("knows the page a request came from", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(sameOrigin(h({}))).toBe(true);
    expect(sameOrigin(h({ origin: "https://a.example.org", host: "a.example.org" }))).toBe(true);
    expect(sameOrigin(h({ origin: "https://a.example.org", host: "internal:3000", "x-forwarded-host": "a.example.org" }))).toBe(true);
    expect(sameOrigin(h({ origin: "https://b.example.org", host: "a.example.org" }))).toBe(false);
    expect(sameOrigin(h({ origin: "null", host: "a.example.org" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("while Niva for admins is switched off", () => {
  const off = { assistant: { enabled: false } };

  it("answers every route except the list with the same sentence", async () => {
    signIn({ rules: off });
    for (const res of [await runPOST(post("run", { key: "events.look" })), await chatPOST(post("chat", { message: "hi" })), await confirmPOST(post("confirm", { proposalId: "p", inputHash: "h" })), await rejectPOST(post("reject", { proposalId: "p" }))]) {
      expect(res.status).toBe(403);
      expect(await json(res)).toEqual({ ok: false, error: "Niva for admins is not switched on for your community." });
    }
    expect(ASSISTANT_OFF).toBe("Niva for admins is not switched on for your community.");
    expect(executed).toEqual([]);
    expect(createCommandContext).not.toHaveBeenCalled();
  });

  it("is off by default, for a community that never said", async () => {
    signIn({ rules: {} });
    expect((await runPOST(post("run", { key: "events.look" }))).status).toBe(403);
  });

  it("lets the list say so instead", async () => {
    signIn({ rules: off });
    vi.mocked(assistantApiKey).mockResolvedValue("sk-ant-x");
    const res = await commandsGET(get("commands"));
    expect(res.status).toBe(200);
    expect(await json<CommandsResponse>(res)).toEqual({ ok: true, enabled: false, aiReady: true, commands: [] });
  });
});

// ---------------------------------------------------------------------------
describe("GET /api/assistant/commands", () => {
  const ALL = ["people.view", "giving.view", "events.view", "events.manage", "comms.send", "accounting.close"];

  it("lists what this person may use, for the palette, whether or not there is an AI key", async () => {
    signIn({ permissions: ALL, rules: { assistant: { enabled: true } } });
    const noKey = await json<CommandsResponse>(await commandsGET(get("commands")));
    expect(noKey).toMatchObject({ ok: true, enabled: true, aiReady: false, usage: { used: 41, limit: 300, month: "2026-10-01" } });
    const keys = noKey.commands.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["people.search", "events.upcoming", "giving.pledges_behind", "messages.draft_reminder", "events.draft_change"]));
    // The one write command is off until the community allows it.
    expect(keys).not.toContain("events.set_field");

    vi.mocked(assistantApiKey).mockResolvedValue("sk-ant-x");
    expect((await json<CommandsResponse>(await commandsGET(get("commands")))).aiReady).toBe(true);

    signIn({ permissions: ALL, rules: { assistant: { enabled: true, tools: { "events.set_field": true } } } });
    const allowed = await json<CommandsResponse>(await commandsGET(get("commands")));
    expect(allowed.commands.find((c) => c.key === "events.set_field")).toMatchObject({ level: "confirm", area: "events", title: "Change a detail of an event" });
  });

  it("lists only what the role allows", async () => {
    signIn({ permissions: ["events.view"], rules: { assistant: { enabled: true } } });
    const body = await json<CommandsResponse>(await commandsGET(get("commands")));
    // Showing a person their own tasks needs no permission; the events list needs events.view.
    expect(body.commands.map((c) => c.key)).toEqual(["tasks.mine", "events.upcoming"]);
  });

  it("still answers when the usage numbers or the key cannot be read", async () => {
    signIn({ permissions: ALL, rules: { assistant: { enabled: true } } });
    vi.mocked(databaseUsageMeter).mockReturnValue({ check: async () => ({ state: "unmetered" }), status: async () => null });
    vi.mocked(assistantApiKey).mockRejectedValue(new Error("vault down"));
    const body = await json<CommandsResponse>(await commandsGET(get("commands")));
    expect(body.aiReady).toBe(false);
    expect(body).not.toHaveProperty("usage");
    expect(body.commands.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/assistant/run", () => {
  it("runs one command with no model and returns its result", async () => {
    signIn({ rules: ruleSet(false) });
    const res = await runPOST(post("run", { key: "events.look", input: { q: "diwali" } }));
    expect(res.status).toBe(200);
    expect(await json<RunResponse>(res)).toEqual({ ok: true, kind: "result", title: "Look at events", data: { q: "diwali" } });
    expect(executed).toEqual(["look:diwali"]);
    expect(assistantModelClient).not.toHaveBeenCalled();
  });

  it("returns the result cleaned of children, like the chat", async () => {
    signIn({ rules: ruleSet(false) });
    const body = JSON.stringify(await json<RunResponse>(await runPOST(post("run", { key: "people.peek" }))));
    expect(body).toContain("Priya Shah");
    expect(body).not.toContain("Zoya");
    expect(body).not.toContain("2018-05-05");
  });

  it("says in plain English when a command cannot be run", async () => {
    signIn({ rules: ruleSet(false) });
    expect(await json<RunResponse>(await runPOST(post("run", { key: "events.nothing" })))).toEqual({ ok: false, error: 'Weaver does not have an action called "events.nothing".' });
    expect(await json<RunResponse>(await runPOST(post("run", { key: "events.look", input: { q: "x".repeat(40) } })))).toMatchObject({ ok: false, error: expect.stringMatching(/at most 20 characters/) });
    signIn({ permissions: [], rules: ruleSet(false) });
    expect(await json<RunResponse>(await runPOST(post("run", { key: "events.look" })))).toMatchObject({ ok: false, error: expect.stringMatching(/you don't have permission/) });
    signIn({ rules: ruleSet(false) });
    for (const bad of [{}, { key: 5 }, { key: "NotAKey" }]) {
      const res = await runPOST(post("run", bad));
      expect(res.status).toBe(400);
      expect((await json<{ ok: boolean; error: string }>(res)).ok).toBe(false);
    }
    expect((await runPOST(post("run", { key: "events.look", input: [1] }))).status).toBe(400);
  });

  it("gives a write command back as a card to confirm, never as done, and not at all while it is off", async () => {
    signIn({ rules: ruleSet(false) });
    expect(await json<RunResponse>(await runPOST(post("run", { key: "events.change", input: { name: "Gala" } })))).toMatchObject({ ok: false, error: expect.stringMatching(/not set up to change an event/) });

    signIn({ rules: ruleSet(true) });
    const card = await json<RunResponse>(await runPOST(post("run", { key: "events.change", input: { name: "Gala" } })));
    expect(card).toMatchObject({ ok: true, kind: "proposal", proposal: { command: "events.change", title: "Change an event", confirmText: "Yes, rename it" } });
    expect(executed).toEqual([]);
  });

  it("does not let the details carry anything the command does not take", async () => {
    signIn({ rules: ruleSet(false) });
    const res = await json<RunResponse>(await runPOST(post("run", { key: "events.look", input: { q: "a", center_id: "other-community" } })));
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/does not take "center_id"/) });
    expect(executed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/assistant/confirm and /reject", () => {
  async function propose(name = "Gala") {
    const answer = await json<RunResponse>(await runPOST(post("run", { key: "events.change", input: { name } })));
    if (!answer.ok || answer.kind !== "proposal") throw new Error(`expected a card, got ${JSON.stringify(answer)}`);
    return answer.proposal;
  }

  it("runs the command only when the person confirms that card, and only once", async () => {
    signIn({ rules: ruleSet(true) });
    const card = await propose();
    expect(executed).toEqual([]);
    const res = await confirmPOST(post("confirm", { proposalId: card.id, inputHash: card.inputHash }));
    expect(res.status).toBe(200);
    expect(await json<ConfirmResponse>(res)).toEqual({ ok: true, message: "Renamed.", data: { name: "Gala" } });
    expect(executed).toEqual(["change:Gala"]);
    const again = await json<ConfirmResponse>(await confirmPOST(post("confirm", { proposalId: card.id, inputHash: card.inputHash })));
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/already used/) });
    expect(executed).toEqual(["change:Gala"]);
  });

  it("does nothing with a hash that does not match the card", async () => {
    signIn({ rules: ruleSet(true) });
    const card = await propose();
    const res = await json<ConfirmResponse>(await confirmPOST(post("confirm", { proposalId: card.id, inputHash: "f".repeat(64) })));
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/details changed/) });
    expect(executed).toEqual([]);
  });

  it("does nothing once the community has switched the write command off", async () => {
    signIn({ rules: ruleSet(true) });
    const card = await propose();
    // The owner switches it off before the person presses the button.
    signIn({ rules: ruleSet(false), proposals: store });
    const res = await json<ConfirmResponse>(await confirmPOST(post("confirm", { proposalId: card.id, inputHash: card.inputHash })));
    expect(res.ok).toBe(false);
    expect(executed).toEqual([]);
  });

  it("asks for the security code in its own window and offers a new card to confirm after it", async () => {
    signIn({ rules: ruleSet(true) });
    const card = await propose();
    // The database wants a fresh 2FA check the first time.
    const run = change.execute!;
    let first = true;
    change.execute = async (ctx, input) => {
      if (first) {
        first = false;
        return { ok: false, error: "Could not change an event — this needs a fresh 2FA check.", stepUp: true };
      }
      return run(ctx, input);
    };
    try {
      const res = await json<ConfirmResponse>(await confirmPOST(post("confirm", { proposalId: card.id, inputHash: card.inputHash })));
      expect(res).toMatchObject({ ok: false, needsStepUp: true, retryProposal: { command: "events.change", title: "Change an event", confirmText: "Yes, rename it" } });
      if (res.ok || !res.retryProposal) throw new Error("expected a new card");
      expect(res.retryProposal.id).not.toBe(card.id);
      expect(executed).toEqual([]);
      const done = await json<ConfirmResponse>(await confirmPOST(post("confirm", { proposalId: res.retryProposal.id, inputHash: res.retryProposal.inputHash })));
      expect(done).toMatchObject({ ok: true, message: "Renamed." });
      expect(executed).toEqual(["change:Gala"]);
    } finally {
      change.execute = run;
    }
  });

  it("turns a card down, and a rejected card cannot be confirmed", async () => {
    signIn({ rules: ruleSet(true) });
    const card = await propose();
    expect(await json(await rejectPOST(post("reject", { proposalId: card.id })))).toEqual({ ok: true });
    const res = await json<ConfirmResponse>(await confirmPOST(post("confirm", { proposalId: card.id, inputHash: card.inputHash })));
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/turned down/) });
    expect(executed).toEqual([]);
    expect(await json(await rejectPOST(post("reject", { proposalId: card.id })))).toMatchObject({ ok: false });
  });

  it("refuses incomplete requests in plain English", async () => {
    signIn({ rules: ruleSet(true) });
    for (const body of [{}, { proposalId: "p" }, { inputHash: "h" }, { proposalId: 5, inputHash: "h" }]) {
      const res = await confirmPOST(post("confirm", body));
      expect(res.status).toBe(400);
      expect((await json<{ error: string }>(res)).error).toMatch(/incomplete/);
    }
    expect((await rejectPOST(post("reject", {}))).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/assistant/chat", () => {
  it("streams one JSON event per line", async () => {
    signIn({ rules: ruleSet(false) });
    vi.mocked(assistantModelClient).mockResolvedValue(new FakeModel([say("Hello.")]));
    const res = await chatPOST(post("chat", { message: "hi" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/x-ndjson/);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    const events = await lines(res);
    expect(events.map((e) => e.type)).toEqual(["thread", "text", "done"]);
    expect(events[1]).toEqual({ type: "text", text: "Hello." });
    expect(events[2]).toEqual({ type: "done", usage: { used: 1, limit: 300 } });
  });

  it("with no AI key answers as a normal stream with a plain-English error", async () => {
    signIn({ rules: ruleSet(false) });
    const res = await chatPOST(post("chat", { message: "hi" }));
    expect(res.status).toBe(200);
    const events = await lines(res);
    expect(events.map((e) => e.type)).toEqual(["thread", "error", "done"]);
    expect(events[1]).toEqual({
      type: "error",
      message: "Niva for admins needs the AI service to be set up (Platform › Setup). You can still use the search box and the commands list.",
      retryable: false,
    });
    expect(NO_AI_KEY).toContain("Platform › Setup");
    // The commands list keeps working in the same situation.
    expect((await commandsGET(get("commands"))).status).toBe(200);
  });

  it("answers an over-the-limit community in plain English", async () => {
    signIn({ rules: ruleSet(false) });
    vi.mocked(assistantModelClient).mockResolvedValue(new FakeModel([say("never")]));
    vi.mocked(databaseUsageMeter).mockReturnValue({ check: async () => ({ state: "blocked", used: 300, limit: 300, reason: "Niva has used up this community's 300 actions for the month." }), status: async () => null });
    const events = await lines(await chatPOST(post("chat", { message: "hi" })));
    expect(events.map((e) => e.type)).toEqual(["thread", "error", "done"]);
    expect(events[1]).toMatchObject({ type: "error", message: "Niva has used up this community's 300 actions for the month.", retryable: false });
  });

  it("treats a message that is not text as an empty one, and a thread that is not text as no thread", async () => {
    signIn({ rules: ruleSet(false) });
    vi.mocked(assistantModelClient).mockResolvedValue(new FakeModel([]));
    const events = await lines(await chatPOST(post("chat", { message: 42, threadId: 7, context: "x" })));
    expect(events.map((e) => e.type)).toEqual(["thread", "error", "done"]);
    expect(events[1]).toMatchObject({ message: "Type a question or an instruction for Niva first." });
  });

  it("says plainly that it could not start when something breaks before the stream", async () => {
    signIn({ rules: ruleSet(false) });
    vi.mocked(createCommandContext).mockRejectedValue(new Error("db down"));
    const res = await chatPOST(post("chat", { message: "hi" }));
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ ok: false, error: "Niva could not start. Nothing was changed. Try again." });
  });
});
