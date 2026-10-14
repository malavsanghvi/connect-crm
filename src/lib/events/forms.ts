// Form parsing for Server Actions in the Events module (moved from
// connect-admin lib/forms.ts, adapted to this app's ActionResult/failure()).

import { unstable_rethrow } from "next/navigation";

import { activityParts, withActivity, type ActivityOption } from "@/lib/activity/with-activity";
import { explainError, failure, type ActionResult } from "@/lib/errors";

import { FormError } from "./form-fields";

// The field readers are pure (form-fields.ts) so the event rules can run in the browser too; re-exported here for the actions.
export { FormError, all, bool, cents, centsList, dateTime, int, isoDate, oneOf, reqStr, str } from "./form-fields";

/** A database step failed; `doing` says which step, in plain words ("save the event"). */
export class DbFailure extends Error {
  constructor(
    public readonly dbError: unknown,
    public readonly doing: string,
  ) {
    super(`${doing}: ${explainError(dbError)}`);
    this.name = "DbFailure";
  }
}

/** Throw a DbFailure if the query failed, else return its data. */
export function must<R extends { data: unknown; error: unknown }>(res: R, doing: string): NonNullable<R["data"]> | null {
  if (res.error) throw new DbFailure(res.error, doing);
  return (res.data ?? null) as NonNullable<R["data"]> | null;
}

/**
 * Wrap a Server Action body: validation errors become plain-English results,
 * database errors are logged and explained, redirects pass through.
 * `doing` completes "Could not …" ("save the event").
 * `activity` (an activity key such as "events.save_event", optionally with the entity it is about) notes the
 * action in the activity stream: how long it took and whether it worked. It never changes the result.
 */
export async function runAction<T = unknown>(
  context: string,
  doing: string,
  fn: () => Promise<ActionResult<T>>,
  activity?: ActivityOption<ActionResult<T>>,
): Promise<ActionResult<T>> {
  if (!activity) return runActionBody(context, doing, fn);
  const { key, opts } = activityParts(activity);
  return withActivity(key, () => runActionBody(context, doing, fn), opts);
}

async function runActionBody<T>(context: string, doing: string, fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof FormError) return { ok: false, error: `Could not ${doing} — ${lowerFirst(error.message)}` };
    if (error instanceof DbFailure) return failure(`Could not ${error.doing}`, error.dbError);
    console.error(`[events] ${context} failed:`, error);
    return failure(`Could not ${doing}`, error);
  }
}

function lowerFirst(s: string): string {
  // Keep proper nouns and acronyms ("RSVPs must close…", "Lunch starts…") readable.
  if (/^[A-Z]{2}/.test(s)) return s;
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}
