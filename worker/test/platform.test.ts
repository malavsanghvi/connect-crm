import { describe, expect, it } from "vitest";

import { PermanentError } from "../src/errors";
import * as promote from "../src/handlers/platform.promote";
import * as expiry from "../src/handlers/platform.sandbox_expiry";
import { createHttp } from "../src/http";
import { createRegistry, jobContext } from "../src/runner";
import { HANDLERS } from "../src/handlers";
import { captureLog, fakeDb, job } from "./helpers";

const PROMO = "3f0c2b1a-9d8e-4c7b-8a6f-5e4d3c2b1a09";

function ctxFor(db: ReturnType<typeof fakeDb>["db"], j = job()) {
  const { log, lines } = captureLog();
  return { ctx: jobContext({ db, reg: createRegistry(HANDLERS), env: {}, http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log), lines };
}

describe("platform handlers are registered", () => {
  it("has platform.promote and platform.sandbox_expiry", () => {
    const reg = createRegistry(HANDLERS);
    expect(reg.has("platform.promote")).toBe(true);
    expect(reg.has("platform.sandbox_expiry")).toBe(true);
  });
});

describe("platform.promote", () => {
  it("refuses a job without a promotion id", async () => {
    const j = job({ kind: "platform.promote", payload: {} });
    await expect(promote.run(j, ctxFor(fakeDb().db, j).ctx)).rejects.toBeInstanceOf(PermanentError);
  });

  it("runs the copy in the database and returns its summary", async () => {
    const summary = { production_id: "p", slug: "jte", staff_reinvited: 2 };
    const { db, calls } = fakeDb({ query: (text) => (text.includes("worker_promote_sandbox") ? [{ result: summary }] : []) });
    const j = job({ kind: "platform.promote", payload: { promotion_id: PROMO } });
    await expect(promote.run(j, ctxFor(db, j).ctx)).resolves.toEqual(summary);
    expect(calls.filter((c) => c.fn === "query").map((c) => c.args)).toEqual([["select app.worker_promote_sandbox($1) as result", [PROMO]]]);
  });

  it("a refusal from the database fails the promotion at once, with its plain message", async () => {
    const refusal = Object.assign(new Error('The web name "jte" was taken after the promotion was requested.'), { code: "P0001" });
    const { db, calls } = fakeDb({
      query: (text) => {
        if (text.includes("worker_promote_sandbox")) throw refusal;
        return [];
      },
    });
    const j = job({ kind: "platform.promote", payload: { promotion_id: PROMO }, attempts: 1, max_attempts: 3 });
    const err = await promote.run(j, ctxFor(db, j).ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as Error).message).toMatch(/was taken/);
    const failed = calls.find((c) => c.fn === "query" && String(c.args[0]).includes("worker_promotion_failed"));
    expect(failed?.args[1]).toEqual([PROMO, refusal.message, true]);
  });

  it("a connection problem is retried, and recorded as not final until the last attempt", async () => {
    const boom = Object.assign(new Error("connection terminated"), { code: "57P01" });
    const { db, calls } = fakeDb({
      query: (text) => {
        if (text.includes("worker_promote_sandbox")) throw boom;
        return [];
      },
    });
    const j = job({ kind: "platform.promote", payload: { promotion_id: PROMO }, attempts: 1, max_attempts: 3 });
    const err = await promote.run(j, ctxFor(db, j).ctx).catch((e: unknown) => e);
    expect(err).toBe(boom);
    expect(calls.find((c) => String(c.args[0]).includes("worker_promotion_failed"))?.args[1]).toEqual([PROMO, "connection terminated", false]);
    const last = job({ kind: "platform.promote", payload: { promotion_id: PROMO }, attempts: 3, max_attempts: 3 });
    const second = fakeDb({ query: (text) => { if (text.includes("worker_promote_sandbox")) throw boom; return []; } });
    await promote.run(last, ctxFor(second.db, last).ctx).catch(() => null);
    expect(second.calls.find((c) => String(c.args[0]).includes("worker_promotion_failed"))?.args[1]).toEqual([PROMO, "connection terminated", true]);
  });

  it("tells refusals from transient errors", () => {
    expect(promote.isRefusal({ code: "P0001" })).toBe(true);
    expect(promote.isRefusal({ code: "42501" })).toBe(true);
    expect(promote.isRefusal({ code: "08006" })).toBe(false);
    expect(promote.isRefusal(new Error("x"))).toBe(false);
  });
});

describe("platform.sandbox_expiry", () => {
  it("runs the database pass and returns how many warnings it recorded", async () => {
    const { db, calls } = fakeDb({ query: () => [{ result: { warnings: 2, details: [] } }] });
    const j = job({ kind: "platform.sandbox_expiry", center_id: null as unknown as string });
    await expect(expiry.run(j, ctxFor(db, j).ctx)).resolves.toEqual({ warnings: 2, details: [] });
    expect(calls.filter((c) => c.fn === "query")).toHaveLength(1);
  });
});
