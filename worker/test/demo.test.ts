import { describe, expect, it } from "vitest";

import { PermanentError } from "../src/errors";
import * as clear from "../src/handlers/demo.clear";
import * as load from "../src/handlers/demo.load";
import { isRefusal } from "../src/demo/common";
import { createHttp } from "../src/http";
import { createRegistry, jobContext } from "../src/runner";
import { HANDLERS } from "../src/handlers";
import { captureLog, fakeDb, job } from "./helpers";

const CENTER = "29000000-0000-4000-8000-0000000000c1";

function ctxFor(db: ReturnType<typeof fakeDb>["db"], j = job()) {
  const { log, lines } = captureLog();
  return { ctx: jobContext({ db, reg: createRegistry(HANDLERS), env: {}, http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log), lines };
}

describe("demo handlers are registered", () => {
  it("has demo.load and demo.clear (and needs no platform keys)", () => {
    const reg = createRegistry(HANDLERS);
    expect(reg.get("demo.load")?.configured).toBeUndefined();
    expect(reg.get("demo.clear")?.configured).toBeUndefined();
  });
});

describe("demo.load", () => {
  it("refuses a job without an organization", async () => {
    const j = job({ kind: "demo.load", center_id: null, payload: { pack: "community" } });
    await expect(load.run(j, ctxFor(fakeDb().db, j).ctx)).rejects.toBeInstanceOf(PermanentError);
  });

  it("runs the database's steps one call at a time until done", async () => {
    let n = 0;
    const { db, calls } = fakeDb({
      query: (text) => {
        if (!text.includes("worker_demo_load_next")) return [];
        n += 1;
        return n < 3 ? [{ result: { done: false, steps_done: n, steps_total: 3, step: `s${n}` } }] : [{ result: { done: true, status: "loaded", steps_done: 3, loaded: { people: 76 } } }];
      },
    });
    const j = job({ kind: "demo.load", center_id: CENTER, payload: { pack: "community" } });
    await expect(load.run(j, ctxFor(db, j).ctx)).resolves.toEqual({ status: "loaded", steps_done: 3, loaded: { people: 76 } });
    expect(calls.filter((c) => c.fn === "query").map((c) => c.args)).toEqual(Array(3).fill(["select app.worker_demo_load_next($1) as result", [CENTER]]));
  });

  it("a refusal (not a sandbox any more) fails the job and the screen at once, with the plain message", async () => {
    const refusal = Object.assign(new Error("Demo data is only for sandboxes. X is a production organization, so …"), { code: "CCDMO" });
    const { db, calls } = fakeDb({ query: (text) => { if (text.includes("worker_demo_load_next")) throw refusal; return []; } });
    const j = job({ kind: "demo.load", center_id: CENTER, attempts: 1, max_attempts: 3 });
    const err = await load.run(j, ctxFor(db, j).ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as Error).message).toMatch(/only for sandboxes/);
    expect(calls.find((c) => String(c.args[0]).includes("worker_demo_failed"))?.args[1]).toEqual([CENTER, refusal.message, true]);
  });

  it("a connection problem is retried and recorded as not final until the last attempt", async () => {
    const boom = Object.assign(new Error("connection terminated"), { code: "57P01" });
    const { db, calls } = fakeDb({ query: (text) => { if (text.includes("worker_demo_load_next")) throw boom; return []; } });
    const j = job({ kind: "demo.load", center_id: CENTER, attempts: 1, max_attempts: 3 });
    expect(await load.run(j, ctxFor(db, j).ctx).catch((e: unknown) => e)).toBe(boom);
    expect(calls.find((c) => String(c.args[0]).includes("worker_demo_failed"))?.args[1]).toEqual([CENTER, "connection terminated", false]);
  });

  it("stops a load that never finishes instead of looping forever", async () => {
    const { db } = fakeDb({ query: (text) => (text.includes("worker_demo_load_next") ? [{ result: { done: false, steps_done: 1, steps_total: 10, step: "setup" } }] : []) });
    const j = job({ kind: "demo.load", center_id: CENTER });
    const err = await load.run(j, ctxFor(db, j).ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as Error).message).toMatch(/did not finish/);
  });

  it("still fails honestly when the failure cannot be recorded", async () => {
    const boom = Object.assign(new Error("step failed"), { code: "P0001" });
    const { db } = fakeDb({ query: () => { throw boom; } });
    const j = job({ kind: "demo.load", center_id: CENTER });
    const { ctx, lines } = ctxFor(db, j);
    await expect(load.run(j, ctx)).rejects.toBeInstanceOf(PermanentError);
    expect(lines.some((l) => String(l.msg).includes("could not record"))).toBe(true);
  });
});

describe("demo.clear", () => {
  it("runs the one-transaction clear and reports what it removed", async () => {
    const { db, calls } = fakeDb({ query: (text) => (text.includes("worker_demo_clear") ? [{ result: { removed_total: 2291, kept_logins: 2, then_load: "community", load_job: "9" } }] : []) });
    const j = job({ kind: "demo.clear", center_id: CENTER, payload: { then_load: "community" } });
    await expect(clear.run(j, ctxFor(db, j).ctx)).resolves.toEqual({ removed_total: 2291, kept_logins: 2, then_load: "community", load_job: "9" });
    expect(calls.filter((c) => c.fn === "query").map((c) => c.args)).toEqual([["select app.worker_demo_clear($1) as result", [CENTER]]]);
  });

  it("a production organization is refused by the database and the job fails at once", async () => {
    const refusal = Object.assign(new Error("Demo data is only for sandboxes."), { code: "CCDMO" });
    const { db, calls } = fakeDb({ query: (text) => { if (text.includes("worker_demo_clear")) throw refusal; return []; } });
    const j = job({ kind: "demo.clear", center_id: CENTER, attempts: 1, max_attempts: 3 });
    await expect(clear.run(j, ctxFor(db, j).ctx)).rejects.toBeInstanceOf(PermanentError);
    expect(calls.find((c) => String(c.args[0]).includes("worker_demo_failed"))?.args[1]).toEqual([CENTER, refusal.message, true]);
  });

  it("tells refusals from transient errors", () => {
    expect(isRefusal({ code: "CCDMO" })).toBe(true);
    expect(isRefusal({ code: "P0001" })).toBe(true);
    expect(isRefusal({ code: "42501" })).toBe(true);
    expect(isRefusal({ code: "08006" })).toBe(false);
    expect(isRefusal(null)).toBe(false);
  });
});
