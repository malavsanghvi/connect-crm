"use client";

// Spotlight, mounted once in the signed-in portal layout. It holds the tours this person has (chosen on the server), what this browser
// remembers about them, and the polite live region; the overlay itself (spotlight-runner.tsx) is loaded only when a tour starts, so
// while no tour runs the cost is this small provider. Anything that needs it calls useSpotlight(): outside a provider it is idle.

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { SPOTLIGHT_TEXT as T } from "@/lib/spotlight/copy";
import { endedStatus, invitedTours, markEnded, markSeen, parseProgress, progressKey, statusOf, withToursOff } from "@/lib/spotlight/progress";
import { UNLOADED, createProgressStore } from "@/lib/spotlight/store";
import type { TourDef, TourStatus } from "@/lib/spotlight/types";

// The overlay is client-only and loaded on first use.
const SpotlightRunner = dynamic(() => import("./spotlight-runner"), { ssr: false });

/** `ok` is false when the browser would not keep the choice: the caller says so in plain words (the choice still holds for this page). */
export type Remembered = { ok: boolean };

export type SpotlightApi = {
  /** The tours this person has (plain data chosen on the server). Empty for almost everyone: then no entry point shows. */
  tours: readonly TourDef[];
  /** The id of the running tour, or null. */
  active: string | null;
  /** False on the server and during the first client render, until this browser's memory has been read. */
  loaded: boolean;
  /** "Don't show tours again" is on: no invitation anywhere. */
  toursOff: boolean;
  /** The tours to invite this person to now: never started, and tours not turned off. */
  invitations: readonly TourDef[];
  statusOf(tourId: string): TourStatus;
  start(tourId: string): void;
  /** Ends the running tour as skipped, from outside the card. */
  stop(): void;
  /** "Not now": the tour is never offered on its own again. */
  decline(tourId: string): Remembered;
  setToursOff(off: boolean): Remembered;
};

const IDLE: SpotlightApi = {
  tours: [],
  active: null,
  loaded: false,
  toursOff: false,
  invitations: [],
  statusOf: () => "not_started",
  start: () => {},
  stop: () => {},
  decline: () => ({ ok: true }),
  setToursOff: () => ({ ok: true }),
};

/** Exported so a test can stand in a state (tours off, a tour never started) without a browser. */
export const SpotlightContext = createContext<SpotlightApi>(IDLE);

export function useSpotlight(): SpotlightApi {
  return useContext(SpotlightContext);
}

const store = createProgressStore(() => (typeof window === "undefined" ? null : window.localStorage));

function subscribe(onChange: () => void): () => void {
  const off = store.subscribe(onChange);
  // Another tab of this browser changed the memory.
  window.addEventListener("storage", onChange);
  return () => {
    off();
    window.removeEventListener("storage", onChange);
  };
}

/** Back to where the person was; if that is gone (the page changed), to the page's main area. */
function restoreFocus(previous: Element | null) {
  const target = previous instanceof HTMLElement && previous.isConnected ? previous : document.querySelector<HTMLElement>("main");
  if (!target) return;
  if (!target.hasAttribute("tabindex") && !target.matches("a[href], button, input, select, textarea, summary")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

export function SpotlightProvider({ userId, tours, children }: { userId: string; tours: readonly TourDef[]; children: ReactNode }) {
  const key = progressKey(userId);
  const raw = useSyncExternalStore(subscribe, () => store.snapshot(key), () => UNLOADED);
  const loaded = raw !== UNLOADED;
  const progress = useMemo(() => parseProgress(loaded ? raw : ""), [raw, loaded]);
  const [active, setActive] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  const returnTo = useRef<Element | null>(null);
  const [message, setMessage] = useState<{ text: string; n: number }>({ text: "", n: 0 });

  const announce = useCallback((text: string) => setMessage((m) => ({ text, n: m.n + 1 })), []);

  const start = useCallback(
    (tourId: string) => {
      if (activeRef.current || !tours.some((t) => t.id === tourId)) return;
      returnTo.current = document.activeElement;
      activeRef.current = tourId;
      store.update(key, (p) => markSeen(p, tourId, new Date()));
      setActive(tourId);
    },
    [key, tours],
  );

  const finish = useCallback(
    (how: "completed" | "skipped") => {
      const id = activeRef.current;
      if (!id) return;
      activeRef.current = null;
      // Skipping or closing at any step is remembered as dismissed, so the tour never starts by itself again.
      store.update(key, (p) => markEnded(p, id, endedStatus(how), new Date()));
      setActive(null);
      restoreFocus(returnTo.current);
      returnTo.current = null;
    },
    [key],
  );

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    announce(T.announceSkipped);
    finish("skipped");
  }, [announce, finish]);

  const decline = useCallback((tourId: string): Remembered => store.update(key, (p) => markEnded(p, tourId, "dismissed", new Date())), [key]);

  const setToursOff = useCallback(
    (off: boolean): Remembered => {
      const result = store.update(key, (p) => withToursOff(p, off));
      announce(off ? T.announceOff : T.announceOn);
      return result;
    },
    [key, announce],
  );

  const api = useMemo<SpotlightApi>(
    () => ({
      tours,
      active,
      loaded,
      toursOff: progress.off,
      invitations: loaded ? invitedTours(tours, progress) : [],
      statusOf: (id) => statusOf(progress, id),
      start,
      stop,
      decline,
      setToursOff,
    }),
    [tours, active, loaded, progress, start, stop, decline, setToursOff],
  );

  const running = active ? tours.find((t) => t.id === active) : undefined;

  return (
    <SpotlightContext.Provider value={api}>
      {children}
      {running ? <SpotlightRunner tour={running} onEnd={finish} announce={announce} /> : null}
      {/* Polite announcements: "Step 3 of 8: …", "Tour skipped". It outlives the card so the last words are still spoken. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="spotlight-live">
        {message.text ? <p key={message.n}>{message.text}</p> : null}
      </div>
    </SpotlightContext.Provider>
  );
}
