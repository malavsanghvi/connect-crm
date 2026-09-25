import type { Job, ReadContext, WorkerDb } from "../src/db";
import { createLogger } from "../src/log";

export function job(over: Partial<Job> = {}): Job {
  return {
    id: "1", center_id: "00000000-0000-4000-8000-000000000001", kind: "demo.ping", payload: {}, status: "running",
    run_after: new Date(), attempts: 1, max_attempts: 5, last_error: null, created_by: null, created_at: new Date(), ...over,
  };
}

export type Call = { fn: string; args: unknown[] };

/** An in-memory WorkerDb that records every call. */
export function fakeDb(opts: {
  claim?: Job[][];
  secrets?: Record<string, string>;
  query?: (text: string, params: unknown[]) => unknown[];
  platform?: { settings?: Record<string, unknown>; secrets?: Record<string, { value: string; version?: string }> } | null;
} = {}) {
  const calls: Call[] = [];
  const claims = [...(opts.claim ?? [])];
  const db: WorkerDb = {
    async claim(...args) { calls.push({ fn: "claim", args }); return claims.shift() ?? []; },
    async finish(...args) { calls.push({ fn: "finish", args }); },
    async fail(id, error, retry) { calls.push({ fn: "fail", args: [id, error, retry] }); return retry ? "retrying" : "failed"; },
    async heartbeat(...args) { calls.push({ fn: "heartbeat", args }); },
    async stopped(...args) { calls.push({ fn: "stopped", args }); },
    async schedule(...args) { calls.push({ fn: "schedule", args }); return null; },
    async readSecret(ctx: ReadContext, c: string, n: string) { calls.push({ fn: "readSecret", args: [ctx, c, n] }); return opts.secrets?.[`${c}/${n}`] ?? null; },
    async storeSecret(ctx: ReadContext, c: string, n: string, v: string) { calls.push({ fn: "storeSecret", args: [ctx, c, n, "[value]"] }); return { fingerprint: v.slice(-4) }; },
    async removeOauthCode(ctx: ReadContext, c: string, n: string, outcome: "exchanged" | "unusable") {
      calls.push({ fn: "removeOauthCode", args: [ctx, c, n, outcome] });
      const key = `${c}/${n}`;
      const had = opts.secrets ? key in opts.secrets : false;
      if (opts.secrets) delete opts.secrets[key];
      return had;
    },
    async platformConfig() {
      calls.push({ fn: "platformConfig", args: [] });
      if (opts.platform === null) return null;
      const p = opts.platform ?? {};
      return {
        settings: p.settings ?? {},
        secrets: Object.fromEntries(Object.entries(p.secrets ?? {}).map(([n, s]) => [n, { fingerprint: s.value.slice(-4), version: s.version ?? "1" }])),
      };
    },
    async readPlatformSecret(ctx: ReadContext, name: string) {
      calls.push({ fn: "readPlatformSecret", args: [ctx, name] });
      return opts.platform?.secrets?.[name]?.value ?? null;
    },
    async query<T extends Record<string, unknown>>(text: string, params: unknown[] = []) {
      calls.push({ fn: "query", args: [text, params] });
      return (opts.query?.(text, params) ?? []) as T[];
    },
    async close() {},
  };
  return { db, calls };
}

export function captureLog() {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({ service: "test" }, { level: "debug", write: (l) => lines.push(JSON.parse(l)) });
  return { log, lines };
}
