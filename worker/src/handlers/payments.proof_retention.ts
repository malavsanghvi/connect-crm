// payments.proof_retention: once a day, remove the payment evidence (photos and files families and staff kept for a payment)
// whose keeping time has run out (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md §4.5; migration 0871). The database decides
// what is due (app.proof_files_due: the organization's years from the end of the payment's year, no legal hold, every pledge it
// supports final, no open refund; 13 months for a proof that was not accepted); this job deletes each object from the private
// payment-evidence bucket through the Storage API, so the stored bytes go, not just the row, and only then tells the database
// (app.proof_file_removed), which keeps the row as a tombstone (hash, size, type, who, when, why) and writes the same
// storage.retention_delete audit entry as the other buckets.
//
// A removal that fails leaves the file due: the next run tries it again, and it is reported in this job's result. A file whose
// object is already gone (an earlier run deleted it and then could not reach the database) is confirmed gone with a lookup and
// then recorded, never left behind and never recorded while its bytes could still exist.
//
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY in the worker's env (like storage.retention); without them the job reports "not
// configured" and nothing is deleted. Platform-wide, scheduled by the generic `every` scheduler in worker/src/server.ts.

import { requireEnv, type Env } from "../config";
import { NotConfiguredError } from "../errors";
import { bucketUrl, hasDotSegment, objectInfoUrl, storageAuthHeaders } from "../storage-api";
import type { Job, JobContext } from "../types";

export const kind = "payments.proof_retention";
export const every = 24 * 3600;
export const BUCKET = "payment-evidence";

export const configured = (env: Env) => requireEnv(env, ["SUPABASE_URL", "SUPABASE_SECRET_KEY"], "Payment confirmation retention");

type Due = { file_id: string; center_id: string; storage_path: string; reason: string };
type Failure = { file_id: string; reason: string };
export type RetentionResult = { removed: number; failed: number; failures: Failure[] };

export async function run(job: Job, ctx: JobContext): Promise<RetentionResult> {
  const ready = configured(ctx.env);
  if (!ready.configured) throw new NotConfiguredError(ready.reason);
  const base = ctx.env.SUPABASE_URL!.replace(/\/+$/, "");
  const headers = storageAuthHeaders(ctx.env.SUPABASE_SECRET_KEY!);
  const batch = typeof job.payload?.batch === "number" ? Math.min(Math.max(job.payload.batch, 1), 1000) : 200;
  const maxRounds = typeof job.payload?.max_rounds === "number" ? Math.min(Math.max(job.payload.max_rounds, 1), 50) : 10;

  let removed = 0;
  const failures: Failure[] = [];
  const skip = new Set<string>();
  const fail = (f: Due, reason: string) => {
    failures.push({ file_id: f.file_id, reason });
    skip.add(f.file_id);
  };

  /** True when the object is certainly not in the bucket (the Storage API answers 404, or 400 "not found"). */
  async function isGone(path: string): Promise<boolean> {
    const res = await ctx.http.request(objectInfoUrl(base, BUCKET, path), { method: "GET", headers, timeoutMs: 30000 });
    return res.status === 404 || (res.status === 400 && /not.?found/i.test(res.text));
  }

  for (let round = 0; round < maxRounds; round++) {
    // Ask for the files that failed earlier in this run too, so they never crowd out the ones behind them.
    const asked = Math.min(batch + skip.size, 1000);
    const due = (await ctx.db.query<Due>("select file_id, center_id, storage_path, reason from app.proof_files_due($1)", [asked])).filter(
      (f) => !skip.has(f.file_id),
    );
    if (due.length === 0) break;

    const safe: Due[] = [];
    for (const f of due) {
      if (hasDotSegment(f.storage_path)) fail(f, "the file's path is not safe to delete");
      else safe.push(f);
    }

    let gone = new Set<string>();
    if (safe.length > 0) {
      const res = await ctx.http.request(bucketUrl(base, BUCKET), {
        method: "DELETE",
        headers,
        body: { prefixes: safe.map((f) => f.storage_path) },
        timeoutMs: 30000,
      });
      if (!res.ok) {
        for (const f of safe) fail(f, `Storage API answered ${res.status}`);
        ctx.log.error("payment evidence delete refused", { status: res.status, count: safe.length });
        continue;
      }
      gone = new Set(res.json<{ name: string }[]>().map((r) => r.name));
    }

    for (const f of safe) {
      if (!gone.has(f.storage_path)) {
        // Not in the list of removed objects: either it was already gone (an earlier run) or the Storage API did not remove it.
        let already = false;
        try {
          already = await isGone(f.storage_path);
        } catch (err) {
          ctx.log.error("payment evidence lookup failed", { file: f.file_id, error: err });
        }
        if (!already) {
          fail(f, "the Storage API did not remove it");
          continue;
        }
      }
      try {
        await ctx.db.query("select app.proof_file_removed($1, $2)", [f.file_id, f.reason]);
        removed++;
      } catch (err) {
        fail(f, "the file is gone from storage but the database could not record it");
        ctx.log.error("could not record a payment evidence removal", { file: f.file_id, error: err });
      }
    }
  }

  ctx.log.info("payment proof retention pass finished", { removed, failed: failures.length });
  if (failures.length > 0 && removed === 0) {
    throw new Error(`Could not remove ${failures.length} expired payment confirmation file(s): ${failures[0]!.reason}. They will be tried again.`);
  }
  return { removed, failed: failures.length, failures: failures.slice(0, 20) };
}
