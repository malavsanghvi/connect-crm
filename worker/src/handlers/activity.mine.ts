// activity.mine: once a day, (1) find repeated sequences of actions in every community whose activity recording is on and
// write them as automation ideas (app.worker_mine_activity, migration 0622), then (2) delete activity events older than 400
// days (app.activity_purge, migration 0623), in batches so a large backlog does not hold one huge delete open. The database
// does the work; the worker only calls it. Platform-wide, scheduled by the generic `every` scheduler in worker/src/server.ts;
// no provider secret is needed, so it is always configured. A community whose recording is off is not mined (but its old
// events are still purged).

import type { Job, JobContext } from "../types";

export const kind = "activity.mine";
export const every = 24 * 3600;

const PURGE_BATCH = 5000;

export type MineResult = { communities: number; candidates: number; failed: number; purged: number };

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export async function run(_job: Job, ctx: JobContext): Promise<MineResult> {
  const rows = await ctx.db.query<{ r: Record<string, unknown> | null }>("select app.worker_mine_activity() as r");
  const r = rows[0]?.r ?? {};
  let purged = 0;
  for (let round = 0; round < 50; round++) {
    const del = await ctx.db.query<{ n: number }>("select app.activity_purge($1::int) as n", [PURGE_BATCH]);
    const n = count(del[0]?.n);
    purged += n;
    if (n < PURGE_BATCH) break;
  }
  const result: MineResult = {
    communities: count(r.communities),
    candidates: count(r.candidates),
    failed: count(r.failed),
    purged,
  };
  if (result.failed > 0) {
    // One community's trouble never stops the rest; the database logged which one (a warning) and it is tried again tomorrow.
    ctx.log.warn("activity.mine: some communities could not be mined; they are tried again tomorrow", { ...result });
  } else {
    ctx.log.info("activity.mine: automation ideas updated and old activity removed", { ...result });
  }
  return result;
}
