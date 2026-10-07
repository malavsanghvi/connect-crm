import { describe, expect, it } from "vitest";

import { HANDLERS } from "../src/handlers";
import * as sweep from "../src/handlers/homework.reminders_sweep";
import { readiness, createRegistry } from "../src/runner";
import type { JobContext } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

function ctxWith(result: unknown) {
  const { db, calls } = fakeDb({ query: () => [{ result }] });
  const { log, lines } = captureLog();
  const ctx = { db, log } as unknown as JobContext;
  return { ctx, calls, lines };
}

describe("homework.reminders_sweep", () => {
  it("is a platform-wide job every 15 minutes in the registry that needs no provider keys", () => {
    expect(sweep.kind).toBe("homework.reminders_sweep");
    expect(sweep.every).toBe(900);
    const mod = HANDLERS.find((h) => h.kind === "homework.reminders_sweep");
    expect(mod?.every).toBe(900);
    expect(readiness(createRegistry(HANDLERS), {})["homework.reminders_sweep"]).toEqual({ configured: true });
  });

  it("runs app.worker_homework_reminders_sweep once and returns its counts", async () => {
    const { ctx, calls, lines } = ctxWith({ reminded: 8, messages: 22, unreached: 1, held_for_quiet_hours: 3, busy: 0 });
    const out = await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx);
    expect(out).toEqual({ reminded: 8, messages: 22, unreached: 1, held_for_quiet_hours: 3, busy: 0 });
    const queries = calls.filter((c) => c.fn === "query");
    expect(queries).toHaveLength(1);
    expect(queries[0]?.args[0]).toBe("select app.worker_homework_reminders_sweep() as result");
    const line = lines.find((l) => String(l.msg).includes("homework.reminders_sweep"));
    expect(line).toMatchObject({ level: "info", reminded: 8, messages: 22, unreached: 1, held_for_quiet_hours: 3, busy: 0 });
  });

  it("treats a missing or odd answer as nothing done, never as a count to invent", async () => {
    const { ctx } = ctxWith(null);
    expect(await sweep.run(job({ kind: sweep.kind, center_id: null }), ctx)).toEqual({ reminded: 0, messages: 0, unreached: 0, held_for_quiet_hours: 0, busy: 0 });
    const odd = ctxWith({ reminded: "4", messages: -1, unreached: "x", held_for_quiet_hours: 2.7 });
    expect(await sweep.run(job({ kind: sweep.kind, center_id: null }), odd.ctx)).toEqual({ reminded: 4, messages: 0, unreached: 0, held_for_quiet_hours: 2, busy: 0 });
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
