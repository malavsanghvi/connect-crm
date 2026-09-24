// platform.sandbox_expiry: once a day, warn the owners of sandboxes that have
// been inactive for 60 and 80 days of their 90-day expiry (ONBOARDING_PLAN §3).
// The database finds them, records each warning once per threshold
// (app.sandbox_expiry_notices) and queues the email through the messaging
// service when it exists. Nothing is ever deleted here: removing an expired
// sandbox is an owner decision.

import type { Job, JobContext } from "../types";

export const kind = "platform.sandbox_expiry";

export async function run(_job: Job, ctx: JobContext) {
  const rows = await ctx.db.query<{ result: { warnings?: number } | null }>("select app.worker_sandbox_expiry() as result");
  const result = rows[0]?.result ?? { warnings: 0 };
  ctx.log.info("sandbox expiry pass finished", { warnings: result.warnings ?? 0 });
  return result;
}
