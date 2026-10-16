// payments.proof_orphans: once a day, remove the payment-evidence uploads nobody keeps (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md
// §5.8, A15; migration 0874). A family uploads its photos BEFORE the proof exists (the proof is made in one call after the files are
// up); when the proof is never sent, or a staff file was removed and its bytes could not be deleted at the time, the file stays in
// the private bucket. The database lists them (app.proof_orphan_objects: older than 48 hours, no live payment_proof_files row names
// the object); this job deletes each through the Storage API and reports the counts. There is no row to update: an orphan has none.
//
// A removal that fails is reported in this job's result and tried again by the next run. An object already gone (the Storage API
// does not list it as removed, and a lookup says not found) counts as gone, never as a failure.
//
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY in the worker's env (like payments.proof_retention); without them the job reports
// "not configured" and nothing is deleted. Platform-wide, scheduled by the generic `every` scheduler in worker/src/server.ts.

import { requireEnv, type Env } from "../config";
import { NotConfiguredError } from "../errors";
import { bucketUrl, hasDotSegment, objectInfoUrl, storageAuthHeaders } from "../storage-api";
import type { Job, JobContext } from "../types";

export const kind = "payments.proof_orphans";
export const every = 24 * 3600;
export const BUCKET = "payment-evidence";

export const configured = (env: Env) => requireEnv(env, ["SUPABASE_URL", "SUPABASE_SECRET_KEY"], "Payment confirmation orphan clean-up");

type Failure = { name: string; reason: string };
export type OrphanResult = { removed: number; already_gone: number; failed: number; failures: Failure[] };

export async function run(job: Job, ctx: JobContext): Promise<OrphanResult> {
  const ready = configured(ctx.env);
  if (!ready.configured) throw new NotConfiguredError(ready.reason);
  const base = ctx.env.SUPABASE_URL!.replace(/\/+$/, "");
  const headers = storageAuthHeaders(ctx.env.SUPABASE_SECRET_KEY!);
  const batch = typeof job.payload?.batch === "number" ? Math.min(Math.max(job.payload.batch, 1), 1000) : 200;
  const maxRounds = typeof job.payload?.max_rounds === "number" ? Math.min(Math.max(job.payload.max_rounds, 1), 50) : 10;

  let removed = 0;
  let alreadyGone = 0;
  const failures: Failure[] = [];
  const skip = new Set<string>();
  const fail = (name: string, reason: string) => {
    failures.push({ name, reason });
    skip.add(name);
  };

  /** True when the object is certainly not in the bucket (the Storage API answers 404, or 400 "not found"). */
  async function isGone(path: string): Promise<boolean> {
    const res = await ctx.http.request(objectInfoUrl(base, BUCKET, path), { method: "GET", headers, timeoutMs: 30000 });
    return res.status === 404 || (res.status === 400 && /not.?found/i.test(res.text));
  }

  for (let round = 0; round < maxRounds; round++) {
    // Ask for the objects that failed earlier in this run too, so they never crowd out the ones behind them.
    const asked = Math.min(batch + skip.size, 1000);
    const listed = (await ctx.db.query<{ name: string }>("select name from app.proof_orphan_objects($1)", [asked])).map((r) => r.name).filter((n) => !skip.has(n));
    if (listed.length === 0) break;

    const safe: string[] = [];
    for (const name of listed) {
      if (hasDotSegment(name)) fail(name, "the object's path is not safe to delete");
      else safe.push(name);
    }
    if (safe.length === 0) continue;

    const res = await ctx.http.request(bucketUrl(base, BUCKET), { method: "DELETE", headers, body: { prefixes: safe }, timeoutMs: 30000 });
    if (!res.ok) {
      for (const name of safe) fail(name, `Storage API answered ${res.status}`);
      ctx.log.error("payment evidence orphan delete refused", { status: res.status, count: safe.length });
      continue;
    }
    const gone = new Set(res.json<{ name: string }[]>().map((r) => r.name));
    for (const name of safe) {
      if (gone.has(name)) {
        removed++;
        continue;
      }
      // Not in the list of removed objects: either it was already gone or the Storage API did not remove it.
      let already = false;
      try {
        already = await isGone(name);
      } catch (err) {
        ctx.log.error("payment evidence orphan lookup failed", { error: err });
      }
      if (already) alreadyGone++;
      else fail(name, "the Storage API did not remove it");
    }
  }

  ctx.log.info("payment proof orphan pass finished", { removed, already_gone: alreadyGone, failed: failures.length });
  if (failures.length > 0 && removed === 0 && alreadyGone === 0) {
    throw new Error(`Could not remove ${failures.length} unused payment confirmation upload(s): ${failures[0]!.reason}. They will be tried again.`);
  }
  return { removed, already_gone: alreadyGone, failed: failures.length, failures: failures.slice(0, 20) };
}
