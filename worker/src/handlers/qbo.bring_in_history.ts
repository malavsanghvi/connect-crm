// qbo.bring_in_history: bring one approved QuickBooks customer's history into
// Community Connect (o-qbo-match). Queued when the treasury approves or maps a
// customer, after a pull finds new history for an approved one, and by "Try
// again" on Needs review. Payload: { qbo_customer_id }.
//
// All the rules live in app.qbo_bring_in_customer (migration 0243): payments
// and sales receipts become historical payments that never post to QuickBooks,
// invoices become pledges with their payments allocated as QuickBooks applied
// them, family-level accounts land on the household's primary member, refunds
// wait for an owner decision. Idempotent, so a retry never duplicates.

import { PermanentError } from "../errors";
import type { Job, JobContext } from "../types";

export const kind = "qbo.bring_in_history";

export async function run(job: Job, ctx: JobContext) {
  const qbo = (job.payload as { qbo_customer_id?: unknown } | null)?.qbo_customer_id;
  if (!job.center_id) throw new PermanentError("qbo.bring_in_history needs an organization.");
  if (typeof qbo !== "string" || qbo.trim() === "") throw new PermanentError("qbo.bring_in_history needs qbo_customer_id.");
  const rows = await ctx.db.query<{ r: Record<string, unknown> }>("select app.qbo_worker_bring_in($1, $2) as r", [job.center_id, qbo]);
  const result = rows[0]?.r ?? {};
  ctx.log.info("QuickBooks history brought in", { qbo_customer_id: qbo, ...result });
  return result;
}
