// messaging.webhook.twilio: a Twilio callback (signature-checked and stored by
// the portal route). A status callback updates the message; an inbound text
// with STOP / START / HELP is recorded (suppression, opt-outs) and answered.
// Payload: { event_id } (webhook_events.id).

import { PermanentError, messageOf } from "../errors";
import { sendMessage } from "../messaging";
import type { Job, JobContext } from "../types";

export const kind = "messaging.webhook.twilio";

type Ev = { id: string; provider: string; payload: Record<string, string>; processed_at: string | null };

export async function run(job: Job, ctx: JobContext) {
  const id = job.payload?.event_id;
  if (typeof id !== "string") throw new PermanentError("messaging.webhook.twilio: event_id is required.");
  const ev = (await ctx.db.query<{ e: Ev | null }>("select app.worker_webhook_event($1) as e", [id]))[0]?.e;
  if (!ev) throw new PermanentError(`Webhook event ${id} was not found.`);
  if (ev.processed_at) return { event_id: id, skipped: "already processed" };
  const p = ev.payload ?? {};
  try {
    let out: Record<string, unknown>;
    if (p.MessageStatus && p.MessageSid) {
      const r = (await ctx.db.query<{ r: unknown }>("select app.worker_record_sms_status($1, $2, $3, $4) as r", [
        p.MessageSid, p.MessageStatus, p.ErrorCode ?? null, p.ErrorMessage ?? null,
      ]))[0]?.r;
      out = { status: p.MessageStatus, result: r };
    } else if (p.From && p.Body !== undefined) {
      const r = (await ctx.db.query<{ r: { keyword: string | null; reply_message_id?: string } }>(
        "select app.worker_record_inbound_sms($1, $2, $3, $4) as r", [p.From, p.To ?? null, p.Body, p.MessageSid ?? null],
      ))[0]?.r;
      out = { keyword: r?.keyword ?? null };
      if (r?.reply_message_id) out.reply = await sendMessage(ctx, r.reply_message_id, null);
    } else {
      out = { ignored: true };
    }
    await ctx.db.query("select app.worker_webhook_done($1, $2)", [id, null]);
    return { event_id: id, ...out };
  } catch (err) {
    await ctx.db.query("select app.worker_webhook_done($1, $2)", [id, messageOf(err)]).catch((e: unknown) =>
      ctx.log.error("could not mark the webhook event failed", { event: id, error: e }),
    );
    throw err;
  }
}
