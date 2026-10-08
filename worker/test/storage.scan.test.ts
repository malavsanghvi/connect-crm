import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { clamdTarget } from "../src/clamd";
import { NotConfiguredError, PermanentError } from "../src/errors";
import { HANDLERS } from "../src/handlers";
import * as scan from "../src/handlers/storage.scan";
import * as sweep from "../src/handlers/storage.scan_sweep";
import { createHttp } from "../src/http";
import { createRegistry, jobContext } from "../src/runner";
import { scanConfigured } from "../src/upload-scan";
import { startFakeClamd, VIRUS_MARKER, type FakeClamd } from "./fake-clamd";
import { captureLog, fakeDb, job } from "./helpers";

/** A storage object id (a uuid: the job names homework files by it). */
const oid = (n: number) => `0b000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HW = "c0000000-0000-4000-8000-000000000001/p0000000-0000-4000-8000-000000000002/s0000000-0000-4000-8000-000000000003/f0000000-0000-4000-8000-000000000004.jpg";

/** A Storage API: GET serves the stored bytes, DELETE removes them; every request is kept. */
function fakeStorage() {
  const files = new Map<string, Buffer>();
  const requests: { method: string; path: string; apikey?: string; authorization?: string; acceptEncoding?: string; prefixes?: string[] }[] = [];
  const answer = { get: 0 as number, del: 0 as number, redirect: null as string | null, chunked: false, delayMs: 0 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const path = decodeURIComponent((req.url ?? "").replace(/^\/storage\/v1\/object\//, ""));
      const r = {
        method: req.method ?? "", path, apikey: req.headers.apikey as string | undefined, authorization: req.headers.authorization,
        acceptEncoding: req.headers["accept-encoding"] as string | undefined,
        ...(req.method === "DELETE" ? { prefixes: (JSON.parse(body) as { prefixes: string[] }).prefixes } : {}),
      };
      requests.push(r);
      if (req.method === "GET") {
        if (answer.redirect && !path.startsWith("elsewhere/")) return void res.writeHead(302, { location: answer.redirect }).end();
        if (answer.get) return void res.writeHead(answer.get).end(JSON.stringify({ statusCode: String(answer.get), error: "x", message: "x" }));
        const f = files.get(path);
        if (!f) return void res.writeHead(400, { "content-type": "application/json" }).end('{"statusCode":"404","error":"not_found","message":"Object not found"}');
        if (answer.chunked) {
          // No Content-Length: written in two pieces (chunked).
          res.writeHead(200, { "content-type": "application/octet-stream" });
          res.write(f.subarray(0, 1));
          if (answer.delayMs) return void setTimeout(() => res.end(f.subarray(1)), answer.delayMs);
          return void res.end(f.subarray(1));
        }
        return void res.writeHead(200, { "content-type": "application/octet-stream", "content-length": f.length }).end(f);
      }
      if (req.method === "DELETE") {
        if (answer.del) return void res.writeHead(answer.del).end("{}");
        const bucket = path;
        const gone = (r.prefixes ?? []).filter((p) => files.delete(`${bucket}/${p}`)).map((name) => ({ name, bucket_id: bucket }));
        return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(gone));
      }
      res.writeHead(405).end();
    });
  });
  return { server, files, requests, answer };
}

type Obj = { id: string; version: string; size: number | null };
type Result = { status: string; version: string; removed_at: string | null; objectId?: string };

/** The database's side (app.worker_scan_object / worker_record_scan / worker_scan_removed), in memory. */
function fakeScanDb(state: { mode: string; objects: Map<string, Obj>; results: Map<string, Result>; recordReason?: string }) {
  const recorded: unknown[][] = [];
  const removed: unknown[][] = [];
  const lookups: unknown[][] = [];
  const { db, calls } = fakeDb({
    query: (text, params) => {
      const [bucket, given] = params as [string, string | null];
      if (text.includes("worker_scan_object")) {
        lookups.push(params as unknown[]);
        // A job may name the file by the object's id alone (homework): find the name from the objects, then the results.
        const byId = (params as unknown[])[2] as string | null;
        let name = given;
        if (!name && byId) {
          name = [...state.objects.entries()].find(([k, o]) => k.startsWith(`${bucket}/`) && o.id === byId)?.[0].slice(bucket.length + 1) ?? null;
          name ??= [...state.results.entries()].find(([k, r]) => k.startsWith(`${bucket}/`) && r.objectId === byId)?.[0].slice(bucket.length + 1) ?? null;
        }
        const k = `${bucket}/${name}`;
        const o = name ? state.objects.get(k) : undefined;
        const r = name ? state.results.get(k) : undefined;
        return [{
          o: {
            mode: state.mode, scanned_bucket: bucket !== "statements", name, exists: Boolean(o), object_id: o?.id ?? null, version: o?.version ?? null,
            size: o?.size ?? null, result: r ? { status: r.status, removed_at: r.removed_at, current: Boolean(o) && o!.version === r.version } : null,
          },
        }];
      }
      const key = `${bucket}/${given}`;
      if (text.includes("worker_record_scan")) {
        recorded.push(params as unknown[]);
        if (state.recordReason) return [{ r: { recorded: false, reason: state.recordReason, mode: state.mode } }];
        const status = (params as unknown[])[4] as string;
        const o = state.objects.get(key)!;
        state.results.set(key, { status, version: o.version, removed_at: null, objectId: o.id });
        const action = status === "infected" ? (state.mode === "enforce" ? "remove" : "keep") : "none";
        return [{ r: { recorded: true, status, action, mode: state.mode } }];
      }
      if (text.includes("worker_scan_removed")) {
        removed.push(params as unknown[]);
        const r = state.results.get(key);
        if (!r || r.status !== "infected") return [{ r: { done: false, reason: "no infected result for this file" } }];
        if (state.objects.has(key)) return [{ r: { done: false, reason: "the file is still stored" } }];
        r.removed_at = "2026-10-06T12:00:00Z";
        return [{ r: { done: true, parts: 1, told: 3, reviewers: 1 } }];
      }
      return [];
    },
  });
  return { db, calls, recorded, removed, lookups };
}

describe("storage.scan", () => {
  let clamd: FakeClamd;
  let storage: ReturnType<typeof fakeStorage>;
  let base = "";
  beforeAll(async () => {
    clamd = await startFakeClamd();
    storage = fakeStorage();
    await new Promise<void>((r) => storage.server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(storage.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await clamd.close();
    await new Promise<void>((r) => storage.server.close(() => r()));
  });
  afterEach(() => {
    storage.requests.length = 0;
    storage.answer.get = 0;
    storage.answer.del = 0;
    storage.answer.redirect = null;
    storage.answer.chunked = false;
    storage.answer.delayMs = 0;
    storage.files.clear();
    scan.resetClamdHealth();
  });

  const env = (mode: string, over: Record<string, string> = {}) => ({
    UPLOAD_SCAN_MODE: mode, SUPABASE_URL: base + "/", SUPABASE_SECRET_KEY: "sb_secret_worker", CLAMD_HOST: "127.0.0.1", CLAMD_PORT: String(clamd.port), ...over,
  });
  const ctxFor = (db: ReturnType<typeof fakeDb>["db"], e: Record<string, string>, j = job({ kind: "storage.scan" })) => {
    const { log, lines } = captureLog();
    return { ctx: jobContext({ db, reg: createRegistry(HANDLERS), env: e, http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log), lines };
  };
  // As the database queues them (0589): a homework file's job names the object by its id only, every other bucket's also by name.
  const scanJob = (name = HW, bucket = "homework", over: Partial<Parameters<typeof job>[0]> = {}, id = oid(1)) =>
    job({
      id: "41", kind: "storage.scan", max_attempts: 25, ...over,
      payload: bucket === "homework" ? { bucket, object_id: id, size: 5 } : { bucket, name, object_id: id, size: 5 },
    });
  /** One stored file, known to the database and to the Storage API. */
  const put = (state: { objects: Map<string, Obj> }, bytes: string, name = HW, bucket = "homework", size: number | null = Buffer.byteLength(bytes), id = oid(1)) => {
    storage.files.set(`${bucket}/${name}`, Buffer.from(bytes, "latin1"));
    state.objects.set(`${bucket}/${name}`, { id, version: "v1", size });
  };

  it("waits while scanning is off, or clamd or the Storage key is missing (a retryable failure, never 'not configured')", async () => {
    expect(scan.configured({ SUPABASE_URL: "x", SUPABASE_SECRET_KEY: "y", CLAMD_HOST: "h" })).toMatchObject({ configured: false, reason: expect.stringContaining("switched off") });
    expect(scan.configured({ UPLOAD_SCAN_MODE: "monitor", CLAMD_HOST: "h" })).toMatchObject({ configured: false, reason: expect.stringContaining("SUPABASE_URL, SUPABASE_SECRET_KEY") });
    expect(scan.configured({ UPLOAD_SCAN_MODE: "enforce", SUPABASE_URL: "x", SUPABASE_SECRET_KEY: "y" })).toMatchObject({ configured: false, reason: expect.stringContaining("CLAMD_HOST or CLAMD_SOCKET") });
    expect(scanConfigured({ UPLOAD_SCAN_MODE: "Monitor", SUPABASE_URL: "x", SUPABASE_SECRET_KEY: "y", CLAMD_SOCKET: "/run/clamd.ctl" })).toEqual({ configured: true });
    expect(sweep.configured({})).toMatchObject({ configured: false });
    expect(scan.info({ UPLOAD_SCAN_MODE: "enforce" })).toEqual({ mode: "enforce" });
    const { db } = fakeDb();
    const err = await scan.run(scanJob(), ctxFor(db, {}).ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NotConfiguredError);
    expect(String((err as Error).message)).toMatch(/switched off.*waits in the queue/);
    await expect(scan.run(job({ kind: "storage.scan", payload: { bucket: "homework" } }), ctxFor(db, env("monitor")).ctx)).rejects.toBeInstanceOf(PermanentError);
  });

  it("checks a clean file: fetched with the worker's key in the apikey header only, streamed to clamd, recorded for that version", async () => {
    const state = { mode: "monitor", objects: new Map<string, Obj>(), results: new Map<string, Result>() };
    put(state, "a harmless homework photo");
    const { db, recorded, lookups } = fakeScanDb(state);
    const { ctx, lines } = ctxFor(db, env("monitor"));
    const out = await scan.run(scanJob(), ctx);
    // The job named the object by its id only: the database was asked by id, and the name came back from it.
    expect(lookups[0]).toEqual(["homework", null, oid(1)]);
    expect(out).toEqual({ bucket: "homework", object_id: oid(1), status: "clean", bytes: 25, engine: "ClamAV 1.4.3/27790/Tue Oct  6 08:00:00 2026" });
    expect(storage.requests).toEqual([{ method: "GET", path: `homework/${HW}`, apikey: "sb_secret_worker", authorization: undefined, acceptEncoding: "identity" }]);
    expect(clamd.received.at(-1)!.toString("latin1")).toBe("a harmless homework photo");
    expect(recorded).toEqual([["homework", HW, oid(1), "v1", "clean", "ClamAV 1.4.3/27790/Tue Oct  6 08:00:00 2026", null, 25, "41", null]]);
    // Neither the result nor a log line carries the file's name.
    expect(JSON.stringify(out)).not.toContain("f0000000");
    expect(JSON.stringify(lines)).not.toContain("f0000000");
  });

  it("monitor: an infected file is recorded and kept", async () => {
    const state = { mode: "monitor", objects: new Map<string, Obj>(), results: new Map<string, Result>() };
    put(state, `x ${VIRUS_MARKER} x`);
    const { db, recorded, removed } = fakeScanDb(state);
    const out = await scan.run(scanJob(), ctxFor(db, env("monitor")).ctx);
    expect(out).toMatchObject({ status: "infected", signature: "Test.Marker.Virus", kept: true });
    expect(recorded[0]![4]).toBe("infected");
    expect(storage.requests.map((r) => r.method)).toEqual(["GET"]);
    expect(removed).toEqual([]);
  });

  it("enforce: an infected file is recorded, deleted through the Storage API, then tidied up and the people told", async () => {
    const state = { mode: "enforce", objects: new Map<string, Obj>(), results: new Map<string, Result>() };
    put(state, `${VIRUS_MARKER}`);
    const { db, recorded, removed } = fakeScanDb(state);
    // The Storage API removes the file; the database then no longer lists it.
    const origDelete = storage.files.delete.bind(storage.files);
    storage.files.delete = (k: string) => (state.objects.delete(k), origDelete(k));
    try {
      const out = await scan.run(scanJob(), ctxFor(db, env("enforce")).ctx);
      expect(out).toMatchObject({ status: "infected", signature: "Test.Marker.Virus", removed: true, parts: 1, told: 3, reviewers_told: 1 });
    } finally {
      storage.files.delete = origDelete;
    }
    expect(recorded.map((r) => r[4])).toEqual(["infected"]);
    expect(storage.requests.map((r) => [r.method, r.path, r.prefixes ?? null, r.authorization ?? null])).toEqual([
      ["GET", `homework/${HW}`, null, null],
      ["DELETE", "homework", [HW], null],
    ]);
    expect(removed).toEqual([["homework", HW, "41"]]);
  });

  it("enforce: a removal the Storage API refuses is retried, and the file stays refused to every reader meanwhile", async () => {
    const state = { mode: "enforce", objects: new Map<string, Obj>(), results: new Map<string, Result>() };
    put(state, `${VIRUS_MARKER}`);
    storage.answer.del = 403;
    const { db, removed } = fakeScanDb(state);
    await expect(scan.run(scanJob(), ctxFor(db, env("enforce")).ctx)).rejects.toThrow(/answered 403 when the infected file was removed; nobody can open it/);
    expect(removed).toEqual([]);
    // The next attempt does not check it again: it removes it.
    storage.answer.del = 0;
    storage.requests.length = 0;
    const origDelete = storage.files.delete.bind(storage.files);
    storage.files.delete = (k: string) => (state.objects.delete(k), origDelete(k));
    try {
      expect(await scan.run(scanJob(), ctxFor(db, env("enforce")).ctx)).toMatchObject({ removed: true });
    } finally {
      storage.files.delete = origDelete;
    }
    expect(storage.requests.map((r) => r.method)).toEqual(["DELETE"]);
  });

  it("enforce: a file deleted before its clean-up finished is tidied up on the next attempt", async () => {
    const state = { mode: "enforce", objects: new Map<string, Obj>(), results: new Map<string, Result>([[`homework/${HW}`, { status: "infected", version: "v1", removed_at: null, objectId: oid(1) }]]) };
    const { db, removed } = fakeScanDb(state);
    expect(await scan.run(scanJob(), ctxFor(db, env("enforce")).ctx)).toMatchObject({ status: "infected", removed: true });
    expect(removed).toHaveLength(1);
    expect(storage.requests).toEqual([]);
  });

  it("a file that is gone is done; one already checked is not checked again", async () => {
    const state = { mode: "monitor", objects: new Map<string, Obj>(), results: new Map<string, Result>() };
    const { db } = fakeScanDb(state);
    // The job names the object by its id; nothing in the database knows it any more.
    expect(await scan.run(scanJob(), ctxFor(db, env("monitor")).ctx)).toEqual({ bucket: "homework", object_id: oid(1), skipped: "the file is gone" });
    put(state, "fine");
    state.results.set(`homework/${HW}`, { status: "clean", version: "v1", removed_at: null });
    const before = clamd.received.length;
    expect(await scan.run(scanJob(), ctxFor(db, env("monitor")).ctx)).toMatchObject({ status: "clean", skipped: "already checked" });
    expect(clamd.received.length).toBe(before);
    expect(storage.requests).toEqual([]);
  });

  it("storage 'not found' for a file the database still lists is retried; once the database agrees it is gone, it is done", async () => {
    const state = { mode: "monitor", objects: new Map<string, Obj>([[`homework/${HW}`, { id: oid(1), version: "v1", size: 4 }]]), results: new Map<string, Result>() };
    const { db } = fakeScanDb(state);
    await expect(scan.run(scanJob(), ctxFor(db, env("monitor")).ctx)).rejects.toThrow(/does not have the file yet/);
    // Removed between the database's answer and the fetch.
    let n = 0;
    const { db: db2 } = fakeDb({
      query: (text) => text.includes("worker_scan_object")
        ? [{ o: { mode: "monitor", scanned_bucket: true, name: HW, exists: n++ === 0, object_id: oid(1), version: "v1", size: 4, result: null } }]
        : [],
    });
    expect(await scan.run(scanJob(), ctxFor(db2, env("monitor")).ctx)).toEqual({ bucket: "homework", skipped: "the file is gone" });
  });

  it("a file that changed size while it was fetched is checked again; so is one the database says changed", async () => {
    const state = { mode: "monitor", objects: new Map<string, Obj>(), results: new Map<string, Result>() };
    put(state, "twelve bytes", HW, "homework", 99);
    const { db, recorded } = fakeScanDb(state);
    await expect(scan.run(scanJob(), ctxFor(db, env("monitor")).ctx)).rejects.toThrow(/changed while it was being checked \(12 of 99 bytes/);
    expect(recorded).toEqual([]);
    const state2 = { mode: "monitor", objects: new Map<string, Obj>(), results: new Map<string, Result>(), recordReason: "changed" };
    put(state2, "twelve bytes");
    const { db: db2 } = fakeScanDb(state2);
    await expect(scan.run(scanJob(), ctxFor(db2, env("monitor")).ctx)).rejects.toThrow(/changed while it was being checked; it is checked again/);
  });

  it("a file too large or too deeply packed to check completely is recorded as failed, not infected", async () => {
    const state = { mode: "enforce", objects: new Map<string, Obj>(), results: new Map<string, Result>() };
    put(state, "LIMITS");
    const { db, recorded } = fakeScanDb(state);
    expect(await scan.run(scanJob(), ctxFor(db, env("enforce")).ctx)).toMatchObject({ status: "failed", signature: "Heuristics.Limits.Exceeded.MaxScanSize" });
    expect(recorded[0]!.slice(4, 7)).toEqual(["failed", "ClamAV 1.4.3/27790/Tue Oct  6 08:00:00 2026", "Heuristics.Limits.Exceeded.MaxScanSize"]);
    expect(storage.requests.map((r) => r.method)).toEqual(["GET"]);
  });

  it("a name with a '..' folder is never fetched: it is recorded as failed", async () => {
    const state = { mode: "monitor", objects: new Map<string, Obj>(), results: new Map<string, Result>() };
    const odd = "c0000000-0000-4000-8000-000000000001/../other/x.png";
    state.objects.set(`content/${odd}`, { id: oid(9), version: "v1", size: 1 });
    const { db, recorded } = fakeScanDb(state);
    expect(await scan.run(scanJob(odd, "content"), ctxFor(db, env("monitor")).ctx)).toMatchObject({ status: "failed", signature: "Unsafe object name" });
    expect(recorded[0]![4]).toBe("failed");
    expect(storage.requests).toEqual([]);
  });

  it("when clamd cannot be reached the check is retried, and the last attempt records 'failed'", async () => {
    const state = { mode: "monitor", objects: new Map<string, Obj>(), results: new Map<string, Result>() };
    put(state, "fine");
    const { db, recorded } = fakeScanDb(state);
    const closed = await startFakeClamd();
    await closed.close();
    const e = env("monitor", { CLAMD_PORT: String(closed.port) });
    await expect(scan.run(scanJob(HW, "homework", { attempts: 3 }), ctxFor(db, e).ctx)).rejects.toThrow(/could not reach clamd/);
    expect(recorded).toEqual([]);
    await expect(scan.run(scanJob(HW, "homework", { attempts: 25 }), ctxFor(db, e).ctx)).rejects.toThrow(/could not reach clamd/);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]![4]).toBe("failed");
    expect(String(recorded[0]![9])).toMatch(/^Not checked after 25 tries: could not reach clamd/);
  });

  it("never follows a redirect: the worker's key goes to the Storage API and nowhere else", async () => {
    const state = { mode: "monitor", objects: new Map<string, Obj>(), results: new Map<string, Result>() };
    put(state, "fine");
    storage.answer.redirect = `${base}/storage/v1/object/elsewhere/loot`;
    const { db, recorded } = fakeScanDb(state);
    const before = clamd.received.length;
    const err = await scan.run(scanJob(), ctxFor(db, env("monitor")).ctx).catch((e: unknown) => e);
    expect(String((err as Error).message)).toMatch(/could not be fetched from storage for its virus check/);
    expect(String((err as Error).message)).not.toContain("f0000000");
    expect(storage.requests.map((r) => r.path)).toEqual([`homework/${HW}`]);
    expect(recorded).toEqual([]);
    expect(clamd.received.length).toBe(before);
  });

  it("with no size in the database the download's Content-Length is the size to match; with neither, 'clean' is never recorded", async () => {
    const state = { mode: "monitor", objects: new Map<string, Obj>(), results: new Map<string, Result>() };
    put(state, "no size in the database", HW, "homework", null);
    const { db, recorded } = fakeScanDb(state);
    expect(await scan.run(scanJob(), ctxFor(db, env("monitor")).ctx)).toMatchObject({ status: "clean", bytes: 23 });
    expect(recorded).toHaveLength(1);
    // Chunked (no Content-Length) and no size either: nothing proves all of it was checked.
    recorded.length = 0;
    state.results.clear();
    storage.answer.chunked = true;
    await expect(scan.run(scanJob(), ctxFor(db, env("monitor")).ctx)).rejects.toThrow(/size is not known.*checked again/);
    expect(recorded).toEqual([]);
    // Chunked, but the database knows the size: that is enough.
    state.objects.get(`homework/${HW}`)!.size = 23;
    expect(await scan.run(scanJob(), ctxFor(db, env("monitor")).ctx)).toMatchObject({ status: "clean", bytes: 23 });
    expect(recorded).toHaveLength(1);
  });

  it("a clamd that answers before the whole file was sent never makes a file clean: the check is tried again", async () => {
    const early = await startFakeClamd("early");
    try {
      const state = { mode: "monitor", objects: new Map<string, Obj>(), results: new Map<string, Result>() };
      put(state, "x".repeat(200_000));
      storage.answer.chunked = true;
      storage.answer.delayMs = 150;
      const { db, recorded } = fakeScanDb(state);
      const err = await scan.run(scanJob(), ctxFor(db, env("monitor", { CLAMD_PORT: String(early.port) })).ctx).catch((e: unknown) => e);
      expect(String((err as Error).message)).toMatch(/answered before the whole file was sent/);
      expect(recorded).toEqual([]);
    } finally {
      await early.close();
    }
  });

  it("the circuit breaker: checks wait while clamd does not answer (no attempt is used) and run again once it does", async () => {
    const e = env("monitor");
    const target = clamdTarget(e)!;
    // Never asked yet: it waits, and asks (once) in the background.
    expect(scan.configured(e)).toMatchObject({ configured: false, reason: expect.stringContaining("waiting for clamd") });
    await scan.probeClamd(target);
    expect(scan.configured(e)).toEqual({ configured: true });
    // A clamd that is not there: the checks wait, with the reason.
    const closed = await startFakeClamd();
    await closed.close();
    const down = env("monitor", { CLAMD_PORT: String(closed.port) });
    scan.configured(down);
    await scan.probeClamd(clamdTarget(down)!);
    expect(scan.configured(down)).toMatchObject({ configured: false, reason: expect.stringContaining("is not answering") });
    // An answer is trusted for a minute, then asked again in the background.
    const pings = () => clamd.commands.filter((c) => c === "zPING").length;
    scan.resetClamdHealth();
    scan.configured(e);
    await scan.probeClamd(target);
    const n = pings();
    expect(scan.configured(e)).toEqual({ configured: true });
    expect(pings()).toBe(n);
    const realNow = Date.now;
    Date.now = () => realNow() + scan.BREAKER_UP_MS + 1000;
    try {
      expect(scan.configured(e)).toEqual({ configured: true }); // still the old answer while it asks again
      await scan.probeClamd(target);
    } finally {
      Date.now = realNow;
    }
    expect(pings()).toBe(n + 1);
  });

  it("checks one file at a time", async () => {
    const state = { mode: "monitor", objects: new Map<string, Obj>(), results: new Map<string, Result>() };
    const names = [1, 2, 3].map((i) => HW.replace("f0000000", `f000000${i}`));
    names.forEach((n, i) => put(state, "x".repeat(200_000), n, "homework", 200_000, oid(i + 1)));
    const { db } = fakeScanDb(state);
    clamd.maxOpenScans = 0;
    const outs = await Promise.all(names.map((n, i) => scan.run(scanJob(n, "homework", {}, oid(i + 1)), ctxFor(db, env("monitor")).ctx)));
    expect(outs.map((o) => o.status)).toEqual(["clean", "clean", "clean"]);
    expect(clamd.maxOpenScans).toBe(1);
  });
});

describe("storage.scan_sweep", () => {
  it("asks the database to queue what needs a check, every 6 hours, and waits while scanning is off", async () => {
    expect(sweep.every).toBe(6 * 3600);
    expect(sweep.waitWhenNotConfigured).toBe(true);
    const { db, calls } = fakeDb({ query: () => [{ r: { mode: "monitor", queued: 3, unchecked: 3, to_remove: 0, retried: 0 } }] });
    const { log } = captureLog();
    const ctx = jobContext({ db, reg: createRegistry(HANDLERS), env: {}, http: createHttp(), log, workerId: "w" }, job({ kind: "storage.scan_sweep" }), log);
    expect(await sweep.run(job({ kind: "storage.scan_sweep", payload: { limit: 9999 } }), ctx)).toEqual({ mode: "monitor", queued: 3, unchecked: 3, to_remove: 0, retried: 0 });
    expect(calls.find((c) => c.fn === "query")!.args).toEqual(["select app.worker_scan_sweep($1::int) as r", [5000]]);
  });
});
