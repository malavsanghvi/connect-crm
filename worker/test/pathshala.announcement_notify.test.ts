import { describe, expect, it } from "vitest";

import { isRetryable } from "../src/errors";
import { HANDLERS } from "../src/handlers";
import * as notify from "../src/handlers/pathshala.announcement_notify";
import { createRegistry, readiness } from "../src/runner";
import type { JobContext } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

const A = "22222222-2222-4222-8222-222222222222";

type Batch = Record<string, unknown>;

/** A database that answers each call of the batch function from a script, and records the parameters. */
function scripted(batches: Batch[]) {
  const queue = [...batches];
  const { db, calls } = fakeDb({ query: () => [{ result: queue.shift() ?? null }] });
  const { log, lines } = captureLog();
  const ctx = { db, log } as unknown as JobContext;
  return { ctx, calls, lines, left: () => queue.length };
}

const queries = (calls: { fn: string; args: unknown[] }[]) => calls.filter((c) => c.fn === "query");
const zero = { batches: 1, people: 0, pushed: 0, skipped: 0, unreachable: 0, refused: 0 };

describe("pathshala.announcement_notify", () => {
  it("is a job of its own in the registry, queued by the database (not scheduled), and needs no provider keys", () => {
    expect(notify.kind).toBe("pathshala.announcement_notify");
    const mod = HANDLERS.find((h) => h.kind === "pathshala.announcement_notify");
    expect(mod).toBeDefined();
    expect(mod?.every).toBeUndefined();
    expect(readiness(createRegistry(HANDLERS), {})["pathshala.announcement_notify"]).toEqual({ configured: true });
  });

  it("pages through the recipients with offset and limit until the database says it is done, and adds the batches up", async () => {
    const { ctx, calls, lines } = scripted([
      { total: 230, offset: 0, limit: 100, people: 100, pushed: 80, skipped: 0, unreachable: 20, refused: 0, done: false },
      { total: 230, offset: 100, limit: 100, people: 100, pushed: 70, skipped: 0, unreachable: 25, refused: 5, done: false },
      { total: 230, offset: 200, limit: 100, people: 30, pushed: 25, skipped: 0, unreachable: 5, refused: 0, done: true },
    ]);
    const out = await notify.run(job({ kind: notify.kind, payload: { announcement_id: A } }), ctx);
    expect(out).toEqual({ announcement_id: A, batches: 3, people: 230, pushed: 175, skipped: 0, unreachable: 50, refused: 5 });
    const q = queries(calls);
    expect(q).toHaveLength(3);
    expect(q.map((c) => c.args[1])).toEqual([[A, 0, 100], [A, 100, 100], [A, 200, 100]]);
    expect(String(q[0]?.args[0])).toBe("select app.worker_pathshala_announcement_notify($1::uuid, $2::int, $3::int) as result");
    expect(lines.find((l) => String(l.msg).includes("pathshala.announcement_notify"))).toMatchObject({ level: "info", batches: 3, people: 230, pushed: 175, announcement_id: A });
  });

  it("a retried job skips the people already handled and still finishes", async () => {
    const { ctx } = scripted([
      { total: 120, people: 100, pushed: 0, skipped: 100, done: false },
      { total: 120, people: 20, pushed: 18, skipped: 0, unreachable: 2, done: true },
    ]);
    expect(await notify.run(job({ kind: notify.kind, payload: { announcement_id: A } }), ctx)).toEqual({
      announcement_id: A, batches: 2, people: 120, pushed: 18, skipped: 100, unreachable: 2, refused: 0,
    });
  });

  it("does one call for a small class, and nobody when the announcement is gone or no longer published", async () => {
    const small = scripted([{ total: 2, people: 2, pushed: 2, done: true }]);
    expect(await notify.run(job({ kind: notify.kind, payload: { announcement_id: A } }), small.ctx)).toMatchObject({ batches: 1, people: 2, pushed: 2 });
    expect(queries(small.calls)).toHaveLength(1);
    const gone = scripted([{ total: 0, people: 0, pushed: 0, done: true, reason: "The announcement is no longer published." }]);
    expect(await notify.run(job({ kind: notify.kind, payload: { announcement_id: A } }), gone.ctx)).toEqual({
      announcement_id: A, ...zero, reason: "The announcement is no longer published.",
    });
  });

  it("never loops on an odd answer: a missing result or an empty page ends the job", async () => {
    const odd = scripted([]);
    expect(await notify.run(job({ kind: notify.kind, payload: { announcement_id: A } }), odd.ctx)).toEqual({ announcement_id: A, ...zero });
    const weird = scripted([{ people: "x", pushed: -3, skipped: null, done: "no" }]);
    expect(await notify.run(job({ kind: notify.kind, payload: { announcement_id: A } }), weird.ctx)).toEqual({ announcement_id: A, ...zero });
  });

  it("takes a smaller batch from the payload, within 1 to 200", async () => {
    const a = scripted([{ people: 1, done: true }]);
    await notify.run(job({ kind: notify.kind, payload: { announcement_id: A, batch: 5 } }), a.ctx);
    expect(queries(a.calls)[0]?.args[1]).toEqual([A, 0, 5]);
    const b = scripted([{ people: 1, done: true }]);
    await notify.run(job({ kind: notify.kind, payload: { announcement_id: A, batch: 9999 } }), b.ctx);
    expect(queries(b.calls)[0]?.args[1]).toEqual([A, 0, 200]);
    const c = scripted([{ people: 1, done: true }]);
    await notify.run(job({ kind: notify.kind, payload: { announcement_id: A, batch: 0 } }), c.ctx);
    expect(queries(c.calls)[0]?.args[1]).toEqual([A, 0, 1]);
  });

  it("refuses a job with no usable announcement id for good: retrying cannot help", async () => {
    for (const payload of [{}, { announcement_id: 5 }, { announcement_id: "not-a-uuid" }]) {
      const { ctx, calls } = scripted([]);
      const err = await notify.run(job({ kind: notify.kind, payload }), ctx).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(isRetryable(err)).toBe(false);
      expect(queries(calls)).toHaveLength(0);
    }
  });

  it("lets a database error fail the job so the runner retries it (the database skips whoever was handled)", async () => {
    const { db } = fakeDb({
      query: () => {
        throw new Error("connection reset");
      },
    });
    const { log } = captureLog();
    const err = await notify.run(job({ kind: notify.kind, payload: { announcement_id: A } }), { db, log } as unknown as JobContext).catch((e: unknown) => e);
    expect(String(err)).toMatch(/connection reset/);
    expect(isRetryable(err)).toBe(true);
  });

  it("stops a runaway database with a retryable error instead of looping for ever", async () => {
    const { db } = fakeDb({ query: () => [{ result: { total: 999999, people: 100, pushed: 0, skipped: 100, done: false } }] });
    const { log } = captureLog();
    const err = await notify.run(job({ kind: notify.kind, payload: { announcement_id: A } }), { db, log } as unknown as JobContext).catch((e: unknown) => e);
    expect(String(err)).toMatch(/there are more; the job will run again/);
    expect(isRetryable(err)).toBe(true);
  });
});
