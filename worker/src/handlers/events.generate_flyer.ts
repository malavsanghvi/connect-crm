// events.generate_flyer: turn an event's name/date/venue/audience into a
// prompt (already built by the portal, never assembled here) and ask OpenAI's
// image API for a flyer. Enqueued by app.events_request_flyer.
//
// What leaves the database: only the prompt text the admin approved (already
// stripped of anything private by the portal — it is built from the event's
// own public fields). Nothing about members, RSVPs or money.
//
// Result (app.jobs.result, read by app.events_flyer_result): { image_b64,
// model, prompt } — the image bytes themselves, never a secret. The PORTAL
// (not the worker) turns them into a Supabase Storage object, because only
// the portal holds the signed-in admin's own upload rights; the worker never
// touches Storage for this job (see docs/DEPLOY.md "storage retention" on why
// giving the worker a Storage-writing key is its own decision, not bundled
// into this feature).
//
// Needs OPENAI_API_KEY on the background service (Community Connect's own
// key). Without it the job fails at once as "not configured" and the builder
// says AI flyer generation is off; uploading a flyer by hand keeps working.

import { providerStatus, type Env, type Readiness } from "../config";
import { NotConfiguredError, PermanentError } from "../errors";
import type { Job, JobContext } from "../types";

export const kind = "events.generate_flyer";

export const MODEL = "gpt-image-1";
const SIZE = "1024x1536"; // portrait, closest built-in size to a flyer
const MAX_PROMPT_CHARS = 2000;

export function configured(env: Env): Readiness {
  return providerStatus(env, "openai");
}

export function readPayload(p: unknown): { prompt: string } {
  const o = (p ?? {}) as Record<string, unknown>;
  const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
  if (!prompt) throw new PermanentError("events.generate_flyer: the payload needs a prompt.");
  return { prompt: prompt.slice(0, MAX_PROMPT_CHARS) };
}

type ImagesResponse = { data?: { b64_json?: string }[]; error?: { message?: string; code?: string } };

export async function run(job: Job, ctx: JobContext) {
  const ready = configured(ctx.env);
  if (!ready.configured) throw new NotConfiguredError(ready.reason);
  const { prompt } = readPayload(job.payload);

  // OPENAI_BASE_URL only points tests at a local mock server.
  const base = (ctx.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
  const res = await ctx.http.request(`${base}/v1/images/generations`, {
    method: "POST",
    headers: { authorization: `Bearer ${ctx.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: { model: MODEL, prompt, size: SIZE, n: 1 },
    timeoutMs: 120000,
    retries: 1,
  });

  if (res.status === 401 || res.status === 403) {
    throw new NotConfiguredError("The OpenAI key on the background service was refused (OPENAI_API_KEY).");
  }
  if (!res.ok) {
    const body = res.json<ImagesResponse>();
    const reason = body.error?.message || `OpenAI answered ${res.status}`;
    // 400s (bad prompt, moderation refusal, unsupported size) will not succeed on retry.
    if (res.status >= 400 && res.status < 500) throw new PermanentError(`Could not generate the flyer image: ${reason}`);
    throw new Error(`Could not generate the flyer image: ${reason}`); // 429/5xx: the queue retries
  }

  const body = res.json<ImagesResponse>();
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new PermanentError("OpenAI did not return an image for this prompt.");

  ctx.log.info("flyer image generated", { event: (job.payload as { event_id?: string } | null)?.event_id ?? null, bytes: Math.round((b64.length * 3) / 4) });
  return { image_b64: b64, model: MODEL, prompt };
}
