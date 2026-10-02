import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PermanentError } from "../src/errors";
import { FLYER_ART_GUARDRAIL, findBlockedArtTerm, withArtGuardrail } from "../src/flyer-guard";
import { configured, readPayload, run } from "../src/handlers/events.generate_flyer";
import { createHttp } from "../src/http";
import { captureLog } from "./helpers";

const http = createHttp(fetch, async () => {});
const FAKE_JPEG = Buffer.from("fake-image-bytes");

let server: Server;
let url = "";
let status = 200;
let contentType = "image/jpeg";
let responseBody: Buffer | string = FAKE_JPEG;
let lastPath = "";
beforeAll(async () => {
  server = createServer((req, res) => {
    lastPath = req.url ?? "";
    res.statusCode = status;
    res.setHeader("content-type", contentType);
    res.end(responseBody);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const ctx = (env: Record<string, string> = {}) => {
  const { log } = captureLog();
  return { env: { ...env, POLLINATIONS_BASE_URL: url }, log, http } as unknown as Parameters<typeof run>[1];
};
const jobOf = (payload: unknown) => ({ id: 1, payload, attempts: 1 }) as unknown as Parameters<typeof run>[0];

/** The prompt as Pollinations received it (the path segment after /prompt/). */
function sentPrompt(): string {
  const path = lastPath.split("?")[0] ?? "";
  return decodeURIComponent(path.replace(/^\/prompt\//, ""));
}
function sentQuery(): URLSearchParams {
  return new URLSearchParams(lastPath.split("?")[1] ?? "");
}
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("events.generate_flyer", () => {
  it("is always configured — no platform key is needed", () => {
    expect(configured()).toEqual({ configured: true });
  });

  it("refuses a payload with no prompt", () => {
    expect(() => readPayload({})).toThrow(PermanentError);
    expect(() => readPayload({ prompt: "  " })).toThrow(PermanentError);
  });

  it("refuses a prompt that asks for people, deities or lettering, permanently", () => {
    expect(() => readPayload({ prompt: "Mahavir seated in a temple" })).toThrow(PermanentError);
    expect(() => readPayload({ prompt: "A murti with flowers" })).toThrow(/abstract or decorative only: the request mentioned "murti"/);
    expect(() => readPayload({ prompt: "Happy Diwali text in gold letters" })).toThrow(PermanentError);
    expect(() => readPayload({ prompt: "A crowd of people dancing" })).toThrow(PermanentError);
  });

  it("does not mistake ornament words for blocked ones", () => {
    expect(readPayload({ prompt: "Lotus and mandala patterns with diya light, rangoli dots, for Paryushan context" }).prompt).toContain("Lotus and mandala");
  });

  it("adds the guardrail exactly once, even when the portal already added it", () => {
    const once = readPayload({ prompt: "Soft saffron mandala" }).prompt;
    expect(count(once, FLYER_ART_GUARDRAIL)).toBe(1);
    const again = readPayload({ prompt: withArtGuardrail("Soft saffron mandala") }).prompt;
    expect(again).toBe(once);
    expect(findBlockedArtTerm(once)).toBeNull();
  });

  it("never cuts the guardrail off a long prompt", () => {
    const long = readPayload({ prompt: "golden lotus petals ".repeat(200) }).prompt;
    expect(long.length).toBeLessThanOrEqual(2000);
    expect(long.endsWith(FLYER_ART_GUARDRAIL)).toBe(true);
  });

  it("sends the guarded prompt with private, no enhancement and the safety filter, and returns the bytes as base64", async () => {
    status = 200;
    contentType = "image/jpeg";
    responseBody = FAKE_JPEG;
    const res = (await run(jobOf({ prompt: "Warm saffron and navy mandala rings" }), ctx())) as {
      image_b64: string;
      content_type: string;
      model: string;
      prompt: string;
    };
    expect(sentPrompt()).toContain("Warm saffron and navy mandala rings");
    expect(count(sentPrompt(), FLYER_ART_GUARDRAIL)).toBe(1);
    const q = sentQuery();
    expect(q.get("nologo")).toBe("true");
    expect(q.get("private")).toBe("true");
    expect(q.get("enhance")).toBe("false");
    expect(q.get("safe")).toBe("true");
    expect(q.get("width")).toBe("1024");
    expect(q.get("height")).toBe("1536");
    expect(q.get("seed")).toMatch(/^\d+$/);
    expect(res.image_b64).toBe(FAKE_JPEG.toString("base64"));
    expect(res.content_type).toBe("image/jpeg");
    expect(res.model).toBe("pollinations-flux");
    expect(res.prompt).toBe(withArtGuardrail("Warm saffron and navy mandala rings"));
  });

  it("refuses a blocked prompt before calling Pollinations", async () => {
    lastPath = "";
    await expect(run(jobOf({ prompt: "Portrait of Bhagwan" }), ctx())).rejects.toBeInstanceOf(PermanentError);
    expect(lastPath).toBe("");
  });

  it("treats a JSON error response (the shared pool refusing) as retryable, not permanent", async () => {
    status = 500;
    contentType = "application/json";
    responseBody = JSON.stringify({ error: "Internal Server Error", message: "429: rate limit exceeded" });
    await expect(run(jobOf({ prompt: "A mandala" }), ctx())).rejects.not.toBeInstanceOf(PermanentError);
  });

  it("treats a 4xx as permanent, not retried", async () => {
    status = 400;
    contentType = "application/json";
    responseBody = JSON.stringify({ message: "invalid prompt" });
    await expect(run(jobOf({ prompt: "A mandala" }), ctx())).rejects.toBeInstanceOf(PermanentError);
  });

  it("fails permanently when an ok response comes back with no image bytes", async () => {
    status = 200;
    contentType = "image/jpeg";
    responseBody = "";
    await expect(run(jobOf({ prompt: "A mandala" }), ctx())).rejects.toBeInstanceOf(PermanentError);
  });
});
