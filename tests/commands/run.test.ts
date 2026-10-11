import { beforeEach, describe, expect, it, vi } from "vitest";

import { defineCommand } from "@/lib/commands/define";
import { onCommandEvent } from "@/lib/commands/hooks";
import { InMemoryProposalStore } from "@/lib/commands/proposals";
import { CommandRegistry } from "@/lib/commands/registry";
import { confirmProposal, rejectProposal, runCommand } from "@/lib/commands/run";
import { f, object } from "@/lib/commands/schema";
import { CommandDbError, CommandError, toActionResult, type CommandEvent } from "@/lib/commands/types";

import { fakeSession, testContext } from "./helpers";

vi.mock("@/lib/commands/hooks", () => ({ onCommandEvent: vi.fn() }));

const hook = vi.mocked(onCommandEvent);
const calls: string[] = [];
let stepUpOnce = false;

const read = defineCommand<{ q?: string }, unknown>({
  key: "events.look",
  title: "Look at events",
  description: "Look at events.",
  level: "read",
  permission: "events",
  module: "events",
  input: object({ q: f.optional(f.string("What to look for.", { max: 20 })) }),
  async execute(_ctx, input) {
    calls.push(`read:${input.q ?? ""}`);
    if (input.q === "boom") throw { code: "42501", message: "permission denied for table events" };
    if (input.q === "db") throw new CommandDbError({ code: "PGRST116", message: "x" }, "read the events");
    if (input.q === "said") throw new CommandError("That event was not found.", "invalid");
    if (input.q === "stepup") throw { code: "CCSTP", message: "Needs a fresh 2FA check." };
    if (input.q === "leaky") {
      return {
        ok: true,
        data: {
          sandbox_code: "ABCD-1234",
          invitation_link: "https://app.example.org/invite/AbCdEfGhIjKlMnOpQr",
          note: "Sent to Priya Shah. Zoya Shah is in Pathshala. Open https://x.example.org/join?token=abc123def456",
          children: [{ name: "Zoya", date_of_birth: "2018-05-05" }],
          postal_code: "60540",
        },
      };
    }
    return { ok: true, data: { q: input.q ?? null } };
  },
});

const draft = defineCommand({
  key: "messages.write",
  title: "Write a message",
  description: "Write a message.",
  level: "draft",
  permission: "commsDraft",
  module: "comms",
  input: object({}),
  async execute() {
    calls.push("draft");
    return { ok: true, data: { sent: false } };
  },
});

const change = defineCommand({
  key: "events.change",
  title: "Change an event",
  description: "Change an event.",
  level: "confirm",
  permission: "eventsManage",
  module: "events",
  input: object({ name: f.string("The new name.", { max: 40 }) }),
  async preview(_ctx, input) {
    return { summary: `Rename to ${input.name}.`, lines: [{ label: "Name", before: "Old", after: input.name }] };
  },
  confirmText: "Yes, rename it",
  async execute(_ctx, input) {
    calls.push(`change:${input.name}`);
    if (stepUpOnce) {
      stepUpOnce = false;
      return { ok: false, error: "Could not change an event — this needs a fresh 2FA check.", stepUp: true };
    }
    return { ok: true, data: { name: input.name }, message: "Renamed." };
  },
});

const onlyYou = defineCommand({
  key: "settings.token",
  title: "Enter a token",
  description: "Enter a token.",
  level: "only_you",
  permission: "centerSettings",
  input: object({}),
  pointTo: { label: "Open Settings, then Texting, to enter it.", href: "/settings/texting" },
});

function registry() {
  const r = new CommandRegistry();
  for (const c of [read, draft, change, onlyYou]) r.register(c);
  return r;
}

const MANAGER = ["events.view", "events.manage", "comms.send", "settings.manage"];
const ctxFor = (over: Parameters<typeof testContext>[0] = {}) =>
  testContext({ registry: registry(), session: fakeSession({ permissions: MANAGER }), ...over });

beforeEach(() => {
  calls.length = 0;
  stepUpOnce = false;
  hook.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runCommand: who may, and what comes back", () => {
  it("runs a read command and returns its data", async () => {
    const r = await runCommand(ctxFor(), "events.look", { q: "diwali" });
    expect(r).toEqual({ ok: true, data: { q: "diwali" } });
    expect(calls).toEqual(["read:diwali"]);
  });

  it("runs a draft command at once; a draft changes nothing", async () => {
    expect(await runCommand(ctxFor(), "messages.write", {})).toEqual({ ok: true, data: { sent: false } });
  });

  it("refuses an action Weaver does not have", async () => {
    const r = await runCommand(ctxFor(), "events.nothing", {});
    expect(r).toMatchObject({ ok: false, code: "unknown_command", error: 'Weaver does not have an action called "events.nothing".' });
  });

  it("refuses without the permission, and does not run", async () => {
    const r = await runCommand(ctxFor({ session: fakeSession({ permissions: ["events.view"] }) }), "events.change", { name: "X" });
    expect(r).toMatchObject({ ok: false, code: "no_access", error: "Could not change an event — you don't have permission (needs events.manage)." });
    expect(calls).toEqual([]);
  });

  it("refuses when the module is switched off", async () => {
    const r = await runCommand(ctxFor({ session: fakeSession({ permissions: MANAGER, modulesOff: ["events"] }) }), "events.look", {});
    expect(r).toMatchObject({ ok: false, code: "module_off" });
    expect(calls).toEqual([]);
  });

  it("keeps a confirm command out of Niva's hands until the community switches it on", async () => {
    const off = await runCommand(ctxFor({ via: "assistant" }), "events.change", { name: "X" });
    expect(off).toMatchObject({ ok: false, code: "switched_off" });
    expect((off as { error: string }).error).toMatch(/not set up to change an event for Jain Society/);
    const session = fakeSession({ permissions: MANAGER, center: { ...fakeSession().center, rules: { assistant: { tools: { "events.change": true } } } } });
    const on = await runCommand(ctxFor({ via: "assistant", session }), "events.change", { name: "X" });
    expect(on).toMatchObject({ ok: true, needsConfirmation: true });
  });

  it("says what is wrong with the input, in a sentence, and does not run", async () => {
    const r = await runCommand(ctxFor(), "events.look", { q: "x".repeat(21) });
    expect(r).toMatchObject({ ok: false, code: "invalid", error: "Could not look at events — q can be at most 20 characters." });
    const unknown = await runCommand(ctxFor(), "events.look", { person_id: "abc" });
    expect(unknown).toMatchObject({ ok: false, code: "invalid" });
    expect(calls).toEqual([]);
  });

  it("never runs an only-you action; it says where the person does it", async () => {
    const r = await runCommand(ctxFor(), "settings.token", {});
    expect(r).toMatchObject({ ok: false, code: "only_you", onlyYou: { href: "/settings/texting" } });
    expect((r as { error: string }).error).toContain("something only you can do");
    expect(calls).toEqual([]);
  });
});

describe("runCommand: errors in plain English", () => {
  it("explains a database error and logs the detail", async () => {
    const r = await runCommand(ctxFor(), "events.look", { q: "boom" });
    expect(r).toMatchObject({ ok: false, code: "failed", error: "Could not look at events — you don't have permission to make this change." });
    expect(console.error).toHaveBeenCalled();
  });

  it("names the step that failed", async () => {
    const r = await runCommand(ctxFor(), "events.look", { q: "db" });
    expect(r).toMatchObject({ ok: false, error: "Could not read the events — the record was not found, or you can't see it." });
  });

  it("shows a problem the command itself explained, as it is", async () => {
    expect(await runCommand(ctxFor(), "events.look", { q: "said" })).toMatchObject({ ok: false, error: "That event was not found." });
  });

  it("returns a fresh-2FA request for the security window, not an error to read", async () => {
    const r = await runCommand(ctxFor(), "events.look", { q: "stepup" });
    expect(r).toMatchObject({ ok: false, code: "needs_step_up", needsStepUp: true, stepUp: true });
  });

  it("converts to an ActionResult for a Server Action", async () => {
    expect(toActionResult(await runCommand(ctxFor(), "events.look", {}))).toEqual({ ok: true, data: { q: null }, message: undefined });
    expect(toActionResult(await runCommand(ctxFor(), "events.look", { q: "stepup" }))).toMatchObject({ ok: false, stepUp: true });
    expect(toActionResult(await runCommand(ctxFor(), "events.change", { name: "X" }))).toMatchObject({ ok: false });
  });
});

describe("a confirm command: propose, confirm, execute", () => {
  it("does not run when asked; it records a proposal with what will happen", async () => {
    const ctx = ctxFor();
    const r = await runCommand(ctx, "events.change", { name: "Diwali 2026" });
    expect(calls).toEqual([]);
    expect(r).toMatchObject({
      ok: true,
      needsConfirmation: true,
      confirmText: "Yes, rename it",
      preview: { summary: "Rename to Diwali 2026.", lines: [{ label: "Name", before: "Old", after: "Diwali 2026" }] },
    });
    const ticket = r as { proposalId: string; inputHash: string; expiresAt: string | null };
    expect(ticket.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ticket.expiresAt).toBe("2026-10-10T15:15:00.000Z");
    expect(ctx.proposals.records.get(ticket.proposalId)).toMatchObject({ command: "events.change", status: "pending", userId: "user-1", centerId: "center-1" });
  });

  it("runs once the person confirms that exact proposal, and records how it went", async () => {
    const ctx = ctxFor();
    const t = (await runCommand(ctx, "events.change", { name: "Diwali 2026" })) as { proposalId: string; inputHash: string };
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r).toEqual({ ok: true, data: { name: "Diwali 2026" }, message: "Renamed." });
    expect(calls).toEqual(["change:Diwali 2026"]);
    expect(ctx.proposals.records.get(t.proposalId)).toMatchObject({ status: "executed", summary: "Renamed.", correlation: "req-1" });
  });

  it("works only once", async () => {
    const ctx = ctxFor();
    const t = (await runCommand(ctx, "events.change", { name: "A" })) as { proposalId: string; inputHash: string };
    await confirmProposal(ctx, t.proposalId, t.inputHash);
    const again = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(again).toMatchObject({ ok: false, code: "proposal_failed" });
    expect((again as { error: string }).error).toMatch(/already used/);
    expect(calls).toEqual(["change:A"]);
  });

  it("refuses a hash that is not the one proposed, and the proposal is spent", async () => {
    const ctx = ctxFor();
    const t = (await runCommand(ctx, "events.change", { name: "A" })) as { proposalId: string; inputHash: string };
    const wrong = await confirmProposal(ctx, t.proposalId, "0".repeat(64));
    expect((wrong as { error: string }).error).toMatch(/details changed/);
    const right = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(right).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("gives a different hash to a different request", async () => {
    const ctx = ctxFor();
    const a = (await runCommand(ctx, "events.change", { name: "A" })) as { inputHash: string };
    const b = (await runCommand(ctx, "events.change", { name: "B" })) as { inputHash: string };
    const a2 = (await runCommand(ctx, "events.change", { name: "A" })) as { inputHash: string };
    expect(a.inputHash).not.toBe(b.inputHash);
    expect(a.inputHash).toBe(a2.inputHash);
  });

  it("refuses an expired confirmation", async () => {
    let now = new Date("2026-10-10T15:00:00Z");
    const clock = () => now;
    const ctx = ctxFor({ now: clock, proposals: new InMemoryProposalStore({ now: clock }) });
    const t = (await runCommand(ctx, "events.change", { name: "A" })) as { proposalId: string; inputHash: string };
    now = new Date("2026-10-10T15:16:00Z");
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: false, code: "proposal_failed" });
    expect((r as { error: string }).error).toMatch(/expired/);
    expect(calls).toEqual([]);
  });

  it("belongs to the person who was asked", async () => {
    const ctx = ctxFor();
    const t = (await runCommand(ctx, "events.change", { name: "A" })) as { proposalId: string; inputHash: string };
    const other = { ...ctx, session: fakeSession({ permissions: MANAGER, userId: "user-2" }) };
    const r = await confirmProposal(other, t.proposalId, t.inputHash);
    expect((r as { error: string }).error).toMatch(/belongs to someone else/);
    expect(calls).toEqual([]);
  });

  it("checks the permission again when it is confirmed", async () => {
    const ctx = ctxFor();
    const t = (await runCommand(ctx, "events.change", { name: "A" })) as { proposalId: string; inputHash: string };
    const revoked = { ...ctx, session: fakeSession({ permissions: ["events.view"] }) };
    const r = await confirmProposal(revoked, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: false, code: "no_access" });
    expect(calls).toEqual([]);
    expect(ctx.proposals.records.get(t.proposalId)?.status).toBe("failed");
  });

  it("will not run a proposal made for another community", async () => {
    const ctx = ctxFor();
    const t = (await runCommand(ctx, "events.change", { name: "A" })) as { proposalId: string; inputHash: string };
    const elsewhere = { ...ctx, session: fakeSession({ permissions: MANAGER, center: { ...fakeSession().center, id: "center-2" } }) };
    const r = await confirmProposal(elsewhere, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: false, code: "wrong_community" });
    expect(calls).toEqual([]);
  });

  it("checks the stored input again before running", async () => {
    const ctx = ctxFor();
    const ticket = await ctx.proposals.propose({ centerId: "center-1", userId: "user-1", command: "events.change", input: { name: "x".repeat(80) }, preview: { summary: "s", lines: [] } });
    const r = await confirmProposal(ctx, ticket.proposalId, ticket.inputHash);
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect(calls).toEqual([]);
  });

  it("returns a fresh proposal when the database asks for a security code, so the person can confirm again", async () => {
    const ctx = ctxFor();
    stepUpOnce = true;
    const t = (await runCommand(ctx, "events.change", { name: "A" })) as { proposalId: string; inputHash: string };
    const first = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(first).toMatchObject({ ok: false, code: "needs_step_up", needsStepUp: true });
    const retry = (first as { retry: { proposalId: string; inputHash: string } }).retry;
    expect(retry.proposalId).not.toBe(t.proposalId);
    expect(ctx.proposals.records.get(t.proposalId)?.status).toBe("failed");
    const second = await confirmProposal(ctx, retry.proposalId, retry.inputHash);
    expect(second).toEqual({ ok: true, data: { name: "A" }, message: "Renamed." });
    expect(calls).toEqual(["change:A", "change:A"]);
  });

  it("lets the person turn it down, and then it cannot run", async () => {
    const ctx = ctxFor();
    const t = (await runCommand(ctx, "events.change", { name: "A" })) as { proposalId: string; inputHash: string };
    expect(await rejectProposal(ctx, t.proposalId)).toEqual({ ok: true });
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect((r as { error: string }).error).toMatch(/turned down/);
    expect(calls).toEqual([]);
  });

  it("says when it could not record the proposal", async () => {
    const ctx = ctxFor();
    ctx.proposals.propose = async () => {
      throw new Error("db down");
    };
    const r = await runCommand(ctx, "events.change", { name: "A" });
    expect(r).toMatchObject({ ok: false, code: "proposal_failed" });
    expect((r as { error: string }).error).toMatch(/^Could not prepare to change an event — /);
  });
});

describe("what a model may see", () => {
  const assistant = (over: Parameters<typeof testContext>[0] = {}) => ctxFor({ via: "assistant", minorNames: ["Zoya Shah"], ...over });

  it("is cleaned of secrets and of children; adults and ordinary codes stay", async () => {
    const r = await runCommand(assistant(), "events.look", { q: "leaky" });
    expect(r.ok).toBe(true);
    const data = (r as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("sandbox_code");
    expect(data).not.toHaveProperty("invitation_link");
    expect(data).not.toHaveProperty("children");
    expect(data.postal_code).toBe("60540");
    expect(String(data.note)).toContain("Priya Shah");
    expect(String(data.note)).not.toContain("Zoya Shah");
    expect(String(data.note)).not.toContain("abc123def456");
    expect(JSON.stringify(data)).not.toMatch(/ABCD-1234|AbCdEf|2018-05-05/);
  });

  it("is left alone for a person on the screen", async () => {
    const r = await runCommand(ctxFor({ via: "screen", minorNames: ["Zoya Shah"] }), "events.look", { q: "leaky" });
    const data = (r as { data: Record<string, unknown> }).data;
    expect(data.sandbox_code).toBe("ABCD-1234");
    expect(String(data.note)).toContain("Zoya Shah");
  });

  it("is withheld when children cannot be checked for", async () => {
    const noSource = { ...assistant(), minors: undefined };
    expect(await runCommand(noSource, "events.look", {})).toMatchObject({ ok: false, code: "unsafe_result" });
    const broken = { ...assistant(), minors: { namesOfMinors: async () => Promise.reject(new Error("db down")) } };
    const r = await runCommand(broken, "events.look", {});
    expect(r).toMatchObject({ ok: false, code: "unsafe_result" });
    expect((r as { error: string }).error).toMatch(/could not check this answer for children's records/);
  });

  it("also cleans the sentences it is told about a failure", async () => {
    const ctx = assistant();
    ctx.registry.register(
      defineCommand({
        key: "events.fail",
        title: "Fail on purpose",
        description: "Fails.",
        level: "read",
        permission: "events",
        input: object({}),
        async execute() {
          throw new CommandError("Could not find the record of Zoya Shah.");
        },
      }),
    );
    const r = await runCommand(ctx, "events.fail", {});
    expect((r as { error: string }).error).not.toContain("Zoya Shah");
  });

  it("shows a model a cleaned preview while the person is shown the real one", async () => {
    const session = fakeSession({ permissions: MANAGER, center: { ...fakeSession().center, rules: { assistant: { tools: { "events.change": true } } } } });
    const ctx = assistant({ session });
    const r = (await runCommand(ctx, "events.change", { name: "Party for Zoya Shah" })) as { preview: { summary: string }; proposalId: string };
    expect(r.preview.summary).not.toContain("Zoya Shah");
    expect(ctx.proposals.records.get(r.proposalId)?.preview.summary).toContain("Zoya Shah");
  });

  it("runs a confirmed action as the assistant and cleans what comes back", async () => {
    const session = fakeSession({ permissions: MANAGER, center: { ...fakeSession().center, rules: { assistant: { tools: { "events.change": true } } } } });
    const ctx = assistant({ session });
    const t = (await runCommand(ctx, "events.change", { name: "Zoya Shah party" })) as { proposalId: string; inputHash: string };
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain("Zoya Shah");
  });
});

describe("the record of a call (the activity recorder plugs in here)", () => {
  const last = (): CommandEvent => hook.mock.calls[hook.mock.calls.length - 1][0];

  it("sends one event per call with the role, the way in, the outcome and the time taken", async () => {
    await runCommand(ctxFor({ via: "palette" }), "events.look", { q: "secret-looking value" });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(last()).toMatchObject({
      key: "events.look",
      level: "read",
      via: "palette",
      outcome: "ok",
      centerId: "center-1",
      userId: "user-1",
      personId: "person-1",
      roles: ["event_manager"],
      requestId: "req-1",
      inputKeys: ["q"],
    });
    expect(last().durationMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(last().at)).not.toBeNaN();
  });

  it("carries the names of the values given, never the values", async () => {
    await runCommand(ctxFor(), "events.look", { q: "secret-looking value" });
    expect(JSON.stringify(last())).not.toContain("secret-looking value");
  });

  it("says what came of a refusal, an invalid input and a failure", async () => {
    await runCommand(ctxFor({ session: fakeSession({ permissions: [] }) }), "events.look", {});
    expect(last()).toMatchObject({ outcome: "denied", code: "no_access" });
    await runCommand(ctxFor(), "events.look", { q: "x".repeat(30) });
    expect(last()).toMatchObject({ outcome: "invalid", code: "invalid" });
    await runCommand(ctxFor(), "events.look", { q: "boom" });
    expect(last()).toMatchObject({ outcome: "failed" });
    await runCommand(ctxFor(), "events.look", { q: "stepup" });
    expect(last()).toMatchObject({ outcome: "needs_step_up" });
    await runCommand(ctxFor(), "nope.nothing", {});
    expect(last()).toMatchObject({ outcome: "denied", code: "unknown_command", level: null });
  });

  it("records a proposal, and its confirmation, with the proposal id", async () => {
    const ctx = ctxFor();
    const t = (await runCommand(ctx, "events.change", { name: "A" })) as { proposalId: string; inputHash: string };
    expect(last()).toMatchObject({ outcome: "proposed", level: "confirm", proposalId: t.proposalId });
    await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(last()).toMatchObject({ outcome: "confirmed", key: "events.change", proposalId: t.proposalId });
  });

  it("never lets a failing recorder break the action", async () => {
    hook.mockImplementation(() => {
      throw new Error("recorder down");
    });
    expect(await runCommand(ctxFor(), "events.look", {})).toEqual({ ok: true, data: { q: null } });
  });
});
