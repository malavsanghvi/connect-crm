// The browser side of screen recording, apart from the page itself so it can be tested: it keeps the screen
// visits and sends them in small batches. The component (src/components/shell/activity-beacon.tsx) only wires
// it to the page's events.
//
// Sending is background work and never shown to the person: a failure to send loses a few screen counts and
// nothing else. (Failures of the receiving side are logged on the server.)

import { MAX_BEACON_EVENTS, type BeaconPayload, type ScreenReport } from "./ingest";
import { createPageViewTracker, type FinishedView } from "./page-views";
import { shouldTrackPath } from "./route-pattern";

/** Screens wait this long for company before they are sent on their own. */
export const FLUSH_DELAY_MS = 20_000;

export type BeaconEnv = {
  now: () => number;
  wallClock: () => number;
  isVisible: () => boolean;
  /** `unloading` is true when the page is being hidden or closed: use the way that survives that. */
  send: (payload: BeaconPayload, unloading: boolean) => void;
  /** The tab's visit: a random id and the next sequence number (both kept for the life of the tab). */
  session: () => { id: string; nextSeq: () => number };
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

export function createBeaconEngine(centerId: string, env: BeaconEnv) {
  const tracker = createPageViewTracker({ now: env.now, wallClock: env.wallClock }, env.isVisible());
  const buffer: ScreenReport[] = [];
  let timer: unknown = null;
  let disposed = false;

  function flush(unloading: boolean): void {
    if (timer !== null) {
      env.clearTimer(timer);
      timer = null;
    }
    if (buffer.length === 0) return;
    const events = buffer.splice(0, buffer.length);
    try {
      env.send({ centerId, sessionId: env.session().id, events }, unloading);
    } catch {
      // Losing a batch of screen counts is acceptable; the person must never notice.
    }
  }

  function take(view: FinishedView | null): void {
    if (!view || disposed) return;
    buffer.push({ key: view.key, duration_ms: view.duration_ms, seq: env.session().nextSeq(), at: view.at });
    if (buffer.length >= MAX_BEACON_EVENTS) flush(false);
    else if (timer === null) timer = env.setTimer(() => flush(false), FLUSH_DELAY_MS);
  }

  return {
    /** The person is now on this address. A screen that is not recorded (the platform console) just ends the last one. */
    enter(pathname: string, dynamicValues: readonly string[] = []): void {
      if (disposed) return;
      if (!shouldTrackPath(pathname)) {
        take(tracker.leave());
        return;
      }
      take(tracker.enter(pathname, dynamicValues));
    },
    /** The tab was hidden or shown. Hiding sends what is waiting. */
    visibility(visible: boolean): void {
      take(tracker.visibility(visible));
      if (!visible) flush(true);
    },
    /** The page is going away (or into the back-forward cache). */
    pageHide(): void {
      take(tracker.visibility(false));
      flush(true);
    },
    /** Stop for good, sending what is waiting. */
    dispose(): void {
      take(tracker.leave());
      flush(true);
      disposed = true;
    },
  };
}

export type BeaconEngine = ReturnType<typeof createBeaconEngine>;
