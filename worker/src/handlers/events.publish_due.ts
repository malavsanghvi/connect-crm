// events.publish_due: every 5 minutes, publish the draft events whose scheduled time has come (migration 0700). A person
// chose the time in the event creator's publish box (events.publish_at). The database does all of it
// (app.worker_events_publish_due): each due event is checked again at that moment with the same rules the portal applies
// before it publishes (the status rule draft -> published and the readiness list's publish blockers) and the flyer
// approval (the approved flyer must still be the event's flyer and still show its name, date and venue). One that cannot be
// published stays a draft; its schedule is cleared and the reason kept for the person (events.publish_failure). Publishing
// is the same status change as the Publish button, so the member app, the calendar and the guest page follow by
// themselves. This handler calls it again while a run stopped at its limit ("more"), at most MAX_BATCHES times; the rest
// waits for the next run. Platform-wide, scheduled by the generic `every` scheduler in worker/src/server.ts; no provider
// secret is needed, so it is always configured.

import type { Job, JobContext } from "../types";

export const kind = "events.publish_due";
export const every = 300;

/** Events one call handles at most. */
export const BATCH = 50;
/** A run's limit: 5 calls of 50 every 5 minutes; the rest waits for the next run. */
export const MAX_BATCHES = 5;

export type PublishDueResult = { batches: number; published: number; refused: number; more: boolean };

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export async function run(_job: Job, ctx: JobContext): Promise<PublishDueResult> {
  const out: PublishDueResult = { batches: 0, published: 0, refused: 0, more: false };
  for (let i = 0; i < MAX_BATCHES; i++) {
    const rows = await ctx.db.query<{ result: { published?: unknown; refused?: unknown; more?: unknown } | null }>(
      "select app.worker_events_publish_due($1::int) as result",
      [BATCH],
    );
    const r = rows[0]?.result ?? {};
    out.batches += 1;
    out.published += count(r.published);
    out.refused += count(r.refused);
    out.more = r.more === true;
    // Another call only when the run stopped at its limit (never loop on an odd answer).
    if (!out.more) break;
  }
  if (out.published > 0 || out.refused > 0) ctx.log.info("events.publish_due: scheduled events handled", { ...out });
  return out;
}
