// storage.retention: remove files past their keeping period (plan §1.9):
// imports 90 days, exports 7 days, recordings 90 days (imports and
// recordings may be changed per organization). The database says which
// objects are due (app.storage_expired_objects); the files are removed
// through the Storage API so the stored bytes go too, not just the row; each
// removal is then recorded (app.record_storage_deletions -> audit entries).
//
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY in the worker's env: the Storage
// API only deletes for a key that may. Without them the job fails at once as
// "not configured" and nothing is deleted.

import { requireEnv, type Env } from "../config";
import { NotConfiguredError } from "../errors";
import type { Job, JobContext } from "../types";

export const kind = "storage.retention";

export const configured = (env: Env) => requireEnv(env, ["SUPABASE_URL", "SUPABASE_SECRET_KEY"], "Storage retention");

type Expired = { bucket_id: string; name: string; created_at: string | Date };

export async function run(job: Job, ctx: JobContext) {
  const ready = configured(ctx.env);
  if (!ready.configured) throw new NotConfiguredError(ready.reason);
  const base = ctx.env.SUPABASE_URL!.replace(/\/+$/, "");
  const key = ctx.env.SUPABASE_SECRET_KEY!;
  const batch = typeof job.payload?.batch === "number" ? Math.min(Math.max(job.payload.batch, 1), 1000) : 200;
  const maxRounds = typeof job.payload?.max_rounds === "number" ? Math.min(Math.max(job.payload.max_rounds, 1), 50) : 10;

  let deleted = 0;
  const failed: { bucket: string; name: string; reason: string }[] = [];
  const skip = new Set<string>();
  for (let round = 0; round < maxRounds; round++) {
    const due = (await ctx.db.query<Expired>("select bucket_id, name, created_at from app.storage_expired_objects($1)", [batch])).filter(
      (o) => !skip.has(`${o.bucket_id}/${o.name}`),
    );
    if (due.length === 0) break;
    const byBucket = new Map<string, Expired[]>();
    for (const o of due) byBucket.set(o.bucket_id, [...(byBucket.get(o.bucket_id) ?? []), o]);

    for (const [bucket, objects] of byBucket) {
      const res = await ctx.http.request(`${base}/storage/v1/object/${encodeURIComponent(bucket)}`, {
        method: "DELETE",
        headers: { apikey: key, authorization: `Bearer ${key}` },
        body: { prefixes: objects.map((o) => o.name) },
        timeoutMs: 30000,
      });
      if (!res.ok) {
        for (const o of objects) {
          failed.push({ bucket, name: o.name, reason: `Storage API answered ${res.status}` });
          skip.add(`${bucket}/${o.name}`);
        }
        ctx.log.error("storage delete refused", { bucket, status: res.status, count: objects.length });
        continue;
      }
      const gone = new Set(res.json<{ name: string }[]>().map((r) => r.name));
      const removed = objects.filter((o) => gone.has(o.name));
      for (const o of objects) {
        if (!gone.has(o.name)) {
          failed.push({ bucket, name: o.name, reason: "the Storage API did not remove it" });
          skip.add(`${bucket}/${o.name}`);
        }
      }
      if (removed.length > 0) {
        await ctx.db.query("select app.record_storage_deletions($1, $2)", [
          job.id,
          JSON.stringify(removed.map((o) => ({ bucket, name: o.name, created_at: o.created_at }))),
        ]);
        deleted += removed.length;
      }
    }
  }
  ctx.log.info("retention pass finished", { deleted, failed: failed.length });
  if (failed.length > 0 && deleted === 0) {
    throw new Error(`Could not remove ${failed.length} expired file(s): ${failed[0]!.reason}. They will be tried again.`);
  }
  return { deleted, failed: failed.length, failures: failed.slice(0, 20) };
}
