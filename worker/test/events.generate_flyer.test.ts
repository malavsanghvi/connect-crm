import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_FLYER_ART_MODEL, FLYER_LAYER_ASPECT, FLYER_LAYER_PROMPTS, FLYER_OCCASIONS, NO_GEMINI_KEY } from "../../src/lib/events/flyer-art";
import { NotConfiguredError, PermanentError, isRetryable } from "../src/errors";
import { FLYER_ART_GUARDRAIL, FLYER_LAYER_GUARDRAIL, findBlockedArtTerm, withArtGuardrail, withLayerGuardrail } from "../src/flyer-guard";
import { configured, geminiRequests, imagesIn, info, isNoQuota, pictureFrom, readPayload, run } from "../src/handlers/events.generate_flyer";
import { createHttp } from "../src/http";
import { captureLog } from "./helpers";

const http = createHttp(fetch, async () => {});

/** A made-up picture: 100 bytes of base64 is the least the reader accepts as an image block. */
const FAKE = Buffer.from("fake-image-bytes-".repeat(20));
const KEY = "AIzaSy-test-key-123456789012345678901234";

type Seen = { method: string; url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> };
type Scripted = { status: number; body: unknown };

let server: Server;
let base = "";
const seen: Seen[] = [];
let script: Scripted[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      } catch {
        // an empty or non-JSON body stays {}
      }
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      const next = script.shift() ?? { status: 500, body: { error: { message: "no scripted answer" } } };
      res.statusCode = next.status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(next.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  seen.length = 0;
  script = [];
});

const ctx = (env: Record<string, string> = {}) => {
  const { log, lines } = captureLog();
  return { c: { env: { GEMINI_API_KEY: KEY, GEMINI_API_BASE: base, ...env }, log, http } as unknown as Parameters<typeof run>[1], lines };
};
const jobOf = (payload: unknown) => ({ id: 1, payload, attempts: 1 }) as unknown as Parameters<typeof run>[0];
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** Interactions API answer with one picture (steps[].content[]). */
const interactionsAnswer = (data = FAKE.toString("base64"), mime = "image/jpeg") => ({
  id: "v1_x",
  status: "completed",
  steps: [{ type: "model_output", content: [{ type: "image", mime_type: mime, data }] }],
});
/** generateContent answer with one picture (candidates[].content.parts[].inlineData). */
const generateAnswer = (data = FAKE.toString("base64"), mime = "image/png") => ({
  candidates: [{ content: { parts: [{ text: "Here is your picture." }, { inlineData: { mimeType: mime, data } }] }, finishReason: "STOP" }],
});

const layerJob = (over: Record<string, unknown> = {}) =>
  jobOf({ event_id: "e1", occasion: "garba", layer: "frame", seed: 12345, prompt: "A decorative border frame with gold mandalas in the corners.", ...over });

describe("events.generate_flyer: readiness", () => {
  it("needs a Gemini key, and says so in plain English", () => {
    expect(configured({})).toEqual({ configured: false, reason: NO_GEMINI_KEY });
    expect(configured({ GEMINI_API_KEY: "  " })).toEqual({ configured: false, reason: NO_GEMINI_KEY });
    expect(configured({ GEMINI_API_KEY: KEY })).toEqual({ configured: true });
    expect(NO_GEMINI_KEY).toBe("AI art needs a Gemini key — ask your Weaver admin (Platform › Setup).");
  });

  it("reports the provider and the model to the heartbeat, never the key", () => {
    expect(info({ GEMINI_API_KEY: KEY })).toEqual({ provider: "gemini", model: DEFAULT_FLYER_ART_MODEL });
    expect(info({ GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image" })).toEqual({ provider: "gemini", model: "gemini-3.1-flash-image" });
    // gemini-2.5-flash-image is shut down on 2026-10-02, and an unknown name is never sent to Google.
    expect(info({ GEMINI_IMAGE_MODEL: "gemini-2.5-flash-image" }).model).toBe(DEFAULT_FLYER_ART_MODEL);
    expect(info({ GEMINI_IMAGE_MODEL: "something-else" }).model).toBe(DEFAULT_FLYER_ART_MODEL);
    expect(JSON.stringify(info({ GEMINI_API_KEY: KEY }))).not.toContain(KEY);
  });

  it("fails a job without a key at once, as not configured (never retried)", async () => {
    const { c } = ctx({ GEMINI_API_KEY: "" });
    const err = await run(layerJob(), c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotConfiguredError);
    expect(isRetryable(err)).toBe(false);
    expect((err as Error).message).toBe(NO_GEMINI_KEY);
    expect(seen).toHaveLength(0);
  });
});

describe("events.generate_flyer: the payload", () => {
  it("refuses a payload with no prompt", () => {
    expect(() => readPayload({})).toThrow(PermanentError);
    expect(() => readPayload({ prompt: "  " })).toThrow(PermanentError);
  });

  it("refuses a prompt that asks for people, deities or lettering, permanently", () => {
    expect(() => readPayload({ prompt: "Mahavir seated in a temple" })).toThrow(PermanentError);
    expect(() => readPayload({ prompt: "A murti with flowers" })).toThrow(/never shows people up close, deities or lettering: the request mentioned "murti"/);
    expect(() => readPayload({ prompt: "Happy Diwali text in gold letters" })).toThrow(PermanentError);
    expect(() => readPayload({ prompt: "A crowd of people dancing" })).toThrow(PermanentError);
    expect(() => readPayload({ prompt: "Garba dancers around Ambe Mataji" })).toThrow(/the request mentioned "dancers"/);
  });

  it("asks for a background in English: the blocked-word check cannot read another script, so a Gujarati or Hindi description is refused", () => {
    expect(() => readPayload({ prompt: "સુંદર ફૂલોની ડિઝાઇન" })).toThrow(PermanentError);
    expect(() => readPayload({ prompt: "सुंदर रंगोली and mandala" })).toThrow(/described in English.*has "स"/);
    // English with accents, symbols and numbers is fine.
    expect(readPayload({ prompt: "Café-style ornaments — 3 rings of gold, ★ sparkles" }).kind).toBe("background");
  });

  it("does not mistake ornament words for blocked ones", () => {
    expect(readPayload({ prompt: "Lotus and mandala patterns with diya light, rangoli dots, for Paryushan context" }).prompt).toContain("Lotus and mandala");
  });

  it("a background gets the background guardrail exactly once, even when the portal already added it", () => {
    const once = readPayload({ prompt: "Soft saffron mandala" });
    expect(once.kind).toBe("background");
    expect(count(once.prompt, FLYER_ART_GUARDRAIL)).toBe(1);
    expect(readPayload({ prompt: withArtGuardrail("Soft saffron mandala") }).prompt).toBe(once.prompt);
    expect(findBlockedArtTerm(once.prompt)).toBeNull();
  });

  it("a layer ENDS with the layer guardrail (no text, no deities, no close-up faces), exactly once", () => {
    const p = readPayload({ prompt: "A border of gold mandalas.", layer: "frame", occasion: "garba", seed: 7 });
    expect(p).toMatchObject({ kind: "layer", layer: "frame", occasion: "garba", seed: 7 });
    expect(p.prompt.endsWith(FLYER_LAYER_GUARDRAIL)).toBe(true);
    expect(count(p.prompt, FLYER_LAYER_GUARDRAIL)).toBe(1);
    expect(p.prompt).toMatch(/No text of any kind/);
    expect(p.prompt).toMatch(/No deities/);
    expect(p.prompt).toMatch(/No close-up faces/);
    // The portal already added it: still once.
    expect(readPayload({ prompt: withLayerGuardrail("A border of gold mandalas."), layer: "frame", occasion: "garba", seed: 7 }).prompt).toBe(p.prompt);
    expect(findBlockedArtTerm(p.prompt)).toBeNull();
  });

  it("builds a layer's description itself from the occasion and layer, whatever text came with the request (the database takes any text from a caller)", () => {
    for (const occasion of FLYER_OCCASIONS) {
      for (const layer of ["frame", "scene"] as const) {
        const own = withLayerGuardrail(FLYER_LAYER_PROMPTS[occasion][layer], 2000);
        // The portal's own text, a different text, a very long text, a blocked one, one in another script, and none at all: always ours.
        for (const prompt of [FLYER_LAYER_PROMPTS[occasion][layer], "A swami giving a blessing", "golden lotus ".repeat(300), "Lord Rama and Sita in a forest", "ભગવાન", undefined]) {
          const p = readPayload({ prompt, layer, occasion, seed: 1 });
          expect(p, `${occasion} ${layer}`).toMatchObject({ kind: "layer", layer, occasion, prompt: own });
          expect(p.prompt.length).toBeLessThanOrEqual(2000);
          expect(p.prompt.endsWith(FLYER_LAYER_GUARDRAIL)).toBe(true);
          expect(findBlockedArtTerm(p.prompt), `${occasion} ${layer}`).toBeNull();
        }
      }
    }
  });

  it("never cuts a guardrail off a long background description", () => {
    const bg = readPayload({ prompt: "golden lotus petals ".repeat(200) }).prompt;
    expect(bg.length).toBeLessThanOrEqual(2000);
    expect(bg.endsWith(FLYER_ART_GUARDRAIL)).toBe(true);
  });

  it("checks the layer, the occasion and the seed", () => {
    const base = { prompt: "Gold border", layer: "frame", occasion: "garba", seed: 5 };
    expect(() => readPayload({ ...base, layer: "background" })).toThrow(/frame or a scene/);
    expect(() => readPayload({ ...base, occasion: "birthday" })).toThrow(/no occasion/);
    expect(() => readPayload({ ...base, seed: 0 })).toThrow(/seed/);
    expect(() => readPayload({ ...base, seed: 2 ** 31 })).toThrow(/seed/);
    expect(() => readPayload({ ...base, seed: 1.5 })).toThrow(/seed/);
  });
});

describe("events.generate_flyer: what is sent to Google", () => {
  it("builds the Interactions API request first, as Google's image page shows it", () => {
    const [first] = geminiRequests("gemini-3.1-flash-lite-image", "A prompt.", "2:3");
    expect(first).toEqual({
      api: "interactions",
      path: "/v1beta/interactions",
      body: {
        model: "gemini-3.1-flash-lite-image",
        input: [{ type: "text", text: "A prompt." }],
        response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "2:3" },
      },
    });
  });

  it("then falls back to generateContent, in the shape the legacy page shows and the older imageConfig one", () => {
    const all = geminiRequests("gemini-3.1-flash-image", "A prompt.", "21:9");
    const second = all[1]!;
    const third = all[2]!;
    expect(second.path).toBe("/v1/models/gemini-3.1-flash-image:generateContent");
    expect(second.body).toEqual({
      contents: [{ role: "user", parts: [{ text: "A prompt." }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], responseFormat: { image: { aspectRatio: "21:9" } } },
    });
    expect(third.path).toBe("/v1beta/models/gemini-3.1-flash-image:generateContent");
    expect(third.body.generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "21:9" } });
  });

  it("asks for a tall frame and a wide scene strip", () => {
    expect(FLYER_LAYER_ASPECT).toEqual({ frame: "2:3", scene: "21:9", background: "2:3" });
  });
});

describe("events.generate_flyer: reading an answer", () => {
  it("finds the picture in an Interactions answer, a generateContent answer (camelCase or snake_case) and the older outputs shape", () => {
    expect(pictureFrom(interactionsAnswer())).toMatchObject({ mimeType: "image/jpeg" });
    expect(pictureFrom(generateAnswer())).toMatchObject({ mimeType: "image/png" });
    const snake = { candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/png", data: FAKE.toString("base64") } }] } }] };
    expect(pictureFrom(snake)).toMatchObject({ mimeType: "image/png" });
    expect(pictureFrom({ outputs: [{ type: "image", mime_type: "image/png", data: FAKE.toString("base64") }] })).toMatchObject({ mimeType: "image/png" });
  });

  it("takes the last picture and skips interim 'thought' pictures", () => {
    const first = Buffer.from("first-".repeat(40)).toString("base64");
    const last = Buffer.from("last--".repeat(40)).toString("base64");
    const answer = {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, inlineData: { mimeType: "image/png", data: first } },
              { inlineData: { mimeType: "image/png", data: last } },
            ],
          },
        },
      ],
    };
    expect(imagesIn(answer)).toHaveLength(1);
    expect(pictureFrom(answer)).toMatchObject({ data: last });
    const steps = { steps: [{ type: "thought", content: [{ type: "image", mime_type: "image/png", data: first }] }, { type: "model_output", content: [{ type: "image", mime_type: "image/png", data: last }] }] };
    expect(pictureFrom(steps)).toMatchObject({ data: last });
  });

  it("says why there is no picture, in plain English", () => {
    expect(pictureFrom({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } })).toEqual({
      reason: "Gemini refused the request (PROHIBITED_CONTENT). Try again, or use the drawn art.",
    });
    expect(pictureFrom({ candidates: [{ finishReason: "IMAGE_SAFETY" }] })).toEqual({ reason: "Gemini did not make a picture (IMAGE_SAFETY). Try again, or use the drawn art." });
    expect(pictureFrom({ status: "failed", steps: [] })).toEqual({ reason: "Gemini did not make a picture (failed). Try again, or use the drawn art." });
    expect(pictureFrom({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "I can't help with that." }] } }] })).toEqual({
      reason: 'Gemini answered without a picture ("I can\'t help with that."). Try again, or use the drawn art.',
    });
    expect(pictureFrom(null)).toEqual({ reason: "Gemini answered without a picture. Try again, or use the drawn art." });
    // Data that is not an image, or too short to be one, is not a picture.
    expect(pictureFrom({ steps: [{ content: [{ type: "image", mime_type: "text/plain", data: FAKE.toString("base64") }] }] })).toHaveProperty("reason");
    expect(pictureFrom({ steps: [{ content: [{ type: "image", mime_type: "image/png", data: "AAAA" }] }] })).toHaveProperty("reason");
  });
});

describe("events.generate_flyer: run", () => {
  it("makes a layer through the Interactions API and returns the bytes with the cache key's parts", async () => {
    script = [{ status: 200, body: interactionsAnswer() }];
    const { c, lines } = ctx();
    const res = (await run(layerJob(), c)) as Record<string, unknown>;
    expect(seen).toHaveLength(1);
    const req = seen[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/v1beta/interactions");
    expect(req.headers["x-goog-api-key"]).toBe(KEY);
    expect(req.headers["content-type"]).toMatch(/application\/json/);
    expect(req.body).toMatchObject({ model: DEFAULT_FLYER_ART_MODEL, response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "2:3" } });
    // No seed goes to Google: it is only the picture's name in the art library.
    expect(JSON.stringify(req.body)).not.toMatch(/seed/i);
    const sent = ((req.body.input as { text: string }[])[0] ?? { text: "" }).text;
    expect(sent).toContain("A decorative border frame");
    expect(count(sent, FLYER_LAYER_GUARDRAIL)).toBe(1);
    expect(sent.endsWith(FLYER_LAYER_GUARDRAIL)).toBe(true);
    expect(res).toMatchObject({ content_type: "image/jpeg", model: DEFAULT_FLYER_ART_MODEL, provider: "gemini", api: "interactions", layer: "frame", occasion: "garba", seed: 12345 });
    expect(res.image_b64).toBe(FAKE.toString("base64"));
    expect(res.prompt).toBe(sent);
    // The key is in the header only: never in the result, never in a log line.
    expect(JSON.stringify(res)).not.toContain(KEY);
    expect(JSON.stringify(lines)).not.toContain(KEY);
  });

  it("sends Google the occasion's own description even when the job's payload carries other words", async () => {
    script = [{ status: 200, body: interactionsAnswer() }];
    const { c } = ctx();
    const res = (await run(layerJob({ prompt: "A swami giving a blessing to the crowd, Lord Rama and Sita" }), c)) as Record<string, unknown>;
    const sent = ((seen[0]!.body.input as { text: string }[])[0] ?? { text: "" }).text;
    expect(sent).toBe(withLayerGuardrail(FLYER_LAYER_PROMPTS.garba.frame, 2000));
    expect(sent).not.toMatch(/swami|Rama|Sita|crowd/i);
    expect(res.prompt).toBe(sent);
  });

  it("asks a wide strip for a scene, with the model the platform chose", async () => {
    script = [{ status: 200, body: interactionsAnswer(FAKE.toString("base64"), "image/png") }];
    const { c } = ctx({ GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image" });
    const res = (await run(layerJob({ layer: "scene", prompt: "A skyline at dusk." }), c)) as Record<string, unknown>;
    expect(seen[0]!.body).toMatchObject({ model: "gemini-3.1-flash-image", response_format: { aspect_ratio: "21:9" } });
    expect(res).toMatchObject({ layer: "scene", content_type: "image/png", model: "gemini-3.1-flash-image" });
  });

  it("makes a background from the organizer's own words, with the background guardrail", async () => {
    script = [{ status: 200, body: interactionsAnswer() }];
    const { c } = ctx();
    const res = (await run(jobOf({ event_id: "e1", prompt: "Warm saffron and navy mandala rings" }), c)) as Record<string, unknown>;
    const sent = ((seen[0]!.body.input as { text: string }[])[0] ?? { text: "" }).text;
    expect(sent.startsWith("Warm saffron and navy mandala rings")).toBe(true);
    expect(count(sent, FLYER_ART_GUARDRAIL)).toBe(1);
    expect(res).not.toHaveProperty("layer");
    expect(res.prompt).toBe(withArtGuardrail("Warm saffron and navy mandala rings"));
  });

  it("refuses a blocked prompt before calling Google", async () => {
    const { c } = ctx();
    await expect(run(jobOf({ prompt: "Portrait of Bhagwan" }), c)).rejects.toBeInstanceOf(PermanentError);
    expect(seen).toHaveLength(0);
  });

  it("tries the next request shape when Google does not accept the first (nothing was made, so nothing was charged)", async () => {
    script = [
      { status: 400, body: { error: { message: 'Invalid JSON payload received. Unknown name "response_format".' } } },
      { status: 200, body: generateAnswer() },
    ];
    const { c, lines } = ctx();
    const res = (await run(layerJob(), c)) as Record<string, unknown>;
    expect(seen.map((s) => s.url)).toEqual(["/v1beta/interactions", `/v1/models/${DEFAULT_FLYER_ART_MODEL}:generateContent`]);
    expect(res).toMatchObject({ api: "generateContent", content_type: "image/png" });
    expect(lines.some((l) => l.level === "warn")).toBe(true);
  });

  it("tries all three shapes, then says what each answered", async () => {
    script = [
      { status: 400, body: { error: { message: "first no" } } },
      { status: 400, body: { error: { message: "second no" } } },
      { status: 422, body: { error: { message: "third no" } } },
    ];
    const { c } = ctx();
    const err = await run(layerJob(), c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect(isRetryable(err)).toBe(false);
    expect((err as Error).message).toMatch(/interactions: HTTP 400: first no; generateContent: HTTP 400: second no; generateContent \(imageConfig\): HTTP 422: third no/);
    expect(seen).toHaveLength(3);
  });

  it("never asks again after an answer that came without a picture (that could charge twice)", async () => {
    script = [{ status: 200, body: { status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "Sorry." }] }] } }];
    const { c } = ctx();
    const err = await run(layerJob(), c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as Error).message).toMatch(/answered without a picture \("Sorry\."\)/);
    expect(seen).toHaveLength(1);
  });

  it("explains a refused request, and a refused picture, permanently", async () => {
    script = [{ status: 200, body: { promptFeedback: { blockReason: "SAFETY" } } }];
    await expect(run(layerJob(), ctx().c)).rejects.toThrow(/Gemini refused the request \(SAFETY\)/);
    script = [{ status: 200, body: { candidates: [{ finishReason: "IMAGE_PROHIBITED_CONTENT" }] } }];
    await expect(run(layerJob(), ctx().c)).rejects.toBeInstanceOf(PermanentError);
  });

  it("treats a refused key as permanent, and does not try other shapes (the key is the problem)", async () => {
    script = [{ status: 403, body: { error: { message: "API key not valid. Please pass a valid API key." } } }];
    const err = await run(layerJob(), ctx().c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as Error).message).toMatch(/Gemini refused the key \(HTTP 403\).*Platform › Setup › AI flyer art/);
    expect(seen).toHaveLength(1);
  });

  it("says when the model is not available to the key (after trying every shape)", async () => {
    script = [404, 404, 404].map((status) => ({ status, body: { error: { message: "models/x is not found" } } }));
    const err = await run(layerJob(), ctx().c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as Error).message).toMatch(new RegExp(`The Gemini model ${DEFAULT_FLYER_ART_MODEL} is not available to this key \\(HTTP 404\\)`));
  });

  it("treats rate limits and Google's own errors as retryable, not permanent", async () => {
    script = [429, 429].map((status) => ({ status, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Too many requests, please slow down." } } }));
    const limited = await run(layerJob(), ctx().c).catch((e: unknown) => e);
    expect(limited).toBeInstanceOf(Error);
    expect(isRetryable(limited)).toBe(true);
    seen.length = 0;
    script = [503, 503].map((status) => ({ status, body: { error: { message: "overloaded" } } }));
    const down = await run(layerJob(), ctx().c).catch((e: unknown) => e);
    expect(isRetryable(down)).toBe(true);
    expect((down as Error).message).toMatch(/Gemini had a problem \(HTTP 503\)/);
  });

  it("does not promise a retry in a message that may be the job's last word (the job may already have given up)", async () => {
    script = [429, 429].map((status) => ({ status, body: { error: { message: "Too many requests" } } }));
    const limited = (await run(layerJob(), ctx().c).catch((e: unknown) => e)) as Error;
    expect(limited.message).toMatch(/^Gemini is rate limiting this key right now \(HTTP 429\): Too many requests/);
    script = [500, 500].map((status) => ({ status, body: {} }));
    const down = (await run(layerJob(), ctx().c).catch((e: unknown) => e)) as Error;
    expect(`${limited.message} ${down.message}`).not.toMatch(/tried again|try again/i);
  });

  describe("a key whose Google Cloud project has no billing (image models have no free tier)", () => {
    // What Google answers: HTTP 429 RESOURCE_EXHAUSTED naming the free tier, with a limit of zero.
    const noQuota = {
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message:
          "You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-lite-image Please retry in 40s.",
        details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
      },
    };

    it("fails at once and for good, saying what to do, instead of waiting out three attempts for nothing", async () => {
      script = [429, 429].map((status) => ({ status, body: noQuota }));
      const err = (await run(layerJob(), ctx().c).catch((e: unknown) => e)) as Error;
      expect(err).toBeInstanceOf(PermanentError);
      expect(isRetryable(err)).toBe(false);
      expect(err.message).toMatch(/no quota for image models \(HTTP 429\): they have no free tier/);
      expect(err.message).toMatch(/turn on billing for the Google Cloud project that owns GEMINI_API_KEY \(Platform › Setup › AI flyer art\)/);
      expect(err.message).toMatch(/drawn art works meanwhile/);
    });

    it("is told apart from a rate limit by what Google says, not by the status number alone", () => {
      expect(isNoQuota(JSON.stringify(noQuota))).toBe(true);
      expect(isNoQuota("Quota exceeded for metric: x, limit: 0, model: y")).toBe(true);
      expect(isNoQuota("Quota exceeded for metric: generate_content_free_tier_requests, limit: 10")).toBe(true);
      expect(isNoQuota('{"error":{"message":"Resource has been exhausted (e.g. check quota)."}}')).toBe(false);
      expect(isNoQuota("limit: 20, model: y")).toBe(false);
      expect(isNoQuota("")).toBe(false);
    });
  });

  it("fails permanently when a picture is too large to keep", async () => {
    script = [{ status: 200, body: interactionsAnswer(Buffer.alloc(6 * 1024 * 1024 + 1, 1).toString("base64")) }];
    await expect(run(layerJob(), ctx().c)).rejects.toThrow(/too large to keep/);
  });
});
