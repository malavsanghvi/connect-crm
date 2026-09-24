// demo.clear: clear a sandbox (o-demo) — everything the organization entered or
// loaded, keeping the organization itself, its owner and staff logins, agreements,
// connections and the audit log (the list is app.demo_keep_tables()). The admin
// asked with app.clear_sandbox or app.reset_sandbox (short name typed, fresh 2FA).
// The clear runs in the database as ONE transaction (app.worker_demo_clear), which
// refuses any center that is not an open sandbox; for a reset it also queues
// demo.load in that same transaction.

import { PermanentError, messageOf } from "../errors";
import type { Job, JobContext } from "../types";
import { isRefusal, recordFailure, requireCenter } from "../demo/common";

export const kind = "demo.clear";

export async function run(job: Job, ctx: JobContext) {
  const center = requireCenter(job, kind);
  try {
    const rows = await ctx.db.query<{ result: Record<string, unknown> }>("select app.worker_demo_clear($1) as result", [center]);
    const result = rows[0]?.result ?? {};
    ctx.log.info("sandbox cleared", { center, removed: result.removed_total ?? null, thenLoad: result.then_load ?? null });
    return { removed_total: result.removed_total ?? null, kept_logins: result.kept_logins ?? null, then_load: result.then_load ?? null, load_job: result.load_job ?? null };
  } catch (err) {
    const refusal = isRefusal(err);
    const final = refusal || job.attempts >= job.max_attempts;
    await recordFailure(ctx, center, messageOf(err), final);
    ctx.log.error("sandbox clear failed", { center, error: messageOf(err), final });
    if (refusal) throw new PermanentError(messageOf(err));
    throw err;
  }
}
