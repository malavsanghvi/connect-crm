import { describe, expect, it } from "vitest";

import { HANDLERS } from "../src/handlers";
import * as sweep from "../src/handlers/care.week_sweep";
import { readiness, createRegistry } from "../src/runner";
import type { JobContext } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

function scripted(answers: unknown[]) {
  const queue = [...answers];
  const { db, calls } = fakeDb({ query: () => [{ result: queue.length ? queue.shift() : null }] });
  const { log, lines } = captureLog();
  const ctx = { db, log } as unknown as JobContext;
  return { ctx, calls, lines };
}
const queries = (calls: { fn: string; args: unknown[] }[]) => calls.filter((c) => c.fn === "query");
const answer = (over: Record<string, unknown> = {}) => ({ centers: 1, queued: 0, refused: 0, no_email: 0, more: false, ...over });

describe("care.week_sweep", () => {
  it("is a platform-wide job every hour in the registry that needs no provider keys", () => {
    expect(sweep.kind).toBe("care.week_sweep");
    expect(sweep.every).toBe(3600);
    expect(HANDLERS.find((h) => h.kind === "care.week_sweep")?.every).toBe(3600);
    expect(readiness(createRegistry(HANDLERS), {})["care.week_sweep"]).toEqual({ configured: true });
  });

  it("calls app.worker_care_week_sweep once when it did not stop at its limit", async () => {
    const { ctx, calls, lines } = scripted([answer({ centers: 2, queued: 7, no_email: 1 })]);
    const out = await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx);
    expect(out).toEqual({ batches: 1, centers: 2, queued: 7, refused: 0, no_email: 1, more: false });
    const q = queries(calls);
    expect(q).toHaveLength(1);
    expect(q[0]?.args).toEqual(["select app.worker_care_week_sweep($1::int) as result", [sweep.BATCH]]);
    expect(lines.find((l) => String(l.msg).includes("care.week_sweep"))).toMatchObject({ level: "info", queued: 7 });
  });

  it("calls again while it stops at its limit, adds the counts up, and stops after MAX_BATCHES", async () => {
    const { ctx, calls } = scripted(Array.from({ length: 9 }, () => answer({ queued: 200, more: true })));
    const out = await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx);
    expect(queries(calls)).toHaveLength(sweep.MAX_BATCHES);
    expect(out.queued).toBe(200 * sweep.MAX_BATCHES);
    expect(out.more).toBe(true);
  });

  it("a refusal is logged as an error (with the counts) but the job does not fail", async () => {
    const { ctx, lines } = scripted([answer({ queued: 1, refused: 2 })]);
    const out = await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx);
    expect(out.refused).toBe(2);
    expect(lines.find((l) => String(l.msg).includes("refused"))).toMatchObject({ level: "error", refused: 2, queued: 1 });
  });

  it("an odd answer stops the loop and counts nothing", async () => {
    const { ctx, calls } = scripted([null, answer({ more: true })]);
    const out = await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx);
    expect(queries(calls)).toHaveLength(1);
    expect(out).toEqual({ batches: 1, centers: 0, queued: 0, refused: 0, no_email: 0, more: false });
  });
});
