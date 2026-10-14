// The step machine of a tour: pure, no DOM. The runner (src/components/spotlight/spotlight-runner.tsx) sends it what happened
// (the target was found, never showed up, a button was pressed) and draws what it answers. Everything about moving between
// steps lives here so it can be tested without a browser.

import { SPOTLIGHT_TEXT as T } from "./copy";
import type { TourDef, TourStep } from "./types";

/** waiting: looking for the step's target (and, after Next, waiting for the page to arrive); ready: lit; missing: it never showed up. */
export type Phase = "waiting" | "ready" | "missing";

export type MachineState = {
  index: number;
  phase: Phase;
  /** The way the person is moving, so an optional step that is left out lets them carry on in the same direction. */
  direction: 1 | -1;
  /** Set once, when the tour is over: finished, or skipped/closed (one action, from any step). */
  ended: null | "completed" | "skipped";
  /** The words for the polite live region when something worth announcing happened. */
  announce: string | null;
  /** Goes up with every announcement, so the same words twice in a row are still spoken twice. */
  tick: number;
};

export type MachineEvent =
  | { type: "found" }
  | { type: "missing" }
  | { type: "next" }
  | { type: "back" }
  /** Skip tour, the X, Esc and the plain Close button are all this one event. */
  | { type: "skip" }
  | { type: "finish" }
  | { type: "retry" };

export function startTour(): MachineState {
  return { index: 0, phase: "waiting", direction: 1, ended: null, announce: null, tick: 0 };
}

export function stepAt(tour: Pick<TourDef, "steps">, index: number): TourStep | undefined {
  return tour.steps[index];
}

export function isLastStep(tour: Pick<TourDef, "steps">, s: Pick<MachineState, "index">): boolean {
  return s.index >= tour.steps.length - 1;
}

function say(s: MachineState, text: string): MachineState {
  return { ...s, announce: text, tick: s.tick + 1 };
}

function end(s: MachineState, how: "completed" | "skipped"): MachineState {
  return say({ ...s, ended: how }, how === "skipped" ? T.announceSkipped : T.announceFinished);
}

/** An optional step whose target is not there is left out; carry on the way the person was going. */
function leaveOut(tour: TourDef, s: MachineState): MachineState {
  const toward = s.index + s.direction;
  if (toward >= tour.steps.length) return end(s, "completed");
  if (toward < 0) {
    // Going back from the first optional step with nothing before it: go forward instead.
    return s.index + 1 < tour.steps.length ? { ...s, index: s.index + 1, direction: 1, phase: "waiting" } : end(s, "completed");
  }
  return { ...s, index: toward, phase: "waiting" };
}

export function reduceTour(tour: TourDef, s: MachineState, e: MachineEvent): MachineState {
  if (s.ended) return s;
  const step = tour.steps[s.index];
  if (!step) return end(s, "completed");
  switch (e.type) {
    case "found":
      // Also from "missing": a page that arrives after the wait ran out lights the step by itself.
      if (s.phase === "ready") return s;
      return say({ ...s, phase: "ready" }, T.announceStep(s.index + 1, tour.steps.length, step.title));
    case "missing":
      if (s.phase !== "waiting") return s;
      if (step.optional) return leaveOut(tour, s);
      return say({ ...s, phase: "missing" }, `${T.announceStep(s.index + 1, tour.steps.length, step.title)}. ${step.missing ?? T.missing}`);
    case "retry":
      return s.phase === "missing" ? { ...s, phase: "waiting" } : s;
    case "next":
      if (isLastStep(tour, s)) return end(s, "completed");
      return { ...s, index: s.index + 1, direction: 1, phase: "waiting" };
    case "back":
      if (s.index === 0) return s;
      return { ...s, index: s.index - 1, direction: -1, phase: "waiting" };
    case "skip":
      return end(s, "skipped");
    case "finish":
      return end(s, "completed");
  }
}

/** The path of a step's address without its query string or hash, for deciding whether the person is already on that page. */
export function pathOf(href: string): string {
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path || "/";
}

/** Where to go for a step, or null when the person is already on its page (or the step has no page of its own). */
export function navigateTarget(step: Pick<TourStep, "href">, currentPath: string): string | null {
  if (!step.href) return null;
  return pathOf(step.href) === pathOf(currentPath) ? null : step.href;
}
