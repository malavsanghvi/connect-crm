import { describe, expect, it } from "vitest";

import { isRetryable } from "../src/errors";
import { HANDLERS } from "../src/handlers";
import * as notify from "../src/handlers/surveys.launch_notify";
import { createRegistry, readiness } from "../src/runner";
import type { JobContext } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

const S = "22222222-2222-4222-8222-222222222222";

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

describe("surveys.launch_notify", () => {
  it("is a job of its own in the registry, queued by the database (not scheduled), and needs no provider keys", () => {
    expect(notify.kind).toBe("surveys.launch_notify");
    const mod = HANDLERS.find((h) => h.kind === "surveys.launch_notify");
    expect(mod).toBeDefined();
    expect(mod?.every).toBeUndefined();
    expect(readiness(createRegistry(HANDLERS), {})["surveys.launch_notify"]).toEqual({ configured: true });
  });

  it("calls the batch function until the database says it is done, and adds the batches up", async () => {
    const { ctx, calls, lines } = scripted([
      { done: false, processed: 200, pushed: 198, refused: 2 },
      { done: false, processed: 200, pushed: 200, refused: 0 },
      { done: true, processed: 37, pushed: 37, refused: 0 },
    ]);
    const out = await notify.run(job({ kind: notify.kind, payload: { survey_id: S } }), ctx);
    expect(out).toEqual({ survey_id: S, batches: 3, processed: 437, pushed: 435, refused: 2 });
    const q = queries(calls);
    expect(q).toHaveLength(3);
    expect(q.map((c) => c.args[1])).toEqual([[S, 200], [S, 200], [S, 200]]);
    expect(String(q[0]?.args[0])).toBe("select app.worker_survey_launch_notify($1::uuid, $2::int) as result");
    expect(lines.find((l) => String(l.msg).includes("surveys.launch_notify"))).toMatchObject({ level: "info", batches: 3, processed: 437, pushed: 435, survey_id: S });
  });

  it("a retried or doubled job finds everyone handled and finishes at once", async () => {
    const { ctx, calls } = scripted([{ done: true, processed: 0, pushed: 0, refused: 0, reason: "Its pushes are finished." }]);
    expect(await notify.run(job({ kind: notify.kind, payload: { survey_id: S } }), ctx)).toEqual({
      survey_id: S, batches: 1, processed: 0, pushed: 0, refused: 0, reason: "Its pushes are finished.",
    });
    expect(queries(calls)).toHaveLength(1);
  });

  it("says why nothing went when the survey closed, opens later or nobody gets a push", async () => {
    const closed = scripted([{ done: true, processed: 0, pushed: 0, refused: 0, reason: "The survey is closed." }]);
    expect(await notify.run(job({ kind: notify.kind, payload: { survey_id: S } }), closed.ctx)).toMatchObject({ batches: 1, reason: "The survey is closed." });
  });

  it("never loops on an odd answer: a missing result or a batch that handled nobody ends the job", async () => {
    const odd = scripted([]);
    expect(await notify.run(job({ kind: notify.kind, payload: { survey_id: S } }), odd.ctx)).toEqual({ survey_id: S, batches: 1, processed: 0, pushed: 0, refused: 0 });
    const weird = scripted([{ processed: "x", pushed: -3, refused: null, done: "no" }]);
    expect(await notify.run(job({ kind: notify.kind, payload: { survey_id: S } }), weird.ctx)).toEqual({ survey_id: S, batches: 1, processed: 0, pushed: 0, refused: 0 });
  });

  it("takes a smaller batch from the payload, within 1 to 200", async () => {
    const a = scripted([{ processed: 1, done: true }]);
    await notify.run(job({ kind: notify.kind, payload: { survey_id: S, batch: 5 } }), a.ctx);
    expect(queries(a.calls)[0]?.args[1]).toEqual([S, 5]);
    const b = scripted([{ processed: 1, done: true }]);
    await notify.run(job({ kind: notify.kind, payload: { survey_id: S, batch: 9999 } }), b.ctx);
    expect(queries(b.calls)[0]?.args[1]).toEqual([S, 200]);
  });

  it("refuses a job without a survey, for good", async () => {
    const { ctx } = scripted([]);
    const err = await notify.run(job({ kind: notify.kind, payload: {} }), ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toMatch(/needs the survey's survey_id/);
    expect(isRetryable(err)).toBe(false);
  });

  it("stops after too many batches with an error the queue retries (the database skips everyone already handled)", async () => {
    const many = scripted(Array.from({ length: notify.MAX_BATCHES + 5 }, () => ({ done: false, processed: 1, pushed: 1, refused: 0 })));
    const err = await notify.run(job({ kind: notify.kind, payload: { survey_id: S } }), many.ctx).catch((e: unknown) => e);
    expect(String((err as Error).message)).toMatch(/the job will run again to finish/);
    expect(isRetryable(err)).toBe(true);
  });
});
