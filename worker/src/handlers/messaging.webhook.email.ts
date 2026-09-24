// messaging.webhook.email: a Resend or Postmark event (already signature-checked
// and stored by the portal route) → the message's status, and a suppression
// for a hard bounce or a spam complaint. Payload: { event_id } (webhook_events.id).

import { PermanentError, messageOf } from "../errors";
import { emailEvent } from "../../../src/lib/messaging/providers";
import type { Job, JobContext } from "../types";

export const kind = "messaging.webhook.email";

type Ev = { id: string; provider: string; payload: Record<string, unknown>; processed_at: string | null };

export async function run(job: Job, ctx: JobContext) {
  const id = job.payload?.event_id;
  if (typeof id !== "string") throw new PermanentError("messaging.webhook.email: event_id is required.");
  const ev = (await ctx.db.query<{ e: Ev | null }>("select app.worker_webhook_event($1) as e", [id]))[0]?.e;
  if (!ev) throw new PermanentError(`Webhook event ${id} was not found.`);
  if (ev.processed_at) return { event_id: id, skipped: "already processed" };
  if (ev.provider !== "resend" && ev.provider !== "postmark") throw new PermanentError(`Not an email provider event (${ev.provider}).`);
  try {
    const e = emailEvent(ev.provider, ev.payload);
    let result: unknown = { ignored: true };
    if (e) {
      result = (await ctx.db.query<{ r: unknown }>("select app.worker_record_email_event($1, $2, $3, $4, $5) as r", [
        ev.provider, e.providerRef, e.event, e.address, e.detail,
      ]))[0]?.r;
    }
    await ctx.db.query("select app.worker_webhook_done($1, $2)", [id, null]);
    return { event_id: id, event: e?.event ?? null, result };
  } catch (err) {
    await ctx.db.query("select app.worker_webhook_done($1, $2)", [id, messageOf(err)]).catch((e: unknown) =>
      ctx.log.error("could not mark the webhook event failed", { event: id, error: e }),
    );
    throw err;
  }
}
