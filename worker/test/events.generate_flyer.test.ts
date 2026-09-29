import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotConfiguredError, PermanentError } from "../src/errors";
import { readPayload, run } from "../src/handlers/events.generate_flyer";
import { createHttp } from "../src/http";
import { captureLog } from "./helpers";

const http = createHttp(fetch, async () => {});

let server: Server;
let url = "";
let status = 200;
let responseBody: unknown = { data: [{ b64_json: "ZmFrZS1pbWFnZS1ieXRlcw==" }] };
let lastBody: Record<string, unknown> | null = null;
let lastAuth: string | null = null;
beforeAll(async () => {
  server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      lastBody = b ? JSON.parse(b) : null;
      lastAuth = req.headers.authorization ?? null;
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(responseBody));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const ctx = (env: Record<string, string>) => {
  const { log } = captureLog();
  return { env, log, http } as unknown as Parameters<typeof run>[1];
};
const jobOf = (payload: unknown) => ({ id: 1, payload, attempts: 1 }) as unknown as Parameters<typeof run>[0];

describe("events.generate_flyer", () => {
  it("says honestly that it is not configured without OPENAI_API_KEY", async () => {
    await expect(run(jobOf({ prompt: "A flyer" }), ctx({}))).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("refuses a payload with no prompt", () => {
    expect(() => readPayload({})).toThrow(PermanentError);
    expect(() => readPayload({ prompt: "  " })).toThrow(PermanentError);
  });

  it("sends the prompt with the API key and returns the image bytes", async () => {
    status = 200;
    responseBody = { data: [{ b64_json: "ZmFrZS1pbWFnZS1ieXRlcw==" }] };
    const res = (await run(jobOf({ prompt: "Diwali celebration flyer, warm colors" }), ctx({ OPENAI_API_KEY: "sk-test-fake", OPENAI_BASE_URL: url }))) as {
      image_b64: string;
      model: string;
      prompt: string;
    };
    expect(lastAuth).toBe("Bearer sk-test-fake");
    expect(lastBody?.prompt).toBe("Diwali celebration flyer, warm colors");
    expect(lastBody?.model).toBe("gpt-image-1");
    expect(res.image_b64).toBe("ZmFrZS1pbWFnZS1ieXRlcw==");
    expect(res.prompt).toBe("Diwali celebration flyer, warm colors");
  });

  it("treats a 401 as not configured (a refused key), not a retryable failure", async () => {
    status = 401;
    responseBody = { error: { message: "Incorrect API key" } };
    await expect(run(jobOf({ prompt: "A flyer" }), ctx({ OPENAI_API_KEY: "sk-bad", OPENAI_BASE_URL: url }))).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("treats a 400 (e.g. a moderation refusal) as permanent, not retried", async () => {
    status = 400;
    responseBody = { error: { message: "Your request was rejected by the safety system." } };
    await expect(run(jobOf({ prompt: "A flyer" }), ctx({ OPENAI_API_KEY: "sk-test-fake", OPENAI_BASE_URL: url }))).rejects.toBeInstanceOf(PermanentError);
  });

  it("fails permanently when no image comes back", async () => {
    status = 200;
    responseBody = { data: [] };
    await expect(run(jobOf({ prompt: "A flyer" }), ctx({ OPENAI_API_KEY: "sk-test-fake", OPENAI_BASE_URL: url }))).rejects.toBeInstanceOf(PermanentError);
  });
});
