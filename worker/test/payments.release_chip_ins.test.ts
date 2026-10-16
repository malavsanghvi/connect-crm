import { describe, expect, it } from "vitest";

import { HANDLERS } from "../src/handlers";
import * as sweep from "../src/handlers/payments.release_chip_ins";
import { readiness, createRegistry } from "../src/runner";
import type { JobContext } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

function ctxWith(released: unknown) {
  const { db, calls } = fakeDb({ query: () => [{ released }] });
  const { log, lines } = captureLog();
  const ctx = { db, log } as unknown as JobContext;
  return { ctx, calls, lines };
}

describe("payments.release_chip_ins", () => {
  it("is a daily platform-wide job in the registry that needs no provider keys", () => {
    expect(sweep.kind).toBe("payments.release_chip_ins");
    expect(sweep.every).toBe(24 * 3600);
    const mod = HANDLERS.find((h) => h.kind === "payments.release_chip_ins");
    expect(mod?.every).toBe(24 * 3600);
    expect(readiness(createRegistry(HANDLERS), {})["payments.release_chip_ins"]).toEqual({ configured: true });
  });

  it("runs app.worker_release_chip_ins once and returns how many reservations it released", async () => {
    const { ctx, calls, lines } = ctxWith(3);
    expect(await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx)).toEqual({ released: 3 });
    const queries = calls.filter((c) => c.fn === "query");
    expect(queries).toHaveLength(1);
    expect(queries[0]?.args[0]).toBe("select app.worker_release_chip_ins() as released");
    expect(lines.find((l) => String(l.msg).includes("payments.release_chip_ins"))).toMatchObject({ level: "info", released: 3 });
  });

  it("treats nothing to release, or an odd answer, as zero", async () => {
    expect(await sweep.run(job({ kind: sweep.kind, center_id: null }), ctxWith(0).ctx)).toEqual({ released: 0 });
    expect(await sweep.run(job({ kind: sweep.kind, center_id: null }), ctxWith(null).ctx)).toEqual({ released: 0 });
    expect(await sweep.run(job({ kind: sweep.kind, center_id: null }), ctxWith("2").ctx)).toEqual({ released: 2 });
    expect(await sweep.run(job({ kind: sweep.kind, center_id: null }), ctxWith(-1).ctx)).toEqual({ released: 0 });
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
