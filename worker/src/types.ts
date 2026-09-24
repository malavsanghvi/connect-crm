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
  /** The job's result (stored in app.jobs.result, never a secret). Throw to fail. */
  run(job: Job, ctx: JobContext): Promise<unknown>;
};
