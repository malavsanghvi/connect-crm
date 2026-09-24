// The worker's database access: always as the connect_worker role, and only
// through the functions granted to it (app.claim_jobs, app.worker_read_secret,
// ...). The role has no table privileges of its own.

import pg from "pg";

import type { Logger } from "./log";

export type Job = {
  id: string; // bigint: pg returns it as text
  center_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  status: string;
  run_after: Date;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_by: string | null;
  created_at: Date;
};

/** Who is reading a secret and why: written to app.secret_access_log. */
export type ReadContext = { workerId: string; jobId: string | null; purpose: string };

export interface WorkerDb {
  claim(worker: string, kinds: string[], limit: number): Promise<Job[]>;
  finish(id: string, result: unknown): Promise<void>;
  fail(id: string, error: string, retry: boolean): Promise<"retrying" | "failed">;
  heartbeat(worker: string, startedAt: Date, version: string, kinds: string[], info: unknown): Promise<void>;
  stopped(worker: string): Promise<void>;
  schedule(kind: string, everySeconds: number): Promise<string | null>;
  readSecret(ctx: ReadContext, connectionId: string, name: string): Promise<string | null>;
  storeSecret(ctx: ReadContext, connectionId: string, name: string, value: string): Promise<{ fingerprint: string }>;
  /** For handlers (ctx.db): a query as connect_worker. */
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/**
 * pg reads sslmode from the URL and lets it override the ssl object, so the
 * URL's TLS parameters are taken out and TLS is decided here:
 *   local host             -> no TLS (unless the URL asks for it)
 *   WORKER_DATABASE_CA set  -> TLS, certificate verified against that CA
 *   otherwise               -> TLS without certificate verification (libpq's sslmode=require)
 */
export function poolConfig(databaseUrl: string, ca: string | undefined): { config: pg.PoolConfig; tls: "off" | "verified" | "unverified" } {
  const url = new URL(databaseUrl);
  const mode = url.searchParams.get("sslmode");
  for (const p of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) url.searchParams.delete(p);
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  const base: pg.PoolConfig = { connectionString: url.toString(), max: 6, idleTimeoutMillis: 30000, application_name: "connect-worker" };
  if (mode === "disable" || (local && !mode)) return { config: { ...base, ssl: false }, tls: "off" };
  if (ca) return { config: { ...base, ssl: { ca, rejectUnauthorized: true } }, tls: "verified" };
  return { config: { ...base, ssl: { rejectUnauthorized: false } }, tls: "unverified" };
}

export function createDb(databaseUrl: string, ca: string | undefined, log: Logger): WorkerDb {
  const { config, tls } = poolConfig(databaseUrl, ca);
  if (tls === "unverified") {
    log.warn("database TLS is on without certificate verification; set WORKER_DATABASE_CA to the Supabase CA certificate to verify it");
  }
  const pool = new pg.Pool(config);
  pool.on("error", (err) => log.error("idle database connection failed", { error: err }));

  const one = async <T>(text: string, params: unknown[]): Promise<T | undefined> => (await pool.query(text, params)).rows[0] as T | undefined;

  /** Runs fn in a transaction whose app.worker_id / app.job_id / app.worker_purpose describe the reader. */
  async function asReader<T>(ctx: ReadContext, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.worker_id', $1, true), set_config('app.job_id', $2, true), set_config('app.worker_purpose', $3, true)",
        [ctx.workerId, ctx.jobId ?? "", ctx.purpose],
      );
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (err) {
      await client.query("rollback").catch((e: unknown) => log.error("rollback failed", { error: e }));
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    async claim(worker, kinds, limit) {
      if (kinds.length === 0) return [];
      return (await pool.query("select * from app.claim_jobs($1, $2, $3)", [worker, kinds, limit])).rows as Job[];
    },
    async finish(id, result) {
      await pool.query("select app.finish_job($1, $2)", [id, JSON.stringify(result ?? {})]);
    },
    async fail(id, error, retry) {
      const row = await one<{ s: "retrying" | "failed" }>("select app.fail_job($1, $2, $3) as s", [id, error, retry]);
      return row?.s ?? "failed";
    },
    async heartbeat(worker, startedAt, version, kinds, info) {
      await pool.query("select app.worker_heartbeat($1, $2, $3, $4, $5)", [worker, startedAt, version, kinds, JSON.stringify(info)]);
    },
    async stopped(worker) {
      await pool.query("select app.worker_stopped($1)", [worker]);
    },
    async schedule(kind, everySeconds) {
      const row = await one<{ id: string | null }>("select app.worker_schedule($1, make_interval(secs => $2)) as id", [kind, everySeconds]);
      return row?.id ?? null;
    },
    readSecret(ctx, connectionId, name) {
      return asReader(ctx, async (c) => {
        const r = await c.query("select app.worker_read_secret($1, $2, $3) as v", [connectionId, name, ctx.purpose]);
        return (r.rows[0]?.v as string | null | undefined) ?? null;
      });
    },
    storeSecret(ctx, connectionId, name, value) {
      return asReader(ctx, async (c) => {
        const r = await c.query("select app.worker_store_secret($1, $2, $3, $4) as v", [connectionId, name, value, ctx.purpose]);
        return { fingerprint: String((r.rows[0]?.v as { fingerprint?: string } | undefined)?.fingerprint ?? "") };
      });
    },
    async query(text, params = []) {
      return (await pool.query(text, params)).rows;
    },
    close: () => pool.end(),
  };
}
