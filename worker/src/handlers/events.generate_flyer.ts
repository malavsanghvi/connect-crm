// events.generate_flyer: turn an event's name/date/venue/audience into a
// prompt (already built by the portal, never assembled here) and ask
// Pollinations.ai's image API for a flyer. Enqueued by app.events_request_flyer.
//
// What leaves the database: only the prompt text the admin approved (already
// stripped of anything private by the portal — it is built from the event's
// own public fields). Nothing about members, RSVPs or money.
//
// Result (app.jobs.result, read by app.events_flyer_result): { image_b64,
// content_type, model, prompt } — the image bytes themselves, never a
// secret. The PORTAL (not the worker) turns them into a Supabase Storage
// object, because only the portal holds the signed-in admin's own upload
// rights; the worker never touches Storage for this job (see docs/DEPLOY.md
// "storage retention" on why giving the worker a Storage-writing key is its
// own decision, not bundled into this feature).
//
// Pollinations.ai (2026-09-29, owner decision — a free alternative to a paid
// image API): no API key, no signup, no platform secret to configure — this
// handler is always "configured". The tradeoff, spelled out rather than
// hidden: it is a shared, rate-limited community pool (a burst of image
// requests across all its users can return a transient error — retried like
// any other 5xx), and `nologo=true` only suppresses the "pollinations.ai"
// watermark for accounts on their paid/registered tier, so flyers may carry
// a small watermark in the corner. If that ever stops being good enough,
// swap the request below for a paid provider (OpenAI, Together.ai, etc.) —
// the rest of the pipeline (portal prompt builder, job queue, Storage write)
// does not know or care which one generated the bytes.

import { PermanentError } from "../errors";
import type { Readiness } from "../config";
import type { Job, JobContext } from "../types";

export const kind = "events.generate_flyer";

export const MODEL = "pollinations-flux";
const WIDTH = 1024;
const HEIGHT = 1536; // portrait, close to a flyer's aspect ratio
const MAX_PROMPT_CHARS = 2000;

export function configured(): Readiness {
  return { configured: true }; // no platform key needed — see file header
}

export function readPayload(p: unknown): { prompt: string } {
  const o = (p ?? {}) as Record<string, unknown>;
  const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
  if (!prompt) throw new PermanentError("events.generate_flyer: the payload needs a prompt.");
  return { prompt: prompt.slice(0, MAX_PROMPT_CHARS) };
}

type ErrorBody = { error?: string; message?: string };

export async function run(job: Job, ctx: JobContext) {
  const { prompt } = readPayload(job.payload);

  // POLLINATIONS_BASE_URL only points tests at a local mock server.
  const base = (ctx.env.POLLINATIONS_BASE_URL || "https://image.pollinations.ai").replace(/\/+$/, "");
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const url = `${base}/prompt/${encodeURIComponent(prompt)}?width=${WIDTH}&height=${HEIGHT}&nologo=true&seed=${seed}`;
  const res = await ctx.http.request(url, { method: "GET", timeoutMs: 120000, retries: 1 });

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.startsWith("image/")) {
    const body = contentType.includes("json") ? res.json<ErrorBody>() : {};
    const reason = body.message || body.error || `Pollinations answered ${res.status}`;
    // 400s (a refused/empty prompt) will not succeed on retry; everything else (429s wrapped as
    // 500 by Pollinations' own gateway, real 5xx) is the shared pool being busy — the queue retries.
    if (res.status >= 400 && res.status < 500) throw new PermanentError(`Could not generate the flyer image: ${reason}`);
    throw new Error(`Could not generate the flyer image: ${reason}`);
  }

  const bytes = res.bytes();
  if (bytes.length === 0) throw new PermanentError("Pollinations did not return an image for this prompt.");
  const image_b64 = Buffer.from(bytes).toString("base64");

  ctx.log.info("flyer image generated", { event: (job.payload as { event_id?: string } | null)?.event_id ?? null, bytes: bytes.length, content_type: contentType });
  return { image_b64, content_type: contentType, model: MODEL, prompt };
}
