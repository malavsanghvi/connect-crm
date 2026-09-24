import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotConfiguredError, PermanentError } from "../src/errors";
import { createHttp } from "../src/http";
import * as oauth from "../src/handlers/oauth.exchange";
import * as retention from "../src/handlers/storage.retention";
import { jobContext } from "../src/runner";
import { createRegistry } from "../src/runner";
import { HANDLERS } from "../src/handlers";
import { healthOf } from "../src/server";
import { captureLog, fakeDb, job } from "./helpers";

function ctxFor(db: ReturnType<typeof fakeDb>["db"], env: Record<string, string>, j = job()) {
  const { log } = captureLog();
  return jobContext({ db, reg: createRegistry(HANDLERS), env, http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log);
}

describe("oauth.exchange skeleton", () => {
  const stripeEnv = { STRIPE_SECRET_KEY: "sk_test_platform", STRIPE_CLIENT_ID: "ca_test" };
  it("refuses an authorization code in the payload", async () => {
    const j = job({ kind: "oauth.exchange", payload: { provider: "stripe", connection_id: "c", code: "ac_123" } });
    await expect(oauth.run(j, ctxFor(fakeDb().db, stripeEnv))).rejects.toBeInstanceOf(PermanentError);
  });
  it("reports not configured when no provider's platform keys are set", () => {
    expect(oauth.configured({})).toMatchObject({ configured: false, reason: expect.stringContaining("STRIPE_*, PAYPAL_*, INTUIT_*") });
    expect(oauth.configured(stripeEnv)).toEqual({ configured: true });
  });
  it("says honestly when the platform keys are missing", async () => {
    const j = job({ kind: "oauth.exchange", payload: { provider: "paypal", connection_id: "c" } });
    const err = await oauth.run(j, ctxFor(fakeDb().db, {})).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotConfiguredError);
    expect((err as Error).message).toBe("PayPal is not configured on the background service (needs PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET, or PAYPAL_SANDBOX_CLIENT_ID + PAYPAL_SANDBOX_CLIENT_SECRET)");
  });
  it("says a provider exchange is not built yet rather than pretending", async () => {
    const j = job({ kind: "oauth.exchange", payload: { provider: "stripe", connection_id: "c" } });
    await expect(oauth.run(j, ctxFor(fakeDb().db, stripeEnv), {})).rejects.toThrow(/Connecting stripe is not built yet/);
  });
  it("with an exchanger, reads the code from the vault and stores the tokens", async () => {
    const { db, calls } = fakeDb({ secrets: { "c/oauth.code": "ac_live_code" } });
    const j = job({ kind: "oauth.exchange", payload: { provider: "stripe", connection_id: "c" } });
    const out = await oauth.run(j, ctxFor(db, stripeEnv, j), {
      stripe: async ({ code }) => ({ secrets: { access_token: `tok_for_${code}_ABCD`, refresh_token: "rt_WXYZ1234" }, externalAccountId: "acct_1" }),
    });
    expect(out).toEqual({ provider: "stripe", stored: { access_token: "ABCD", refresh_token: "1234" }, expires_at: null, external_account_id: "acct_1" });
    expect(calls.filter((c) => c.fn === "storeSecret").map((c) => c.args[2])).toEqual(["access_token", "refresh_token"]);
  });
});

describe("storage.retention", () => {
  let server: http.Server;
  let base = "";
  const deletes: { bucket: string; prefixes: string[]; apikey: string | undefined }[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const bucket = decodeURIComponent((req.url ?? "").split("/").pop()!);
        const prefixes = (JSON.parse(body) as { prefixes: string[] }).prefixes;
        deletes.push({ bucket, prefixes, apikey: req.headers.apikey as string | undefined });
        if (bucket === "exports") return void res.writeHead(500).end("{}");
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(prefixes.filter((p) => !p.includes("keep")).map((name) => ({ name, bucket_id: bucket }))));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("is not configured without SUPABASE_URL and SUPABASE_SECRET_KEY", async () => {
    await expect(retention.run(job({ kind: "storage.retention" }), ctxFor(fakeDb().db, {}))).rejects.toBeInstanceOf(NotConfiguredError);
  });
  it("deletes through the Storage API, records what went, reports what did not", async () => {
    let round = 0;
    const { db, calls } = fakeDb({
      query: (text) => {
        if (text.includes("storage_expired_objects")) {
          round++;
          return round > 1 ? [] : [
            { bucket_id: "imports", name: "c1/a.csv", created_at: "2026-01-01" },
            { bucket_id: "imports", name: "c1/keep.csv", created_at: "2026-01-01" },
            { bucket_id: "recordings", name: "c1/p1/r.m4a", created_at: "2026-01-01" },
          ];
        }
        return [];
      },
    });
    const out = await retention.run(job({ id: "5", kind: "storage.retention" }), ctxFor(db, { SUPABASE_URL: base + "/", SUPABASE_SECRET_KEY: "sb_secret_test" }));
    expect(out).toMatchObject({ deleted: 2, failed: 1, failures: [{ bucket: "imports", name: "c1/keep.csv" }] });
    expect(deletes.map((d) => [d.bucket, d.prefixes, d.apikey])).toEqual([
      ["imports", ["c1/a.csv", "c1/keep.csv"], "sb_secret_test"],
      ["recordings", ["c1/p1/r.m4a"], "sb_secret_test"],
    ]);
    const recorded = calls.filter((c) => c.fn === "query" && String(c.args[0]).includes("record_storage_deletions"));
    expect(recorded.map((c) => JSON.parse((c.args[1] as unknown[])[1] as string).map((o: { name: string }) => o.name))).toEqual([["c1/a.csv"], ["c1/p1/r.m4a"]]);
  });
  it("throws (to retry) when nothing could be removed", async () => {
    let round = 0;
    const { db } = fakeDb({ query: (t) => (t.includes("storage_expired_objects") && round++ === 0 ? [{ bucket_id: "exports", name: "c1/u/x.csv", created_at: "2026-01-01" }] : []) });
    await expect(retention.run(job({ kind: "storage.retention" }), ctxFor(db, { SUPABASE_URL: base, SUPABASE_SECRET_KEY: "k" }))).rejects.toThrow(/Could not remove 1 expired file/);
  });
});

describe("health", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  it("is healthy while the last heartbeat is recent", () => {
    expect(healthOf({ stopping: false, lastBeatOk: new Date(now.getTime() - 30000), lastBeatError: null, heartbeatMs: 60000, inFlight: 0, now }).status).toBe(200);
  });
  it("is unhealthy with no heartbeat, a stale one, or while stopping, and says why", () => {
    expect(healthOf({ stopping: false, lastBeatOk: null, lastBeatError: "heartbeat failed: password authentication failed", heartbeatMs: 60000, inFlight: 0, now }).body.problem).toMatch(/password authentication failed/);
    expect(healthOf({ stopping: false, lastBeatOk: new Date(now.getTime() - 600000), lastBeatError: null, heartbeatMs: 60000, inFlight: 0, now }).status).toBe(503);
    expect(healthOf({ stopping: true, lastBeatOk: now, lastBeatError: null, heartbeatMs: 60000, inFlight: 1, now }).body.problem).toBe("shutting down");
  });
});
