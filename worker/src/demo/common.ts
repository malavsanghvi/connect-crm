// Shared by the demo.load and demo.clear handlers (o-demo).

import { PermanentError } from "../errors";
import type { Job, JobContext } from "../types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The job's organization; demo jobs are always queued for one center. */
export function requireCenter(job: Job, kind: string): string {
  if (typeof job.center_id !== "string" || !UUID.test(job.center_id)) {
    throw new PermanentError(`${kind} needs the organization it is for (the job has no center).`);
  }
  return job.center_id;
}

/**
 * The database said no on purpose: a RAISE (P0001), "Demo data is only for
 * sandboxes." (CCDMO) or a refused permission (42501). Retrying cannot help.
 */
export function isRefusal(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "P0001" || code === "CCDMO" || code === "42501";
}

/** Put the failure on the Demo data screen; a failure to record it is logged, never hidden. */
export async function recordFailure(ctx: JobContext, center: string, message: string, final: boolean): Promise<void> {
  try {
    await ctx.db.query("select app.worker_demo_failed($1, $2, $3)", [center, message, final]);
  } catch (recordErr) {
    ctx.log.error("could not record the demo job's failure on the Demo data screen", { center, error: recordErr, jobError: message });
  }
}
