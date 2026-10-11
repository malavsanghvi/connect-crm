// What the server accepts from the browser beacon. Pure, so the rules are tested without a request.
//
// The browser may only report screens: a visit to a screen pattern, how long it was visible, in order. It cannot
// report actions (those are noted on the server, where the result is known), cannot name an entity and cannot
// say a visit failed. Whatever else arrives is dropped, and every screen key is checked again, so a changed
// browser still cannot send an id or a query string.

import { isActivityUuid, normalizeEvent, type ActivityEvent } from "./event";

/** Screens per beacon. The browser sends at most this many at once. */
export const MAX_BEACON_EVENTS = 25;
/** The largest beacon body we read, in characters. */
export const MAX_BEACON_BYTES = 16_000;

export type ScreenReport = {
  key: string;
  duration_ms: number;
  seq?: number;
  at?: string;
};

export type BeaconPayload = {
  centerId: string;
  /** A random id for this browser tab's visit (not tied to a person). */
  sessionId?: string;
  events: ScreenReport[];
};

export type AcceptedBeacon = { centerId: string; events: ActivityEvent[] };

export function parseBeacon(body: unknown, nowMs: number = Date.now()): AcceptedBeacon | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isActivityUuid(b.centerId) || !Array.isArray(b.events)) return null;
  const sessionId = typeof b.sessionId === "string" ? b.sessionId : undefined;

  const events: ActivityEvent[] = [];
  for (const raw of b.events.slice(0, MAX_BEACON_EVENTS)) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    // Only these fields are read; everything else the browser sent is ignored.
    const event = normalizeEvent(
      {
        key: r.key,
        kind: "screen",
        outcome: "ok",
        via: "screen",
        duration_ms: r.duration_ms,
        seq: r.seq,
        at: r.at,
        session_id: sessionId,
        platform: "web",
      },
      nowMs,
    );
    if (event && event.kind === "screen") events.push(event);
  }
  return events.length > 0 ? { centerId: b.centerId.toLowerCase(), events } : null;
}
