import { describe, expect, it } from "vitest";

import { every, kind, run } from "../src/handlers/activity.mine";

type Call = { text: string; params?: unknown[] };

/**
 * A fake database. `centers` answers the list of communities (or throws when it is an Error); `mine` answers each
 * worker_mine_activity call by community id (a value, or an Error to throw); each purge call answers with the next of `purges`.
 */
function fakeCtx(opts: { centers: string[] | Error; mine?: Record<string, unknown>; purges?: { expired: number; swept?: number }[] }) {
  const calls: Call[] = [];
  const logs: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];
  let i = 0;
  const db = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      if (text.includes("worker_activity_centers")) {
        if (opts.centers instanceof Error) throw opts.centers;
        return opts.centers.map((center_id) => ({ center_id }));
      }
      if (text.includes("worker_mine_activity")) {
        const answer = opts.mine?.[String(params?.[0])];
        if (answer instanceof Error) throw answer;
        return [{ r: answer ?? { candidates: 0 } }];
      }
      const r = opts.purges?.[i] ?? { expired: 0, swept: 0 };
      i += 1;
      return [{ r }];
    },
  };
  const log = {
    info: (msg: string, fields?: Record<string, unknown>) => logs.push({ level: "info", msg, fields }),
    warn: (msg: string, fields?: Record<string, unknown>) => logs.push({ level: "warn", msg, fields }),
    error: (msg: string, fields?: Record<string, unknown>) => logs.push({ level: "error", msg, fields }),
    debug() {},
  };
  return { ctx: { db, log } as unknown as Parameters<typeof run>[1], calls, logs };
}

describe("activity.mine", () => {
  it("is a daily platform-wide job", () => {
    expect(kind).toBe("activity.mine");
    expect(every).toBe(24 * 3600);
  });

  it("mines each community in its own call, then purges one batch with the sweep", async () => {
    const { ctx, calls, logs } = fakeCtx({
      centers: ["c1", "c2", "c3"],
      mine: { c1: { candidates: 4 }, c2: { candidates: 0, skipped: true }, c3: { candidates: 8 } },
      purges: [{ expired: 41, swept: 2 }],
    });
    const out = await run(undefined as never, ctx);
    expect(out).toEqual({ communities: 3, candidates: 12, failed: 0, expired: 41, swept: 2 });
    expect(calls.map((c) => c.text.replace(/\s+/g, " "))).toEqual([
      "select center_id from app.worker_activity_centers()",
      "select app.worker_mine_activity($1::uuid) as r",
      "select app.worker_mine_activity($1::uuid) as r",
      "select app.worker_mine_activity($1::uuid) as r",
      "select app.activity_purge($1::int, $2::boolean) as r",
    ]);
    expect(calls.slice(1, 4).map((c) => c.params)).toEqual([["c1"], ["c2"], ["c3"]]);
    expect(calls[4]?.params).toEqual([5000, true]);
    expect(logs.map((l) => l.level)).toEqual(["info"]);
  });

  it("keeps purging while a full batch keeps coming back, and sweeps on the first call only", async () => {
    const { ctx, calls } = fakeCtx({ centers: [], purges: [{ expired: 5000, swept: 3 }, { expired: 5000, swept: 0 }, { expired: 7, swept: 0 }] });
    const out = await run(undefined as never, ctx);
    expect(out).toMatchObject({ expired: 10007, swept: 3 });
    const purges = calls.filter((c) => c.text.includes("activity_purge"));
    expect(purges.map((c) => c.params)).toEqual([[5000, true], [5000, false], [5000, false]]);
  });

  it("one community failing does not stop the others, and the purge still runs", async () => {
    const { ctx, calls, logs } = fakeCtx({
      centers: ["c1", "slow", "c3"],
      mine: { c1: { candidates: 2 }, slow: new Error("canceling statement due to statement timeout"), c3: { candidates: 5 } },
      purges: [{ expired: 0, swept: 0 }],
    });
    const out = await run(undefined as never, ctx);
    expect(out).toEqual({ communities: 2, candidates: 7, failed: 1, expired: 0, swept: 0 });
    expect(calls.filter((c) => c.text.includes("worker_mine_activity")).map((c) => c.params?.[0])).toEqual(["c1", "slow", "c3"]);
    expect(calls.some((c) => c.text.includes("activity_purge"))).toBe(true);
    expect(logs.map((l) => l.level)).toEqual(["error", "warn"]);
    expect(logs[0]?.fields).toMatchObject({ center: "slow", error: "canceling statement due to statement timeout" });
  });

  it("still purges when the list of communities cannot be read", async () => {
    const { ctx, calls, logs } = fakeCtx({ centers: new Error("connection reset"), purges: [{ expired: 3, swept: 1 }] });
    const out = await run(undefined as never, ctx);
    expect(out).toEqual({ communities: 0, candidates: 0, failed: 1, expired: 3, swept: 1 });
    expect(calls.filter((c) => c.text.includes("activity_purge"))).toHaveLength(1);
    expect(logs.map((l) => l.level)).toEqual(["error", "warn"]);
  });

  it("copes with an empty answer from the database", async () => {
    const { ctx } = fakeCtx({ centers: ["c1"], mine: { c1: null as never }, purges: [] });
    const out = await run(undefined as never, ctx);
    expect(out).toEqual({ communities: 1, candidates: 0, failed: 0, expired: 0, swept: 0 });
  });
});
