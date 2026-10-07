import { describe, expect, it } from "vitest";

import { HANDLERS } from "../src/handlers";
import * as sweep from "../src/handlers/homework.reminders_sweep";
import { readiness, createRegistry } from "../src/runner";
import type { JobContext } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

/** A database that answers each call of the sweep from a script, and records the parameters. */
function scripted(batches: unknown[]) {
  const queue = [...batches];
  const { db, calls } = fakeDb({ query: () => [{ result: queue.length ? queue.shift() : null }] });
  const { log, lines } = captureLog();
  const ctx = { db, log } as unknown as JobContext;
  return { ctx, calls, lines };
}

const queries = (calls: { fn: string; args: unknown[] }[]) => calls.filter((c) => c.fn === "query");

const batch = (over: Record<string, unknown> = {}) => ({
  reminded: 0, messages: 0, suppressed: 0, dropped_pushes: 0, unreached: 0, held_for_quiet_hours: 0, busy: 0,
  cancelled: 0, skipped_time_zone: 0, limit: 100, more: false, ...over,
});

describe("homework.reminders_sweep", () => {
  it("is a platform-wide job every 15 minutes in the registry that needs no provider keys", () => {
    expect(sweep.kind).toBe("homework.reminders_sweep");
    expect(sweep.every).toBe(900);
    const mod = HANDLERS.find((h) => h.kind === "homework.reminders_sweep");
    expect(mod?.every).toBe(900);
    expect(readiness(createRegistry(HANDLERS), {})["homework.reminders_sweep"]).toEqual({ configured: true });
  });

  it("runs one batch of app.worker_homework_reminders_sweep, with the housekeeping, when it is not full", async () => {
    const { ctx, calls, lines } = scripted([batch({ reminded: 8, messages: 22, suppressed: 1, dropped_pushes: 2, unreached: 1, held_for_quiet_hours: 3, cancelled: 4 })]);
    const out = await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx);
    expect(out).toEqual({
      batches: 1, reminded: 8, messages: 22, suppressed: 1, dropped_pushes: 2, unreached: 1, held_for_quiet_hours: 3, busy: 0,
      cancelled: 4, skipped_time_zone: 0, more: false,
    });
    const q = queries(calls);
    expect(q).toHaveLength(1);
    expect(q[0]?.args).toEqual(["select app.worker_homework_reminders_sweep($1::int, $2::boolean) as result", [sweep.BATCH, true]]);
    const line = lines.find((l) => String(l.msg).includes("homework.reminders_sweep"));
    expect(line).toMatchObject({ level: "info", reminded: 8, messages: 22, suppressed: 1, dropped_pushes: 2, held_for_quiet_hours: 3 });
  });

  it("calls again while a batch comes back full, housekeeping only in the first, and adds the batches up", async () => {
    const { ctx, calls } = scripted([
      batch({ reminded: 100, messages: 250, held_for_quiet_hours: 5, cancelled: 2, more: true }),
      batch({ reminded: 99, messages: 240, busy: 1, held_for_quiet_hours: 5, more: true }),
      batch({ reminded: 30, messages: 70, held_for_quiet_hours: 4 }),
    ]);
    const out = await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx);
    expect(out).toMatchObject({ batches: 3, reminded: 229, messages: 560, busy: 1, cancelled: 2, held_for_quiet_hours: 5, more: false });
    expect(queries(calls).map((c) => (c.args[1] as unknown[])[1])).toEqual([true, false, false]);
  });

  it("stops after MAX_BATCHES and says more learners wait for the next run", async () => {
    const { ctx, calls } = scripted(Array.from({ length: sweep.MAX_BATCHES + 5 }, () => batch({ reminded: 100, messages: 200, more: true })));
    const out = await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx);
    expect(queries(calls)).toHaveLength(sweep.MAX_BATCHES);
    expect(out).toMatchObject({ batches: sweep.MAX_BATCHES, reminded: 100 * sweep.MAX_BATCHES, more: true });
  });

  it("warns when a community's time zone is unknown (its audit log names it)", async () => {
    const { ctx, lines } = scripted([batch({ reminded: 3, messages: 8, skipped_time_zone: 1 })]);
    const out = await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx);
    expect(out.skipped_time_zone).toBe(1);
    expect(lines.find((l) => String(l.msg).includes("unknown time zone"))).toMatchObject({ level: "warn", skipped_time_zone: 1 });
  });

  it("treats a missing or odd answer as nothing done, never as a count to invent or a reason to loop", async () => {
    const empty = scripted([null]);
    expect(await sweep.run(job({ kind: sweep.kind, center_id: null }), empty.ctx)).toEqual({
      batches: 1, reminded: 0, messages: 0, suppressed: 0, dropped_pushes: 0, unreached: 0, held_for_quiet_hours: 0, busy: 0,
      cancelled: 0, skipped_time_zone: 0, more: false,
    });
    const odd = scripted([{ reminded: "4", messages: -1, unreached: "x", held_for_quiet_hours: 2.7, more: "yes" }]);
    expect(await sweep.run(job({ kind: sweep.kind, center_id: null }), odd.ctx)).toMatchObject({ batches: 1, reminded: 4, messages: 0, unreached: 0, held_for_quiet_hours: 2, more: false });
    expect(queries(odd.calls)).toHaveLength(1);
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
