import type { DbErrorLike } from "@/lib/errors";
import { untypedRpc } from "@/lib/payments/rpc";
import type { AppSupabase } from "@/lib/supabase/server";

import type { ActivityEvent } from "./event";

// app.record_activity(p_center, p_events) is written by the database half of this feature and is not in the
// generated types yet, so it is called through the repo's untyped RPC helper. While the function does not
// exist (the migration is not applied yet) recording is "unavailable": noted once in the server log, retried
// after a while, never an error for the person.

/** Events per database call; the database caps a call too. */
export const EVENTS_PER_CALL = 50;
const UNAVAILABLE_RETRY_MS = 10 * 60 * 1000;
const LOG_AGAIN_MS = 5 * 60 * 1000;

export type SendOutcome = { status: "sent"; count: number } | { status: "unavailable" } | { status: "failed"; code: string };

type State = { unavailableUntil: number; loggedAt: Map<string, number> };
const state: State = { unavailableUntil: 0, loggedAt: new Map() };

/** For tests: forget what was learned about the database. */
export function resetSendState(): void {
  state.unavailableUntil = 0;
  state.loggedAt.clear();
}

export function isFunctionMissing(error: DbErrorLike): boolean {
  const code = error.code ?? "";
  const message = error.message ?? "";
  return code === "PGRST202" || code === "42883" || /could not find the function|function .* does not exist/i.test(message);
}

function logOnce(code: string, line: string, detail: string, now: number): void {
  const last = state.loggedAt.get(code);
  if (last !== undefined && now - last < LOG_AGAIN_MS) return;
  state.loggedAt.set(code, now);
  console.error(line, detail);
}

export type SendDeps = { now?: () => number };

/**
 * Hand events to the database. Never throws and never logs the events themselves: a failure is logged
 * (code and message only) at most once every few minutes per kind of failure.
 */
export async function sendEvents(db: AppSupabase, centerId: string, events: readonly ActivityEvent[], deps: SendDeps = {}): Promise<SendOutcome> {
  const now = deps.now ?? Date.now;
  if (events.length === 0) return { status: "sent", count: 0 };
  if (now() < state.unavailableUntil) return { status: "unavailable" };
  let sent = 0;
  try {
    const rpc = untypedRpc(db);
    for (let i = 0; i < events.length; i += EVENTS_PER_CALL) {
      const batch = events.slice(i, i + EVENTS_PER_CALL);
      const res = await rpc("record_activity", { p_center: centerId, p_events: batch });
      if (res.error) {
        if (isFunctionMissing(res.error)) {
          state.unavailableUntil = now() + UNAVAILABLE_RETRY_MS;
          logOnce(
            "unavailable",
            "[activity] recording is unavailable: the database has no record_activity function yet (has the latest migration been applied?).",
            "",
            now(),
          );
          return { status: "unavailable" };
        }
        const code = res.error.code ?? "unknown";
        logOnce(code, `[activity] could not record activity (code ${code}):`, res.error.message ?? "", now());
        return { status: "failed", code };
      }
      sent += batch.length;
    }
    return { status: "sent", count: sent };
  } catch (error) {
    logOnce("thrown", "[activity] could not record activity:", error instanceof Error ? error.message : String(error), now());
    return { status: "failed", code: "thrown" };
  }
}
