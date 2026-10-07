// storage.scan: the virus check of one uploaded file (migration 0589; owner decisions 2026-10-06 and 2026-10-07).
//
// Every upload to a scanned bucket queues one of these (app.storage_enqueue_scan, since 0172; 25 attempts since 0589),
// and the sweep (storage.scan_sweep) queues the files that have none. They WAIT in the queue while scanning is off
// (waitWhenNotConfigured: the runner does not claim them), so switching scanning on checks the whole backlog once, one
// file at a time (maxInFlight 1, in a slot of its own, and one at a time in this process), claimed after every other kind
// of job. A circuit breaker keeps them waiting while clamd does not answer (configured() asks it for PONG, cached), so an
// outage does not use up their attempts.
//
// A homework file's job names the object by its id only (0589): the name comes from app.worker_scan_object.
//
// For one file: ask the database what it knows (app.worker_scan_object: the mode, the file's name, the object's id,
// version and size, a result already recorded); fetch the file from the Storage API with the worker's key (no redirect
// followed) and stream it straight to clamd (nothing is written to this machine's disk); record the verdict for exactly
// that version (app.worker_record_scan), which refuses a result for a file that changed or went in the meantime (then it
// is checked again). In enforce mode (LOCKED in this release: the database refuses to switch to it) an infected file is
// recorded first (every read is refused at once), then deleted through the Storage API like retention does, then
// app.worker_scan_removed tidies up and tells the family or the uploader and the office (never the file's name).
//
//   a file that is gone             done, nothing to check
//   storage 404 for a file it has   tried again (the upload may not have finished)
//   size differs from the database  tried again (it was replaced while being fetched); with no size in the database, the
//                                   download's Content-Length is the size to match
//   clamd unreachable or failing    tried again, up to 25 attempts (about 18 hours); the last one records "failed"
//   clamd answers early or cut off  tried again: only a NUL-terminated answer after the whole file counts (clamd.ts)
//   Heuristics.Limits.Exceeded.*    recorded "failed" (too big or too deeply packed to check completely), not "infected"
//   past clamd's StreamMaxLength    recorded "failed" (the buckets' own limits are below it)
//   a "." or ".." in the name       recorded "failed": a URL parser resolves those, so it is never fetched
//   a name over 1,024 characters    done: no result can be kept for it (the database says so)
//
// The job's result says the bucket, the object id and the verdict, never the file's name (a homework file's name stays
// out of results and logs; app.upload_scans keeps it for the staff who may read it).

import type { Env, Readiness } from "../config";
import { clamdTarget, clamdVersion, describeTarget, isLimitsHeuristic, isSizeLimit, ping, scanStream, type ClamdTarget } from "../clamd";
import { isRetryable, messageOf, PermanentError } from "../errors";
import { scrubText } from "../log";
import { bucketUrl, hasDotSegment, objectUrl, storageAuthHeaders } from "../storage-api";
import type { Job, JobContext } from "../types";
import { scanConfigured, scanMode } from "../upload-scan";

export const kind = "storage.scan";
export const waitWhenNotConfigured = true;
export const maxInFlight = 1;
export const info = (env: Env) => ({ mode: scanMode(env) });

/** Fetching one file (the buckets hold at most 50 MB). */
export const DOWNLOAD_TIMEOUT_MS = 120000;

// ── The circuit breaker ──────────────────────────────────────────────────────
/** How long a PONG is trusted, and how soon a clamd that did not answer is asked again. */
export const BREAKER_UP_MS = 60000;
export const BREAKER_DOWN_MS = 15000;

export type ClamdHealth = { key: string; ok: boolean; at: number; error: string | null };
let health: ClamdHealth | null = null;
let probing: Promise<ClamdHealth> | null = null;

/** Ask clamd for PONG now (one question at a time); the answer feeds configured(). Never rejects. */
export function probeClamd(target: ClamdTarget, now: () => number = Date.now): Promise<ClamdHealth> {
  if (probing) return probing;
  const key = describeTarget(target);
  probing = ping(target, { connectTimeoutMs: 3000, timeoutMs: 5000 })
    .then((ok): ClamdHealth => ({ key, ok, at: now(), error: ok ? null : "it did not answer PONG" }))
    .catch((err: unknown): ClamdHealth => ({ key, ok: false, at: now(), error: messageOf(err) }))
    .then((h) => {
      health = h;
      return h;
    })
    .finally(() => {
      probing = null;
    });
  return probing;
}

/** Forget what clamd last answered (tests). */
export function resetClamdHealth(): void {
  health = null;
  probing = null;
}

/**
 * Configured: scanning on, the Storage API key, a clamd address (upload-scan.ts), and clamd answering. While clamd does not
 * answer (or has not been asked yet) the checks wait in the queue (waitWhenNotConfigured) instead of each one using up an
 * attempt; it is asked again in the background every 15 seconds while it is down, every minute while it is up.
 */
export function configured(env: Env): Readiness {
  const ready = scanConfigured(env);
  if (!ready.configured) return ready;
  const target = clamdTarget(env)!;
  const key = describeTarget(target);
  const h = health?.key === key ? health : null;
  if (!h || Date.now() - h.at > (h.ok ? BREAKER_UP_MS : BREAKER_DOWN_MS)) void probeClamd(target);
  if (!h) return { configured: false, reason: `Virus scanning is waiting for clamd at ${key} to answer` };
  if (!h.ok) return { configured: false, reason: `clamd at ${key} is not answering (${h.error}); the checks wait in the queue until it does` };
  return { configured: true };
}

// ── One file ─────────────────────────────────────────────────────────────────
export type ObjectView = {
  mode: string;
  scannedBucket: boolean;
  /** The file's name (found from the object's id when the job names only that). */
  name: string | null;
  exists: boolean;
  objectId: string | null;
  version: string | null;
  size: number | null;
  result: { status: string | null; current: boolean; removedAt: string | null } | null;
};

export type ScanResult = {
  bucket: string;
  object_id?: string | null;
  status?: "clean" | "infected" | "failed";
  signature?: string;
  bytes?: number;
  engine?: string | null;
  kept?: boolean;
  removed?: boolean;
  parts?: number;
  told?: number;
  reviewers_told?: number;
  skipped?: string;
};

type Recorded = { recorded?: boolean; reason?: string; status?: string; action?: string; mode?: string };
type Removed = { done?: boolean; already?: boolean; reason?: string; parts?: number; told?: number; reviewers?: number };

/** What the job names: the bucket, and the file's name or its object's id (homework: the id only). */
type Ask = { job: Job; ctx: JobContext; bucket: string; name: string | null; objectId: string | null };
type Scan = Ask & { name: string; target: ClamdTarget; base: string; key: string };

// One file at a time in this service, however many checks are due: clamd runs two threads (clamav-setup.sh) and the
// droplet's memory is shared with the apps.
let tail: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const p = tail.then(fn, fn);
  tail = p.catch(() => undefined);
  return p;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function objectInfo(ctx: JobContext, bucket: string, name: string | null, objectId: string | null = null): Promise<ObjectView> {
  const rows = await ctx.db.query<{ o: Record<string, unknown> | null }>("select app.worker_scan_object($1, $2, $3::uuid) as o", [bucket, name, objectId]);
  const o = rows[0]?.o ?? {};
  const r = o.result && typeof o.result === "object" ? (o.result as Record<string, unknown>) : null;
  return {
    mode: typeof o.mode === "string" ? o.mode : "off",
    scannedBucket: o.scanned_bucket === true,
    name: str(o.name) ?? name,
    exists: o.exists === true,
    objectId: str(o.object_id),
    version: str(o.version),
    size: num(o.size),
    result: r ? { status: str(r.status), current: r.current === true, removedAt: str(r.removed_at) } : null,
  };
}

async function record(
  s: Pick<Scan, "ctx" | "job" | "bucket" | "name">,
  obj: ObjectView,
  status: "clean" | "infected" | "failed",
  found: { engine?: string | null; signature?: string | null; bytes?: number | null; detail?: string | null },
): Promise<Recorded> {
  const rows = await s.ctx.db.query<{ r: Recorded | null }>(
    "select app.worker_record_scan($1, $2, $3::uuid, $4, $5, $6, $7, $8::bigint, $9::bigint, $10) as r",
    [s.bucket, s.name, obj.objectId, obj.version, status, found.engine ?? null, found.signature ?? null, found.bytes ?? null, s.job.id, found.detail ?? null],
  );
  return rows[0]?.r ?? {};
}

/** The file's bytes from the Storage API (and the Content-Length it gave), or "gone" when the database agrees it is no longer there. */
async function download(s: Scan): Promise<{ body: AsyncIterable<Uint8Array>; length: number | null } | "gone"> {
  let res: Response;
  try {
    res = await fetch(objectUrl(s.base, s.bucket, s.name), {
      // identity: the bytes exactly as stored (their count is compared with the size); never follow a redirect elsewhere
      headers: { ...storageAuthHeaders(s.key), "accept-encoding": "identity" },
      redirect: "error",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`The file could not be fetched from storage for its virus check (${scrubText(messageOf(err))}); it is checked again.`);
  }
  if (res.ok) {
    const raw = res.headers.get("content-length");
    const length = raw !== null && /^[0-9]{1,15}$/.test(raw.trim()) ? Number(raw.trim()) : null;
    return { body: res.body ?? (async function* () {})(), length };
  }
  const text = await res.text().catch(() => "");
  // The Storage API says "not found" with 404, or (older versions) 400 and statusCode 404 in the body.
  if (res.status === 404 || (res.status === 400 && /not.?found|"404"/i.test(text))) {
    const again = await objectInfo(s.ctx, s.bucket, s.name);
    if (!again.exists) return "gone";
    throw new Error("Storage does not have the file yet although the database lists it (an upload still finishing?); it is checked again.");
  }
  const keyHint = res.status === 401 || res.status === 403 ? " (is the worker's key, WORKER_SUPABASE_SECRET_KEY, a secret key of this project?)" : "";
  throw new Error(`The Storage API answered ${res.status} when the file was fetched for its virus check${keyHint}; it is checked again.`);
}

/** Enforce mode: delete the infected file through the Storage API (as retention does), then tidy up and tell people. */
async function remove(s: Scan, obj: ObjectView, found: Partial<ScanResult>): Promise<ScanResult> {
  const res = await s.ctx.http.request(bucketUrl(s.base, s.bucket), {
    method: "DELETE",
    headers: storageAuthHeaders(s.key),
    body: { prefixes: [s.name] },
    timeoutMs: 30000,
  });
  if (!res.ok) {
    throw new Error(`The Storage API answered ${res.status} when the infected file was removed; nobody can open it, and it is removed on the next try.`);
  }
  let removed = false;
  try {
    removed = res.json<{ name?: string }[]>().some((r) => r?.name === s.name);
  } catch {
    removed = false;
  }
  if (!removed && (await objectInfo(s.ctx, s.bucket, s.name)).exists) {
    throw new Error("The Storage API did not remove the infected file; nobody can open it, and it is removed on the next try.");
  }
  return finishRemoval(s, obj, found);
}

async function finishRemoval(s: Scan, obj: ObjectView, found: Partial<ScanResult>): Promise<ScanResult> {
  const rows = await s.ctx.db.query<{ r: Removed | null }>("select app.worker_scan_removed($1, $2, $3::bigint) as r", [s.bucket, s.name, s.job.id]);
  const r = rows[0]?.r ?? {};
  if (r.done !== true) throw new Error(`The infected file is gone but its clean-up did not finish (${r.reason ?? "no answer"}); it is tried again.`);
  s.ctx.log.warn("infected file removed", { bucket: s.bucket, object: obj.objectId, signature: found.signature, told: r.told ?? 0, reviewers: r.reviewers ?? 0 });
  return { bucket: s.bucket, object_id: obj.objectId, status: "infected", ...found, removed: true, parts: r.parts ?? 0, told: r.told ?? 0, reviewers_told: r.reviewers ?? 0 };
}

async function checkOne(ask: Ask, target: ClamdTarget, base: string, key: string): Promise<ScanResult> {
  const { ctx, bucket } = ask;
  const obj = await objectInfo(ctx, bucket, ask.name, ask.objectId);
  if (obj.mode === "off") throw new Error("Virus scanning was switched off while this check waited; it runs once scanning is on again.");
  if (!obj.scannedBucket) return { bucket, skipped: "files in this bucket are not checked" };
  if (!obj.name) return { bucket, object_id: ask.objectId, skipped: "the file is gone" };
  const s: Scan = { ...ask, name: obj.name, target, base, key };
  const res = obj.result;
  if (!obj.exists) {
    // Deleted as infected while its clean-up did not finish (the service stopped in between): finish it now.
    if (res?.status === "infected" && !res.removedAt && obj.mode === "enforce") return finishRemoval(s, obj, {});
    return { bucket, skipped: "the file is gone" };
  }
  if (res?.current && res.status === "infected") {
    if (obj.mode === "enforce" && !res.removedAt) return remove(s, obj, {});
    return { bucket, object_id: obj.objectId, status: "infected", skipped: "already checked" };
  }
  if (res?.current && res.status === "clean") return { bucket, object_id: obj.objectId, status: "clean", skipped: "already checked" };

  // No result for this version (or one that failed): check it now.
  if (hasDotSegment(s.name)) {
    // A URL parser resolves "." and "..": the file cannot be fetched without risking another one. Never checked = failed.
    const detail = "The file's name has a . or .. folder, so it cannot be fetched safely to be checked.";
    return afterRecord(s, obj, await record(s, obj, "failed", { signature: "Unsafe object name", detail }), { status: "failed", signature: "Unsafe object name" });
  }
  const engine = await clamdVersion(s.target).catch((err: unknown) => {
    ctx.log.warn("clamd did not tell its version", { error: messageOf(err) });
    return null;
  });
  const got = await download(s);
  if (got === "gone") return { bucket, skipped: "the file is gone" };
  let scanned: Awaited<ReturnType<typeof scanStream>>;
  try {
    scanned = await scanStream(s.target, got.body);
  } catch (err) {
    // clamd could not be reached before the download was read: let the connection go.
    try {
      await (got.body as { cancel?: () => Promise<void> }).cancel?.();
    } catch {
      // already read or released
    }
    throw err;
  }
  const { verdict, bytes } = scanned;
  if (verdict.result === "error") {
    if (!isSizeLimit(verdict.message)) throw new Error(`clamd could not check the file (${verdict.message}); it is checked again.`);
    const failed = await record(s, obj, "failed", { engine, signature: "INSTREAM size limit exceeded", bytes, detail: "The file is larger than the scanner takes (60 MB)." });
    return afterRecord(s, obj, failed, { status: "failed", signature: "INSTREAM size limit exceeded", bytes, engine });
  }
  // Every byte must have been checked: the size the database knows, or else the one the download announced.
  const expected = obj.size ?? got.length;
  if (expected !== null && bytes !== expected) {
    throw new Error(`The file changed while it was being checked (${bytes} of ${expected} bytes arrived); it is checked again.`);
  }
  if (verdict.result === "clean") {
    return afterRecord(s, obj, await record(s, obj, "clean", { engine, bytes }), { status: "clean", bytes, engine });
  }
  if (isLimitsHeuristic(verdict.signature)) {
    const detail = "The file is too large or too deeply packed to be checked completely.";
    return afterRecord(s, obj, await record(s, obj, "failed", { engine, signature: verdict.signature, bytes, detail }), { status: "failed", signature: verdict.signature, bytes, engine });
  }
  const rec = await record(s, obj, "infected", { engine, signature: verdict.signature, bytes });
  return afterRecord(s, obj, rec, { status: "infected", signature: verdict.signature, bytes, engine });
}

async function afterRecord(s: Scan, obj: ObjectView, rec: Recorded, found: Partial<ScanResult>): Promise<ScanResult> {
  if (!rec.recorded) {
    if (rec.reason === "gone") return { bucket: s.bucket, skipped: "the file was removed while it was being checked" };
    if (rec.reason === "already") return { bucket: s.bucket, object_id: obj.objectId, status: rec.status as ScanResult["status"], skipped: "already checked" };
    if (rec.reason === "name_too_long") return { bucket: s.bucket, object_id: obj.objectId, skipped: "the file's name is too long to keep a result for" };
    if (rec.reason === "off") throw new Error("Virus scanning was switched off while the file was being checked; it is checked again once scanning is on.");
    throw new Error("The file changed while it was being checked; it is checked again.");
  }
  if (rec.action === "remove") return remove(s, obj, found);
  if (found.status === "infected") s.ctx.log.warn("infected file kept (monitor mode)", { bucket: s.bucket, object: obj.objectId, signature: found.signature });
  return { bucket: s.bucket, object_id: obj.objectId, ...found, ...(rec.action === "keep" ? { kept: true } : {}) };
}

/** The last attempt failed for a passing reason: record "failed" so the office sees it (and the sweep retries it a day later). */
async function recordFailure(ask: Ask, message: string): Promise<void> {
  try {
    const obj = await objectInfo(ask.ctx, ask.bucket, ask.name, ask.objectId);
    if (!obj.exists || !obj.objectId || !obj.name || obj.mode === "off" || !obj.scannedBucket) return;
    await record({ ...ask, name: obj.name }, obj, "failed", { detail: `Not checked after ${ask.job.attempts} tries: ${message}`.slice(0, 500) });
  } catch (err) {
    ask.ctx.log.error("could not record the failed virus check", { bucket: ask.bucket, error: messageOf(err) });
  }
}

export async function run(job: Job, ctx: JobContext): Promise<ScanResult> {
  const ready = scanConfigured(ctx.env);
  // Retryable on purpose: the check goes back to the queue (the runner claims none while scanning is off).
  if (!ready.configured) throw new Error(`${ready.reason}; the check waits in the queue until it is.`);
  const bucket = typeof job.payload?.bucket === "string" ? job.payload.bucket : "";
  const name = typeof job.payload?.name === "string" && job.payload.name !== "" ? job.payload.name : null;
  const objectId = typeof job.payload?.object_id === "string" && UUID.test(job.payload.object_id) ? job.payload.object_id : null;
  if (!bucket || (!name && !objectId)) throw new PermanentError("A storage.scan job needs the file's bucket, and its name or its object's id.");
  const ask: Ask = { job, ctx, bucket, name, objectId };
  const target = clamdTarget(ctx.env)!;
  const base = ctx.env.SUPABASE_URL!.trim().replace(/\/+$/, "");
  const key = ctx.env.SUPABASE_SECRET_KEY!.trim();
  try {
    const out = await oneAtATime(() => checkOne(ask, target, base, key));
    ctx.log.info("virus check done", { bucket, object: out.object_id ?? null, status: out.status ?? null, skipped: out.skipped ?? null });
    return out;
  } catch (err) {
    if (isRetryable(err) && job.attempts >= job.max_attempts) await recordFailure(ask, messageOf(err));
    throw err;
  }
}
