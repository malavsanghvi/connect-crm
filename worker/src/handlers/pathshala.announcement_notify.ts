// pathshala.announcement_notify: tells the families a published class announcement is for (migration 0781). The database
// queues one of these jobs the moment a class announcement becomes published (a trigger on class_announcements, so
// the portal's "Publish now", the Publish button on a draft and any later tool all do it), and again if it is unpublished
// and published once more. The work is paged: app.worker_pathshala_announcement_notify pushes one batch of the
// recipients (offset and limit over a fixed order, one transaction a batch), so a Pathshala of 600 families is never
// one long request and one failure never rolls back the publish. A person already handled is skipped by the database
// (app.notice_log), so a retried job picks up where it stopped and publishing again tells nobody twice.
//
// The pushes it queues go out through the usual messaging.send jobs (the member's own switch, quiet hours, suppressions
// and sandbox rules apply there). A person with no login or no phone with the app is not pushed: they read the
// announcement in the app. No provider secret is needed here.

import { PermanentError } from "../errors";
import type { Job, JobContext } from "../types";

export const kind = "pathshala.announcement_notify";

/** People a batch pushes (each is one push, or none when they have no phone with the app). */
export const BATCH = 100;
/** A guard against a runaway loop: 500 batches of 100 is 50,000 adults, far beyond any Pathshala. */
export const MAX_BATCHES = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BatchResult = {
  total?: unknown;
  people?: unknown;
  pushed?: unknown;
  skipped?: unknown;
  unreachable?: unknown;
  refused?: unknown;
  done?: unknown;
  reason?: unknown;
};

export type AnnouncementNotifyResult = {
  announcement_id: string;
  batches: number;
  people: number;
  pushed: number;
  skipped: number;
  unreachable: number;
  refused: number;
  /** Why nothing was sent when the announcement is gone or no longer published. */
  reason?: string;
};

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export async function run(job: Job, ctx: JobContext): Promise<AnnouncementNotifyResult> {
  const announcementId = typeof job.payload?.announcement_id === "string" ? job.payload.announcement_id : "";
  if (!UUID.test(announcementId)) throw new PermanentError("A pathshala.announcement_notify job needs the announcement's announcement_id.");
  const size = typeof job.payload?.batch === "number" ? Math.min(Math.max(Math.trunc(job.payload.batch), 1), 200) : BATCH;

  const out: AnnouncementNotifyResult = { announcement_id: announcementId, batches: 0, people: 0, pushed: 0, skipped: 0, unreachable: 0, refused: 0 };
  for (let offset = 0; ; offset += size) {
    if (out.batches >= MAX_BATCHES) {
      // Retryable on purpose: the database skips everyone already handled, so the next attempt only finishes the job.
      throw new Error(`Handled ${out.people} people in ${out.batches} batches and there are more; the job will run again to finish.`);
    }
    const rows = await ctx.db.query<{ result: BatchResult | null }>(
      "select app.worker_pathshala_announcement_notify($1::uuid, $2::int, $3::int) as result",
      [announcementId, offset, size],
    );
    const r = rows[0]?.result ?? {};
    out.batches += 1;
    out.people += count(r.people);
    out.pushed += count(r.pushed);
    out.skipped += count(r.skipped);
    out.unreachable += count(r.unreachable);
    out.refused += count(r.refused);
    if (typeof r.reason === "string" && r.reason) out.reason = r.reason;
    // Done when the database says so, or when a page came back empty (never loop on an odd answer).
    if (r.done === true || count(r.people) === 0) break;
  }
  ctx.log.info("pathshala.announcement_notify: families told", {
    announcement_id: announcementId,
    batches: out.batches,
    people: out.people,
    pushed: out.pushed,
    skipped: out.skipped,
    unreachable: out.unreachable,
    refused: out.refused,
    ...(out.reason ? { reason: out.reason } : {}),
  });
  return out;
}
