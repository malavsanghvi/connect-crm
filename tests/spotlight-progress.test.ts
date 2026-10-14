import { describe, expect, it, vi } from "vitest";

import {
  emptyProgress,
  endedStatus,
  invitationsOn,
  invitedTours,
  markEnded,
  markSeen,
  parseProgress,
  progressKey,
  serializeProgress,
  statusOf,
  withToursOff,
} from "@/lib/spotlight/progress";
import { UNLOADED, createProgressStore, type StorageLike } from "@/lib/spotlight/store";

// What this browser remembers about tours, per signed-in person (prototype: localStorage). The storage can throw or be empty, and the
// choices ("Not now", skip, "Don't show tours again", turning tours back on) must hold either way.

const NOW = new Date("2026-10-14T09:00:00Z");
const TOUR = { id: "treasurer-bank-match" };
const OTHER = { id: "another-tour" };

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("one memory per browser, signed-in person and tour", () => {
  it("keys the memory by the signed-in person", () => {
    expect(progressKey("u-1")).not.toBe(progressKey("u-2"));
    expect(progressKey("u-1")).toContain("u-1");
  });

  it("a tour never started is not_started", () => {
    expect(statusOf(emptyProgress(), TOUR.id)).toBe("not_started");
  });

  it("starting marks it seen, once; a replay keeps what the person did before", () => {
    const seen = markSeen(emptyProgress(), TOUR.id, NOW);
    expect(statusOf(seen, TOUR.id)).toBe("seen");
    const finished = markEnded(seen, TOUR.id, "completed", NOW);
    expect(statusOf(markSeen(finished, TOUR.id, NOW), TOUR.id)).toBe("completed");
    const dismissed = markEnded(seen, TOUR.id, "dismissed", NOW);
    expect(statusOf(markSeen(dismissed, TOUR.id, NOW), TOUR.id)).toBe("dismissed");
  });

  it("finishing is completed; skip, X, Esc and Close at any step are dismissed", () => {
    expect(endedStatus("completed")).toBe("completed");
    expect(endedStatus("skipped")).toBe("dismissed");
  });

  it("round-trips through text", () => {
    const p = withToursOff(markEnded(emptyProgress(), TOUR.id, "dismissed", NOW), true);
    expect(parseProgress(serializeProgress(p))).toEqual(p);
  });
});

describe("what comes back from storage", () => {
  it("nothing remembered, or text that is not ours, is simply 'nothing remembered'", () => {
    expect(parseProgress(null)).toEqual(emptyProgress());
    expect(parseProgress("")).toEqual(emptyProgress());
    expect(parseProgress("not json")).toEqual(emptyProgress());
    expect(parseProgress("[1,2]")).toEqual(emptyProgress());
    expect(parseProgress('"text"')).toEqual(emptyProgress());
  });

  it("ignores a status it does not know and keeps the rest", () => {
    const p = parseProgress(JSON.stringify({ off: true, tours: { a: { status: "weird", at: "x" }, b: { status: "completed", at: "2026-10-14" } } }));
    expect(p.off).toBe(true);
    expect(statusOf(p, "a")).toBe("not_started");
    expect(statusOf(p, "b")).toBe("completed");
  });
});

describe("who is invited", () => {
  it("a tour never started is offered", () => {
    expect(invitedTours([TOUR, OTHER], emptyProgress())).toEqual([TOUR, OTHER]);
  });

  it("started, finished or dismissed: never offered on its own again", () => {
    for (const how of ["seen", "completed", "dismissed"] as const) {
      const p = how === "seen" ? markSeen(emptyProgress(), TOUR.id, NOW) : markEnded(emptyProgress(), TOUR.id, how, NOW);
      expect(invitedTours([TOUR], p)).toEqual([]);
    }
  });

  it("'Not now' on the invitation is remembered as dismissed", () => {
    const p = markEnded(emptyProgress(), TOUR.id, "dismissed", NOW);
    expect(statusOf(p, TOUR.id)).toBe("dismissed");
    expect(invitedTours([TOUR, OTHER], p)).toEqual([OTHER]);
  });

  it("tours off: no invitation for any tour, and none of the other entry points either", () => {
    const off = withToursOff(emptyProgress(), true);
    expect(invitedTours([TOUR, OTHER], off)).toEqual([]);
    expect(invitationsOn(off)).toBe(false);
    expect(invitationsOn(emptyProgress())).toBe(true);
  });

  it("turning tours back on brings back the invitations that were never answered, not the ones that were", () => {
    const answered = markEnded(emptyProgress(), TOUR.id, "dismissed", NOW);
    const off = withToursOff(answered, true);
    const on = withToursOff(off, false);
    expect(invitationsOn(on)).toBe(true);
    expect(invitedTours([TOUR, OTHER], on)).toEqual([OTHER]);
  });
});

describe("the browser's storage", () => {
  it("writes the choice and reads it back, per person", () => {
    const storage = memoryStorage();
    const store = createProgressStore(() => storage);
    const mine = progressKey("u-1");
    expect(store.snapshot(mine)).toBe("");
    expect(store.update(mine, (p) => markEnded(p, TOUR.id, "dismissed", NOW))).toEqual({ ok: true });
    expect(statusOf(parseProgress(store.snapshot(mine)), TOUR.id)).toBe("dismissed");
    // Another person on the same browser has their own memory.
    expect(statusOf(parseProgress(store.snapshot(progressKey("u-2"))), TOUR.id)).toBe("not_started");
    expect(store.failed()).toBe(false);
  });

  it("tells the listeners, so a card goes away the moment the person answers", () => {
    const store = createProgressStore(() => memoryStorage());
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.update(progressKey("u-1"), (p) => withToursOff(p, true));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.update(progressKey("u-1"), (p) => withToursOff(p, false));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("another tab's change is read from storage", () => {
    const storage = memoryStorage();
    const store = createProgressStore(() => storage);
    const key = progressKey("u-1");
    storage.data[key] = serializeProgress(withToursOff(emptyProgress(), true));
    expect(parseProgress(store.snapshot(key)).off).toBe(true);
  });

  it("writing blocked (private window, site data blocked): the choice holds for this page and the failure is reported", () => {
    const blocked: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    };
    const store = createProgressStore(() => blocked);
    const key = progressKey("u-1");
    const result = store.update(key, (p) => withToursOff(p, true));
    expect(result).toEqual({ ok: false });
    expect(store.failed()).toBe(true);
    // The page still behaves: tours are off for the rest of the visit.
    expect(parseProgress(store.snapshot(key)).off).toBe(true);
  });

  it("reading blocked too: nothing remembered, nothing thrown, in-memory choice kept", () => {
    const worse: StorageLike = {
      getItem: () => {
        throw new Error("no storage");
      },
      setItem: () => {
        throw new Error("no storage");
      },
    };
    const store = createProgressStore(() => worse);
    const key = progressKey("u-1");
    expect(store.snapshot(key)).toBe("");
    store.update(key, (p) => markEnded(p, TOUR.id, "dismissed", NOW));
    expect(statusOf(parseProgress(store.snapshot(key)), TOUR.id)).toBe("dismissed");
  });

  it("no storage object at all (the server, or a browser without it) is the same as blocked", () => {
    const store = createProgressStore(() => null);
    expect(store.snapshot("k")).toBe("");
    expect(store.update("k", (p) => withToursOff(p, true))).toEqual({ ok: false });
    expect(store.failed()).toBe(true);
  });

  it("a getStorage that itself throws (accessing localStorage can) is also handled", () => {
    const store = createProgressStore(() => {
      throw new Error("SecurityError");
    });
    expect(store.snapshot("k")).toBe("");
    expect(store.update("k", (p) => withToursOff(p, true)).ok).toBe(false);
  });

  it("a write that works again clears the failure", () => {
    let blocked = true;
    const storage = memoryStorage();
    const flaky: StorageLike = {
      getItem: (k) => storage.getItem(k),
      setItem: (k, v) => {
        if (blocked) throw new Error("denied");
        storage.setItem(k, v);
      },
    };
    const store = createProgressStore(() => flaky);
    expect(store.update("k", (p) => withToursOff(p, true)).ok).toBe(false);
    blocked = false;
    expect(store.update("k", (p) => withToursOff(p, false)).ok).toBe(true);
    expect(store.failed()).toBe(false);
  });

  it("the server and the first client render see 'unloaded', which is not a stored value", () => {
    expect(UNLOADED).not.toBe("");
    expect(() => JSON.parse(UNLOADED)).toThrow();
    expect(parseProgress(UNLOADED)).toEqual(emptyProgress());
  });
});
