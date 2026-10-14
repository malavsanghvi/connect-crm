import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SPOTLIGHT_TEXT as T } from "@/lib/spotlight/copy";
import { isLastStep, navigateTarget, pathOf, reduceTour, startTour, stepAt, type MachineEvent, type MachineState } from "@/lib/spotlight/machine";
import { TARGET_WAIT_MS, isValidKey, selectorFor, waitForTarget } from "@/lib/spotlight/target";
import type { TourDef, TourStep } from "@/lib/spotlight/types";

// The step machine of a tour and the waiting for a target, with no browser: next/back/skip/close, a target that is missing, optional steps,
// a step on another page (the person waits for the page with a fake clock), and the keys.

const step = (id: string, extra: Partial<TourStep> = {}): TourStep => ({ id, target: `t-${id}`, title: `Title ${id}`, body: `Body ${id}`, ...extra });

const tourOf = (steps: TourStep[]): TourDef => ({
  id: "demo-tour",
  title: "Demo",
  summary: "A demo tour.",
  minutes: 1,
  persona: ["treasurer"],
  requires: {},
  steps,
});

/** Applies events one after the other. */
function run(tour: TourDef, events: MachineEvent["type"][], from: MachineState = startTour()): MachineState {
  return events.reduce((s, type) => reduceTour(tour, s, { type }), from);
}

describe("moving through the steps", () => {
  const tour = tourOf([step("a"), step("b"), step("c")]);

  it("starts waiting for the first step's target, and announces the step once it is lit", () => {
    const s = startTour();
    expect(s).toMatchObject({ index: 0, phase: "waiting", ended: null, announce: null });
    const lit = reduceTour(tour, s, { type: "found" });
    expect(lit.phase).toBe("ready");
    expect(lit.announce).toBe("Step 1 of 3: Title a");
  });

  it("next goes to the following step and waits for its target; back goes the other way", () => {
    let s = run(tour, ["found", "next"]);
    expect(s).toMatchObject({ index: 1, phase: "waiting", direction: 1 });
    s = run(tour, ["found", "next", "found", "back"], startTour());
    expect(s).toMatchObject({ index: 0, phase: "waiting", direction: -1 });
    expect(reduceTour(tour, s, { type: "found" }).announce).toBe("Step 1 of 3: Title a");
  });

  it("back on the first step does nothing", () => {
    const s = run(tour, ["found"]);
    expect(reduceTour(tour, s, { type: "back" })).toBe(s);
  });

  it("next on the last step finishes the tour", () => {
    const s = run(tour, ["found", "next", "found", "next", "found", "next"]);
    expect(s.ended).toBe("completed");
    expect(s.announce).toBe(T.announceFinished);
  });

  it("finish completes it from the last step", () => {
    const s = run(tour, ["found", "next", "found", "next", "found", "finish"]);
    expect(s).toMatchObject({ ended: "completed", announce: "Tour finished" });
  });

  it("nothing moves a tour that has ended", () => {
    const done = run(tour, ["skip"]);
    expect(reduceTour(tour, done, { type: "next" })).toBe(done);
    expect(reduceTour(tour, done, { type: "found" })).toBe(done);
    expect(reduceTour(tour, done, { type: "back" })).toBe(done);
  });

  it("knows the last step", () => {
    expect(isLastStep(tour, { index: 1 })).toBe(false);
    expect(isLastStep(tour, { index: 2 })).toBe(true);
    expect(stepAt(tour, 1)?.id).toBe("b");
    expect(stepAt(tour, 9)).toBeUndefined();
  });
});

describe("skipping and closing: one action, from anywhere", () => {
  const tour = tourOf([step("a", { href: "/one" }), step("b", { href: "/two" }), step("c", { href: "/two" })]);

  it("skip at step 1 ends the tour as skipped, and says so", () => {
    const s = run(tour, ["skip"]);
    expect(s).toMatchObject({ index: 0, ended: "skipped", announce: "Tour skipped" });
  });

  it("skip once step 1 is lit does the same (Skip tour, the X, Esc and Close are all this one event)", () => {
    const s = run(tour, ["found", "skip"]);
    expect(s).toMatchObject({ ended: "skipped", announce: "Tour skipped" });
  });

  it("skip in the middle of a tour, on a step that is still waiting for its page, ends it at once", () => {
    const s = run(tour, ["found", "next", "skip"]);
    expect(s.phase).toBe("waiting");
    expect(s).toMatchObject({ index: 1, ended: "skipped", announce: "Tour skipped" });
  });

  it("skip on a step whose target never showed up ends it too", () => {
    const s = run(tour, ["found", "next", "missing", "skip"]);
    expect(s).toMatchObject({ ended: "skipped", announce: "Tour skipped" });
  });

  it("every announcement counts up, so the same words twice are still spoken twice", () => {
    const a = run(tour, ["found"]);
    const b = reduceTour(tour, run(tour, ["next", "back"], a), { type: "found" });
    expect(b.announce).toBe(a.announce);
    expect(b.tick).toBeGreaterThan(a.tick);
  });
});

describe("a step whose target is not on the screen", () => {
  it("says so in the step's own words, and offers a way on", () => {
    const tour = tourOf([step("a", { missing: "Nothing is waiting right now." }), step("b")]);
    const s = run(tour, ["missing"]);
    expect(s.phase).toBe("missing");
    expect(s.announce).toBe("Step 1 of 2: Title a. Nothing is waiting right now.");
    expect(reduceTour(tour, s, { type: "next" })).toMatchObject({ index: 1, phase: "waiting" });
  });

  it("uses the plain generic note when the step has none", () => {
    const s = run(tourOf([step("a")]), ["missing"]);
    expect(s.announce).toBe(`Step 1 of 1: Title a. ${T.missing}`);
  });

  it("a page that arrives after the wait ran out lights the step by itself", () => {
    const tour = tourOf([step("a"), step("b")]);
    const s = run(tour, ["missing", "found"]);
    expect(s).toMatchObject({ index: 0, phase: "ready", announce: "Step 1 of 2: Title a" });
  });

  it("try again looks for the target again", () => {
    const tour = tourOf([step("a"), step("b")]);
    const s = run(tour, ["missing", "retry"]);
    expect(s).toMatchObject({ index: 0, phase: "waiting" });
    expect(reduceTour(tour, s, { type: "found" }).phase).toBe("ready");
  });

  it("an optional step that is not there is left out without a word, going forward", () => {
    const tour = tourOf([step("a"), step("b", { optional: true }), step("c")]);
    const s = run(tour, ["found", "next", "missing"]);
    expect(s).toMatchObject({ index: 2, phase: "waiting", announce: "Step 1 of 3: Title a" });
  });

  it("and going back, the person lands on the step before it", () => {
    const tour = tourOf([step("a"), step("b", { optional: true }), step("c")]);
    const s = run(tour, ["found", "next", "found", "next", "found", "back", "missing"]);
    // At c, Back lands on b (optional, missing): carry on backwards to a.
    expect(s).toMatchObject({ index: 0, phase: "waiting", direction: -1 });
  });

  it("an optional last step that is not there ends the tour as finished", () => {
    const tour = tourOf([step("a"), step("b", { optional: true })]);
    const s = run(tour, ["found", "next", "missing"]);
    expect(s).toMatchObject({ ended: "completed", announce: "Tour finished" });
  });

  it("an optional first step that is not there starts at the second", () => {
    const tour = tourOf([step("a", { optional: true }), step("b")]);
    const s = reduceTour(tour, startTour(), { type: "missing" });
    expect(s).toMatchObject({ index: 1, phase: "waiting" });
  });

  it("several optional steps in a row are all left out", () => {
    const tour = tourOf([step("a"), step("b", { optional: true }), step("c", { optional: true }), step("d")]);
    const s = run(tour, ["found", "next", "missing", "missing"]);
    expect(s).toMatchObject({ index: 3, phase: "waiting" });
  });

  it("a late 'found' after the step moved on changes nothing", () => {
    const tour = tourOf([step("a"), step("b")]);
    const lit = run(tour, ["found"]);
    expect(reduceTour(tour, lit, { type: "found" })).toBe(lit);
    expect(reduceTour(tour, lit, { type: "missing" })).toBe(lit);
  });
});

describe("pages", () => {
  it("compares the path only, not the query string or a trailing slash", () => {
    expect(pathOf("/giving/payments/bank?view=gifts")).toBe("/giving/payments/bank");
    expect(pathOf("/giving/payments/bank/")).toBe("/giving/payments/bank");
    expect(pathOf("/")).toBe("/");
    expect(pathOf("/?x=1#top")).toBe("/");
  });

  it("goes to a step's page only when the person is somewhere else", () => {
    expect(navigateTarget({ href: "/giving/payments/bank" }, "/")).toBe("/giving/payments/bank");
    expect(navigateTarget({ href: "/giving/payments/bank" }, "/giving/payments/bank")).toBeNull();
    expect(navigateTarget({ href: "/giving/payments/bank?view=gifts" }, "/giving/payments/bank")).toBeNull();
    expect(navigateTarget({}, "/anywhere")).toBeNull();
  });
});

describe("waiting for a target (fake clock)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A page that gains its element after `ms`; `change` is what the MutationObserver would call. */
  function page(appearsAfterMs: number | null) {
    let element: string | null = null;
    const watchers = new Set<() => void>();
    if (appearsAfterMs !== null) {
      setTimeout(() => {
        element = "the-element";
        for (const w of [...watchers]) w();
      }, appearsAfterMs);
    }
    return {
      deps: {
        find: () => element,
        watch: (cb: () => void) => {
          watchers.add(cb);
          return () => watchers.delete(cb);
        },
      },
      watching: () => watchers.size,
    };
  }

  it("finds an element that is already there at once, without waiting", () => {
    const done = vi.fn();
    waitForTarget({ find: () => "now", watch: () => () => {} }, done);
    expect(done).toHaveBeenCalledWith("now");
  });

  it("waits for a page change, then reports the element once and stops watching", () => {
    const p = page(1500);
    const done = vi.fn();
    waitForTarget(p.deps, done);
    expect(done).not.toHaveBeenCalled();
    expect(p.watching()).toBe(1);
    vi.advanceTimersByTime(1499);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith("the-element");
    expect(p.watching()).toBe(0);
    vi.advanceTimersByTime(TARGET_WAIT_MS * 2);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("gives up after the time box with null, so the card can say the screen is not there", () => {
    const p = page(null);
    const done = vi.fn();
    waitForTarget(p.deps, done);
    vi.advanceTimersByTime(TARGET_WAIT_MS - 1);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(null);
    expect(p.watching()).toBe(0);
  });

  it("an element that shows up just as time runs out still counts", () => {
    const p = page(TARGET_WAIT_MS);
    const done = vi.fn();
    waitForTarget(p.deps, done);
    vi.advanceTimersByTime(TARGET_WAIT_MS);
    expect(done).toHaveBeenCalledWith("the-element");
  });

  it("stopping the wait (the person skipped, or moved on) reports nothing and cleans up", () => {
    const p = page(2000);
    const done = vi.fn();
    const stop = waitForTarget(p.deps, done);
    vi.advanceTimersByTime(500);
    stop();
    expect(p.watching()).toBe(0);
    vi.advanceTimersByTime(TARGET_WAIT_MS * 2);
    expect(done).not.toHaveBeenCalled();
  });

  it("a whole cross-page tour: Next goes to the page, the wait is cancelled by Skip, and nothing lingers", () => {
    // The runner's contract in miniature: a step in the waiting phase navigates (once) and waits; Skip cancels the wait.
    const tour = tourOf([step("home", { href: "/" }), step("bank", { href: "/giving/payments/bank" })]);
    const visited: string[] = [];
    const p = page(4000);
    let state = reduceTour(tour, startTour(), { type: "found" });
    state = reduceTour(tour, state, { type: "next" });
    const current = stepAt(tour, state.index)!;
    const go = navigateTarget(current, "/");
    if (go) visited.push(go);
    const done = vi.fn((el: string | null) => {
      state = reduceTour(tour, state, { type: el ? "found" : "missing" });
    });
    const stop = waitForTarget(p.deps, done);
    vi.advanceTimersByTime(1000);
    expect(visited).toEqual(["/giving/payments/bank"]);
    state = reduceTour(tour, state, { type: "skip" });
    stop();
    vi.advanceTimersByTime(TARGET_WAIT_MS * 2);
    expect(done).not.toHaveBeenCalled();
    expect(state).toMatchObject({ ended: "skipped", announce: "Tour skipped" });
    expect(p.watching()).toBe(0);
  });
});

describe("keys of a data-spotlight attribute", () => {
  it("builds a selector that also matches an element carrying several keys", () => {
    expect(selectorFor("bank-line")).toBe('[data-spotlight~="bank-line"]');
    expect(selectorFor("nav:giving")).toBe('[data-spotlight~="nav:giving"]');
  });

  it("refuses a key that could break out of the selector", () => {
    expect(isValidKey('a"],body[x="')).toBe(false);
    expect(isValidKey("")).toBe(false);
    expect(() => selectorFor("a b")).toThrow();
  });
});
