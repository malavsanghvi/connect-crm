import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotConfiguredError } from "../src/errors";
import { HANDLERS } from "../src/handlers";
import * as orphans from "../src/handlers/payments.proof_orphans";
import { createHttp } from "../src/http";
import { createRegistry, jobContext } from "../src/runner";
import { captureLog, fakeDb, job } from "./helpers";

function ctxFor(db: ReturnType<typeof fakeDb>["db"], env: Record<string, string>, j = job({ kind: "payments.proof_orphans" })) {
  const { log } = captureLog();
  return jobContext({ db, reg: createRegistry(HANDLERS), env, http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log);
}

const C = "00000000-0000-4000-8000-0000000000c1";
const names = (...n: string[]) => n.map((name) => ({ name }));

describe("payments.proof_orphans", () => {
  let server: http.Server;
  let base = "";
  const requests: { method: string; url: string; body: string; apikey: string | undefined; authorization: string | undefined }[] = [];
  let deleteStatus = 200;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const url = req.url ?? "";
        requests.push({ method: req.method ?? "", url, body, apikey: req.headers.apikey as string | undefined, authorization: req.headers.authorization });
        if (req.method === "DELETE") {
          if (deleteStatus !== 200) return void res.writeHead(deleteStatus).end("{}");
          const prefixes = (JSON.parse(body) as { prefixes: string[] }).prefixes;
          // "gone" objects were deleted by something else and "stuck" ones are refused: neither is in the answer
          return void res
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify(prefixes.filter((p) => !p.includes("gone") && !p.includes("stuck")).map((name) => ({ name, bucket_id: "payment-evidence" }))));
        }
        // the lookup: an object that is already gone answers not found, a stuck one is still there
        if (url.includes("gone")) return void res.writeHead(400, { "content-type": "application/json" }).end('{"statusCode":"404","error":"not_found","message":"Object not found"}');
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("is a daily platform-wide job, registered, and needs the Storage key", () => {
    expect(orphans.kind).toBe("payments.proof_orphans");
    expect(orphans.every).toBe(24 * 3600);
    expect(orphans.BUCKET).toBe("payment-evidence");
    expect(HANDLERS.some((h) => h.kind === "payments.proof_orphans")).toBe(true);
    expect(orphans.configured({})).toMatchObject({ configured: false, reason: expect.stringContaining("SUPABASE_URL") });
    expect(orphans.configured({ SUPABASE_URL: base, SUPABASE_SECRET_KEY: "k" })).toEqual({ configured: true });
  });

  it("reports not configured and deletes nothing without SUPABASE_URL and SUPABASE_SECRET_KEY", async () => {
    const { db, calls } = fakeDb();
    await expect(orphans.run(job({ kind: "payments.proof_orphans" }), ctxFor(db, {}))).rejects.toBeInstanceOf(NotConfiguredError);
    expect(calls).toHaveLength(0);
  });

  it("deletes the listed uploads through the Storage API and reports what could not be removed", async () => {
    requests.length = 0;
    deleteStatus = 200;
    const listed = names(`${C}/h1/p1/a.jpg`, `${C}/h1/p1/stuck.jpg`, `${C}/h1/p1/gone.jpg`, `${C}/h1/../other/x.jpg`, `${C}/staff/pay1/b.pdf`);
    let round = 0;
    const { db, calls } = fakeDb({ query: (text) => (text.includes("proof_orphan_objects") && round++ === 0 ? listed : []) });
    const out = await orphans.run(job({ id: "9", kind: "payments.proof_orphans" }), ctxFor(db, { SUPABASE_URL: base + "/", SUPABASE_SECRET_KEY: "sb_secret_test" }));

    // one DELETE for the whole batch of safe paths, in the payment-evidence bucket, with the new-style key in apikey only
    const deletes = requests.filter((r) => r.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.url).toBe("/storage/v1/object/payment-evidence");
    expect((JSON.parse(deletes[0]!.body) as { prefixes: string[] }).prefixes).toEqual([`${C}/h1/p1/a.jpg`, `${C}/h1/p1/stuck.jpg`, `${C}/h1/p1/gone.jpg`, `${C}/staff/pay1/b.pdf`]);
    expect(requests.every((r) => r.apikey === "sb_secret_test" && r.authorization === undefined)).toBe(true);
    // the objects not in the answer were looked up: the stuck one is still there, the gone one is not
    expect(requests.filter((r) => r.method === "GET").map((r) => r.url)).toEqual([
      `/storage/v1/object/info/payment-evidence/${C}/h1/p1/stuck.jpg`,
      `/storage/v1/object/info/payment-evidence/${C}/h1/p1/gone.jpg`,
    ]);
    expect(out).toMatchObject({ removed: 2, already_gone: 1, failed: 2 });
    expect(out.failures).toEqual([
      { name: `${C}/h1/../other/x.jpg`, reason: "the object's path is not safe to delete" },
      { name: `${C}/h1/p1/stuck.jpg`, reason: "the Storage API did not remove it" },
    ]);
    // an orphan has no row: the job only ever lists, never writes to the database; the failed ones are asked for again in the next round
    expect(calls.filter((c) => c.fn === "query").every((c) => String(c.args[0]).includes("proof_orphan_objects"))).toBe(true);
    expect(calls.filter((c) => c.fn === "query").map((c) => (c.args[1] as number[])[0])).toEqual([200, 202]);
  });

  it("throws (so the job is retried) when nothing at all could be removed", async () => {
    deleteStatus = 500;
    let round = 0;
    const { db } = fakeDb({ query: (t) => (t.includes("proof_orphan_objects") && round++ === 0 ? names(`${C}/h1/p1/a.jpg`) : []) });
    await expect(orphans.run(job({ kind: "payments.proof_orphans" }), ctxFor(db, { SUPABASE_URL: base, SUPABASE_SECRET_KEY: "k" }))).rejects.toThrow(
      /Could not remove 1 unused payment proof upload.*Storage API answered 500/,
    );
    deleteStatus = 200;
  });

  it("does nothing, and says so, when there is no orphan", async () => {
    const { db } = fakeDb();
    expect(await orphans.run(job({ kind: "payments.proof_orphans" }), ctxFor(db, { SUPABASE_URL: base, SUPABASE_SECRET_KEY: "k" }))).toEqual({
      removed: 0, already_gone: 0, failed: 0, failures: [],
    });
  });
});
