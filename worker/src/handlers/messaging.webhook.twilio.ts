// messaging.webhook.twilio: a Twilio callback (signature-checked and stored by
// the portal route). A status callback updates the message; an inbound text
// with STOP / START / HELP is recorded (suppression, opt-outs) and answered.
// Payload: { event_id } (webhook_events.id).
//
// The reply to STOP / START / HELP is sent by THIS job, so the queue's retry sends it again after a Twilio error (0598):
//   - app.worker_record_inbound_sms is idempotent per inbound message: on a retry it records nothing again and returns
//     the same reply;
//   - sendMessage gets the job, so an error that may pass (a 5xx, a timeout) leaves the reply queued for the retry, and
//     only a refusal that cannot pass, or the last try, records it as failed;
//   - the webhook event is marked processed only when the reply was sent, or when no retry is left (with the error).
// Before this the event was marked processed even when the reply failed, so the retried job skipped it and the reply was
// lost.

import { isRetryable, messageOf, PermanentError } from "../errors";
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
      if (r?.reply_message_id) out.reply = await sendMessage(ctx, r.reply_message_id, job);
    } else {
      out = { ignored: true };
    }
    await ctx.db.query("select app.worker_webhook_done($1, $2)", [id, null]);
    return { event_id: id, ...out };
  } catch (err) {
    // Not final: leave the event unprocessed so the retry runs it again (and sends the same reply).
    const final = !isRetryable(err) || job.attempts >= job.max_attempts;
    if (final) {
      await ctx.db.query("select app.worker_webhook_done($1, $2)", [id, messageOf(err)]).catch((e: unknown) =>
        ctx.log.error("could not mark the webhook event failed", { event: id, error: e }),
      );
    }
    throw err;
  }
}
