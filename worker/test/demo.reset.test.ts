import { describe, expect, it } from "vitest";

import { every, kind, run } from "../src/handlers/demo.reset";
import { HANDLERS } from "../src/handlers";

function fakeCtx(answer: unknown) {
  const calls: string[] = [];
  const logs: { level: string; msg: string; data: unknown }[] = [];
  const db = {
    async query(text: string) {
      calls.push(text);
      return [{ r: answer }];
    },
  };
  const log = {
    info: (msg: string, data: unknown) => logs.push({ level: "info", msg, data }),
    warn: (msg: string, data: unknown) => logs.push({ level: "warn", msg, data }),
    error: (msg: string, data: unknown) => logs.push({ level: "error", msg, data }),
    debug() {},
  };
  return { ctx: { db, log } as unknown as Parameters<typeof run>[1], calls, logs };
}

describe("demo.reset", () => {
  it("is registered as an hourly platform-wide job", () => {
    expect(kind).toBe("demo.reset");
    expect(every).toBe(3600);
    expect(HANDLERS.some((h) => h.kind === "demo.reset")).toBe(true);
  });

  it("asks the database which demo communities are due and reports what it did", async () => {
    const { ctx, calls, logs } = fakeCtx({
      checked: 2, reset: 1, skipped: 1, failed: 0,
      centers: [{ center_id: "c1", status: "reset", why: "changed" }, { center_id: "c2", status: "skipped" }],
    });
    const out = await run(undefined as never, ctx);
    expect(calls).toEqual(["select app.worker_demo_reset_due() as r"]);
    expect(out).toMatchObject({ checked: 2, reset: 1, skipped: 1, failed: 0 });
    expect(logs.map((l) => l.level)).toEqual(["info"]);
  });

  it("logs an error (with the reason) when a demo community could not be reset, and still returns the answer", async () => {
    const { ctx, logs } = fakeCtx({
      checked: 1, reset: 0, skipped: 0, failed: 1,
      centers: [{ center_id: "c1", status: "failed", error: "insert or update on table x violates foreign key" }],
    });
    const out = await run(undefined as never, ctx);
    expect(out.failed).toBe(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: "error", msg: "demo.reset: a demo community could not be reset" });
    expect(JSON.stringify(logs[0]!.data)).toContain("violates foreign key");
  });

  it("copes with an empty answer", async () => {
    const { ctx } = fakeCtx(null);
    expect(await run(undefined as never, ctx)).toEqual({ checked: 0, reset: 0, skipped: 0, failed: 0, centers: [] });
  });
});
