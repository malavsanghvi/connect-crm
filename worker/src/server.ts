// Community Connect background service (systemd unit connect@worker).
//
//   node server.js    with WORKER_DATABASE_URL = the connect_worker connection string
//
// Every WORKER_POLL_MS it claims due jobs (app.claim_jobs) and runs them; every
// WORKER_HEARTBEAT_MS it writes its heartbeat (app.worker_heartbeat), which the
// portal's "Background service" tile and the readiness check read, and queues
// the daily storage.retention pass when that handler is configured.
// GET http://127.0.0.1:WORKER_HEALTH_PORT/health answers 200 while the last
// heartbeat reached the database, 503 otherwise (the deploy checks it).
// SIGTERM / SIGINT: stop claiming, let running jobs finish (WORKER_SHUTDOWN_MS),
// remove the heartbeat, close the pool, exit.

import http from "node:http";
import os from "node:os";

import { loadConfig, type Env, type WorkerConfig } from "./config";
import { createDb, type WorkerDb } from "./db";
import { HANDLERS } from "./handlers";
import { createHttp } from "./http";
import { createLogger, type Logger } from "./log";
import { createRegistry, createRunner, readiness, type Registry } from "./runner";

const VERSION = process.env.WORKER_VERSION_BUILT ?? "dev";

export type Health = { ok: boolean; status: number; body: Record<string, unknown> };

export function healthOf(state: { stopping: boolean; lastBeatOk: Date | null; lastBeatError: string | null; heartbeatMs: number; inFlight: number; now: Date }): Health {
  const fresh = state.lastBeatOk !== null && state.now.getTime() - state.lastBeatOk.getTime() <= state.heartbeatMs * 2 + 5000;
  const ok = fresh && !state.stopping;
  return {
    ok,
    status: ok ? 200 : 503,
    body: {
      ok,
      version: VERSION,
      stopping: state.stopping,
      last_heartbeat_at: state.lastBeatOk?.toISOString() ?? null,
      problem: ok ? null : state.stopping ? "shutting down" : (state.lastBeatError ?? "no heartbeat has reached the database yet"),
      in_flight: state.inFlight,
    },
  };
}

export async function main(env: Env = process.env): Promise<void> {
  let config: WorkerConfig;
  try {
    config = loadConfig(env);
  } catch (err) {
    createLogger({ service: "connect-worker" }).error("cannot start", { error: err });
    process.exitCode = 1;
    return;
  }
  const log = createLogger({ service: "connect-worker", worker: config.workerId }, { level: config.logLevel });
  const reg: Registry = createRegistry(HANDLERS);
  const db: WorkerDb = createDb(config.databaseUrl, config.databaseCa, log);
  const runner = createRunner({ db, reg, env, http: createHttp(), log, workerId: config.workerId }, config.concurrency);
  const startedAt = new Date();
  const state = { stopping: false, lastBeatOk: null as Date | null, lastBeatError: null as string | null };

  const handlerInfo = () => {
    const r = readiness(reg, env);
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.configured ? { configured: true } : { configured: false, reason: v.reason }]));
  };
  for (const [kind, v] of Object.entries(readiness(reg, env))) {
    if (!v.configured) log.warn("handler not configured", { handler: kind, reason: v.reason });
  }

  async function beat(): Promise<void> {
    const handlers = handlerInfo();
    try {
      await db.heartbeat(config.workerId, startedAt, VERSION, [...reg.keys()], { handlers, host: os.hostname(), pid: process.pid, node: process.version });
      state.lastBeatOk = new Date();
      state.lastBeatError = null;
    } catch (err) {
      state.lastBeatError = `heartbeat failed: ${err instanceof Error ? err.message : String(err)}`;
      log.error("heartbeat failed", { error: err });
      return;
    }
    if ((handlers["storage.retention"] as { configured: boolean } | undefined)?.configured) {
      try {
        const id = await db.schedule("storage.retention", 24 * 3600);
        if (id) log.info("queued the daily storage.retention pass", { queued_job: id });
      } catch (err) {
        log.error("could not queue storage.retention", { error: err });
      }
    }
    try {
      const id = await db.schedule("platform.sandbox_expiry", 24 * 3600);
      if (id) log.info("queued the daily platform.sandbox_expiry pass", { queued_job: id });
    } catch (err) {
      log.error("could not queue platform.sandbox_expiry", { error: err });
    }
    // o-qbo-match: once a day, one platform-wide job queues a QuickBooks customer pull per connected center.
    try {
      const id = await db.schedule("qbo.pull_customers_history", 24 * 3600);
      if (id) log.info("queued the daily QuickBooks customer pulls", { queued_job: id });
    } catch (err) {
      log.error("could not queue the daily QuickBooks customer pulls", { error: err });
    }
    // Other recurring platform-wide work: handlers that declare `every` (seconds).
    for (const h of reg.values()) {
      if (!h.every || h.kind === "storage.retention") continue;
      if (!(handlers[h.kind] as { configured: boolean } | undefined)?.configured) continue;
      try {
        const id = await db.schedule(h.kind, h.every);
        if (id) log.info(`queued the recurring ${h.kind} run`, { queued_job: id });
      } catch (err) {
        log.error(`could not queue ${h.kind}`, { error: err });
      }
    }
    // o-messaging: the email-domain re-verify sweep (pending domains every 15 minutes).
    if ((handlers["messaging.domain_verify"] as { configured: boolean } | undefined)?.configured) {
      try {
        const id = await db.schedule("messaging.domain_verify", 15 * 60);
        if (id) log.info("queued the email-domain re-verify sweep", { queued_job: id });
      } catch (err) {
        log.error("could not queue messaging.domain_verify", { error: err });
      }
    }
    // o-payments: the daily payout sync across every connected Stripe account.
    if ((handlers["payments.sync_payouts"] as { configured: boolean } | undefined)?.configured) {
      try {
        const id = await db.schedule("payments.sync_payouts", 24 * 3600);
        if (id) log.info("queued the daily payments.sync_payouts pass", { queued_job: id });
      } catch (err) {
        log.error("could not queue payments.sync_payouts", { error: err });
      }
    }
  }

  let polling = false;
  async function poll(): Promise<void> {
    if (polling || state.stopping) return;
    polling = true;
    try {
      // Keep claiming while there is work and room.
      while (!state.stopping && (await runner.tick()) > 0) {
        /* claimed a batch; look again */
      }
    } catch (err) {
      log.error("could not claim jobs", { error: err });
    } finally {
      polling = false;
    }
  }

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
      const h = healthOf({ ...state, heartbeatMs: config.heartbeatMs, inFlight: runner.inFlight(), now: new Date() });
      res.writeHead(h.status, { "content-type": "application/json" }).end(JSON.stringify(h.body));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }));
  });
  server.on("error", (err) => log.error("health endpoint failed", { error: err }));
  server.listen(config.healthPort, config.healthHost, () => log.info("health endpoint listening", { at: `http://${config.healthHost}:${config.healthPort}/health` }));

  log.info("background service starting", { version: VERSION, handlers: Object.keys(handlerInfo()), concurrency: config.concurrency });
  await beat();
  const beatTimer = setInterval(() => void beat(), config.heartbeatMs);
  const pollTimer = setInterval(() => void poll(), config.pollMs);
  void poll();

  await new Promise<void>((resolve) => {
    const stop = (signal: string) => {
      if (state.stopping) return;
      state.stopping = true;
      runner.stop();
      clearInterval(beatTimer);
      clearInterval(pollTimer);
      log.info("stopping", { signal, in_flight: runner.inFlight() });
      void (async () => {
        const drained = await runner.drain(config.shutdownMs);
        if (!drained) log.warn("jobs still running at shutdown; the queue releases them after 15 minutes", { in_flight: runner.inFlight() });
        try {
          await db.stopped(config.workerId);
        } catch (err) {
          log.error("could not remove the heartbeat on shutdown", { error: err });
        }
        await db.close().catch((err: unknown) => log.error("closing the database pool failed", { error: err }));
        server.close();
        log.info("stopped");
        resolve();
      })();
    };
    process.once("SIGTERM", () => stop("SIGTERM"));
    process.once("SIGINT", () => stop("SIGINT"));
  });
}

export type { Logger };

// Run when executed directly (node dist/server.js), not when imported by tests.
if (!process.env.VITEST) {
  main().catch((err: unknown) => {
    createLogger({ service: "connect-worker" }).error("crashed", { error: err });
    process.exit(1);
  });
}
