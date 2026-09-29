import { describe, expect, it } from "vitest";

import { every, run } from "../src/handlers/niva.retention";

function fakeCtx(counts: number[]) {
  let i = 0;
  const calls: string[] = [];
  const db = {
    async query(text: string) {
      calls.push(text);
      const n = counts[i] ?? 0;
      i += 1;
      return [{ r: n }];
    },
  };
  return { ctx: { db, log: { info() {}, warn() {}, error() {}, debug() {} } } as unknown as Parameters<typeof run>[1], calls };
}

describe("niva.retention", () => {
  it("is a daily platform-wide job", () => {
    expect(every).toBe(24 * 3600);
  });

  it("deletes one batch and stops once fewer than a full batch came back", async () => {
    const { ctx, calls } = fakeCtx([37]);
    const out = await run(undefined as never, ctx);
    expect(out).toEqual({ deleted: 37 });
    expect(calls).toHaveLength(1);
  });

  it("loops while a full batch keeps coming back, then stops", async () => {
    const { ctx, calls } = fakeCtx([1000, 1000, 12]);
    const out = await run(undefined as never, ctx);
    expect(out).toEqual({ deleted: 2012 });
    expect(calls).toHaveLength(3);
  });
});
