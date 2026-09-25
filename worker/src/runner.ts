// The loop: claim due jobs, run each with its handler, finish or fail it.
// Every outcome is written back to app.jobs; a failure message is plain and
// never carries a secret (scrubbed), and "not configured" is never retried.

import type { Env, Readiness } from "./config";
import type { Job, WorkerDb } from "./db";
import { isRetryable, messageOf, NotConfiguredError } from "./errors";
import type { Http } from "./http";
import { scrubText, type Logger } from "./log";
import type { HandlerModule, JobContext } from "./types";

export type Registry = Map<string, HandlerModule>;

export function createRegistry(handlers: HandlerModule[]): Registry {
  const reg: Registry = new Map();
  for (const h of handlers) {
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(h.kind)) throw new Error(`Handler kind "${h.kind}" is not of the form area.action`);
    if (reg.has(h.kind)) throw new Error(`Two handlers for the job kind "${h.kind}"`);
    reg.set(h.kind, h);
  }
  return reg;
}

export function readiness(reg: Registry, env: Env): Record<string, Readiness> {
  const out: Record<string, Readiness> = {};
  for (const [kind, h] of reg) out[kind] = h.configured ? h.configured(env) : { configured: true };
  return out;
}

export type RunnerDeps = { db: WorkerDb; reg: Registry; env: Env; http: Http; log: Logger; workerId: string };

export function jobContext(deps: RunnerDeps, job: Job, log: Logger): JobContext {
  const reader = { workerId: deps.workerId, jobId: job.id, purpose: `job ${job.id} ${job.kind}` };
  return {
    db: { query: (text, params) => deps.db.query(text, params) },
    secret: (connectionId, name) => deps.db.readSecret(reader, connectionId, name),
    storeSecret: (connectionId, name, value) => deps.db.storeSecret(reader, connectionId, name, value),
    removeOauthCode: (connectionId, name, outcome) => deps.db.removeOauthCode(reader, connectionId, name, outcome),
    http: deps.http,
    log,
    env: deps.env,
    workerId: deps.workerId,
  };
}

export type Outcome = { id: string; kind: string; status: "done" | "retrying" | "failed"; error?: string };

/** Run one claimed job to its outcome. Never throws: a failure is recorded on the job. */
export async function processJob(deps: RunnerDeps, job: Job): Promise<Outcome> {
  const log = deps.log.child({ job: job.id, kind: job.kind, attempt: job.attempts });
  const handler = deps.reg.get(job.kind);
  let error: unknown;
  try {
    if (!handler) throw new NotConfiguredError(`This background service has no handler for "${job.kind}" jobs.`);
    const ready = handler.configured ? handler.configured(deps.env) : ({ configured: true } as Readiness);
    if (!ready.configured) throw new NotConfiguredError(ready.reason);
    const started = Date.now();
    const result = await handler.run(job, jobContext(deps, job, log));
    await deps.db.finish(job.id, result ?? {});
    log.info("job done", { ms: Date.now() - started });
    return { id: job.id, kind: job.kind, status: "done" };
  } catch (err) {
    error = err;
  }
  const retry = isRetryable(error);
  const message = scrubText(messageOf(error)).slice(0, 2000);
  try {
    const status = await deps.db.fail(job.id, message, retry);
    (status === "failed" ? log.error : log.warn)(status === "failed" ? "job failed" : "job failed, will retry", { error: message, retry });
    return { id: job.id, kind: job.kind, status, error: message };
  } catch (recordErr) {
    // The job stays "running"; claim_jobs releases it after 15 minutes.
    log.error("could not record the job's failure", { error: recordErr, jobError: message });
    return { id: job.id, kind: job.kind, status: "failed", error: message };
  }
}

export type Runner = {
  tick(): Promise<number>;
  inFlight(): number;
  drain(timeoutMs: number): Promise<boolean>;
  stop(): void;
};

/** Claims up to the free concurrency each tick; jobs run in the background. */
export function createRunner(deps: RunnerDeps, concurrency: number): Runner {
  const running = new Set<Promise<Outcome>>();
  let stopping = false;
  const kinds = [...deps.reg.keys()];
  return {
    async tick() {
      if (stopping) return 0;
      const free = concurrency - running.size;
      if (free <= 0) return 0;
      const jobs = await deps.db.claim(deps.workerId, kinds, free);
      for (const job of jobs) {
        const p = processJob(deps, job).finally(() => running.delete(p));
        running.add(p);
      }
      return jobs.length;
    },
    inFlight: () => running.size,
    async drain(timeoutMs) {
      if (running.size === 0) return true;
      const timeout = new Promise<false>((r) => setTimeout(() => r(false), timeoutMs));
      return Promise.race([Promise.allSettled([...running]).then(() => true as const), timeout]);
    },
    stop() {
      stopping = true;
    },
  };
}
