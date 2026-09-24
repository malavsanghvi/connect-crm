// platform.promote: copy a sandbox's configuration into a new production
// organization (ONBOARDING_PLAN §5). The owner asked for it with
// app.promote_sandbox (fresh 2FA, an approved go-live); the copy itself runs in
// the database as one transaction (app.worker_promote_sandbox): configuration
// only — never people, transactions, files, connections or secrets — with the
// staff re-invited. A refusal from the database (the web name was taken
// meanwhile, the approval was withdrawn) cannot get better by retrying, so it
// fails the job and the promotion at once with the database's plain message.

import { PermanentError, messageOf } from "../errors";
import type { Job, JobContext } from "../types";

export const kind = "platform.promote";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A RAISE in plpgsql (SQLSTATE P0001) or a refused permission: the database said no on purpose. */
export function isRefusal(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "P0001" || code === "42501";
}

export async function run(job: Job, ctx: JobContext) {
  const id = job.payload?.promotion_id;
  if (typeof id !== "string" || !UUID.test(id)) throw new PermanentError("platform.promote needs { promotion_id } (a uuid).");
  try {
    const rows = await ctx.db.query<{ result: unknown }>("select app.worker_promote_sandbox($1) as result", [id]);
    const result = rows[0]?.result ?? null;
    ctx.log.info("sandbox promoted", { promotion: id });
    return result;
  } catch (err) {
    const refusal = isRefusal(err);
    const final = refusal || job.attempts >= job.max_attempts;
    const message = messageOf(err);
    try {
      await ctx.db.query("select app.worker_promotion_failed($1, $2, $3)", [id, message, final]);
    } catch (recordErr) {
      ctx.log.error("could not record the failed promotion", { promotion: id, error: recordErr });
    }
    ctx.log.error("promotion failed", { promotion: id, error: message, final });
    if (refusal) throw new PermanentError(message);
    throw err;
  }
}
