import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityEvent } from "@/lib/activity/event";
import { createRecorder, MAX_QUEUED_PER_REQUEST, type ActivityContext, type RecorderScope } from "@/lib/activity/record";
import { EVENTS_PER_CALL, resetSendState, sendEvents, type SendOutcome } from "@/lib/activity/send";
import type { AppSupabase } from "@/lib/supabase/server";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const CENTER = "11111111-2222-4333-8444-555555555555";
const ID = "8f0c9e5a-1b2c-4d3e-9f40-5a6b7c8d9e0f";
const fakeDb = {} as AppSupabase;
const on: ActivityContext = { db: fakeDb, center: { id: CENTER, rules: { activity: { enabled: true } } } };
const input = { key: "giving.record_payment", outcome: "ok" as const };

function harness(sendImpl?: (centerId: string, events: readonly ActivityEvent[]) => Promise<SendOutcome>) {
  const scope: RecorderScope = { queues: new Map() };
  const scheduled: Array<() => Promise<void>> = [];
  const calls: Array<{ centerId: string; events: ActivityEvent[] }> = [];
  const send = vi.fn(async (_db: AppSupabase, centerId: string, events: readonly ActivityEvent[]) => {
    calls.push({ centerId, events: [...events] });
    return sendImpl ? sendImpl(centerId, events) : ({ status: "sent", count: events.length } as SendOutcome);
  });
  const recorder = createRecorder({
    scope: () => scope,
    schedule: (task) => void scheduled.push(task),
    send,
    now: () => NOW,
    defaults: { platform: "web" },
  });
  return { recorder, scheduled, calls, send, scope };
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  resetSendState();
});
afterEach(() => {
  errorLog.mockRestore();
});

describe("recordActivity: the community's switch", () => {
  it("does nothing while the switch is off, missing or not exactly true", () => {
    const h = harness();
    for (const rules of [{}, { activity: {} }, { activity: { enabled: false } }, { activity: { enabled: "yes" } }, null]) {
      expect(h.recorder.record({ db: fakeDb, center: { id: CENTER, rules } }, input)).toBe(false);
    }
    expect(h.scheduled).toHaveLength(0);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("queues once the switch is on", () => {
    const h = harness();
    expect(h.recorder.record(on, input)).toBe(true);
    expect(h.scheduled).toHaveLength(1);
  });

  it("leaves the decision to the database when the rules are not known (the beacon route)", () => {
    const h = harness();
    expect(h.recorder.record({ db: fakeDb, center: { id: CENTER } }, { key: "screen:/giving", outcome: "ok" })).toBe(true);
  });
});

describe("recordActivity: batching", () => {
  it("sends nothing until the response has gone, then sends the request's events together", async () => {
    const h = harness();
    h.recorder.record(on, input);
    h.recorder.record(on, { key: "people.update_person", outcome: "error", error_code: "no_permission" });
    h.recorder.record(on, { key: "events.save_event", outcome: "ok", entity_kind: "event", entity_id: ID });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.scheduled).toHaveLength(1);

    await h.scheduled[0]();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.calls[0].centerId).toBe(CENTER);
    expect(h.calls[0].events.map((e) => e.key)).toEqual(["giving.record_payment", "people.update_person", "events.save_event"]);
  });

  it("fills in the time, the way it started and the platform, and keeps what the caller set", async () => {
    const h = harness();
    h.recorder.record(on, input);
    h.recorder.record(on, { ...input, via: "palette", platform: "ios" });
    await h.scheduled[0]();
    const [a, b] = h.calls[0].events;
    expect(a).toMatchObject({ kind: "action", via: "screen", platform: "web", at: "2026-10-10T12:00:00.000Z" });
    expect(b).toMatchObject({ via: "palette", platform: "ios" });
  });

  it("splits a long queue into calls of the size the database takes", async () => {
    const h = harness();
    for (let i = 0; i < EVENTS_PER_CALL + 10; i += 1) h.recorder.record(on, input);
    await h.scheduled[0]();
    expect(h.calls.map((c) => c.events.length)).toEqual([EVENTS_PER_CALL, 10]);
  });

  it("caps what one request can queue", () => {
    const h = harness();
    let queued = 0;
    for (let i = 0; i < MAX_QUEUED_PER_REQUEST + 50; i += 1) if (h.recorder.record(on, input)) queued += 1;
    expect(queued).toBe(MAX_QUEUED_PER_REQUEST);
  });

  it("keeps communities apart and flushes again after a flush", async () => {
    const h = harness();
    const other: ActivityContext = { db: fakeDb, center: { id: "99999999-2222-4333-8444-555555555555", rules: { activity: { enabled: true } } } };
    h.recorder.record(on, input);
    h.recorder.record(other, input);
    expect(h.scheduled).toHaveLength(2);
    await Promise.all(h.scheduled.map((t) => t()));
    expect(h.calls.map((c) => c.centerId).sort()).toEqual([CENTER, "99999999-2222-4333-8444-555555555555"].sort());

    h.recorder.record(on, input);
    expect(h.scheduled).toHaveLength(3);
  });

  it("sends events noted while an earlier send is under way", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const h = harness(async () => {
      await gate;
      return { status: "sent", count: 1 };
    });
    h.recorder.record(on, input);
    const running = h.scheduled[0]();
    h.recorder.record(on, { key: "people.update_person", outcome: "ok" });
    expect(h.scheduled).toHaveLength(1);
    release();
    await running;
    expect(h.calls.flatMap((c) => c.events.map((e) => e.key))).toEqual(["giving.record_payment", "people.update_person"]);
  });
});

describe("recordActivity: never throws", () => {
  it("drops an event that is not valid", () => {
    const h = harness();
    expect(h.recorder.record(on, { key: "Not A Key", outcome: "ok" })).toBe(false);
    expect(h.recorder.record(on, { key: "a.b", outcome: "nope" as never })).toBe(false);
    expect(h.scheduled).toHaveLength(0);
  });

  it("survives a send that rejects or throws", async () => {
    const rejecting = harness(async () => {
      throw new Error("the database fell over");
    });
    rejecting.recorder.record(on, input);
    await expect(rejecting.scheduled[0]()).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalled();
  });

  it("survives a scheduler or a scope that throws", () => {
    const broken = createRecorder({
      scope: () => {
        throw new Error("no request");
      },
      schedule: () => undefined,
      send: async () => ({ status: "sent", count: 0 }),
      now: () => NOW,
    });
    expect(broken.record(on, input)).toBe(false);

    const noSchedule = createRecorder({
      scope: () => ({ queues: new Map() }),
      schedule: () => {
        throw new Error("cannot schedule");
      },
      send: async () => ({ status: "sent", count: 0 }),
      now: () => NOW,
    });
    expect(() => noSchedule.record(on, input)).not.toThrow();
  });
});

describe("sendEvents", () => {
  const event: ActivityEvent = { key: "giving.record_payment", kind: "action", outcome: "ok", via: "screen" };

  function db(rpc: (fn: string, args: Record<string, unknown>) => unknown) {
    const client = { rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => rpc(fn, args)) };
    return { client, db: client as unknown as AppSupabase };
  }

  it("calls app.record_activity with the community and the events", async () => {
    const { client, db: d } = db(() => ({ data: 1, error: null }));
    const out = await sendEvents(d, CENTER, [event, event]);
    expect(out).toEqual({ status: "sent", count: 2 });
    expect(client.rpc).toHaveBeenCalledWith("record_activity", { p_center: CENTER, p_events: [event, event] });
  });

  it("sends nothing for nothing", async () => {
    const { client, db: d } = db(() => ({ data: 0, error: null }));
    expect(await sendEvents(d, CENTER, [])).toEqual({ status: "sent", count: 0 });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("treats a database without the function as recording unavailable: logs once, stops asking, tries again later", async () => {
    let now = NOW;
    const { client, db: d } = db(() => ({ data: null, error: { code: "PGRST202", message: "Could not find the function app.record_activity" } }));
    expect(await sendEvents(d, CENTER, [event], { now: () => now })).toEqual({ status: "unavailable" });
    expect(await sendEvents(d, CENTER, [event], { now: () => now })).toEqual({ status: "unavailable" });
    expect(await sendEvents(d, CENTER, [event], { now: () => now })).toEqual({ status: "unavailable" });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledTimes(1);

    now += 11 * 60 * 1000;
    await sendEvents(d, CENTER, [event], { now: () => now });
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it("also recognises the Postgres 'function does not exist' code", async () => {
    const { db: d } = db(() => ({ data: null, error: { code: "42883", message: "function app.record_activity(uuid, jsonb) does not exist" } }));
    expect(await sendEvents(d, CENTER, [event])).toEqual({ status: "unavailable" });
  });

  it("reports another failure once in a while, with the code and never the events", async () => {
    let now = NOW;
    const { db: d } = db(() => ({ data: null, error: { code: "XX000", message: "boom" } }));
    expect(await sendEvents(d, CENTER, [event], { now: () => now })).toEqual({ status: "failed", code: "XX000" });
    await sendEvents(d, CENTER, [event], { now: () => now });
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("giving.record_payment");
    now += 6 * 60 * 1000;
    await sendEvents(d, CENTER, [event], { now: () => now });
    expect(errorLog).toHaveBeenCalledTimes(2);
  });

  it("never throws, even when the client does", async () => {
    const { db: d } = db(() => {
      throw new Error("network down");
    });
    await expect(sendEvents(d, CENTER, [event])).resolves.toEqual({ status: "failed", code: "thrown" });
  });
});
