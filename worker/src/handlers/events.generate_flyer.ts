// events.generate_flyer: ask Pollinations.ai's free image API for a flyer's
// BACKGROUND ART (owner decision 2026-10-01). The flyer itself — headline,
// date, venue, QR code, logo — is laid out by the portal's flyer maker
// (src/lib/events/flyer-render.tsx); this job only makes the picture behind
// it. Enqueued by app.events_request_flyer.
//
// Background art only, never people, deities or lettering: the payload's
// prompt is refused (permanently) when it names a blocked word, and the
// guardrail (flyer-guard.ts, identical to the portal's copy) is always sent
// with it exactly once. The request also asks Pollinations not to rewrite the
// prompt (enhance=false), to apply its safety filter (safe=true) and to keep
// the image out of its public feed (private=true).
//
// What leaves the database: only the art prompt the organizer approved (a
// description of colours and ornaments — it never includes the event name).
// Nothing about members, RSVPs or money.
//
// Result (app.jobs.result, read by app.events_flyer_result): { image_b64,
// content_type, model, prompt }. The PORTAL stores the bytes as
// content/<center>/events/<event>/art-<ms>.<ext> as the signed-in organizer,
// then app.events_flyer_art_taken removes image_b64 from this result and
// records the stored path (0578), so app.jobs does not keep a copy. The worker
// never touches Storage for this job.
//
// Pollinations.ai (2026-09-29, owner decision — free, no API key, no signup,
// so this handler is always "configured"). The tradeoff, spelled out rather
// than hidden: it is a shared, rate-limited community pool (a burst of
// requests can return a transient error — retried like any other 5xx), it may
// still draw a figure or letters despite the guardrail (the organizer always
// looks at the preview), and `nologo=true` only removes the watermark for
// registered accounts, so free art may carry a small mark in a corner (the
// portal says so).

import { PermanentError } from "../errors";
import type { Readiness } from "../config";
import { findBlockedArtTerm, withArtGuardrail } from "../flyer-guard";
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
  const blocked = findBlockedArtTerm(prompt);
  if (blocked) throw new PermanentError(`AI backgrounds are abstract or decorative only: the request mentioned "${blocked}".`);
  return { prompt: withArtGuardrail(prompt, MAX_PROMPT_CHARS) };
}

type ErrorBody = { error?: string; message?: string };

export async function run(job: Job, ctx: JobContext) {
  const { prompt } = readPayload(job.payload);

  // POLLINATIONS_BASE_URL only points tests at a local mock server.
  const base = (ctx.env.POLLINATIONS_BASE_URL || "https://image.pollinations.ai").replace(/\/+$/, "");
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const query = new URLSearchParams({
    width: String(WIDTH),
    height: String(HEIGHT),
    nologo: "true",
    private: "true",
    enhance: "false",
    safe: "true",
    seed: String(seed),
  });
  const url = `${base}/prompt/${encodeURIComponent(prompt)}?${query.toString()}`;
  const res = await ctx.http.request(url, { method: "GET", timeoutMs: 120000, retries: 1 });

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.startsWith("image/")) {
    const body = contentType.includes("json") ? res.json<ErrorBody>() : {};
    const reason = body.message || body.error || `Pollinations answered ${res.status}`;
    // 400s (a refused/empty prompt) will not succeed on retry; everything else (429s wrapped as
    // 500 by Pollinations' own gateway, real 5xx) is the shared pool being busy — the queue retries.
    if (res.status >= 400 && res.status < 500) throw new PermanentError(`Could not generate the flyer art: ${reason}`);
    throw new Error(`Could not generate the flyer art: ${reason}`);
  }

  const bytes = res.bytes();
  if (bytes.length === 0) throw new PermanentError("Pollinations did not return an image for this prompt.");
  const image_b64 = Buffer.from(bytes).toString("base64");

  ctx.log.info("flyer art generated", { event: (job.payload as { event_id?: string } | null)?.event_id ?? null, bytes: bytes.length, content_type: contentType });
  return { image_b64, content_type: contentType, model: MODEL, prompt };
}
