// surveys.launch_notify: queues the pushes of an event feedback survey (migration 0596). Marking an event completed,
// "Send survey", attaching a survey to a completed event and Events › Feedback › "Request feedback" queue ONE of these
// jobs (at the send time) instead of doing per-person work in the staff member's request. The work is paged:
// app.worker_survey_launch_notify queues one batch of invited adults (the push now, or when quiet hours end, and a
// reminder one and two days after that person's first push), one transaction a batch, until it says it is done.
// Everyone handled is recorded once (app.survey_notice_recipients) and the run is locked while a batch runs, so a
// retried or doubled job never pushes anyone twice. What was refused is counted on the run (the Survey tab shows it).
//
// The pushes themselves go out through the usual messaging.send jobs. No provider secret is needed here.

import { PermanentError } from "../errors";
import type { Job, JobContext } from "../types";

export const kind = "surveys.launch_notify";

/** Invited adults a batch handles (each is up to three messages: the push and two reminders). */
export const BATCH = 200;
/** A guard against a runaway loop: 250 batches of 200 is 50,000 people, far beyond one event. */
export const MAX_BATCHES = 250;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BatchResult = { done?: unknown; processed?: unknown; pushed?: unknown; refused?: unknown; reason?: unknown };

export type LaunchNotifyResult = {
  survey_id: string;
  batches: number;
  processed: number;
  pushed: number;
  refused: number;
  /** Why nothing (more) was sent: the survey closed, it opens later, nobody gets a push, a template problem. */
  reason?: string;
};

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export async function run(job: Job, ctx: JobContext): Promise<LaunchNotifyResult> {
  const surveyId = typeof job.payload?.survey_id === "string" ? job.payload.survey_id : "";
  if (!UUID.test(surveyId)) throw new PermanentError("A surveys.launch_notify job needs the survey's survey_id.");
  const size = typeof job.payload?.batch === "number" ? Math.min(Math.max(Math.trunc(job.payload.batch), 1), 200) : BATCH;

  const out: LaunchNotifyResult = { survey_id: surveyId, batches: 0, processed: 0, pushed: 0, refused: 0 };
  for (;;) {
    if (out.batches >= MAX_BATCHES) {
      // Retryable on purpose: the database skips everyone already handled, so the next attempt only finishes the job.
      throw new Error(`Queued the pushes of ${out.processed} people in ${out.batches} batches and there are more; the job will run again to finish.`);
    }
    const rows = await ctx.db.query<{ result: BatchResult | null }>("select app.worker_survey_launch_notify($1::uuid, $2::int) as result", [
      surveyId,
      size,
    ]);
    const r = rows[0]?.result ?? {};
    out.batches += 1;
    out.processed += count(r.processed);
    out.pushed += count(r.pushed);
    out.refused += count(r.refused);
    if (typeof r.reason === "string" && r.reason) out.reason = r.reason;
    // Done when the database says so, or when a batch handled nobody (never loop on an odd answer).
    if (r.done === true || count(r.processed) === 0) break;
  }
  ctx.log.info("surveys.launch_notify: survey pushes queued", {
    survey_id: surveyId,
    batches: out.batches,
    processed: out.processed,
    pushed: out.pushed,
    refused: out.refused,
    ...(out.reason ? { reason: out.reason } : {}),
  });
  return out;
}
