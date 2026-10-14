import { describe, expect, it, vi } from "vitest";

import { createBeaconEngine, FLUSH_DELAY_MS, type BeaconEnv } from "@/lib/activity/beacon-engine";
import { ACTIVITY_ENDPOINT, postScreens } from "@/lib/activity/browser-env";
import { MAX_BEACON_EVENTS, parseBeacon, type BeaconPayload } from "@/lib/activity/ingest";
import { createPageViewTracker, MIN_VIEW_MS } from "@/lib/activity/page-views";

const CENTER = "11111111-2222-4333-8444-555555555555";
const ID = "8f0c9e5a-1b2c-4d3e-9f40-5a6b7c8d9e0f";
const NOW = Date.parse("2026-10-10T12:00:00Z");

function clock(start = 0) {
  let t = start;
  return { now: () => t, wallClock: () => NOW + t, advance: (ms: number) => (t += ms) };
}

describe("page view tracker", () => {
  it("counts only the time the page was visible", () => {
    const c = clock();
    const tracker = createPageViewTracker(c, true);
    expect(tracker.enter("/events/" + ID)).toBeNull();
    c.advance(1000);
    expect(tracker.visibility(false)).toMatchObject({ key: "screen:/events/[id]", duration_ms: 1000 });
    c.advance(60_000); // in another tab
    tracker.visibility(true);
    c.advance(500);
    const next = tracker.enter("/giving");
    expect(next).toMatchObject({ key: "screen:/events/[id]", duration_ms: 500 });
  });

  it("hands back the screen that was left, with its time, and starts the next", () => {
    const c = clock();
    const tracker = createPageViewTracker(c, true);
    tracker.enter("/people");
    c.advance(2500);
    expect(tracker.enter("/people/" + ID)).toMatchObject({ key: "screen:/people", duration_ms: 2500, at: new Date(NOW).toISOString() });
    c.advance(900);
    expect(tracker.leave()).toMatchObject({ key: "screen:/people/[id]", duration_ms: 900 });
  });

  it("ignores a pass-through that is too short to be a visit", () => {
    const c = clock();
    const tracker = createPageViewTracker(c, true);
    tracker.enter("/");
    c.advance(MIN_VIEW_MS - 1);
    expect(tracker.enter("/giving")).toBeNull();
  });

  it("does not count a page opened in a background tab until it is shown", () => {
    const c = clock();
    const tracker = createPageViewTracker(c, false);
    tracker.enter("/giving");
    c.advance(30_000);
    expect(tracker.leave()).toBeNull();
  });

  it("never reports an id, whatever the address", () => {
    const c = clock();
    const tracker = createPageViewTracker(c, true);
    tracker.enter(`/households/${ID}?tab=giving`);
    c.advance(1000);
    const done = tracker.leave();
    expect(done?.key).toBe("screen:/households/[id]");
    expect(JSON.stringify(done)).not.toContain(ID);
  });
});

function engineEnv(visible = true) {
  const c = clock();
  const sent: Array<{ payload: BeaconPayload; unloading: boolean }> = [];
  let seq = 0;
  let timer: (() => void) | null = null;
  const env: BeaconEnv = {
    now: c.now,
    wallClock: c.wallClock,
    isVisible: () => visible,
    send: (payload, unloading) => void sent.push({ payload, unloading }),
    session: () => ({ id: "session-abcdef", nextSeq: () => (seq += 1) }),
    setTimer: (fn) => {
      timer = fn;
      return 1;
    },
    clearTimer: () => {
      timer = null;
    },
  };
  return { env, c, sent, fireTimer: () => timer?.(), hasTimer: () => timer !== null };
}

describe("beacon engine", () => {
  it("batches page views and sends them after a short wait", () => {
    const t = engineEnv();
    const engine = createBeaconEngine(CENTER, t.env);
    engine.enter("/");
    t.c.advance(1000);
    engine.enter("/giving");
    t.c.advance(2000);
    engine.enter(`/events/${ID}`);
    expect(t.sent).toHaveLength(0);
    expect(t.hasTimer()).toBe(true);
    t.fireTimer();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].unloading).toBe(false);
    expect(t.sent[0].payload.centerId).toBe(CENTER);
    expect(t.sent[0].payload.events.map((e) => e.key)).toEqual(["screen:/", "screen:/giving"]);
    expect(t.sent[0].payload.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(FLUSH_DELAY_MS).toBeGreaterThan(1000);
  });

  it("sends at once, by the way that survives the page closing, when the page is hidden", () => {
    const t = engineEnv();
    const engine = createBeaconEngine(CENTER, t.env);
    engine.enter("/people");
    t.c.advance(4000);
    engine.pageHide();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].unloading).toBe(true);
    expect(t.sent[0].payload.events[0]).toMatchObject({ key: "screen:/people", duration_ms: 4000 });
  });

  it("sends when the tab is hidden, and counts a return as a new visit to the same screen", () => {
    const t = engineEnv();
    const engine = createBeaconEngine(CENTER, t.env);
    engine.enter("/people");
    t.c.advance(1500);
    engine.visibility(false);
    expect(t.sent).toHaveLength(1);
    t.c.advance(100_000);
    engine.visibility(true);
    t.c.advance(700);
    engine.pageHide();
    expect(t.sent[1].payload.events[0]).toMatchObject({ key: "screen:/people", duration_ms: 700 });
  });

  it("never sends a platform-console screen", () => {
    const t = engineEnv();
    const engine = createBeaconEngine(CENTER, t.env);
    engine.enter("/platform/centers/" + ID);
    t.c.advance(5000);
    engine.pageHide();
    expect(t.sent).toHaveLength(0);
  });

  it("ends the last screen when the person goes to the platform console", () => {
    const t = engineEnv();
    const engine = createBeaconEngine(CENTER, t.env);
    engine.enter("/giving");
    t.c.advance(3000);
    engine.enter("/platform");
    t.c.advance(3000);
    engine.pageHide();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].payload.events.map((e) => e.key)).toEqual(["screen:/giving"]);
  });

  it("sends a full batch without waiting", () => {
    const t = engineEnv();
    const engine = createBeaconEngine(CENTER, t.env);
    for (let i = 0; i <= MAX_BEACON_EVENTS; i += 1) {
      engine.enter(i % 2 ? "/giving" : "/people");
      t.c.advance(1000);
    }
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].payload.events).toHaveLength(MAX_BEACON_EVENTS);
  });

  it("sends what is waiting and goes quiet when it is disposed", () => {
    const t = engineEnv();
    const engine = createBeaconEngine(CENTER, t.env);
    engine.enter("/giving");
    t.c.advance(2000);
    engine.dispose();
    expect(t.sent).toHaveLength(1);
    engine.enter("/people");
    t.c.advance(2000);
    engine.pageHide();
    expect(t.sent).toHaveLength(1);
  });

  it("is not troubled by a send that throws", () => {
    const t = engineEnv();
    t.env.send = () => {
      throw new Error("offline");
    };
    const engine = createBeaconEngine(CENTER, t.env);
    engine.enter("/giving");
    t.c.advance(2000);
    expect(() => engine.pageHide()).not.toThrow();
  });
});

describe("postScreens", () => {
  const payload: BeaconPayload = { centerId: CENTER, events: [{ key: "screen:/giving", duration_ms: 1200 }] };

  it("uses sendBeacon while the page is going away", () => {
    const sendBeacon = vi.fn(() => true);
    const fetch = vi.fn();
    postScreens(payload, true, { sendBeacon, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(sendBeacon).toHaveBeenCalledWith(ACTIVITY_ENDPOINT, expect.any(Blob));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to a keepalive fetch, and never throws", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    postScreens(payload, false, { fetch: fetch as unknown as typeof globalThis.fetch });
    postScreens(payload, true, { sendBeacon: () => false, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(ACTIVITY_ENDPOINT, expect.objectContaining({ method: "POST", keepalive: true, credentials: "same-origin" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(() =>
      postScreens(payload, true, {
        sendBeacon: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });
});

describe("parseBeacon (what the server accepts)", () => {
  const good = { centerId: CENTER, sessionId: "session-abcdef", events: [{ key: "screen:/events/[id]", duration_ms: 5400, seq: 2, at: "2026-10-10T11:59:00Z" }] };

  it("accepts screens and stamps them as screen views that worked", () => {
    const out = parseBeacon(good, NOW);
    expect(out?.centerId).toBe(CENTER);
    expect(out?.events[0]).toEqual({
      key: "screen:/events/[id]",
      kind: "screen",
      outcome: "ok",
      via: "screen",
      duration_ms: 5400,
      seq: 2,
      session_id: "session-abcdef",
      platform: "web",
      at: "2026-10-10T11:59:00.000Z",
    });
  });

  it("refuses a screen with an id or a query string in it, however it was sent", () => {
    const bad = ["screen:/events/" + ID, "screen:/events/417", "screen:/events?tab=x", "screen:/people/Priya-Shah", "screen:/x#y"];
    for (const key of bad) {
      expect(parseBeacon({ ...good, events: [{ key, duration_ms: 1 }] }, NOW), key).toBeNull();
    }
    const mixed = parseBeacon({ ...good, events: [{ key: "screen:/events/" + ID, duration_ms: 1 }, { key: "screen:/giving", duration_ms: 1 }] }, NOW);
    expect(mixed?.events.map((e) => e.key)).toEqual(["screen:/giving"]);
  });

  it("accepts nothing but screens: no actions, entities, failures or other fields", () => {
    const out = parseBeacon(
      {
        ...good,
        events: [
          { key: "giving.record_payment", duration_ms: 1 },
          { key: "screen:/giving", duration_ms: 1, outcome: "error", error_code: "no_permission", entity_kind: "payment", entity_id: ID, via: "assistant", name: "Priya Shah" },
        ],
      },
      NOW,
    );
    expect(out?.events).toHaveLength(1);
    expect(out?.events[0]).toEqual({ key: "screen:/giving", kind: "screen", outcome: "ok", via: "screen", duration_ms: 1, session_id: "session-abcdef", platform: "web" });
  });

  it("needs a community id and a list", () => {
    expect(parseBeacon({ ...good, centerId: "acme" }, NOW)).toBeNull();
    expect(parseBeacon({ ...good, centerId: undefined }, NOW)).toBeNull();
    expect(parseBeacon({ ...good, events: "screen:/giving" }, NOW)).toBeNull();
    expect(parseBeacon({ ...good, events: [] }, NOW)).toBeNull();
    expect(parseBeacon(null, NOW)).toBeNull();
    expect(parseBeacon("x", NOW)).toBeNull();
  });

  it("reads at most one batch", () => {
    const many = { ...good, events: Array.from({ length: MAX_BEACON_EVENTS + 20 }, () => ({ key: "screen:/giving", duration_ms: 1 })) };
    expect(parseBeacon(many, NOW)?.events).toHaveLength(MAX_BEACON_EVENTS);
  });
});
