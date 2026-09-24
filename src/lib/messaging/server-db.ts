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
let warned = false;

export function workerDbConfigured(): boolean {
  return !!(process.env.PORTAL_DATABASE_URL?.trim() || process.env.WORKER_DATABASE_URL?.trim());
}

function getPool(): pg.Pool | null {
  if (pool) return pool;
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
  pool = new pg.Pool({
    connectionString: url.toString(),
    max: 4,
    idleTimeoutMillis: 30000,
    application_name: "connect-portal-hooks",
    ssl: mode === "disable" || (local && !mode) ? false : { rejectUnauthorized: false },
  });
  pool.on("error", (err) => console.error("[messaging] idle database connection failed:", err.message));
  return pool;
}

/** One statement as connect_worker; null when the database is not configured. Throws on a database error. */
export async function workerQuery<T extends Record<string, unknown>>(text: string, params: unknown[]): Promise<T[] | null> {
  const p = getPool();
  if (!p) return null;
  return (await p.query(text, params)).rows as T[];
}
