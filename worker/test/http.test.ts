import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHttp, HttpError } from "../src/http";

let server: http.Server;
let base = "";
const hits: Record<string, number> = {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0]!;
    hits[path] = (hits[path] ?? 0) + 1;
    if (path === "/flaky" && hits[path]! < 3) return void res.writeHead(503).end("busy");
    if (path === "/bad") return void res.writeHead(400).end('{"error":"bad"}');
    if (path === "/slow") return void setTimeout(() => res.writeHead(200).end("late"), 500);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, body, ct: req.headers["content-type"] })));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const noSleep = async () => {};

describe("http with timeouts and retries", () => {
  it("retries 5xx and succeeds", async () => {
    const res = await createHttp(fetch, noSleep).request(`${base}/flaky`, { retries: 3 });
    expect(res.status).toBe(200);
    expect(hits["/flaky"]).toBe(3);
  });
  it("does not retry a 4xx and hands it back", async () => {
    const res = await createHttp(fetch, noSleep).request(`${base}/bad`, { retries: 3 });
    expect(res.status).toBe(400);
    expect(hits["/bad"]).toBe(1);
  });
  it("times out, and the error names neither query string nor headers", async () => {
    const err = await createHttp(fetch, noSleep)
      .request(`${base}/slow?token=abc`, { timeoutMs: 50, retries: 1, headers: { authorization: "Bearer secret" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as Error).message).toBe(`GET ${base}/slow timed out after 50 ms`);
  });
  it("sends objects as JSON", async () => {
    const res = await createHttp(fetch, noSleep).request(`${base}/echo`, { method: "POST", body: { a: 1 } });
    expect(res.json()).toEqual({ ok: true, body: '{"a":1}', ct: "application/json" });
  });
});
