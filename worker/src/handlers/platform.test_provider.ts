// platform.test_provider: the "Test" button of the platform setup wizard
// (/platform/setup). Calls the provider with the keys this service will really
// use — saved in the wizard first, its environment second (ctx.env) — and
// stores plain lines as the job's result. The result never carries a key
// (src/lib/platform-setup/checks.ts blanks every configured secret out).
//   payload: { step: "email" | "payments" | "texting" | "quickbooks" | "ai" | "art" | "push" }
// (art: a free GET of the Gemini model with the key; no picture is made.)
//
// The AI step's test is a real (one-token) Anthropic call, so what it gets is
// recorded in the service's AI status like any other call (ai-status.ts): after
// a spending limit is raised or a key replaced, a passing Test clears "Niva
// paused" on the next heartbeat instead of waiting for the next question.

import type { Req } from "../../../src/lib/messaging/providers";
import { testStep } from "../../../src/lib/platform-setup/checks";
import { isStepKey, STEP_BY_KEY } from "../../../src/lib/platform-setup/catalog";
import { aiStatus, recordAnthropicNoAnswer, recordAnthropicResponse, type AiStatus } from "../ai-status";
import { PermanentError } from "../errors";
import { reqFrom } from "../messaging";
import type { Job, JobContext } from "../types";

export const kind = "platform.test_provider";

/** `req`, with every answer (or the lack of one) recorded in `status`. */
export function recordingReq(req: Req, status: AiStatus): Req {
  return async (url, init) => {
    try {
      const r = await req(url, init);
      recordAnthropicResponse(status, r.status, r.text);
      return r;
    } catch (err) {
      recordAnthropicNoAnswer(status, err);
      throw err;
    }
  };
}

export async function run(job: Job, ctx: JobContext) {
  const step = job.payload?.step;
  if (!isStepKey(step) || !STEP_BY_KEY[step].workerTest) throw new PermanentError("platform.test_provider: the payload names no step the background service can test.");
  const req = step === "ai" ? recordingReq(reqFrom(ctx.http), aiStatus) : reqFrom(ctx.http);
  const result = await testStep(step, req, ctx.env);
  ctx.log.info("platform setup test", { step, ok: result.ok, checks: result.lines.length });
  return { step, tested_at: new Date().toISOString(), ...result };
}
