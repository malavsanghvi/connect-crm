import type { Env, Readiness } from "./config";
import type { Job, WorkerDb } from "./db";
import type { Http } from "./http";
import type { Logger } from "./log";

export type { Job } from "./db";

/** What a handler gets for one job (ONBOARDING_CONTRACT.md "Worker service"). */
export type JobContext = {
  /** Queries as the connect_worker role (only the functions granted to it). */
  db: Pick<WorkerDb, "query">;
  /** An organization's secret from the vault; every read is logged. NULL when not stored. */
  secret(connectionId: string, name: string): Promise<string | null>;
  /** Store a secret a provider handed back (OAuth tokens); audited, never logged. */
  storeSecret(connectionId: string, name: string, value: string): Promise<{ fingerprint: string }>;
  /** Remove an OAuth authorization code once exchanged, or once a retry could no longer use it; audited, never logged. */
  removeOauthCode(connectionId: string, name: string, outcome: "exchanged" | "unusable"): Promise<boolean>;
  http: Http;
  log: Logger;
  /** The worker's environment: Community Connect's own provider keys live here. */
  env: Env;
  workerId: string;
};

/** worker/src/handlers/<kind>.ts exports these. */
export type HandlerModule = {
  kind: string;
  /** Whether this handler can run with the current env (the reason names missing variables only). */
  configured?: (env: Env) => Readiness;
  /** Extra names for the heartbeat beside "configured" (a provider, a model) — never a secret. */
  info?: (env: Env) => Record<string, string | number | boolean>;
  /** Seconds: the service queues one platform-wide job of this kind this often (when configured). */
  every?: number;
  /**
   * The kind's jobs WAIT in the queue while the handler is not configured: the runner does not claim them (instead of
   * failing each one as "not configured") and claims them again as soon as configured() says yes. storage.scan uses it:
   * every upload queues a check, and the checks stay queued while virus scanning is off.
   */
  waitWhenNotConfigured?: boolean;
  /** At most this many jobs of the kind run at once in this service; they are claimed after the other kinds, never ahead of them. */
  maxInFlight?: number;
  /** The job's result (stored in app.jobs.result, never a secret). Throw to fail. */
  run(job: Job, ctx: JobContext): Promise<unknown>;
};
