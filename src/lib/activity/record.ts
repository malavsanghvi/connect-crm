import { cache } from "react";

import type { AppSupabase } from "@/lib/supabase/server";

import { activityRecordingOn } from "./enabled";
import { normalizeEvent, type ActivityEvent } from "./event";
import { runAfterResponse } from "./schedule";
import { EVENTS_PER_CALL, sendEvents, type SendOutcome } from "./send";

/** What recording needs from a signed-in request. A CrmSession has exactly this. */
export type ActivityContext = {
  db: AppSupabase;
  center: { id: string; rules?: unknown };
};

/** An event as the callers give it: only `key` and `outcome` are required; `via`, `at` and `platform` get defaults. */
export type ActivityInput = Partial<Omit<ActivityEvent, "key" | "outcome" | "kind">> &
  Pick<ActivityEvent, "key" | "outcome"> & { kind?: ActivityEvent["kind"] };

/** The most events one request may queue; a loop that records without end cannot flood the database. */
export const MAX_QUEUED_PER_REQUEST = 200;

type Queue = { db: AppSupabase; centerId: string; events: ActivityEvent[]; scheduled: boolean };
export type RecorderScope = { queues: Map<string, Queue> };

export type RecorderDeps = {
  /** The per-request place events wait in (React `cache`, so one request shares one). */
  scope: () => RecorderScope;
  /** Runs the flush once the response has gone. */
  schedule: (task: () => Promise<void>) => void;
  send: (db: AppSupabase, centerId: string, events: readonly ActivityEvent[]) => Promise<SendOutcome>;
  now: () => number;
  /** Fields added to every event that does not set them. */
  defaults?: { platform?: string; app_version?: string };
};

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function createRecorder(deps: RecorderDeps) {
  async function flush(queue: Queue): Promise<void> {
    try {
      while (queue.events.length > 0) {
        const batch = queue.events.splice(0, EVENTS_PER_CALL);
        await deps.send(queue.db, queue.centerId, batch);
      }
    } catch (error) {
      queue.events.length = 0;
      console.error("[activity] could not record activity:", error instanceof Error ? error.message : String(error));
    } finally {
      queue.scheduled = false;
    }
  }

  /**
   * Note one event. Fire and forget: it returns at once, never throws, and sends nothing until the response
   * has been delivered; events noted in the same request travel together. Returns true when the event was
   * queued (false: recording is off for the community, or the event was not valid).
   */
  function record(ctx: ActivityContext, input: ActivityInput): boolean {
    try {
      // The community's switch: off (or never set) means nothing is queued and no call is made. A context
      // that does not know the rules (the beacon route) leaves the decision to the database.
      if (ctx.center.rules !== undefined && !activityRecordingOn(ctx.center.rules)) return false;
      const event = normalizeEvent(
        {
          via: "screen",
          platform: deps.defaults?.platform,
          app_version: deps.defaults?.app_version,
          at: new Date(deps.now()).toISOString(),
          ...stripUndefined(input),
        },
        deps.now(),
      );
      if (!event) return false;
      const scope = deps.scope();
      let queue = scope.queues.get(ctx.center.id);
      if (!queue) {
        queue = { db: ctx.db, centerId: ctx.center.id, events: [], scheduled: false };
        scope.queues.set(ctx.center.id, queue);
      }
      if (queue.events.length >= MAX_QUEUED_PER_REQUEST) return false;
      queue.events.push(event);
      if (!queue.scheduled) {
        queue.scheduled = true;
        const q = queue;
        deps.schedule(() => flush(q));
      }
      return true;
    } catch (error) {
      console.error("[activity] could not note an event:", error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  return { record };
}

const requestScope = cache((): RecorderScope => ({ queues: new Map() }));

const recorder = createRecorder({
  scope: requestScope,
  schedule: runAfterResponse,
  send: (db, centerId, events) => sendEvents(db, centerId, events),
  now: () => Date.now(),
  defaults: { platform: "web" },
});

/**
 * Record one event for the signed-in person (the database takes the person from the sign-in). Safe to call
 * anywhere on the server; see createRecorder for the guarantees. The command layer calls this from its
 * `onCommandEvent` hook.
 */
export const recordActivity: (ctx: ActivityContext, event: ActivityInput) => boolean = recorder.record;
