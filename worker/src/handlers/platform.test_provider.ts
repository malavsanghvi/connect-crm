// platform.test_provider: the "Test" button of the platform setup wizard
// (/platform/setup). Calls the provider with the keys this service will really
// use — saved in the wizard first, its environment second (ctx.env) — and
// stores plain lines as the job's result. The result never carries a key
// (src/lib/platform-setup/checks.ts blanks every configured secret out).
//   payload: { step: "email" | "payments" | "texting" | "quickbooks" | "ai" | "push" }

import { testStep } from "../../../src/lib/platform-setup/checks";
import { isStepKey, STEP_BY_KEY } from "../../../src/lib/platform-setup/catalog";
import { PermanentError } from "../errors";
import { reqFrom } from "../messaging";
import type { Job, JobContext } from "../types";

export const kind = "platform.test_provider";

export async function run(job: Job, ctx: JobContext) {
  const step = job.payload?.step;
  if (!isStepKey(step) || !STEP_BY_KEY[step].workerTest) throw new PermanentError("platform.test_provider: the payload names no step the background service can test.");
  const result = await testStep(step, reqFrom(ctx.http), ctx.env);
  ctx.log.info("platform setup test", { step, ok: result.ok, checks: result.lines.length });
  return { step, tested_at: new Date().toISOString(), ...result };
}
