// activity.mine: once a day, (1) recompute the automation ideas (repeated sequences of actions) of every community whose
// activity recording is on, one community per call so that one slow or failing community stops nobody else
// (app.worker_activity_centers and app.worker_mine_activity, migration 0622), then (2) ALWAYS run the retention: delete
// activity events older than 400 days and, once a run, sweep the events of anyone who no longer passes the recording rules
// (app.activity_purge, migration 0623), in batches so a large backlog does not hold one huge delete open. The database
// does the work; the worker only calls it. Platform-wide, scheduled by the generic `every` scheduler in
// worker/src/server.ts; no provider secret is needed, so it is always configured. A community whose recording is off is
// not mined (but its old events are still purged).

import { messageOf } from "../errors";
import type { Job, JobContext } from "../types";

export const kind = "activity.mine";
export const every = 24 * 3600;

const PURGE_BATCH = 5000;
const MAX_PURGE_ROUNDS = 50;

export type MineResult = { communities: number; candidates: number; failed: number; expired: number; swept: number };

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export async function run(_job: Job, ctx: JobContext): Promise<MineResult> {
  let communities = 0;
  let candidates = 0;
  let failed = 0;

  // 1. Mine each community in its own call and its own try/catch.
  try {
    const centers = await ctx.db.query<{ center_id: string }>("select center_id from app.worker_activity_centers()");
    for (const c of centers) {
      try {
        const rows = await ctx.db.query<{ r: Record<string, unknown> | null }>("select app.worker_mine_activity($1::uuid) as r", [c.center_id]);
        communities += 1;
        candidates += count(rows[0]?.r?.candidates);
      } catch (err) {
        failed += 1;
        ctx.log.error("activity.mine: could not mine one community; it is tried again tomorrow", { center: c.center_id, error: messageOf(err) });
      }
    }
  } catch (err) {
    failed += 1;
    ctx.log.error("activity.mine: could not list the communities to mine; the retention still runs", { error: messageOf(err) });
  }

  // 2. The retention always runs, whatever happened above. The sweep is asked for on the first call only.
  let expired = 0;
  let swept = 0;
  for (let round = 0; round < MAX_PURGE_ROUNDS; round++) {
    const rows = await ctx.db.query<{ r: Record<string, unknown> | null }>("select app.activity_purge($1::int, $2::boolean) as r", [PURGE_BATCH, round === 0]);
    const done = count(rows[0]?.r?.expired);
    expired += done;
    swept += count(rows[0]?.r?.swept);
    if (done < PURGE_BATCH) break;
  }

  const result: MineResult = { communities, candidates, failed, expired, swept };
  if (failed > 0) {
    ctx.log.warn("activity.mine: some communities could not be mined; they are tried again tomorrow", { ...result });
  } else {
    ctx.log.info("activity.mine: automation ideas updated and old activity removed", { ...result });
  }
  return result;
}
