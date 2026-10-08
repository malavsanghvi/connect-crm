// storage.scan_sweep: every 6 hours while virus scanning is on (and at once when a platform admin switches it on, which
// queues one), queue a check (storage.scan) for each file that needs one (app.worker_scan_sweep, migration 0589):
//   - a file of a scanned bucket with no result for its current version and no check waiting: the backlog of every file
//     uploaded before scanning started (scanned once, owner decision 2026-10-06), and any check that was lost;
//   - in enforce mode, an infected file still stored (kept while the mode was monitor, or a removal that did not finish);
//   - a check that failed for a passing reason (no signature) more than a day ago.
// At most `limit` of each per run (default 500), oldest first. It waits in the queue while scanning is off, like the
// checks themselves.

import type { Job, JobContext } from "../types";
import { scanConfigured } from "../upload-scan";

export const kind = "storage.scan_sweep";
export const every = 6 * 3600;
export const waitWhenNotConfigured = true;
export const configured = scanConfigured;

export async function run(job: Job, ctx: JobContext) {
  const limit = typeof job.payload?.limit === "number" ? Math.min(Math.max(Math.trunc(job.payload.limit), 1), 5000) : 500;
  const rows = await ctx.db.query<{ r: Record<string, unknown> | null }>("select app.worker_scan_sweep($1::int) as r", [limit]);
  const r = rows[0]?.r ?? {};
  ctx.log.info("virus check sweep", r);
  return r;
}
