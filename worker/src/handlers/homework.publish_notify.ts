// homework.publish_notify: tells the learners of newly published homework, and the household adults of each child
// learner (homework plan §2.6, migration 0587). The database queues one of these jobs on EVERY publish
// (app.set_gyan_assignment_status), so homework that was unpublished when an earlier job ran is still announced when it
// is published again. The work is paged: app.worker_homework_publish_notify tells one batch of the learners the
// homework applies to (offset and limit over a fixed order, one transaction a batch), so a class of 250 is never one
// long request and one failure never rolls back the publish. A learner already told is skipped by the database, so
// a retried job picks up where it stopped, and a second publish (or five toggles) tells nobody twice.
//
// The messages it queues go out through the usual messaging.send jobs (suppressions, quiet hours and sandbox rules
// apply there). A teacher's or a parent's note is never part of any of them. No provider secret is needed here.

import { PermanentError } from "../errors";
import type { Job, JobContext } from "../types";

export const kind = "homework.publish_notify";

/** Learners a batch tells (each one is up to six messages: the learner and two parents, push and email). */
export const BATCH = 50;
/** A guard against a runaway loop: 500 batches of 50 is 25,000 learners, far beyond one lesson's homework. */
export const MAX_BATCHES = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BatchResult = { total?: unknown; learners?: unknown; messages?: unknown; skipped?: unknown; done?: unknown; reason?: unknown };

export type PublishNotifyResult = {
  assignment_id: string;
  batches: number;
  learners: number;
  messages: number;
  skipped: number;
  /** Why nothing was sent when the homework is gone or no longer published. */
  reason?: string;
};

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export async function run(job: Job, ctx: JobContext): Promise<PublishNotifyResult> {
  const assignmentId = typeof job.payload?.assignment_id === "string" ? job.payload.assignment_id : "";
  if (!UUID.test(assignmentId)) throw new PermanentError("A homework.publish_notify job needs the homework's assignment_id.");
  const size = typeof job.payload?.batch === "number" ? Math.min(Math.max(Math.trunc(job.payload.batch), 1), 200) : BATCH;

  const out: PublishNotifyResult = { assignment_id: assignmentId, batches: 0, learners: 0, messages: 0, skipped: 0 };
  for (let offset = 0; ; offset += size) {
    if (out.batches >= MAX_BATCHES) {
      // Retryable on purpose: the database skips everyone already told, so the next attempt only finishes the job.
      throw new Error(`Told ${out.learners} learners in ${out.batches} batches and there are more; the job will run again to finish.`);
    }
    const rows = await ctx.db.query<{ result: BatchResult | null }>(
      "select app.worker_homework_publish_notify($1::uuid, $2::int, $3::int) as result",
      [assignmentId, offset, size],
    );
    const r = rows[0]?.result ?? {};
    out.batches += 1;
    out.learners += count(r.learners);
    out.messages += count(r.messages);
    out.skipped += count(r.skipped);
    if (typeof r.reason === "string" && r.reason) out.reason = r.reason;
    // Done when the database says so, or when a page came back empty (never loop on an odd answer).
    if (r.done === true || count(r.learners) === 0) break;
  }
  ctx.log.info("homework.publish_notify: learners and parents told", {
    assignment_id: assignmentId,
    batches: out.batches,
    learners: out.learners,
    messages: out.messages,
    skipped: out.skipped,
    ...(out.reason ? { reason: out.reason } : {}),
  });
  return out;
}
