// messaging.send: send one app.messages row (queued by app.enqueue_message).
// Payload: { message_id }. Email via Resend/Postmark, texts and WhatsApp via
// Twilio, push via Expo; missing platform variables fail the job honestly.

import { messageIdOf, sendMessage } from "../messaging";
import type { Job, JobContext } from "../types";

export const kind = "messaging.send";

export async function run(job: Job, ctx: JobContext) {
  return sendMessage(ctx, messageIdOf(job), job);
}
