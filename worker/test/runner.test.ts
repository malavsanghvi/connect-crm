import { describe, expect, it } from "vitest";

import * as demoPing from "../src/handlers/demo.ping";
import { HANDLERS } from "../src/handlers";
import { createHttp } from "../src/http";
import { createRegistry, createRunner, processJob, readiness } from "../src/runner";
import { captureLog, fakeDb, job } from "./helpers";

const deps = (db: ReturnType<typeof fakeDb>["db"], env: Record<string, string> = {}) => {
  const { log, lines } = captureLog();
  return { d: { db, reg: createRegistry(HANDLERS), env, http: createHttp(), log, workerId: "w-test" }, lines };
};

describe("registry", () => {
  it("has demo.ping, oauth.exchange and storage.retention, and no invented storage.scan", () => {
    expect([...createRegistry(HANDLERS).keys()].sort()).toEqual([
      "demo.ping", "import.suggest_mapping", "messaging.domain_verify", "messaging.send", "messaging.test_send",
      "messaging.webhook.email", "messaging.webhook.twilio", "oauth.exchange", "storage.retention",
    ]);
  });
  it("refuses duplicate or malformed kinds", () => {
    expect(() => createRegistry([demoPing, demoPing])).toThrow(/Two handlers/);
    expect(() => createRegistry([{ kind: "Bad", run: async () => null }])).toThrow(/area.action/);
  });
  it("reports which handlers are configured, with the reason", () => {
    const r = readiness(createRegistry(HANDLERS), {});
    expect(r["demo.ping"]).toEqual({ configured: true });
    expect(r["oauth.exchange"]).toMatchObject({ configured: false });
    expect(r["storage.retention"]).toMatchObject({ configured: false, reason: expect.stringContaining("SUPABASE_URL, SUPABASE_SECRET_KEY not set") });
  });
});

describe("processJob", () => {
  it("finishes a demo.ping with its result", async () => {
    const { db, calls } = fakeDb();
    const { d } = deps(db);
    expect(await processJob(d, job({ attempts: 1 }))).toMatchObject({ status: "done" });
    const fin = calls.find((c) => c.fn === "finish")!;
    expect(fin.args[0]).toBe("1");
    expect(fin.args[1]).toMatchObject({ pong: true, attempt: 1, worker: "w-test" });
  });
  it("a failing attempt is recorded as retryable", async () => {
    const { db, calls } = fakeDb();
    const { d } = deps(db);
    const out = await processJob(d, job({ attempts: 1, payload: { fail_times: 1 } }));
    expect(out.status).toBe("retrying");
    expect(calls.find((c) => c.fn === "fail")!.args).toEqual(["1", "Test failure 1 of 1, as the job asked (it will be retried).", true]);
    expect(await processJob(d, job({ attempts: 2, payload: { fail_times: 1 } }))).toMatchObject({ status: "done" });
  });
  it("a handler that is not configured fails at once and says why", async () => {
    const { db, calls } = fakeDb();
    const { d, lines } = deps(db);
    const out = await processJob(d, job({ kind: "storage.retention" }));
    expect(out.status).toBe("failed");
    const [, msg, retry] = calls.find((c) => c.fn === "fail")!.args;
    expect(retry).toBe(false);
    expect(msg).toBe("Storage retention is not configured on the background service (SUPABASE_URL, SUPABASE_SECRET_KEY not set)");
    expect(lines.some((l) => l.msg === "job failed")).toBe(true);
  });
  it("an unknown kind is not retried", async () => {
    const { db, calls } = fakeDb();
    const { d } = deps(db);
    await processJob(d, job({ kind: "nothing.here" }));
    expect(calls.find((c) => c.fn === "fail")!.args[2]).toBe(false);
  });
  it("reads a secret through the vault with the job as the purpose, and never returns it", async () => {
    const { db, calls } = fakeDb({ secrets: { "conn-1/api_key": "sk_test_SECRET" } });
    const { d, lines } = deps(db);
    await processJob(d, job({ id: "9", payload: { secret: { connection_id: "conn-1", name: "api_key" } } }));
    const read = calls.find((c) => c.fn === "readSecret")!;
    expect(read.args[0]).toEqual({ workerId: "w-test", jobId: "9", purpose: "job 9 demo.ping" });
    const fin = calls.find((c) => c.fn === "finish")!;
    expect(JSON.stringify(fin.args[1])).not.toContain("SECRET");
    expect(fin.args[1]).toMatchObject({ secret: { found: true } });
    expect(JSON.stringify(lines)).not.toContain("SECRET");
  });
});

describe("runner", () => {
  it("claims only up to the free concurrency and drains", async () => {
    const { db, calls } = fakeDb({ claim: [[job({ id: "1" }), job({ id: "2" })], []] });
    const { d } = deps(db);
    const r = createRunner(d, 2);
    expect(await r.tick()).toBe(2);
    expect(calls[0]).toEqual({ fn: "claim", args: ["w-test", [...createRegistry(HANDLERS).keys()], 2] });
    expect(await r.drain(1000)).toBe(true);
    expect(calls.filter((c) => c.fn === "finish")).toHaveLength(2);
    r.stop();
    expect(await r.tick()).toBe(0);
  });
});
