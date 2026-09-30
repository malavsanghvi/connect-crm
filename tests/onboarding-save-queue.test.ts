import { describe, expect, it, vi } from "vitest";

import type { SavePatch } from "@/lib/onboarding/progress";
import { SaveQueue, type Send, type SaveStatus, type SendResult } from "@/lib/onboarding/save-queue";

type Call = { id: string; version: number; patch: SavePatch; resolve: (r: SendResult) => void };

/** A send whose answers the test controls, so races can be staged. */
function harness() {
  const calls: Call[] = [];
  const statuses: SaveStatus["kind"][] = [];
  const send: Send = (input) =>
    new Promise<SendResult>((resolve) => {
      calls.push({ ...input, resolve });
    });
  const queue = new SaveQueue(send, (s) => statuses.push(s.kind));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { calls, statuses, queue, tick };
}

const ok = (version: number): SendResult => ({ ok: true, data: { version } });

describe("the save queue", () => {
  it("sends a save with the draft's id and version, then uses the version the server returns", async () => {
    const h = harness();
    h.queue.attach("d1", 5);
    const first = h.queue.save({ stage: "members" });
    await h.tick();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ id: "d1", version: 5, patch: { stage: "members" } });
    h.calls[0]!.resolve(ok(6));
    expect(await first).toBe(true);
    const second = h.queue.save({ stage: "family" });
    await h.tick();
    expect(h.calls[1]).toMatchObject({ version: 6 });
    h.calls[1]!.resolve(ok(7));
    expect(await second).toBe(true);
    expect(h.statuses).toEqual(["idle", "saving", "saved", "saving", "saved"]);
  });

  it("a burst of changes while one save is in flight goes out as a single save", async () => {
    const h = harness();
    h.queue.attach("d1", 1);
    const a = h.queue.save({ answers: { q1: "merge" }, state: { qi: 1 } });
    await h.tick();
    // Three quick answers while the first save has not come back.
    void h.queue.save({ answers: { q2: "separate" }, state: { qi: 2 } });
    void h.queue.save({ answers: { q3: "merge" }, state: { qi: 3 } });
    const last = h.queue.save({ answers: { q2: null }, state: { qi: 4 } });
    expect(h.calls).toHaveLength(1);
    h.calls[0]!.resolve(ok(2));
    await h.tick();
    // The queue carries on by itself with everything that arrived meanwhile, as ONE save.
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toMatchObject({ version: 2, patch: { answers: { q2: null, q3: "merge" }, state: { qi: 4 } } });
    h.calls[1]!.resolve(ok(3));
    // Every caller's promise resolves once everything queued so far is saved.
    expect(await Promise.all([a, last])).toEqual([true, true]);
    expect(h.calls).toHaveLength(2);
  });

  it("a failed save is reported, keeps what it had not saved, and is sent again with the next change", async () => {
    const h = harness();
    h.queue.attach("d1", 1);
    const a = h.queue.save({ answers: { q1: "merge" } });
    await h.tick();
    h.calls[0]!.resolve({ ok: false, error: "Could not save your progress — the database could not be reached." });
    expect(await a).toBe(false);
    expect(h.statuses.at(-1)).toBe("failed");
    // The owner goes on answering: the failed answer is not lost.
    const b = h.queue.save({ answers: { q2: "separate" } });
    await h.tick();
    expect(h.calls[1]).toMatchObject({ version: 1, patch: { answers: { q1: "merge", q2: "separate" } } });
    h.calls[1]!.resolve(ok(2));
    expect(await b).toBe(true);
    expect(h.statuses.at(-1)).toBe("saved");
  });

  it("retry sends what failed; with nothing waiting it does nothing", async () => {
    const h = harness();
    h.queue.attach("d1", 1);
    const a = h.queue.save({ stage: "review" });
    await h.tick();
    h.calls[0]!.resolve({ ok: false, error: "x" });
    await a;
    const r = h.queue.retry();
    await h.tick();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.patch).toEqual({ stage: "review" });
    h.calls[1]!.resolve(ok(2));
    expect(await r).toBe(true);
    expect(await h.queue.retry()).toBe(true);
    expect(h.calls).toHaveLength(2);
  });

  it("a save that lost the race to someone else is reported as a conflict, not as a generic failure", async () => {
    const h = harness();
    h.queue.attach("d1", 1);
    const a = h.queue.save({ stage: "review" });
    await h.tick();
    h.calls[0]!.resolve({ ok: false, error: "Someone else changed this guided onboarding.", conflict: true });
    expect(await a).toBe(false);
    expect(h.statuses.at(-1)).toBe("conflict");
  });

  it("a call that throws (connection lost) never leaves the queue stuck", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const statuses: string[] = [];
    let n = 0;
    const q = new SaveQueue(async () => {
      n += 1;
      if (n === 1) throw new Error("network down");
      return ok(2);
    }, (s) => statuses.push(s.kind));
    q.attach("d1", 1);
    expect(await q.save({ stage: "review" })).toBe(false);
    expect(statuses.at(-1)).toBe("failed");
    expect(await q.retry()).toBe(true);
    expect(statuses.at(-1)).toBe("saved");
    spy.mockRestore();
  });

  it("while rows are written, saves wait, and the version the rows call returns is the one used next", async () => {
    const h = harness();
    h.queue.attach("d1", 1);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const writing = h.queue.exclusive(async (id, setVersion) => {
      expect(id).toBe("d1");
      await gate;
      setVersion(9);
      return "rows saved";
    });
    const held = h.queue.save({ state: { qi: 0 } });
    await h.tick();
    expect(h.calls).toHaveLength(0);
    release();
    expect(await writing).toBe("rows saved");
    await h.tick();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ version: 9, patch: { state: { qi: 0 } } });
    h.calls[0]!.resolve(ok(10));
    expect(await held).toBe(true);
  });

  it("exclusive waits for a save already in flight, and its error still releases the hold", async () => {
    const h = harness();
    h.queue.attach("d1", 1);
    const inflight = h.queue.save({ stage: "members" });
    await h.tick();
    let started = false;
    const writing = h.queue.exclusive(async () => {
      started = true;
      throw new Error("could not write the rows");
    });
    const caught = writing.catch((e: Error) => e.message);
    await h.tick();
    expect(started).toBe(false);
    h.calls[0]!.resolve(ok(2));
    await inflight;
    expect(await caught).toBe("could not write the rows");
    // The hold is gone: a later save goes out.
    const later = h.queue.save({ stage: "family" });
    await h.tick();
    expect(h.calls).toHaveLength(2);
    h.calls[1]!.resolve(ok(3));
    expect(await later).toBe(true);
  });

  it("nothing is sent before a draft is attached, or after it is detached", async () => {
    const h = harness();
    await h.queue.save({ stage: "review" });
    expect(h.calls).toHaveLength(0);
    h.queue.attach("d1", 1);
    void h.queue.save({ stage: "members" });
    await h.tick();
    expect(h.calls).toHaveLength(1);
    h.queue.detach();
    h.calls[0]!.resolve(ok(2));
    await h.tick();
    await h.queue.save({ stage: "family" });
    expect(h.calls).toHaveLength(1);
  });
});
