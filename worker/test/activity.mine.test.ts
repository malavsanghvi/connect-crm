import { describe, expect, it } from "vitest";

import { every, kind, run } from "../src/handlers/activity.mine";

type Call = { text: string; params?: unknown[] };

/** A fake database: the miner answers with `mined`, then each purge call answers with the next number of `purges`. */
function fakeCtx(mined: unknown, purges: number[]) {
  const calls: Call[] = [];
  const logs: { level: string; msg: string }[] = [];
  let i = 0;
  const db = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      if (text.includes("worker_mine_activity")) return [{ r: mined }];
      const n = purges[i] ?? 0;
      i += 1;
      return [{ n }];
    },
  };
  const log = {
    info: (msg: string) => logs.push({ level: "info", msg }),
    warn: (msg: string) => logs.push({ level: "warn", msg }),
    error: (msg: string) => logs.push({ level: "error", msg }),
    debug() {},
  };
  return { ctx: { db, log } as unknown as Parameters<typeof run>[1], calls, logs };
}

describe("activity.mine", () => {
  it("is a daily platform-wide job", () => {
    expect(kind).toBe("activity.mine");
    expect(every).toBe(24 * 3600);
  });

  it("mines first, then purges one batch and stops when fewer than a full batch was deleted", async () => {
    const { ctx, calls, logs } = fakeCtx({ communities: 3, candidates: 12, failed: 0 }, [41]);
    const out = await run(undefined as never, ctx);
    expect(out).toEqual({ communities: 3, candidates: 12, failed: 0, purged: 41 });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toContain("app.worker_mine_activity()");
    expect(calls[1]?.text).toContain("app.activity_purge(");
    expect(calls[1]?.params).toEqual([5000]);
    expect(logs.map((l) => l.level)).toEqual(["info"]);
  });

  it("keeps purging while a full batch keeps coming back", async () => {
    const { ctx, calls } = fakeCtx({ communities: 0, candidates: 0, failed: 0 }, [5000, 5000, 7]);
    const out = await run(undefined as never, ctx);
    expect(out.purged).toBe(10007);
    expect(calls).toHaveLength(4);
  });

  it("warns when a community could not be mined, and still purges", async () => {
    const { ctx, logs } = fakeCtx({ communities: 2, candidates: 1, failed: 1 }, [0]);
    const out = await run(undefined as never, ctx);
    expect(out).toEqual({ communities: 2, candidates: 1, failed: 1, purged: 0 });
    expect(logs.map((l) => l.level)).toEqual(["warn"]);
  });

  it("copes with an empty answer from the database", async () => {
    const { ctx } = fakeCtx(null, [0]);
    const out = await run(undefined as never, ctx);
    expect(out).toEqual({ communities: 0, candidates: 0, failed: 0, purged: 0 });
  });
});
