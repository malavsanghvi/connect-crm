// messaging.test_send: a "Send a test" from Settings (app.send_test_message).
// Same path as messaging.send; the result shows on the Settings page.

import { messageIdOf, sendMessage } from "../messaging";
import type { Job, JobContext } from "../types";

export const kind = "messaging.test_send";

export async function run(job: Job, ctx: JobContext) {
  return { test: true, ...(await sendMessage(ctx, messageIdOf(job), job)) };
}
