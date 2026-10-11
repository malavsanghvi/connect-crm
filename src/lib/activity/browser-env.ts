// The real browser behind the beacon engine: Page Visibility, sendBeacon, fetch with keepalive and a
// per-tab session id in sessionStorage. Every browser feature is optional; a missing one only means fewer
// screen counts.

import { newRequestId } from "@/lib/supabase/trace";

import type { BeaconEnv } from "./beacon-engine";
import type { BeaconPayload } from "./ingest";

export const ACTIVITY_ENDPOINT = "/api/activity";
const SESSION_KEY = "weaver.activity.session";

type Transport = {
  sendBeacon?: (url: string, data: Blob) => boolean;
  fetch?: typeof fetch;
};

/** Send a batch. While the page is going away, sendBeacon is the only way that reliably gets out. */
export function postScreens(payload: BeaconPayload, unloading: boolean, transport: Transport): void {
  const body = JSON.stringify(payload);
  try {
    if (unloading && transport.sendBeacon && transport.sendBeacon(ACTIVITY_ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    transport.fetch?.(ACTIVITY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    })?.catch(() => undefined);
  } catch {
    // Background work: never an error for the person.
  }
}

function tabSession(): { id: string; nextSeq: () => number } {
  let id = "";
  let seq = 0;
  try {
    const saved = window.sessionStorage.getItem(SESSION_KEY);
    const parsed = saved ? (JSON.parse(saved) as { id?: unknown; seq?: unknown }) : null;
    if (parsed && typeof parsed.id === "string" && typeof parsed.seq === "number") {
      id = parsed.id;
      seq = parsed.seq;
    }
  } catch {
    // Storage can be blocked; the session then lives only as long as this page.
  }
  if (!id) id = newRequestId();
  return {
    id,
    nextSeq() {
      seq += 1;
      try {
        window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, seq }));
      } catch {
        // See above.
      }
      return seq;
    },
  };
}

export function browserBeaconEnv(): BeaconEnv {
  const session = tabSession();
  return {
    now: () => performance.now(),
    wallClock: () => Date.now(),
    isVisible: () => document.visibilityState === "visible",
    send: (payload, unloading) =>
      postScreens(payload, unloading, {
        sendBeacon: typeof navigator.sendBeacon === "function" ? navigator.sendBeacon.bind(navigator) : undefined,
        fetch: typeof fetch === "function" ? fetch.bind(globalThis) : undefined,
      }),
    session: () => session,
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  };
}
