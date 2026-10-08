// notices.sweep: every 5 minutes, the member notices that are due NOW (migration 0598): the RSVP confirmation N hours
// before an event, the boli notice 24 hours before it closes, and a special day's labh prompt. The database does all of
// it (app.worker_notices_sweep): which community has each switch on, who has a login with a working phone and the topic
// on, once per thing and person (app.notice_log), quiet hours, expiry and the sandbox rule. A notice is queued when its
// window opens (nothing waits in the queue for days) and goes out through the usual messaging.send job. This handler
// calls it again while a sweep reports it stopped at its limit ("more"), at most MAX_BATCHES times; the rest waits for the
// next run. One sweep failing does not stop the others (its error is in the answer, logged here). Platform-wide,
// scheduled by the generic `every` scheduler in worker/src/server.ts; no provider secret is needed, so it is always
// configured.

import type { Job, JobContext } from "../types";

export const kind = "notices.sweep";
export const every = 300;

/** Notices a sweep queues at most per call (the database's own default). */
export const BATCH = 200;
/** A run's limit: 5 calls of 200 per notice kind every 5 minutes; the rest waits for the next run. */
export const MAX_BATCHES = 5;

const PARTS = ["rsvp_confirmation", "boli_closing", "special_day_labh"] as const;
type Part = (typeof PARTS)[number];

export type PartResult = { pushed: number; refused: number; more: boolean; error?: string };
export type NoticesSweepResult = { batches: number } & Record<Part, PartResult>;

type Answer = Partial<Record<Part, { pushed?: unknown; refused?: unknown; more?: unknown; error?: unknown }>>;

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export async function run(_job: Job, ctx: JobContext): Promise<NoticesSweepResult> {
  const out = { batches: 0 } as NoticesSweepResult;
  for (const p of PARTS) out[p] = { pushed: 0, refused: 0, more: false };
  for (let i = 0; i < MAX_BATCHES; i++) {
    const rows = await ctx.db.query<{ result: Answer | null }>("select app.worker_notices_sweep($1::int) as result", [BATCH]);
    const r = rows[0]?.result ?? {};
    out.batches += 1;
    let again = false;
    for (const p of PARTS) {
      const part = r[p] ?? {};
      out[p].pushed += count(part.pushed);
      out[p].refused += count(part.refused);
      out[p].more = part.more === true;
      if (typeof part.error === "string" && part.error) out[p].error = part.error;
      again = again || out[p].more;
    }
    // Another call only when a sweep stopped at its limit (never loop on an odd answer).
    if (!again) break;
  }
  const failed = PARTS.filter((p) => out[p].error);
  if (failed.length > 0) {
    // The other sweeps ran; this one is tried again in 5 minutes. The error text is the database's own.
    ctx.log.error("notices.sweep: a sweep failed", { failed, ...out });
  } else {
    ctx.log.info("notices.sweep: member notices queued", { ...out });
  }
  return out;
}
