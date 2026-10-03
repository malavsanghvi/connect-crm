// events.generate_flyer: ask Google Gemini for flyer ART (owner decision
// 2026-10-02, "approach C" of Flyers v2). The flyer itself — every word, the
// logos, icons, agenda, QR code and the layout — is drawn by the portal
// (src/lib/events/flyer-render.tsx, flyer-poster.tsx); this job only makes a
// picture with no text in it. Two kinds of request reach it:
//
//   a Poster layer   { event_id, occasion, layer: "frame" | "scene", seed, prompt }
//                    app.events_request_flyer_art (0585). The picture's description is
//                    NEVER read from the payload: the database takes any text from an
//                    organizer who calls it directly, and these pictures are made on the
//                    owner's key and shared with the whole community. The worker builds it
//                    itself from the occasion and layer (FLYER_LAYER_PROMPTS, the same
//                    table the portal sends from), ending with FLYER_LAYER_GUARDRAIL
//   a background     { event_id, prompt }  app.events_request_flyer (0578): the
//                    organizer's own words (English only: the blocked-word check reads
//                    English), abstract or decorative only, with FLYER_ART_GUARDRAIL
//                    appended
//
// Both are refused (permanently) when they name a blocked word, and the right
// guardrail is sent exactly once (flyer-guard.ts, identical to the portal's
// copy). Pollinations.ai, the free service this job used to call, is retired:
// it now answers HTTP 402 Payment Required most of the time, caps images at
// ~0.6 megapixels and ignores nologo (a watermark).
//
// Gemini, as Google's public docs describe it on 2026-10-02
// (ai.google.dev/gemini-api/docs/image-generation, .../pricing, .../models):
//
//   1. The Interactions API, the current way: POST {base}/v1beta/interactions,
//      key in the x-goog-api-key header, body { model, input: [{ type: "text",
//      text }], response_format: { type: "image", mime_type, aspect_ratio } };
//      the picture comes back in steps[].content[] as { type: "image",
//      mime_type, data (base64) }.
//   2. generateContent, which Google now calls legacy but still documents for
//      the image models: POST {base}/v1/models/{model}:generateContent, body
//      { contents, generationConfig: { responseModalities, responseFormat:
//      { image: { aspectRatio } } } } (or the older generationConfig.imageConfig);
//      the picture comes back in candidates[].content.parts[].inlineData.
//
// The first is asked first. When Google answers it with a 4xx that is not about
// the key (the request shape was not accepted for this model or account), the
// others are tried in turn — nothing was made, so nothing was charged. A 200
// answer without a picture is NEVER asked again (that could charge twice). The
// answer is read by looking for the image block wherever it is, so a change
// in Google's envelope does not break it. There is no seed: Google's pages for
// these models do not list one; the portal's seed is only the picture's name in
// the community's art library, so "Generate another" is a new picture.
//
// The model is GEMINI_IMAGE_MODEL (Platform › Setup › AI flyer art) when it is
// one of src/lib/events/flyer-art.ts's models, else that file's default; the
// pictures are 1K, the only size the default model makes, and cost about 4¢
// (shown to the organizer before they ask). Every picture carries Google's
// SynthID watermark.
//
// The key: GEMINI_API_KEY, saved by the owner in Platform › Setup (Supabase
// Vault, read through platform-config.ts) or in this service's environment.
// It is sent only in the request header, never logged, never in a result.
//
// What leaves the database: only the art prompt (colours and ornaments — never
// the event's name) and the aspect ratio. Nothing about members.
//
// Result (app.jobs.result, read by app.events_flyer_result): { image_b64,
// content_type, model, prompt, provider, api, layer?, occasion?, seed? }. The
// PORTAL stores the bytes as the organizer — a layer at its cache key
// content/<center>/flyer-art/<occasion>/<layer>-<seed>.<ext>, a background at
// content/<center>/events/<event>/art-<ms>.<ext> — then
// app.events_flyer_art_taken removes image_b64 from this result (0578/0585),
// and app.audit_mask keeps the bytes out of the audit log.

import { FLYER_LAYER_ASPECT, FLYER_LAYER_PROMPTS, NO_GEMINI_KEY, firstNonEnglishLetter, flyerArtModel, isFlyerOccasion, type FlyerArtModel } from "../../../src/lib/events/flyer-art";
import type { Env, Readiness } from "../config";
import { NotConfiguredError, PermanentError } from "../errors";
import { findBlockedArtTerm, withArtGuardrail, withLayerGuardrail } from "../flyer-guard";
import type { HttpResponse } from "../http";
import type { Job, JobContext } from "../types";

export const kind = "events.generate_flyer";
export const PROVIDER = "gemini";
const MAX_PROMPT_CHARS = 2000;
/** The most a picture may weigh (base64 goes into app.jobs.result until the portal has stored it). */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function hasKey(env: Env): boolean {
  return Boolean((env.GEMINI_API_KEY ?? "").trim());
}

export function configured(env: Env): Readiness {
  return hasKey(env) ? { configured: true } : { configured: false, reason: NO_GEMINI_KEY };
}

/** What the heartbeat says beside "configured": the provider and the model (names only, never the key). */
export function info(env: Env): Record<string, string> {
  return { provider: PROVIDER, model: flyerArtModel(env.GEMINI_IMAGE_MODEL) };
}

export type FlyerArtPayload =
  | { kind: "layer"; prompt: string; layer: "frame" | "scene"; occasion: string; seed: number }
  | { kind: "background"; prompt: string };

export function readPayload(p: unknown): FlyerArtPayload {
  const o = (p ?? {}) as Record<string, unknown>;
  if (o.layer !== undefined) {
    if (o.layer !== "frame" && o.layer !== "scene") throw new PermanentError("events.generate_flyer: the layer must be a frame or a scene.");
    if (!isFlyerOccasion(o.occasion)) throw new PermanentError("events.generate_flyer: the payload names no occasion.");
    const seed = Number(o.seed);
    if (!Number.isInteger(seed) || seed < 1 || seed > 2_147_483_647) throw new PermanentError("events.generate_flyer: the seed is out of range.");
    // The description is ours, whatever text came with the request (see the top of this file).
    const prompt = withLayerGuardrail(FLYER_LAYER_PROMPTS[o.occasion][o.layer], MAX_PROMPT_CHARS);
    // Our own descriptions never name a blocked word (a test checks every one); this stays as a second lock.
    const blocked = findBlockedArtTerm(prompt);
    if (blocked) throw new PermanentError(`AI flyer art never shows people up close, deities or lettering: the built-in description mentioned "${blocked}".`);
    return { kind: "layer", prompt, layer: o.layer, occasion: o.occasion, seed };
  }
  const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
  if (!prompt) throw new PermanentError("events.generate_flyer: the payload needs a prompt.");
  const foreign = firstNonEnglishLetter(prompt);
  if (foreign) throw new PermanentError(`AI background art is described in English: the check for people, deities and lettering reads English words only, and the description has "${foreign}".`);
  const blocked = findBlockedArtTerm(prompt);
  if (blocked) throw new PermanentError(`AI flyer art never shows people up close, deities or lettering: the request mentioned "${blocked}".`);
  return { kind: "background", prompt: withArtGuardrail(prompt, MAX_PROMPT_CHARS) };
}

// ── The requests ─────────────────────────────────────────────────────────────

export type GeminiApi = "interactions" | "generateContent" | "generateContent (imageConfig)";

export type GeminiRequest = { api: GeminiApi; path: string; body: Record<string, unknown> };

/** The requests to try, in order, for one picture. Pure, so the tests can check the exact shapes. */
export function geminiRequests(model: FlyerArtModel, prompt: string, aspectRatio: string): GeminiRequest[] {
  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  return [
    {
      api: "interactions",
      path: "/v1beta/interactions",
      body: {
        model,
        input: [{ type: "text", text: prompt }],
        response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: aspectRatio },
      },
    },
    {
      api: "generateContent",
      path: `/v1/models/${encodeURIComponent(model)}:generateContent`,
      body: { contents, generationConfig: { responseModalities: ["TEXT", "IMAGE"], responseFormat: { image: { aspectRatio } } } },
    },
    {
      api: "generateContent (imageConfig)",
      path: `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      body: { contents, generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio } } },
    },
  ];
}

// ── The answer ───────────────────────────────────────────────────────────────

type Found = { data: string; mimeType: string };

/**
 * Every picture in an answer of either API, in order, wherever it is: any
 * object with a base64 `data` string and an image/* `mime_type` (Interactions,
 * snake_case) or `mimeType` (generateContent's inlineData). Interim "thought"
 * pictures of a reasoning model are skipped.
 */
export function imagesIn(node: unknown, out: Found[] = [], depth = 0): Found[] {
  if (depth > 10 || node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) imagesIn(n, out, depth + 1);
    return out;
  }
  const o = node as Record<string, unknown>;
  if (o.thought === true || o.type === "thought") return out;
  const mime = typeof o.mime_type === "string" ? o.mime_type : typeof o.mimeType === "string" ? o.mimeType : "";
  if (mime.toLowerCase().startsWith("image/") && typeof o.data === "string" && o.data.length > 64) {
    out.push({ data: o.data, mimeType: mime.toLowerCase() });
    return out;
  }
  for (const v of Object.values(o)) imagesIn(v, out, depth + 1);
  return out;
}

function textIn(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 10 || node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) textIn(n, out, depth + 1);
    return out;
  }
  const o = node as Record<string, unknown>;
  if (o.thought === true || o.type === "thought") return out;
  if (typeof o.text === "string" && o.text.trim() && (o.type === undefined || o.type === "text")) out.push(o.text.trim());
  for (const v of Object.values(o)) if (typeof v === "object") textIn(v, out, depth + 1);
  return out;
}

type GeminiAnswer = {
  status?: string;
  candidates?: { finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
};

/** The (last, i.e. final) picture in an answer, or why there is none, in plain English. */
export function pictureFrom(body: unknown): Found | { reason: string } {
  const answer = (body && typeof body === "object" ? body : {}) as GeminiAnswer;
  const last = imagesIn(body).at(-1);
  if (last) return last;
  if (answer.promptFeedback?.blockReason) return { reason: `Gemini refused the request (${answer.promptFeedback.blockReason}). Try again, or use the drawn art.` };
  const finish = answer.candidates?.[0]?.finishReason;
  if (finish && finish !== "STOP") return { reason: `Gemini did not make a picture (${finish}). Try again, or use the drawn art.` };
  if (answer.status && answer.status !== "completed") return { reason: `Gemini did not make a picture (${answer.status}). Try again, or use the drawn art.` };
  const said = textIn(body).join(" ").replace(/\s+/g, " ").slice(0, 160);
  return { reason: `Gemini answered without a picture${said ? ` ("${said}")` : ""}. Try again, or use the drawn art.` };
}

function bodyOf(res: Pick<HttpResponse, "json">): GeminiAnswer {
  try {
    const v = res.json<GeminiAnswer>();
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function why(answer: GeminiAnswer): string {
  const m = answer.error?.message;
  return m ? `: ${m.replace(/\s+/g, " ").slice(0, 300)}` : "";
}

/**
 * Is this a 429 that waiting cannot fix? Google names the free tier in its quota message ("Quota exceeded for metric:
 * ...generate_content_free_tier_requests, limit: 0"): a project with billing is never held to the free tier's limits, so
 * seeing them means the project has no billing (and image models have no free tier). A true rate limit says neither.
 */
export function isNoQuota(text: string): boolean {
  return /\blimit:\s*0\b/i.test(text) || /free[_\s-]?tier/i.test(text);
}

/** The kinds of "no" that mean this request SHAPE was not accepted (try the next one), not that the key or the service is the problem. */
function isShapeProblem(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 408 && status !== 429;
}

export async function run(job: Job, ctx: JobContext) {
  if (!hasKey(ctx.env)) throw new NotConfiguredError(NO_GEMINI_KEY);
  const payload = readPayload(job.payload);
  const key = ctx.env.GEMINI_API_KEY!.trim();
  const model = flyerArtModel(ctx.env.GEMINI_IMAGE_MODEL);
  // GEMINI_API_BASE only points tests at a local mock server.
  const base = (ctx.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const aspectRatio = FLYER_LAYER_ASPECT[payload.kind === "layer" ? payload.layer : "background"];

  let res: HttpResponse | null = null;
  let used: GeminiRequest | null = null;
  const refused: string[] = [];
  for (const req of geminiRequests(model, payload.prompt, aspectRatio)) {
    used = req;
    res = await ctx.http.request(`${base}${req.path}`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: req.body,
      timeoutMs: 120000,
      retries: 1,
    });
    if (res.ok || !isShapeProblem(res.status)) break;
    refused.push(`${req.api}: HTTP ${res.status}${why(bodyOf(res))}`);
    ctx.log.warn("gemini did not accept the request; trying the next shape", { api: req.api, status: res.status, model });
  }
  if (!res || !used) throw new Error("Gemini was not asked.");

  const answer = bodyOf(res);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new PermanentError(`Gemini refused the key (HTTP ${res.status}). A platform administrator needs to check GEMINI_API_KEY in Platform › Setup › AI flyer art${why(answer)}`);
    if (res.status === 404) throw new PermanentError(`The Gemini model ${model} is not available to this key (HTTP 404). Choose another model in Platform › Setup › AI flyer art${why(answer)}`);
    if (res.status === 429) {
      // The usual mistake: the key's Google Cloud project has no billing. Image models have no free tier, so Google answers
      // "quota exceeded, limit: 0" at once, and asking again in a minute would only wait for nothing.
      if (isNoQuota(res.text)) {
        throw new PermanentError(
          "Google says this key's project has no quota for image models (HTTP 429): they have no free tier. A platform administrator needs to turn on billing for the Google Cloud project that owns GEMINI_API_KEY " +
            "(Platform › Setup › AI flyer art), then ask again. The drawn art works meanwhile.",
        );
      }
      throw new Error(`Gemini is rate limiting this key right now (HTTP 429)${why(answer)}`);
    }
    if (res.status >= 500) throw new Error(`Gemini had a problem (HTTP ${res.status})${why(answer)}`);
    throw new PermanentError(`Gemini did not accept the request (${refused.join("; ")}).`);
  }

  const picture = pictureFrom(answer);
  if ("reason" in picture) throw new PermanentError(picture.reason);
  const bytes = Buffer.from(picture.data, "base64");
  if (bytes.length === 0) throw new PermanentError("Gemini answered with an empty picture. Try again, or use the drawn art.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new PermanentError("Gemini sent a picture too large to keep. Try again, or use the drawn art.");

  ctx.log.info("flyer art generated", {
    event: (job.payload as { event_id?: string } | null)?.event_id ?? null,
    kind: payload.kind,
    layer: payload.kind === "layer" ? payload.layer : null,
    model,
    api: used.api,
    bytes: bytes.length,
    content_type: picture.mimeType,
  });
  return {
    image_b64: bytes.toString("base64"),
    content_type: picture.mimeType,
    model,
    provider: PROVIDER,
    api: used.api,
    prompt: payload.prompt,
    ...(payload.kind === "layer" ? { layer: payload.layer, occasion: payload.occasion, seed: payload.seed } : {}),
  };
}
