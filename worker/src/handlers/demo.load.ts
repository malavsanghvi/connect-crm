// demo.load: load a Demo data pack into a sandbox (o-demo). The admin asked with
// app.activate_demo_pack (or app.reset_sandbox, after the clear). The database owns
// the steps: each call of app.worker_demo_load_next runs the next one in its own
// transaction, so the Setup › Demo data screen shows the progress and a retry
// resumes where the last try stopped. A refusal (the organization is not a
// sandbox any more) fails the job at once with the database's plain message.

import { PermanentError, messageOf } from "../errors";
import type { Job, JobContext } from "../types";
import { isRefusal, recordFailure, requireCenter } from "../demo/common";

export const kind = "demo.load";

/** A pack has ten steps; this bounds a runaway loop if a step ever stops advancing. */
export const MAX_STEPS = 50;

export type LoadStep = { done?: boolean; status?: string; steps_done?: number; steps_total?: number; step?: string; loaded?: Record<string, number> };

export async function run(job: Job, ctx: JobContext) {
  const center = requireCenter(job, kind);
  let last: LoadStep | null = null;
  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      const rows = await ctx.db.query<{ result: LoadStep }>("select app.worker_demo_load_next($1) as result", [center]);
      last = rows[0]?.result ?? null;
      if (!last) throw new Error("The database returned nothing for the next demo step.");
      if (last.done) {
        ctx.log.info("demo pack loaded", { center, status: last.status, steps: last.steps_done });
        return { status: last.status ?? "loaded", steps_done: last.steps_done ?? null, loaded: last.loaded ?? null };
      }
      ctx.log.info("demo step done", { center, step: last.step, done: last.steps_done, total: last.steps_total });
    }
    throw new PermanentError(`The demo load did not finish after ${MAX_STEPS} steps; it was stopped so it cannot run forever.`);
  } catch (err) {
    const refusal = isRefusal(err) || err instanceof PermanentError;
    const final = refusal || job.attempts >= job.max_attempts;
    await recordFailure(ctx, center, messageOf(err), final);
    ctx.log.error("demo load failed", { center, error: messageOf(err), final, lastStep: last?.step ?? null });
    if (refusal) throw err instanceof PermanentError ? err : new PermanentError(messageOf(err));
    throw err;
  }
}
