import { describe, expect, it } from "vitest";

import * as demoPing from "../src/handlers/demo.ping";
import { HANDLERS } from "../src/handlers";
import { createHttp } from "../src/http";
import type { Job } from "../src/db";
import { createRegistry, createRunner, PRIORITY_KINDS, processJob, readiness } from "../src/runner";
import type { HandlerModule } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

const deps = (db: ReturnType<typeof fakeDb>["db"], env: Record<string, string> = {}) => {
  const { log, lines } = captureLog();
  return { d: { db, reg: createRegistry(HANDLERS), env, http: createHttp(), log, workerId: "w-test" }, lines };
};

/** The kinds the runner claims while nothing is configured: every kind but the ones that wait (storage.scan and its sweep). */
const claimedKinds = () => HANDLERS.filter((h) => !h.waitWhenNotConfigured).map((h) => h.kind);

describe("registry", () => {
  it("has demo.ping, oauth.exchange, storage.retention and storage.scan (which waits while scanning is off)", () => {
    expect([...createRegistry(HANDLERS).keys()].sort()).toEqual([
      "calendar.import_feed", "calendar.refresh_feeds",
      "demo.clear", "demo.load", "demo.ping", "events.generate_flyer", "homework.publish_notify", "homework.reminders_sweep", "import.suggest_mapping", "messaging.domain_verify", "messaging.send", "messaging.test_send", "messaging.webhook.email", "messaging.webhook.twilio", "niva.answer", "niva.discover_site", "niva.import_page", "niva.retention", "oauth.exchange", "pathshala.holds_sweep", "payments.refund", "payments.reports_sweep", "payments.sync_payouts", "payments.test_charge", "payments.webhook.paypal", "payments.webhook.stripe", "photos.import_album", "platform.promote", "platform.sandbox_expiry", "platform.test_provider", "qbo.bring_in_history", "qbo.match_suggest_ai", "qbo.post", "qbo.pull_customers_history", "qbo.pull_lists", "qbo.refresh_token", "qbo.test_post", "storage.retention", "storage.scan", "storage.scan_sweep", "surveys.launch_notify",
    ]);
    expect(HANDLERS.filter((h) => h.waitWhenNotConfigured).map((h) => h.kind).sort()).toEqual(["storage.scan", "storage.scan_sweep"]);
    expect(HANDLERS.filter((h) => h.maxInFlight !== undefined).map((h) => [h.kind, h.maxInFlight])).toEqual([["storage.scan", 1]]);
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
    expect(r["storage.scan"]).toMatchObject({ configured: false, reason: expect.stringContaining("Virus scanning is switched off") });
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
    // Niva first (none due), then the rest into all but the slot kept for Niva.
    const { db, calls } = fakeDb({ claim: [[], [job({ id: "1" })], []] });
    const { d } = deps(db, { ANTHROPIC_API_KEY: "sk-ant-test" });
    const r = createRunner(d, 2);
    expect(await r.tick()).toBe(1);
    expect(calls[0]).toEqual({ fn: "claim", args: ["w-test", ["niva.answer"], 2] });
    expect(calls[1]).toEqual({ fn: "claim", args: ["w-test", claimedKinds().filter((k) => k !== "niva.answer"), 1] });
    expect(await r.drain(1000)).toBe(true);
    expect(calls.filter((c) => c.fn === "finish")).toHaveLength(1);
    r.stop();
    expect(await r.tick()).toBe(0);
  });
});

describe("runner: kinds that wait, and kinds with a limit (virus checks, 0589)", () => {
  /** Handlers that wait until the test lets them finish, and a queue the claims take from by kind, in order. */
  function setup(queued: Job[], handlers: HandlerModule[], env: Record<string, string>, concurrency = 4) {
    const release: (() => void)[] = [];
    const reg = createRegistry(handlers.map((h) => ({ ...h, run: () => new Promise((r) => release.push(() => r({ ok: true }))) })));
    const { db, calls } = fakeDb();
    const queue = [...queued];
    db.claim = async (worker, kinds, limit) => {
      calls.push({ fn: "claim", args: [worker, kinds, limit] });
      const out: Job[] = [];
      for (let i = 0; i < queue.length && out.length < limit; ) {
        if (kinds.includes(queue[i]!.kind)) out.push(...queue.splice(i, 1));
        else i++;
      }
      return out;
    };
    const { log } = captureLog();
    const runner = createRunner({ db, reg, env, http: createHttp(), log, workerId: "w" }, concurrency, { priority: [] });
    const releaseAll = () => release.splice(0).forEach((f) => f());
    return { runner, calls, queue, releaseAll };
  }
  const claims = (calls: { fn: string; args: unknown[] }[]) => calls.filter((c) => c.fn === "claim").map((c) => c.args.slice(1));
  const scan: HandlerModule = {
    kind: "storage.scan",
    waitWhenNotConfigured: true,
    maxInFlight: 1,
    configured: (e) => (e.UPLOAD_SCAN_MODE === "monitor" ? { configured: true } : { configured: false, reason: "Virus scanning is switched off" }),
    run: async () => null,
  };
  const send: HandlerModule = { kind: "messaging.send", run: async () => null };

  it("leaves a waiting kind's jobs in the queue while it is not configured, and claims them once it is", async () => {
    const env: Record<string, string> = {};
    const backlog = Array.from({ length: 5 }, (_, i) => job({ id: `S${i}`, kind: "storage.scan" }));
    const { runner, calls, queue, releaseAll } = setup(backlog, [scan, send], env);
    expect(await runner.tick()).toBe(0);
    expect(claims(calls)).toEqual([[["messaging.send"], 4]]);
    expect(queue).toHaveLength(5);
    // Switched on in Platform › Setup (the overlay): one check at a time, after the other kinds.
    env.UPLOAD_SCAN_MODE = "monitor";
    calls.length = 0;
    expect(await runner.tick()).toBe(1);
    expect(claims(calls)).toEqual([
      [["messaging.send"], 4],
      [["storage.scan"], 1],
    ]);
    // While that one runs, the next tick claims no second check, and the check takes none of the general slots.
    calls.length = 0;
    expect(await runner.tick()).toBe(0);
    expect(claims(calls)).toEqual([[["messaging.send"], 4]]);
    releaseAll();
    expect(await runner.drain(1000)).toBe(true);
    calls.length = 0;
    expect(await runner.tick()).toBe(1);
    expect(queue).toHaveLength(3);
    releaseAll();
    expect(await runner.drain(1000)).toBe(true);
  });

  it("a backlog of checks never keeps messages waiting: a check runs in a slot of its own, after the other kinds", async () => {
    const env = { UPLOAD_SCAN_MODE: "monitor" };
    const queued = [...Array.from({ length: 3 }, (_, i) => job({ id: `S${i}`, kind: "storage.scan" })), ...Array.from({ length: 4 }, (_, i) => job({ id: `M${i}`, kind: "messaging.send" }))];
    const { runner, calls, queue, releaseAll } = setup(queued, [scan, send], env);
    expect(await runner.tick()).toBe(5);
    expect(claims(calls)).toEqual([
      [["messaging.send"], 4],
      [["storage.scan"], 1],
    ]);
    expect(queue.map((j) => j.id)).toEqual(["S1", "S2"]);
    expect(runner.inFlight()).toBe(5);
    releaseAll();
    expect(await runner.drain(1000)).toBe(true);
    calls.length = 0;
    expect(await runner.tick()).toBe(1);
    expect(claims(calls)).toEqual([
      [["messaging.send"], 4],
      [["storage.scan"], 1],
    ]);
    releaseAll();
    expect(await runner.drain(1000)).toBe(true);
  });

  it("a check that is still running holds none of the general slots, and a second one is not started beside it", async () => {
    const env = { UPLOAD_SCAN_MODE: "monitor" };
    const { runner, calls, queue, releaseAll } = setup([job({ id: "S0", kind: "storage.scan" }), job({ id: "S1", kind: "storage.scan" })], [scan, send], env);
    expect(await runner.tick()).toBe(1); // S0 runs (and does not finish)
    queue.push(...Array.from({ length: 6 }, (_, i) => job({ id: `M${i}`, kind: "messaging.send" })));
    calls.length = 0;
    expect(await runner.tick()).toBe(4); // all four general slots are free for messages
    expect(claims(calls)).toEqual([[["messaging.send"], 4]]); // and the check's own slot is taken: S1 is not claimed
    expect(runner.inFlight()).toBe(5);
    expect(queue.map((j) => j.id)).toEqual(["S1", "M4", "M5"]);
    releaseAll();
    expect(await runner.drain(1000)).toBe(true);
  });

  it("a waiting kind's job claimed just as it stopped being configured goes back to the queue (retried, never failed for good)", async () => {
    const { db, calls } = fakeDb();
    const { log } = captureLog();
    const out = await processJob({ db, reg: createRegistry([scan]), env: {}, http: createHttp(), log, workerId: "w" }, job({ kind: "storage.scan" }));
    expect(out.status).toBe("retrying");
    expect(calls.find((c) => c.fn === "fail")!.args).toEqual(["1", "Virus scanning is switched off; the job waits in the queue until it is.", true]);
  });
});

describe("runner: a slot kept for Niva", () => {
  /** Handlers that wait until the test lets them finish, and a queue the claims take from by kind, in order. */
  function setup(queued: Job[]) {
    const release: (() => void)[] = [];
    const slow = (kind: string): HandlerModule => ({ kind, run: () => new Promise((r) => release.push(() => r({ ok: true }))) });
    const reg = createRegistry([slow("niva.answer"), slow("photos.import_album"), slow("qbo.bring_in_history")]);
    const { db, calls } = fakeDb();
    const queue = [...queued];
    db.claim = async (worker, kinds, limit) => {
      calls.push({ fn: "claim", args: [worker, kinds, limit] });
      const out: Job[] = [];
      for (let i = 0; i < queue.length && out.length < limit; ) {
        if (kinds.includes(queue[i]!.kind)) out.push(...queue.splice(i, 1));
        else i++;
      }
      return out;
    };
    const { log } = captureLog();
    const runner = createRunner({ db, reg, env: {}, http: createHttp(), log, workerId: "w" }, 4);
    const releaseAll = () => release.splice(0).forEach((f) => f());
    return { runner, calls, queue, releaseAll };
  }
  const claims = (calls: { fn: string; args: unknown[] }[]) => calls.filter((c) => c.fn === "claim").map((c) => c.args.slice(1));

  it("is niva.answer by default", () => {
    expect(PRIORITY_KINDS).toEqual(["niva.answer"]);
  });

  it("claims niva.answer first, and long jobs never take the last slot", async () => {
    const long = Array.from({ length: 6 }, (_, i) => job({ id: `L${i}`, kind: i % 2 ? "qbo.bring_in_history" : "photos.import_album" }));
    const { runner, calls, queue, releaseAll } = setup(long);
    expect(await runner.tick()).toBe(3);
    expect(claims(calls)).toEqual([
      [["niva.answer"], 4],
      [["photos.import_album", "qbo.bring_in_history"], 3],
    ]);
    expect(runner.inFlight()).toBe(3);
    // Three long jobs running: the fourth slot stays free, and the next tick asks only for answers.
    calls.length = 0;
    expect(await runner.tick()).toBe(0);
    expect(claims(calls)).toEqual([[["niva.answer"], 1]]);
    // A question arrives: it gets the kept slot at once, though long jobs are still queued.
    queue.push(job({ id: "N1", kind: "niva.answer" }));
    calls.length = 0;
    expect(await runner.tick()).toBe(1);
    expect(claims(calls)).toEqual([[["niva.answer"], 1]]);
    expect(runner.inFlight()).toBe(4);
    expect(queue.map((j) => j.id)).toEqual(["L3", "L4", "L5"]);
    releaseAll();
    expect(await runner.drain(1000)).toBe(true);
  });

  it("answers may use every slot, and long jobs get theirs back as answers finish", async () => {
    const answers = Array.from({ length: 5 }, (_, i) => job({ id: `N${i}`, kind: "niva.answer" }));
    const { runner, calls, queue, releaseAll } = setup([...answers, job({ id: "L0", kind: "photos.import_album" })]);
    expect(await runner.tick()).toBe(4);
    expect(claims(calls)).toEqual([[["niva.answer"], 4]]);
    expect(queue.map((j) => j.id)).toEqual(["N4", "L0"]);
    releaseAll();
    expect(await runner.drain(1000)).toBe(true);
    calls.length = 0;
    expect(await runner.tick()).toBe(2);
    expect(claims(calls)).toEqual([
      [["niva.answer"], 4],
      [["photos.import_album", "qbo.bring_in_history"], 3],
    ]);
    releaseAll();
    expect(await runner.drain(1000)).toBe(true);
  });

  it("keeps no slot while niva.answer cannot run (no Anthropic key), and keeps it again once a key is saved", async () => {
    const release: (() => void)[] = [];
    const slow = (kind: string): HandlerModule => ({ kind, run: () => new Promise((r) => release.push(() => r({ ok: true }))) });
    const env: Record<string, string> = {};
    const niva: HandlerModule = { ...slow("niva.answer"), configured: (e) => (e.ANTHROPIC_API_KEY ? { configured: true } : { configured: false, reason: "no key" }) };
    const reg = createRegistry([niva, slow("photos.import_album")]);
    const { db, calls } = fakeDb();
    const queue = Array.from({ length: 6 }, (_, i) => job({ id: `L${i}`, kind: "photos.import_album" }));
    db.claim = async (worker, kinds, limit) => {
      calls.push({ fn: "claim", args: [worker, kinds, limit] });
      return kinds.includes("photos.import_album") ? queue.splice(0, limit) : [];
    };
    const { log } = captureLog();
    // deps.env is the platform overlay: the test changes it as a key saved in the wizard would.
    const runner = createRunner({ db, reg, env, http: createHttp(), log, workerId: "w" }, 4);
    expect(await runner.tick()).toBe(4);
    expect(claims(calls)).toEqual([
      [["niva.answer"], 4],
      [["photos.import_album"], 4],
    ]);
    release.splice(0).forEach((f) => f());
    expect(await runner.drain(1000)).toBe(true);
    env.ANTHROPIC_API_KEY = "sk-ant-saved";
    calls.length = 0;
    expect(await runner.tick()).toBe(2);
    expect(claims(calls)).toEqual([
      [["niva.answer"], 4],
      [["photos.import_album"], 3],
    ]);
    release.splice(0).forEach((f) => f());
    expect(await runner.drain(1000)).toBe(true);
  });

  it("keeps no slot with a single slot, or when this service does not run niva.answer", async () => {
    const { db, calls } = fakeDb();
    const { log } = captureLog();
    const one = createRunner({ db, reg: createRegistry(HANDLERS), env: {}, http: createHttp(), log, workerId: "w" }, 1);
    await one.tick();
    expect(claims(calls)).toEqual([
      [["niva.answer"], 1],
      [claimedKinds().filter((k) => k !== "niva.answer"), 1],
    ]);
    calls.length = 0;
    const noNiva = createRunner({ db, reg: createRegistry([demoPing]), env: {}, http: createHttp(), log, workerId: "w" }, 4);
    await noNiva.tick();
    expect(claims(calls)).toEqual([[["demo.ping"], 4]]);
  });
});
