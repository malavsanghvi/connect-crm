// The frame every webhook handler runs in: read the stored event (app.webhook_events),
// skip it when already processed, and mark it processed — or record why it was not,
// so staff see the reason on the event and on the job.

import { PermanentError, messageOf } from "../errors";
import { scrubText } from "../log";
import type { Job, JobContext } from "../types";
import { dbValue } from "./core";

export type StoredEvent = {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  center_id: string | null;
  payload: Record<string, unknown>;
  processed_at: string | null;
};

/** What a handler reports: shown as the job result; `center` fills a missing center on the event. */
export type EventOutcome = { outcome: string; center?: string | null; [k: string]: unknown };

export async function runWebhook(job: Job, ctx: JobContext, handle: (ev: StoredEvent) => Promise<EventOutcome>) {
  const id = job.payload?.webhook_event_id;
  if (typeof id !== "string") throw new PermanentError(`${job.kind}: webhook_event_id is missing from the job.`);
  const ev = await dbValue<StoredEvent>(ctx, "select app.worker_webhook_event($1) as v", [id]);
  if (!ev) throw new PermanentError(`Webhook event ${id} was not found.`);
  if (ev.processed_at) return { outcome: "already processed", event: ev.event_id };
  try {
    const out = await handle(ev);
    await ctx.db.query("select app.worker_webhook_done($1, null, $2)", [id, out.center ?? null]);
    return { event: ev.event_id, type: ev.event_type, ...out };
  } catch (err) {
    const msg = scrubText(messageOf(err)).slice(0, 2000);
    await ctx.db
      .query("select app.worker_webhook_done($1, $2, null)", [id, msg])
      .catch((e: unknown) => ctx.log.error("could not record the webhook's failure", { error: e, event: ev.event_id }));
    throw err;
  }
}
