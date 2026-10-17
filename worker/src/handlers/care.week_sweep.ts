// care.week_sweep: every hour, DonorDelight's weekly reminder (migration 0893). For each community that switched it on, from the chosen
// weekday at 08:00 local time (and for two days after, in case this service was down), each relationship owner with at least one care task is told
// HOW MANY (a number and the name of the section, never a household, a name or a step) through the usual messaging path, once per person and week.
// The database does all of it (app.worker_care_week_sweep): which community, who owns households, who has a task, the sandbox's verified recipients,
// suppressions and unsubscribes (app.enqueue_message), and the log of what happened to each person (app.care_week_log), including a refusal with its
// reason. This handler calls it again while it reports it stopped at its limit ("more"), at most MAX_BATCHES times; the rest waits for the next run.
// Platform-wide, scheduled by the generic `every` scheduler in worker/src/server.ts; no provider secret is needed, so it is always configured.

import type { Job, JobContext } from "../types";

export const kind = "care.week_sweep";
export const every = 3600;

/** People told at most per call (the database's own default). */
export const BATCH = 200;
/** A run's limit: 5 calls of 200 people an hour; the rest waits for the next run. */
export const MAX_BATCHES = 5;

export type CareWeekSweepResult = { batches: number; centers: number; queued: number; refused: number; no_email: number; more: boolean };

type Answer = { centers?: unknown; queued?: unknown; refused?: unknown; no_email?: unknown; more?: unknown };

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export async function run(_job: Job, ctx: JobContext): Promise<CareWeekSweepResult> {
  const out: CareWeekSweepResult = { batches: 0, centers: 0, queued: 0, refused: 0, no_email: 0, more: false };
  for (let i = 0; i < MAX_BATCHES; i++) {
    const rows = await ctx.db.query<{ result: Answer | null }>("select app.worker_care_week_sweep($1::int) as result", [BATCH]);
    const r = rows[0]?.result ?? {};
    out.batches += 1;
    out.centers = Math.max(out.centers, count(r.centers));
    out.queued += count(r.queued);
    out.refused += count(r.refused);
    out.no_email += count(r.no_email);
    out.more = r.more === true;
    // Another call only when the sweep stopped at its limit (never loop on an odd answer).
    if (!out.more) break;
  }
  if (out.refused > 0) {
    // A refusal is in the log with its reason (Communications shows it); the run itself did its job.
    ctx.log.error("care.week_sweep: some reminders were refused", { ...out });
  } else {
    ctx.log.info("care.week_sweep: weekly reminders queued", { ...out });
  }
  return out;
}
