import { describe, expect, it } from "vitest";

import { HANDLERS } from "../src/handlers";
import * as sweep from "../src/handlers/notices.sweep";
import { createRegistry, readiness } from "../src/runner";
import type { JobContext } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

type Answer = Record<string, unknown>;

/** A database that answers each call of the sweep function from a script, and records the parameters. */
function scripted(answers: Answer[]) {
  const queue = [...answers];
  const { db, calls } = fakeDb({ query: () => [{ result: queue.shift() ?? null }] });
  const { log, lines } = captureLog();
  const ctx = { db, log } as unknown as JobContext;
  return { ctx, calls, lines, left: () => queue.length };
}

const queries = (calls: { fn: string; args: unknown[] }[]) => calls.filter((c) => c.fn === "query");
const idle = { pushed: 0, refused: 0, more: false };

describe("notices.sweep", () => {
  it("is scheduled by the service every 5 minutes, platform-wide, and needs no provider keys", () => {
    expect(sweep.kind).toBe("notices.sweep");
    const mod = HANDLERS.find((h) => h.kind === "notices.sweep");
    expect(mod).toBeDefined();
    expect(mod?.every).toBe(300);
    expect(readiness(createRegistry(HANDLERS), {})["notices.sweep"]).toEqual({ configured: true });
  });

  it("calls the database sweep once when nothing stopped at its limit, and reports each notice kind", async () => {
    const { ctx, calls, lines } = scripted([
      { rsvp_confirmation: { pushed: 12, refused: 1, more: false }, boli_closing: { pushed: 3, refused: 0, more: false }, special_day_labh: idle },
    ]);
    const out = await sweep.run(job({ kind: sweep.kind }), ctx);
    expect(out).toEqual({
      batches: 1,
      rsvp_confirmation: { pushed: 12, refused: 1, more: false },
      boli_closing: { pushed: 3, refused: 0, more: false },
      special_day_labh: { pushed: 0, refused: 0, more: false },
    });
    const q = queries(calls);
    expect(q).toHaveLength(1);
    expect(String(q[0]?.args[0])).toBe("select app.worker_notices_sweep($1::int) as result");
    expect(q[0]?.args[1]).toEqual([200]);
    expect(lines.find((l) => String(l.msg).includes("notices.sweep"))).toMatchObject({ level: "info", batches: 1 });
  });

  it("calls again while a sweep stopped at its limit, adds the answers up, and stops after MAX_BATCHES", async () => {
    const more = { rsvp_confirmation: { pushed: 200, refused: 0, more: true }, boli_closing: idle, special_day_labh: idle };
    const last = { rsvp_confirmation: { pushed: 40, refused: 2, more: false }, boli_closing: idle, special_day_labh: idle };
    const a = scripted([more, more, last]);
    expect(await sweep.run(job({ kind: sweep.kind }), a.ctx)).toMatchObject({ batches: 3, rsvp_confirmation: { pushed: 440, refused: 2, more: false } });
    const b = scripted(Array.from({ length: 10 }, () => more));
    const out = await sweep.run(job({ kind: sweep.kind }), b.ctx);
    expect(out.batches).toBe(sweep.MAX_BATCHES);
    expect(out.rsvp_confirmation).toMatchObject({ pushed: 200 * sweep.MAX_BATCHES, more: true });
    expect(b.left()).toBe(10 - sweep.MAX_BATCHES);
  });

  it("one sweep failing does not stop the others, and the failure is logged as an error, never swallowed", async () => {
    const { ctx, lines } = scripted([
      { rsvp_confirmation: { error: "relation does not exist" }, boli_closing: { pushed: 2, refused: 0, more: false }, special_day_labh: idle },
    ]);
    const out = await sweep.run(job({ kind: sweep.kind }), ctx);
    expect(out.rsvp_confirmation.error).toBe("relation does not exist");
    expect(out.boli_closing.pushed).toBe(2);
    expect(lines.find((l) => String(l.msg).includes("a sweep failed"))).toMatchObject({ level: "error", failed: ["rsvp_confirmation"] });
  });

  it("never loops on an odd answer: a missing result or numbers that make no sense end the job", async () => {
    const none = scripted([]);
    expect(await sweep.run(job({ kind: sweep.kind }), none.ctx)).toEqual({
      batches: 1,
      rsvp_confirmation: idle,
      boli_closing: idle,
      special_day_labh: idle,
    });
    const weird = scripted([{ rsvp_confirmation: { pushed: "x", refused: -4, more: "yes" }, boli_closing: null, special_day_labh: 7 }]);
    expect(await sweep.run(job({ kind: sweep.kind }), weird.ctx)).toMatchObject({ batches: 1, rsvp_confirmation: idle });
  });
});
