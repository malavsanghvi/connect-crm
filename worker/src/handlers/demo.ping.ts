// demo.ping: proves the queue works end to end. Payload (all optional):
//   fail_times  fail this many attempts before succeeding (to see a retry)
//   secret      { connection_id, name }: read that secret through the vault
//               (logged) and report only that it was found, never the value
//   echo        any small value, returned as is

import { PermanentError } from "../errors";
import type { Job, JobContext } from "../types";

export const kind = "demo.ping";

export async function run(job: Job, ctx: JobContext) {
  const p = job.payload ?? {};
  const failTimes = typeof p.fail_times === "number" && Number.isInteger(p.fail_times) ? p.fail_times : 0;
  if (job.attempts <= failTimes) {
    throw new Error(`Test failure ${job.attempts} of ${failTimes}, as the job asked (it will be retried).`);
  }
  let secret: { found: boolean } | undefined;
  if (p.secret !== undefined) {
    const s = p.secret as { connection_id?: unknown; name?: unknown };
    if (typeof s.connection_id !== "string" || typeof s.name !== "string") {
      throw new PermanentError("demo.ping: secret must be { connection_id, name }.");
    }
    const value = await ctx.secret(s.connection_id, s.name);
    secret = { found: value !== null };
  }
  ctx.log.info("pong", { attempt: job.attempts });
  return { pong: true, attempt: job.attempts, at: new Date().toISOString(), worker: ctx.workerId, ...(secret ? { secret } : {}), ...(p.echo !== undefined ? { echo: p.echo } : {}) };
}
