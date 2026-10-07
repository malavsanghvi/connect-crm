// pathshala.holds_sweep: every 15 minutes, the Pathshala seats held for payment (pay-now terms, registration plan §2.7,
// migration 0591): a reminder 6 hours before a hold ends; a hold that is no longer live (its window passed, no payment
// page for it is still open at the provider, and for an office hold no Zelle report for it waits for the treasurer) is
// released: its fee pledges are cancelled, anything already paid toward them becomes credit for the treasurer (never a
// refund), the family is told, and the seat goes to the next learner on the waitlist. A free seat with a waitlist is
// served too, and a held seat whose fee is already paid is placed (never released). The database does all of it
// (app.worker_pathshala_holds_sweep); the worker only calls it. Platform-wide, scheduled by the generic `every`
// scheduler in worker/src/server.ts; no provider secret is needed, so it is always configured.

import type { Job, JobContext } from "../types";

export const kind = "pathshala.holds_sweep";
export const every = 15 * 60;

export type SweepResult = {
  reminded: number;
  released: number;
  credited: number;
  credit_cents: number;
  kept_paying: number;
  waitlist_served: number;
  paid_placed: number;
};

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export async function run(_job: Job, ctx: JobContext): Promise<SweepResult> {
  const rows = await ctx.db.query<{ result: Partial<Record<keyof SweepResult, unknown>> | null }>(
    "select app.worker_pathshala_holds_sweep() as result",
  );
  const r = rows[0]?.result ?? {};
  const result: SweepResult = {
    reminded: count(r.reminded),
    released: count(r.released),
    credited: count(r.credited),
    credit_cents: count(r.credit_cents),
    kept_paying: count(r.kept_paying),
    waitlist_served: count(r.waitlist_served),
    paid_placed: count(r.paid_placed),
  };
  if (result.credited > 0) {
    // Money paid toward a released seat is credit waiting for the treasurer (app.rsvp_credit_releases).
    ctx.log.warn("pathshala.holds_sweep: released seats had money paid toward them; the treasurer has credit to handle", { ...result });
  } else {
    ctx.log.info("pathshala.holds_sweep: seats held for payment checked", { ...result });
  }
  return result;
}
