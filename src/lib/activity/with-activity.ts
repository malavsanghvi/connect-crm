import { currentActivityContext } from "./context";
import { isActivityUuid, outcomeOfResult, type ActivityEvent } from "./event";
import { recordActivity, type ActivityContext, type ActivityInput } from "./record";

/** What an action was about: a kind word ("payment") and the record's id. Ignored unless the id is a uuid. */
export type EntityRef = { kind?: string; id?: string | null };
/** Either a fixed reference, or one read from the action's result (for an id the action only learns by running). */
export type EntityFrom<R> = EntityRef | ((result: R | undefined) => EntityRef | null | undefined);

export type ActivityOptions<R> = {
  entityFrom?: EntityFrom<R>;
  /** How the person started it. Default "screen" (a button or form in the portal). */
  via?: ActivityEvent["via"];
};

/** What the shared helpers (runAction) accept to turn recording on: a key, or a key with options. */
export type ActivityOption<R = unknown> = string | ({ key: string } & ActivityOptions<R>);

export type WithActivityDeps = {
  clock: () => number;
  context: () => Promise<ActivityContext | null>;
  record: (ctx: ActivityContext, event: ActivityInput) => boolean;
};

function entityOf<R>(from: EntityFrom<R> | undefined, result: R | undefined): Pick<ActivityEvent, "entity_kind" | "entity_id"> {
  if (!from) return {};
  try {
    const ref = typeof from === "function" ? from(result) : from;
    if (ref && ref.kind && isActivityUuid(ref.id)) return { entity_kind: ref.kind, entity_id: ref.id };
  } catch {
    // Reading the entity must never matter to the action.
  }
  return {};
}

// Control-flow errors Next.js throws on purpose (redirect, notFound, ...) carry a `digest`. A redirect after
// a save is a success; the others are not failures of the action, so they are not recorded as one.
function digestOf(error: unknown): string | null {
  const digest = typeof error === "object" && error !== null ? (error as { digest?: unknown }).digest : undefined;
  return typeof digest === "string" ? digest : null;
}

export function createWithActivity(deps: WithActivityDeps) {
  /**
   * Run an action and note it in the activity stream: its key, how long it took, and whether it worked (an
   * ActionResult with `ok: false` is an error; a throw is an error and is thrown again unchanged; a Next.js
   * redirect counts as ok). The action's result is returned as it came, the same object, and recording can
   * never delay it or make it fail: the note is made afterwards, detached, and everything in it is caught.
   */
  return async function withActivity<R>(key: string, action: () => Promise<R>, opts: ActivityOptions<R> = {}): Promise<R> {
    const started = deps.clock();
    // Ask for the session now: the action asks for it too, and the request shares one load.
    let contextPromise: Promise<ActivityContext | null>;
    try {
      contextPromise = deps.context().catch(() => null);
    } catch {
      contextPromise = Promise.resolve(null);
    }

    const note = (outcome: Pick<ActivityEvent, "outcome" | "error_code">, result: R | undefined): void => {
      const duration_ms = Math.max(0, Math.round(deps.clock() - started));
      void (async () => {
        try {
          const ctx = await contextPromise;
          if (!ctx) return;
          deps.record(ctx, { key, ...outcome, duration_ms, via: opts.via ?? "screen", ...entityOf(opts.entityFrom, result) });
        } catch (error) {
          console.error("[activity] could not note an action:", error instanceof Error ? error.message : String(error));
        }
      })();
    };

    let result: R;
    try {
      result = await action();
    } catch (error) {
      const digest = digestOf(error);
      if (digest === null) note({ outcome: "error", error_code: "exception" }, undefined);
      else if (digest.startsWith("NEXT_REDIRECT")) note({ outcome: "ok" }, undefined);
      throw error;
    }
    note(outcomeOfResult(result), result);
    return result;
  };
}

export const withActivity = createWithActivity({
  clock: () => performance.now(),
  context: currentActivityContext,
  record: recordActivity,
});

/** Normalise the `activity` argument of the runAction helpers. */
export function activityParts<R>(option: ActivityOption<R>): { key: string; opts: ActivityOptions<R> } {
  return typeof option === "string" ? { key: option, opts: {} } : { key: option.key, opts: { entityFrom: option.entityFrom, via: option.via } };
}
