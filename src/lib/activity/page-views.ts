// Counting how long each screen is on view, in the browser. Pure: the clock and the page's visibility are fed in.
//
// A screen's time is the time the page was visible while it was open (the Page Visibility API), so a tab left
// in the background does not count. When the person navigates, the finished screen is handed back. When the
// page is hidden or closed, the screen so far is handed back and counting starts again for the same screen if
// the person returns to it (a second visit, with its own time).

import { screenKey } from "./route-pattern";

/** A screen visit shorter than this is a redirect passing through, not a visit. */
export const MIN_VIEW_MS = 300;

export type FinishedView = { key: string; duration_ms: number; at: string };

type Current = { key: string; visibleMs: number; since: number | null; startedAt: number };

export type PageViewClock = { now: () => number; wallClock: () => number };

export function createPageViewTracker(clock: PageViewClock, initiallyVisible: boolean) {
  let visible = initiallyVisible;
  let current: Current | null = null;

  function close(): FinishedView | null {
    if (!current) return null;
    const ms = current.visibleMs + (current.since !== null ? clock.now() - current.since : 0);
    const done = { key: current.key, duration_ms: Math.round(ms), at: new Date(current.startedAt).toISOString() };
    current = null;
    return done.duration_ms >= MIN_VIEW_MS ? done : null;
  }

  function open(key: string): void {
    current = { key, visibleMs: 0, since: visible ? clock.now() : null, startedAt: clock.wallClock() };
  }

  return {
    /** The person arrived on a screen. Returns the screen they left, if it counted. */
    enter(pathname: string, dynamicValues: readonly string[] = []): FinishedView | null {
      const finished = close();
      open(screenKey(pathname, dynamicValues));
      return finished;
    },
    /** The page was hidden (visible = false) or shown again (true). Hiding returns the screen so far. */
    visibility(nowVisible: boolean): FinishedView | null {
      if (nowVisible === visible) return null;
      visible = nowVisible;
      if (!current) return null;
      if (!nowVisible) {
        const key = current.key;
        const finished = close();
        open(key);
        return finished;
      }
      current.since = clock.now();
      return null;
    },
    /** The page is going away. Returns the screen so far. */
    leave(): FinishedView | null {
      return close();
    },
    /** Stop counting without reporting (recording was switched off). */
    reset(): void {
      current = null;
    },
  };
}
