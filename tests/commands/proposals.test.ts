import { beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryProposalStore, ProposalError, canonicalJson, createRpcProposalStore, hashProposalInput } from "@/lib/commands/proposals";

import { fakeDb } from "./helpers";

const preview = { summary: "Do it.", lines: [] };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the input hash", () => {
  it("is the same for the same input whatever the order of its keys", () => {
    const a = hashProposalInput({ centerId: "c", command: "x.y", input: { a: 1, b: { c: [1, 2], d: "x" } } });
    const b = hashProposalInput({ centerId: "c", command: "x.y", input: { b: { d: "x", c: [1, 2] }, a: 1 } });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("changes with the input, the command and the community", () => {
    const base = { centerId: "c", command: "x.y", input: { a: 1 } };
    const h = hashProposalInput(base);
    expect(hashProposalInput({ ...base, input: { a: 2 } })).not.toBe(h);
    expect(hashProposalInput({ ...base, command: "x.z" })).not.toBe(h);
    expect(hashProposalInput({ ...base, centerId: "d" })).not.toBe(h);
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("the in-memory proposal store", () => {
  const base = { centerId: "c", userId: "u", command: "x.y", input: { a: 1 }, preview };

  it("keeps what was proposed even if the caller's object changes afterwards", async () => {
    const store = new InMemoryProposalStore();
    const input = { a: 1 };
    const t = await store.propose({ ...base, input });
    input.a = 99;
    expect(await store.confirm({ proposalId: t.proposalId, inputHash: t.inputHash, userId: "u" })).toEqual({ command: "x.y", input: { a: 1 }, centerId: "c" });
  });

  it("expires after 15 minutes", async () => {
    let now = new Date("2026-10-10T10:00:00Z");
    const store = new InMemoryProposalStore({ now: () => now });
    const t = await store.propose(base);
    expect(t.expiresAt).toBe("2026-10-10T10:15:00.000Z");
    now = new Date("2026-10-10T10:14:59Z");
    await expect(store.confirm({ proposalId: t.proposalId, inputHash: t.inputHash, userId: "u" })).resolves.toBeDefined();
    const second = await store.propose(base);
    now = new Date("2026-10-10T10:30:00Z");
    await expect(store.confirm({ proposalId: second.proposalId, inputHash: second.inputHash, userId: "u" })).rejects.toMatchObject({ code: "expired" });
  });

  it("can be used once, only by the person it was made for, and only with the right hash", async () => {
    const store = new InMemoryProposalStore();
    const t = await store.propose(base);
    await expect(store.confirm({ proposalId: t.proposalId, inputHash: t.inputHash, userId: "other" })).rejects.toMatchObject({ code: "not_yours" });
    await expect(store.confirm({ proposalId: "nope", inputHash: t.inputHash, userId: "u" })).rejects.toMatchObject({ code: "not_found" });
    await store.confirm({ proposalId: t.proposalId, inputHash: t.inputHash, userId: "u" });
    await expect(store.confirm({ proposalId: t.proposalId, inputHash: t.inputHash, userId: "u" })).rejects.toMatchObject({ code: "used" });
    const wrong = await store.propose(base);
    await expect(store.confirm({ proposalId: wrong.proposalId, inputHash: "f".repeat(64), userId: "u" })).rejects.toBeInstanceOf(ProposalError);
  });

  it("lets the person it was made for turn it down, once", async () => {
    const store = new InMemoryProposalStore();
    const t = await store.propose(base);
    await expect(store.reject({ proposalId: t.proposalId, userId: "other" })).rejects.toMatchObject({ code: "not_yours" });
    await store.reject({ proposalId: t.proposalId, userId: "u" });
    await expect(store.reject({ proposalId: t.proposalId, userId: "u" })).rejects.toMatchObject({ code: "used" });
  });
});

describe("the database proposal store", () => {
  const ticket = { proposal_id: "p1", input_hash: "h1", expires_at: "2026-10-10T10:15:00Z" };

  it("calls assistant_propose with the community, command, input, preview and thread", async () => {
    const db = fakeDb({ rpc: { assistant_propose: ticket } });
    const store = createRpcProposalStore(db);
    const t = await store.propose({ centerId: "c", userId: "u", command: "events.set_field", input: { venue: "Hall B" }, preview, thread: "t1" });
    expect(t).toEqual({ proposalId: "p1", inputHash: "h1", expiresAt: "2026-10-10T10:15:00Z" });
    expect(db.rpcCalls).toEqual([{ fn: "assistant_propose", args: { p_center: "c", p_command: "events.set_field", p_input: { venue: "Hall B" }, p_preview: preview, p_thread: "t1" } }]);
  });

  it("passes a null thread when there is none", async () => {
    const db = fakeDb({ rpc: { assistant_propose: ticket } });
    await createRpcProposalStore(db).propose({ centerId: "c", userId: "u", command: "a.b", input: {}, preview });
    expect(db.rpcCalls[0].args.p_thread).toBeNull();
  });

  it("calls assistant_confirm with the proposal and the hash, and reads command, input and community", async () => {
    const db = fakeDb({ rpc: { assistant_confirm: { ok: true, command: "events.set_field", input: { venue: "Hall B" }, center_id: "c" } } });
    const c = await createRpcProposalStore(db).confirm({ proposalId: "p1", inputHash: "h1", userId: "u" });
    expect(c).toEqual({ command: "events.set_field", input: { venue: "Hall B" }, centerId: "c" });
    expect(db.rpcCalls).toEqual([{ fn: "assistant_confirm", args: { p_proposal: "p1", p_input_hash: "h1" } }]);
  });

  it("calls assistant_finish and assistant_reject", async () => {
    const db = fakeDb({ rpc: { assistant_finish: null, assistant_reject: null } });
    const store = createRpcProposalStore(db);
    await store.finish({ proposalId: "p1", ok: true, summary: "Renamed.", correlation: "req-1" });
    await store.reject({ proposalId: "p1", userId: "u" });
    expect(db.rpcCalls).toEqual([
      { fn: "assistant_finish", args: { p_proposal: "p1", p_ok: true, p_summary: "Renamed.", p_correlation: "req-1" } },
      { fn: "assistant_reject", args: { p_proposal: "p1" } },
    ]);
  });

  it("turns the database's own sentence into the person's, and logs the detail", async () => {
    const db = fakeDb({ failRpc: { assistant_confirm: { code: "P0001", message: "This confirmation has expired." } } });
    await expect(createRpcProposalStore(db).confirm({ proposalId: "p1", inputHash: "h1", userId: "u" })).rejects.toThrow("Could not confirm this — This confirmation has expired.");
    expect(console.error).toHaveBeenCalled();
  });

  it("says confirmations are not available before the database update is applied", async () => {
    const db = fakeDb({ failRpc: { assistant_propose: { code: "PGRST202", message: "Could not find the function" } } });
    await expect(createRpcProposalStore(db).propose({ centerId: "c", userId: "u", command: "a.b", input: {}, preview })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("does not trust an answer it cannot read", async () => {
    const odd = fakeDb({ rpc: { assistant_propose: { nothing: true }, assistant_confirm: { ok: true, command: 5 } } });
    const store = createRpcProposalStore(odd);
    await expect(store.propose({ centerId: "c", userId: "u", command: "a.b", input: {}, preview })).rejects.toThrow(/does not understand/);
    await expect(store.confirm({ proposalId: "p", inputHash: "h", userId: "u" })).rejects.toThrow(/does not understand/);
    const refused = fakeDb({ rpc: { assistant_confirm: { ok: false, error: "it was already used" } } });
    await expect(createRpcProposalStore(refused).confirm({ proposalId: "p", inputHash: "h", userId: "u" })).rejects.toThrow("Could not confirm this — it was already used");
  });
});
