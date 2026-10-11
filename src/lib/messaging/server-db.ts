import "server-only";

import pg from "pg";

// The portal's routes that have no signed-in user — the Supabase Auth hooks,
// provider webhooks, unsubscribe links — reach the database as the
// connect_worker role, which can call only the app.worker_* functions granted
// to it (0223). The portal never holds a service-role key.
//
// PORTAL_DATABASE_URL: the connect_worker connection string (the same one the
// background service uses as WORKER_DATABASE_URL, which is the fallback).

let pool: pg.Pool | null = null;
let demoPool: pg.Pool | null = null;
let warned = false;

export function workerDbConfigured(): boolean {
  return !!(process.env.PORTAL_DATABASE_URL?.trim() || process.env.WORKER_DATABASE_URL?.trim());
}

function poolConfig(max: number, applicationName: string, extra: pg.PoolConfig = {}): pg.PoolConfig | null {
  const raw = process.env.PORTAL_DATABASE_URL?.trim() || process.env.WORKER_DATABASE_URL?.trim();
  if (!raw) {
    if (!warned) {
      console.error("[messaging] PORTAL_DATABASE_URL is not set: hooks and webhooks cannot reach the database (docs/DEPLOY.md › Messaging).");
      warned = true;
    }
    return null;
  }
  const url = new URL(raw);
  const mode = url.searchParams.get("sslmode");
  for (const p of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) url.searchParams.delete(p);
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  return {
    connectionString: url.toString(),
    max,
    idleTimeoutMillis: 30000,
    application_name: applicationName,
    ssl: mode === "disable" || (local && !mode) ? false : { rejectUnauthorized: false },
    ...extra,
  };
}

function getPool(): pg.Pool | null {
  if (pool) return pool;
  const config = poolConfig(4, "connect-portal-hooks");
  if (!config) return null;
  pool = new pg.Pool(config);
  pool.on("error", (err) => console.error("[messaging] idle database connection failed:", err.message));
  return pool;
}

/** One statement as connect_worker; null when the database is not configured. Throws on a database error. */
export async function workerQuery<T extends Record<string, unknown>>(text: string, params: unknown[]): Promise<T[] | null> {
  const p = getPool();
  if (!p) return null;
  return (await p.query(text, params)).rows as T[];
}

// "Try the demo" (B88): its own one-connection pool, so a burst of demo starts can never use up the connections that the sign-in
// hooks and the webhooks above need. A start that finds others already waiting, or waits more than a few seconds for the
// connection, is told the demo is busy (src/lib/demo-signin/server.ts turns this into the "busy" answer).
export class DemoBusyError extends Error {
  constructor() {
    super("The demo database connection is busy.");
    this.name = "DemoBusyError";
  }
}

/** How many demo starts may wait for the one connection before the next one is turned away. */
export const DEMO_MAX_WAITING = 4;
const DEMO_CONNECT_TIMEOUT_MS = 4000;

function getDemoPool(): pg.Pool | null {
  if (demoPool) return demoPool;
  const config = poolConfig(1, "connect-portal-demo", { connectionTimeoutMillis: DEMO_CONNECT_TIMEOUT_MS });
  if (!config) return null;
  demoPool = new pg.Pool(config);
  demoPool.on("error", (err) => console.error("[demo] idle database connection failed:", err.message));
  return demoPool;
}

/** Like workerQuery, on the demo's own one-connection pool. Throws DemoBusyError when it is saturated. */
export async function demoWorkerQuery<T extends Record<string, unknown>>(text: string, params: unknown[]): Promise<T[] | null> {
  const p = getDemoPool();
  if (!p) return null;
  if (p.waitingCount >= DEMO_MAX_WAITING) throw new DemoBusyError();
  try {
    return (await p.query(text, params)).rows as T[];
  } catch (error) {
    if (error instanceof Error && /timeout exceeded when trying to connect/i.test(error.message)) throw new DemoBusyError();
    throw error;
  }
}
