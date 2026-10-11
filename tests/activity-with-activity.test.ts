import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityInput } from "@/lib/activity/record";
import type { ActivityContext } from "@/lib/activity/record";
import { createWithActivity } from "@/lib/activity/with-activity";
import type { ActionResult } from "@/lib/errors";
import type { AppSupabase } from "@/lib/supabase/server";

const ID = "8f0c9e5a-1b2c-4d3e-9f40-5a6b7c8d9e0f";
const ctx: ActivityContext = { db: {} as AppSupabase, center: { id: "11111111-2222-4333-8444-555555555555", rules: { activity: { enabled: true } } } };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(opts: { context?: () => Promise<ActivityContext | null>; record?: (c: ActivityContext, e: ActivityInput) => boolean } = {}) {
  let time = 1000;
  const recorded: ActivityInput[] = [];
  const record = vi.fn((c: ActivityContext, e: ActivityInput) => {
    if (opts.record) return opts.record(c, e);
    recorded.push(e);
    return true;
  });
  const withActivity = createWithActivity({
    clock: () => time,
    context: opts.context ?? (async () => ctx),
    record,
  });
  return { withActivity, recorded, record, advance: (ms: number) => (time += ms) };
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorLog.mockRestore());

describe("withActivity", () => {
  it("returns the action's result as it came and notes an ok", async () => {
    const t = setup();
    const result: ActionResult = { ok: true, message: "Saved" };
    const out = await t.withActivity("events.save_event", async () => {
      t.advance(250);
      return result;
    });
    expect(out).toBe(result);
    await tick();
    expect(t.recorded).toEqual([{ key: "events.save_event", outcome: "ok", duration_ms: 250, via: "screen" }]);
  });

  it("notes an error result with a code, and still returns it unchanged", async () => {
    const t = setup();
    const result: ActionResult = { ok: false, error: "Could not save the event — you don't have permission (needs events.manage)." };
    const out = await t.withActivity("events.save_event", async () => result);
    expect(out).toBe(result);
    await tick();
    expect(t.recorded[0]).toMatchObject({ outcome: "error", error_code: "no_permission" });
    expect(JSON.stringify(t.recorded)).not.toContain("Could not save");
  });

  it("throws the same error again and notes an error", async () => {
    const t = setup();
    const boom = new Error("kaboom with a secret detail");
    await expect(
      t.withActivity("events.save_event", async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    await tick();
    expect(t.recorded).toEqual([{ key: "events.save_event", outcome: "error", error_code: "exception", duration_ms: 0, via: "screen" }]);
    expect(JSON.stringify(t.recorded)).not.toContain("secret");
  });

  it("counts a Next.js redirect as ok and passes it on", async () => {
    const t = setup();
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/events/builder;307;" });
    await expect(
      t.withActivity("events.save_event", async () => {
        throw redirect;
      }),
    ).rejects.toBe(redirect);
    await tick();
    expect(t.recorded[0]).toMatchObject({ outcome: "ok" });
  });

  it("does not note other Next.js control flow as a failure of the action", async () => {
    const t = setup();
    const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    await expect(
      t.withActivity("events.save_event", async () => {
        throw notFound;
      }),
    ).rejects.toBe(notFound);
    await tick();
    expect(t.recorded).toHaveLength(0);
  });

  it("notes the entity when the id is a uuid (fixed or read from the result), and drops anything else", async () => {
    const fixed = setup();
    await fixed.withActivity("events.set_status", async () => ({ ok: true }) as ActionResult, { entityFrom: { kind: "event", id: ID } });
    await tick();
    expect(fixed.recorded[0]).toMatchObject({ entity_kind: "event", entity_id: ID });

    const fromResult = setup();
    await fromResult.withActivity("giving.record_payment", async () => ({ ok: true, data: { paymentId: ID } }) as ActionResult<{ paymentId: string }>, {
      entityFrom: (r) => ({ kind: "payment", id: r?.data?.paymentId }),
    });
    await tick();
    expect(fromResult.recorded[0]).toMatchObject({ entity_kind: "payment", entity_id: ID });

    const notUuid = setup();
    await notUuid.withActivity("people.update_person", async () => ({ ok: true }) as ActionResult, { entityFrom: { kind: "person", id: "Priya Shah" } });
    await notUuid.withActivity("people.update_person", async () => ({ ok: true }) as ActionResult, { entityFrom: { kind: "person", id: "" } });
    await tick();
    for (const e of notUuid.recorded) expect(e).not.toHaveProperty("entity_id");
  });

  it("is not troubled by an entityFrom that throws", async () => {
    const t = setup();
    const out = await t.withActivity("a.b", async () => ({ ok: true }) as ActionResult, {
      entityFrom: () => {
        throw new Error("bad");
      },
    });
    expect(out).toEqual({ ok: true });
    await tick();
    expect(t.recorded).toHaveLength(1);
    expect(t.recorded[0]).not.toHaveProperty("entity_id");
  });

  it("passes on the way it was started", async () => {
    const t = setup();
    await t.withActivity("a.b", async () => ({ ok: true }) as ActionResult, { via: "palette" });
    await tick();
    expect(t.recorded[0]).toMatchObject({ via: "palette" });
  });
});

describe("withActivity never changes or delays the action", () => {
  it("returns the result when recording throws", async () => {
    const t = setup({
      record: () => {
        throw new Error("recorder down");
      },
    });
    const result: ActionResult = { ok: true };
    await expect(t.withActivity("a.b", async () => result)).resolves.toBe(result);
    await tick();
    expect(errorLog).toHaveBeenCalled();
  });

  it("returns the result when the session cannot be read", async () => {
    const rejecting = setup({ context: () => Promise.reject(new Error("no session")) });
    const result: ActionResult = { ok: true };
    await expect(rejecting.withActivity("a.b", async () => result)).resolves.toBe(result);

    const throwing = setup({
      context: () => {
        throw new Error("sync failure");
      },
    });
    await expect(throwing.withActivity("a.b", async () => result)).resolves.toBe(result);
    await tick();
    expect(rejecting.record).not.toHaveBeenCalled();
    expect(throwing.record).not.toHaveBeenCalled();
  });

  it("does not record without a session", async () => {
    const t = setup({ context: async () => null });
    await t.withActivity("a.b", async () => ({ ok: true }) as ActionResult);
    await tick();
    expect(t.record).not.toHaveBeenCalled();
  });

  it("does not wait for the session or for the recorder", async () => {
    const never = setup({ context: () => new Promise<ActivityContext | null>(() => undefined) });
    const result: ActionResult = { ok: false, error: "Could not do it." };
    await expect(never.withActivity("a.b", async () => result)).resolves.toBe(result);
  });

  it("makes the error visible to the caller when the action throws and recording also fails", async () => {
    const t = setup({
      record: () => {
        throw new Error("recorder down");
      },
    });
    const boom = new Error("action failed");
    await expect(
      t.withActivity("a.b", async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});
