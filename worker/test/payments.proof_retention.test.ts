import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotConfiguredError } from "../src/errors";
import { HANDLERS } from "../src/handlers";
import * as retention from "../src/handlers/payments.proof_retention";
import { createHttp } from "../src/http";
import { createRegistry, jobContext } from "../src/runner";
import { objectInfoUrl } from "../src/storage-api";
import { captureLog, fakeDb, job } from "./helpers";

function ctxFor(db: ReturnType<typeof fakeDb>["db"], env: Record<string, string>, j = job({ kind: "payments.proof_retention" })) {
  const { log } = captureLog();
  return jobContext({ db, reg: createRegistry(HANDLERS), env, http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log);
}

const C = "00000000-0000-4000-8000-0000000000c1";
const due = (n: number, path: string, reason = "Kept 7 years after the end of 2018, then removed") => ({
  file_id: `00000000-0000-4000-8000-00000000030${n}`,
  center_id: C,
  storage_path: path,
  reason,
});

describe("payments.proof_retention", () => {
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
          // "gone" objects were deleted by an earlier run and "stuck" ones are refused: neither is in the answer
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
    expect(retention.kind).toBe("payments.proof_retention");
    expect(retention.every).toBe(24 * 3600);
    expect(HANDLERS.some((h) => h.kind === "payments.proof_retention")).toBe(true);
    expect(retention.configured({})).toMatchObject({ configured: false, reason: expect.stringContaining("SUPABASE_URL") });
    expect(retention.configured({ SUPABASE_URL: base, SUPABASE_SECRET_KEY: "k" })).toEqual({ configured: true });
  });

  it("reports not configured and deletes nothing without SUPABASE_URL and SUPABASE_SECRET_KEY", async () => {
    const { db, calls } = fakeDb();
    await expect(retention.run(job({ kind: "payments.proof_retention" }), ctxFor(db, {}))).rejects.toBeInstanceOf(NotConfiguredError);
    expect(calls).toHaveLength(0);
  });

  it("deletes through the Storage API, tells the database, and reports what could not be removed", async () => {
    requests.length = 0;
    deleteStatus = 200;
    const files = [
      due(1, `${C}/h1/a.jpg`),
      due(2, `${C}/h1/stuck.jpg`),
      due(3, `${C}/h1/gone.jpg`),
      due(4, `${C}/h1/../other/x.jpg`),
      due(5, `${C}/h1/b.pdf`, "Proof not accepted: kept 13 months, then removed"),
      due(6, `${C}/h1/record-fails.jpg`),
    ];
    let round = 0;
    const { db, calls } = fakeDb({
      query: (text, params) => {
        if (text.includes("proof_files_due")) return round++ === 0 ? files : [];
        if (text.includes("proof_file_removed") && params[0] === files[5]!.file_id) throw new Error("connection reset");
        return [];
      },
    });
    const out = await retention.run(job({ id: "9", kind: "payments.proof_retention" }), ctxFor(db, { SUPABASE_URL: base + "/", SUPABASE_SECRET_KEY: "sb_secret_test" }));

    // one DELETE for the whole batch of safe paths, in the payment-evidence bucket, with the new-style key in apikey only
    const deletes = requests.filter((r) => r.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.url).toBe("/storage/v1/object/payment-evidence");
    expect((JSON.parse(deletes[0]!.body) as { prefixes: string[] }).prefixes).toEqual([
      `${C}/h1/a.jpg`, `${C}/h1/stuck.jpg`, `${C}/h1/gone.jpg`, `${C}/h1/b.pdf`, `${C}/h1/record-fails.jpg`,
    ]);
    expect(requests.every((r) => r.apikey === "sb_secret_test" && r.authorization === undefined)).toBe(true);
    // the files not in the answer were looked up: the stuck one is still there, the gone one is not
    expect(requests.filter((r) => r.method === "GET").map((r) => r.url)).toEqual([
      `/storage/v1/object/info/payment-evidence/${C}/h1/stuck.jpg`,
      `/storage/v1/object/info/payment-evidence/${C}/h1/gone.jpg`,
    ]);
    // the database hears about the removed (a.jpg, b.pdf), the already-gone one and the one it could not record; never about the stuck or unsafe ones
    const recorded = calls.filter((c) => c.fn === "query" && String(c.args[0]).includes("proof_file_removed")).map((c) => c.args[1]);
    expect(recorded).toEqual([
      [files[0]!.file_id, files[0]!.reason],
      [files[2]!.file_id, files[2]!.reason],
      [files[4]!.file_id, "Proof not accepted: kept 13 months, then removed"],
      [files[5]!.file_id, files[5]!.reason],
    ]);
    expect(out).toMatchObject({ removed: 3, failed: 3 });
    expect(out.failures.map((f) => [f.file_id, f.reason])).toEqual([
      [files[3]!.file_id, "the file's path is not safe to delete"],
      [files[1]!.file_id, "the Storage API did not remove it"],
      [files[5]!.file_id, "the file is gone from storage but the database could not record it"],
    ]);
    // the failed ones stay due: the next round asks for as many extra as failed, so they cannot crowd out the rest
    const asks = calls.filter((c) => c.fn === "query" && String(c.args[0]).includes("proof_files_due")).map((c) => (c.args[1] as number[])[0]);
    expect(asks).toEqual([200, 203]);
  });

  it("throws (so the job is retried) when nothing at all could be removed", async () => {
    deleteStatus = 500;
    let round = 0;
    const { db, calls } = fakeDb({ query: (t) => (t.includes("proof_files_due") && round++ === 0 ? [due(1, `${C}/h1/a.jpg`)] : []) });
    await expect(retention.run(job({ kind: "payments.proof_retention" }), ctxFor(db, { SUPABASE_URL: base, SUPABASE_SECRET_KEY: "k" }))).rejects.toThrow(
      /Could not remove 1 expired payment proof file.*Storage API answered 500/,
    );
    expect(calls.some((c) => c.fn === "query" && String(c.args[0]).includes("proof_file_removed"))).toBe(false);
    deleteStatus = 200;
  });

  it("does nothing, and says so, when no file is due", async () => {
    const { db } = fakeDb();
    expect(await retention.run(job({ kind: "payments.proof_retention" }), ctxFor(db, { SUPABASE_URL: base, SUPABASE_SECRET_KEY: "k" }))).toEqual({
      removed: 0, failed: 0, failures: [],
    });
  });

  it("looks an object up by its encoded path and refuses a path that could leave the bucket", () => {
    expect(objectInfoUrl("https://x.supabase.co/", "payment-evidence", "c/h 1/a.jpg")).toBe("https://x.supabase.co/storage/v1/object/info/payment-evidence/c/h%201/a.jpg");
    expect(() => objectInfoUrl("https://x.supabase.co", "payment-evidence", "c/../other")).toThrow(/cannot be looked up safely/);
  });
});
