import { describe, expect, it } from "vitest";

import { isRetryable } from "../src/errors";
import { HANDLERS } from "../src/handlers";
import * as notify from "../src/handlers/homework.publish_notify";
import { createRegistry, readiness } from "../src/runner";
import type { JobContext } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

const A = "11111111-1111-4111-8111-111111111111";

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

describe("homework.publish_notify", () => {
  it("is a job of its own in the registry, queued by the database (not scheduled), and needs no provider keys", () => {
    expect(notify.kind).toBe("homework.publish_notify");
    const mod = HANDLERS.find((h) => h.kind === "homework.publish_notify");
    expect(mod).toBeDefined();
    expect(mod?.every).toBeUndefined();
    expect(readiness(createRegistry(HANDLERS), {})["homework.publish_notify"]).toEqual({ configured: true });
  });

  it("pages through the learners with offset and limit until the database says it is done, and adds the batches up", async () => {
    const { ctx, calls, lines } = scripted([
      { total: 120, offset: 0, limit: 50, learners: 50, messages: 150, skipped: 0, done: false },
      { total: 120, offset: 50, limit: 50, learners: 50, messages: 148, skipped: 0, done: false },
      { total: 120, offset: 100, limit: 50, learners: 20, messages: 59, skipped: 0, done: true },
    ]);
    const out = await notify.run(job({ kind: notify.kind, payload: { assignment_id: A } }), ctx);
    expect(out).toEqual({ assignment_id: A, batches: 3, learners: 120, messages: 357, skipped: 0 });
    const q = queries(calls);
    expect(q).toHaveLength(3);
    expect(q.map((c) => c.args[1])).toEqual([[A, 0, 50], [A, 50, 50], [A, 100, 50]]);
    expect(String(q[0]?.args[0])).toBe("select app.worker_homework_publish_notify($1::uuid, $2::int, $3::int) as result");
    expect(lines.find((l) => String(l.msg).includes("homework.publish_notify"))).toMatchObject({ level: "info", batches: 3, learners: 120, messages: 357, assignment_id: A });
  });

  it("a retried job skips the learners already told and still finishes", async () => {
    const { ctx } = scripted([
      { total: 60, learners: 50, messages: 0, skipped: 50, done: false },
      { total: 60, learners: 10, messages: 31, skipped: 0, done: true },
    ]);
    expect(await notify.run(job({ kind: notify.kind, payload: { assignment_id: A } }), ctx)).toEqual({ assignment_id: A, batches: 2, learners: 60, messages: 31, skipped: 50 });
  });

  it("does one call for a small class, and none of the learners again when homework is gone or no longer published", async () => {
    const small = scripted([{ total: 1, learners: 1, messages: 4, skipped: 0, done: true }]);
    expect(await notify.run(job({ kind: notify.kind, payload: { assignment_id: A } }), small.ctx)).toMatchObject({ batches: 1, learners: 1, messages: 4 });
    expect(queries(small.calls)).toHaveLength(1);
    const gone = scripted([{ total: 0, offset: 0, limit: 0, learners: 0, messages: 0, skipped: 0, done: true, reason: "The homework is no longer published." }]);
    expect(await notify.run(job({ kind: notify.kind, payload: { assignment_id: A } }), gone.ctx)).toEqual({
      assignment_id: A, batches: 1, learners: 0, messages: 0, skipped: 0, reason: "The homework is no longer published.",
    });
  });

  it("never loops on an odd answer: a missing result or an empty page ends the job", async () => {
    const odd = scripted([]);
    expect(await notify.run(job({ kind: notify.kind, payload: { assignment_id: A } }), odd.ctx)).toEqual({ assignment_id: A, batches: 1, learners: 0, messages: 0, skipped: 0 });
    const weird = scripted([{ learners: "x", messages: -3, skipped: null, done: "no" }]);
    expect(await notify.run(job({ kind: notify.kind, payload: { assignment_id: A } }), weird.ctx)).toEqual({ assignment_id: A, batches: 1, learners: 0, messages: 0, skipped: 0 });
  });

  it("takes a smaller batch from the payload, within 1 to 200", async () => {
    const a = scripted([{ learners: 1, done: true }]);
    await notify.run(job({ kind: notify.kind, payload: { assignment_id: A, batch: 5 } }), a.ctx);
    expect(queries(a.calls)[0]?.args[1]).toEqual([A, 0, 5]);
    const b = scripted([{ learners: 1, done: true }]);
    await notify.run(job({ kind: notify.kind, payload: { assignment_id: A, batch: 9999 } }), b.ctx);
    expect(queries(b.calls)[0]?.args[1]).toEqual([A, 0, 200]);
    const c = scripted([{ learners: 1, done: true }]);
    await notify.run(job({ kind: notify.kind, payload: { assignment_id: A, batch: 0 } }), c.ctx);
    expect(queries(c.calls)[0]?.args[1]).toEqual([A, 0, 1]);
  });

  it("refuses a job with no usable assignment id for good: retrying cannot help", async () => {
    for (const payload of [{}, { assignment_id: 5 }, { assignment_id: "not-a-uuid" }]) {
      const { ctx, calls } = scripted([]);
      const err = await notify.run(job({ kind: notify.kind, payload }), ctx).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(isRetryable(err)).toBe(false);
      expect(queries(calls)).toHaveLength(0);
    }
  });

  it("lets a database error fail the job so the runner retries it (the database skips whoever was told)", async () => {
    const { db } = fakeDb({
      query: () => {
        throw new Error("connection reset");
      },
    });
    const { log } = captureLog();
    const err = await notify.run(job({ kind: notify.kind, payload: { assignment_id: A } }), { db, log } as unknown as JobContext).catch((e: unknown) => e);
    expect(String(err)).toMatch(/connection reset/);
    expect(isRetryable(err)).toBe(true);
  });

  it("stops a runaway database with a retryable error instead of looping for ever", async () => {
    const { db } = fakeDb({ query: () => [{ result: { total: 999999, learners: 50, messages: 0, skipped: 50, done: false } }] });
    const { log } = captureLog();
    const err = await notify.run(job({ kind: notify.kind, payload: { assignment_id: A } }), { db, log } as unknown as JobContext).catch((e: unknown) => e);
    expect(String(err)).toMatch(/there are more; the job will run again/);
    expect(isRetryable(err)).toBe(true);
  });
});
