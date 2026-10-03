// payments.reports_sweep: once an hour, a member's Zelle report that the bank statement has not
// shown within its window (centers.rules.payments.zelle.report_window_days, 10 days by default)
// becomes "not seen at the bank" and the member is told once (payments plan §2.9, migration 0582).
// A report whose family already has a Zelle of that amount recorded stays for the treasurer.
// The database does all of it (app.worker_payment_reports_sweep); it never creates, allocates or
// posts a payment. Platform-wide, scheduled by the generic `every` scheduler in
// worker/src/server.ts; no provider secret is needed, so it is always configured.

import type { Job, JobContext } from "../types";

export const kind = "payments.reports_sweep";
export const every = 3600;

export type SweepResult = { marked: number; notices: number; notice_failures: number; held_for_review: number };

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export async function run(_job: Job, ctx: JobContext): Promise<SweepResult> {
  const rows = await ctx.db.query<{ result: Partial<Record<keyof SweepResult, unknown>> | null }>(
    "select app.worker_payment_reports_sweep() as result",
  );
  const r = rows[0]?.result ?? {};
  const result: SweepResult = {
    marked: count(r.marked),
    notices: count(r.notices),
    notice_failures: count(r.notice_failures),
    held_for_review: count(r.held_for_review),
  };
  if (result.notice_failures > 0) {
    // The reports are still marked; payment_reports.notice_error says why each member was not told.
    ctx.log.warn("payments.reports_sweep: some members could not be told", { ...result });
  } else {
    ctx.log.info("payments.reports_sweep: Zelle reports checked against their window", { ...result });
  }
  return result;
}
