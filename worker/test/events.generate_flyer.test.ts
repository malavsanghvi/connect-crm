import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PermanentError } from "../src/errors";
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

describe("events.generate_flyer", () => {
  it("is always configured — no platform key is needed", () => {
    expect(configured()).toEqual({ configured: true });
  });

  it("refuses a payload with no prompt", () => {
    expect(() => readPayload({})).toThrow(PermanentError);
    expect(() => readPayload({ prompt: "  " })).toThrow(PermanentError);
  });

  it("sends the prompt in the request path and returns the image bytes as base64", async () => {
    status = 200;
    contentType = "image/jpeg";
    responseBody = FAKE_JPEG;
    const res = (await run(jobOf({ prompt: "Diwali celebration flyer, warm colors" }), ctx())) as {
      image_b64: string;
      content_type: string;
      model: string;
      prompt: string;
    };
    expect(decodeURIComponent(lastPath)).toContain("Diwali celebration flyer, warm colors");
    expect(lastPath).toContain("nologo=true");
    expect(res.image_b64).toBe(FAKE_JPEG.toString("base64"));
    expect(res.content_type).toBe("image/jpeg");
    expect(res.model).toBe("pollinations-flux");
    expect(res.prompt).toBe("Diwali celebration flyer, warm colors");
  });

  it("treats a JSON error response (the shared pool refusing) as retryable, not permanent", async () => {
    status = 500;
    contentType = "application/json";
    responseBody = JSON.stringify({ error: "Internal Server Error", message: "429: rate limit exceeded" });
    await expect(run(jobOf({ prompt: "A flyer" }), ctx())).rejects.not.toBeInstanceOf(PermanentError);
  });

  it("treats a 4xx as permanent, not retried", async () => {
    status = 400;
    contentType = "application/json";
    responseBody = JSON.stringify({ message: "invalid prompt" });
    await expect(run(jobOf({ prompt: "A flyer" }), ctx())).rejects.toBeInstanceOf(PermanentError);
  });

  it("fails permanently when an ok response comes back with no image bytes", async () => {
    status = 200;
    contentType = "image/jpeg";
    responseBody = "";
    await expect(run(jobOf({ prompt: "A flyer" }), ctx())).rejects.toBeInstanceOf(PermanentError);
  });
});
