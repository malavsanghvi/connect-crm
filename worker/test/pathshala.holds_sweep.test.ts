import { describe, expect, it } from "vitest";

import { HANDLERS } from "../src/handlers";
import * as sweep from "../src/handlers/pathshala.holds_sweep";
import { readiness, createRegistry } from "../src/runner";
import type { JobContext } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

function ctxWith(result: unknown) {
  const { db, calls } = fakeDb({ query: () => [{ result }] });
  const { log, lines } = captureLog();
  const ctx = { db, log } as unknown as JobContext;
  return { ctx, calls, lines };
}

const counts = { reminded: 2, released: 1, credited: 0, credit_cents: 0, kept_paying: 1, waitlist_served: 1 };

describe("pathshala.holds_sweep", () => {
  it("is a platform-wide job every 15 minutes in the registry that needs no provider keys", () => {
    expect(sweep.kind).toBe("pathshala.holds_sweep");
    expect(sweep.every).toBe(900);
    const mod = HANDLERS.find((h) => h.kind === "pathshala.holds_sweep");
    expect(mod?.every).toBe(900);
    expect(readiness(createRegistry(HANDLERS), {})["pathshala.holds_sweep"]).toEqual({ configured: true });
  });

  it("runs app.worker_pathshala_holds_sweep once and returns its counts", async () => {
    const { ctx, calls, lines } = ctxWith(counts);
    const out = await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx);
    expect(out).toEqual(counts);
    const queries = calls.filter((c) => c.fn === "query");
    expect(queries).toHaveLength(1);
    expect(queries[0]?.args[0]).toBe("select app.worker_pathshala_holds_sweep() as result");
    const line = lines.find((l) => String(l.msg).includes("pathshala.holds_sweep"));
    expect(line).toMatchObject({ level: "info", reminded: 2, released: 1, waitlist_served: 1 });
  });

  it("warns when released seats had money paid toward them (credit for the treasurer)", async () => {
    const { ctx, lines } = ctxWith({ ...counts, credited: 1, credit_cents: 4500 });
    const out = await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx);
    expect(out).toMatchObject({ credited: 1, credit_cents: 4500 });
    expect(lines.find((l) => String(l.msg).includes("credit to handle"))).toMatchObject({ level: "warn", credited: 1, credit_cents: 4500 });
  });

  it("treats a missing or odd answer as nothing done, never as a failure to invent", async () => {
    const { ctx } = ctxWith(null);
    expect(await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx)).toEqual({
      reminded: 0, released: 0, credited: 0, credit_cents: 0, kept_paying: 0, waitlist_served: 0,
    });
    const odd = ctxWith({ reminded: "3", released: -1, credited: "x" });
    expect(await sweep.run(job({ kind: sweep.kind, center_id: null }), odd.ctx)).toEqual({
      reminded: 3, released: 0, credited: 0, credit_cents: 0, kept_paying: 0, waitlist_served: 0,
    });
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
