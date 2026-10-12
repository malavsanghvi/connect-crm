import { describe, expect, it } from "vitest";

import { HANDLERS } from "../src/handlers";
import * as due from "../src/handlers/events.publish_due";
import { createRegistry, readiness } from "../src/runner";
import type { JobContext } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

/** A database that answers each call of the publish function from a script, and records the parameters. */
function scripted(answers: unknown[]) {
  const queue = [...answers];
  const { db, calls } = fakeDb({ query: () => [{ result: queue.shift() ?? null }] });
  const { log, lines } = captureLog();
  const ctx = { db, log } as unknown as JobContext;
  return { ctx, calls, lines, left: () => queue.length };
}

const queries = (calls: { fn: string; args: unknown[] }[]) => calls.filter((c) => c.fn === "query");

describe("events.publish_due", () => {
  it("is scheduled by the service every 5 minutes, platform-wide, and needs no provider keys", () => {
    expect(due.kind).toBe("events.publish_due");
    const mod = HANDLERS.find((h) => h.kind === "events.publish_due");
    expect(mod?.every).toBe(300);
    expect(readiness(createRegistry(HANDLERS), {})["events.publish_due"]).toEqual({ configured: true });
  });

  it("asks the database once when nothing more is waiting, and reports what was published and refused", async () => {
    const { ctx, calls, lines } = scripted([{ published: 2, refused: 1, more: false }]);
    expect(await due.run(job({ kind: due.kind }), ctx)).toEqual({ batches: 1, published: 2, refused: 1, more: false });
    const q = queries(calls);
    expect(q).toHaveLength(1);
    expect(String(q[0]?.args[0])).toBe("select app.worker_events_publish_due($1::int) as result");
    expect(q[0]?.args[1]).toEqual([50]);
    expect(lines.find((l) => String(l.msg).includes("events.publish_due"))).toMatchObject({ level: "info", published: 2, refused: 1 });
  });

  it("calls again while a run stopped at its limit, and stops after MAX_BATCHES", async () => {
    const more = { published: 50, refused: 0, more: true };
    const a = scripted([more, { published: 3, refused: 0, more: false }]);
    expect(await due.run(job({ kind: due.kind }), a.ctx)).toEqual({ batches: 2, published: 53, refused: 0, more: false });
    const b = scripted(Array.from({ length: 9 }, () => more));
    const out = await due.run(job({ kind: due.kind }), b.ctx);
    expect(out).toMatchObject({ batches: due.MAX_BATCHES, published: 50 * due.MAX_BATCHES, more: true });
    expect(b.left()).toBe(9 - due.MAX_BATCHES);
  });

  it("reads an odd answer as nothing done and never loops on it, and logs nothing when nothing was due", async () => {
    const { ctx, calls, lines } = scripted([{ published: "x", refused: -4, more: "yes" }]);
    expect(await due.run(job({ kind: due.kind }), ctx)).toEqual({ batches: 1, published: 0, refused: 0, more: false });
    expect(queries(calls)).toHaveLength(1);
    expect(lines.filter((l) => String(l.msg).includes("events.publish_due"))).toHaveLength(0);
  });
});
