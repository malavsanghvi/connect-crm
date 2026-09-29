// niva.retention: enforce the "conversation logs kept 30 days" promise shown
// on the content/niva admin screen and in connect-mobile's niva.footer
// (backlog B14). Platform-wide, scheduled daily by the generic `every`
// scheduler in worker/src/server.ts — no provider secret needed, so it is
// always configured.

import type { Job, JobContext } from "../types";

export const kind = "niva.retention";
export const every = 24 * 3600;

export async function run(_job: Job, ctx: JobContext) {
  let total = 0;
  // Loop in batches so a very large backlog (first run after this shipped,
  // or a gap while the worker was down) does not hold one giant delete open.
  for (let round = 0; round < 50; round++) {
    const rows = await ctx.db.query<{ r: number }>("select app.niva_expired_conversations(1000) as r");
    const n = rows[0]?.r ?? 0;
    total += n;
    if (n < 1000) break;
  }
  ctx.log.info("niva.retention: removed conversations past 30 days", { deleted: total });
  return { deleted: total };
}
