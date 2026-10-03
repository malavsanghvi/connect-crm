import { describe, expect, it } from "vitest";

import { HANDLERS } from "../src/handlers";
import * as sweep from "../src/handlers/payments.reports_sweep";
import { readiness, createRegistry } from "../src/runner";
import type { JobContext } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

function ctxWith(result: unknown) {
  const { db, calls } = fakeDb({ query: () => [{ result }] });
  const { log, lines } = captureLog();
  const ctx = { db, log } as unknown as JobContext;
  return { ctx, calls, lines };
}

describe("payments.reports_sweep", () => {
  it("is an hourly platform-wide job in the registry that needs no provider keys", () => {
    expect(sweep.kind).toBe("payments.reports_sweep");
    expect(sweep.every).toBe(3600);
    const mod = HANDLERS.find((h) => h.kind === "payments.reports_sweep");
    expect(mod?.every).toBe(3600);
    expect(readiness(createRegistry(HANDLERS), {})["payments.reports_sweep"]).toEqual({ configured: true });
  });

  it("runs app.worker_payment_reports_sweep once and returns its counts", async () => {
    const { ctx, calls, lines } = ctxWith({ marked: 3, notices: 2, notice_failures: 0, held_for_review: 1 });
    const out = await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx);
    expect(out).toEqual({ marked: 3, notices: 2, notice_failures: 0, held_for_review: 1 });
    const queries = calls.filter((c) => c.fn === "query");
    expect(queries).toHaveLength(1);
    expect(queries[0]?.args[0]).toBe("select app.worker_payment_reports_sweep() as result");
    const line = lines.find((l) => String(l.msg).includes("payments.reports_sweep"));
    expect(line).toMatchObject({ level: "info", marked: 3, notices: 2, notice_failures: 0, held_for_review: 1 });
  });

  it("warns when some members could not be told (the reports are still marked)", async () => {
    const { ctx, lines } = ctxWith({ marked: 2, notices: 1, notice_failures: 1, held_for_review: 0 });
    const out = await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx);
    expect(out).toEqual({ marked: 2, notices: 1, notice_failures: 1, held_for_review: 0 });
    expect(lines.find((l) => String(l.msg).includes("could not be told"))).toMatchObject({ level: "warn", notice_failures: 1 });
  });

  it("treats a missing or odd answer as nothing done, never as a failure to invent", async () => {
    const { ctx } = ctxWith(null);
    expect(await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx)).toEqual({ marked: 0, notices: 0, notice_failures: 0, held_for_review: 0 });
    const odd = ctxWith({ marked: "4", notices: -1, notice_failures: "x" });
    expect(await sweep.run(job({ kind: sweep.kind, center_id: null }), odd.ctx)).toEqual({ marked: 4, notices: 0, notice_failures: 0, held_for_review: 0 });
  });

  it("lets a database error fail the job so the runner retries it", async () => {
    const { db } = fakeDb({
      query: () => {
        throw new Error("connection reset");
      },
    });
    const { log } = captureLog();
    await expect(sweep.run(job({ kind: sweep.kind, center_id: null }), { db, log } as unknown as JobContext)).rejects.toThrow(/connection reset/);
  });
});
