import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A stand-in for pg: it records how each pool was made and answers queries as told.
const pgFake = vi.hoisted(() => ({
  pools: [] as { config: Record<string, unknown>; waitingCount: number; query: ReturnType<typeof vi.fn> }[],
  behaviour: null as null | ((text: string) => Promise<{ rows: unknown[] }>),
}));
vi.mock("pg", () => {
  class Pool {
    config: Record<string, unknown>;
    waitingCount = 0;
    query = vi.fn(async (text: string) => (pgFake.behaviour ? pgFake.behaviour(text) : { rows: [{ r: "ok" }] }));
    constructor(config: Record<string, unknown>) {
      this.config = config;
      pgFake.pools.push(this as never);
    }
    on() {}
  }
  return { default: { Pool } };
});

async function load() {
  vi.resetModules();
  return await import("@/lib/messaging/server-db");
}

beforeEach(() => {
  pgFake.pools.length = 0;
  pgFake.behaviour = null;
  process.env.PORTAL_DATABASE_URL = "postgres://connect_worker:secret@db.example.supabase.co:5432/postgres?sslmode=require";
});
afterEach(() => {
  delete process.env.PORTAL_DATABASE_URL;
});

describe("the demo's own database connection", () => {
  it("is a separate pool of one connection, with a short wait, apart from the hooks' pool of four", async () => {
    const db = await load();
    await db.workerQuery("select 1", []);
    await db.demoWorkerQuery("select 2", []);
    expect(pgFake.pools).toHaveLength(2);
    const [hooks, demo] = pgFake.pools;
    expect(hooks!.config.max).toBe(4);
    expect(hooks!.config.application_name).toBe("connect-portal-hooks");
    expect(demo!.config.max).toBe(1);
    expect(demo!.config.application_name).toBe("connect-portal-demo");
    expect(demo!.config.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(demo!.config.connectionTimeoutMillis).toBeLessThanOrEqual(5000);
    expect(demo!.config.connectionString).toBe(hooks!.config.connectionString);
    expect(demo!.query).toHaveBeenCalledTimes(1);
    expect(hooks!.query).toHaveBeenCalledTimes(1);
  });

  it("never touches the hooks' pool, however many demo starts there are", async () => {
    const db = await load();
    for (let i = 0; i < 10; i++) await db.demoWorkerQuery("select 1", []);
    expect(pgFake.pools).toHaveLength(1);
    expect(pgFake.pools[0]!.config.application_name).toBe("connect-portal-demo");
  });

  it("turns a start away when others are already waiting for the one connection", async () => {
    const db = await load();
    await db.demoWorkerQuery("select 1", []);
    pgFake.pools[0]!.waitingCount = db.DEMO_MAX_WAITING;
    await expect(db.demoWorkerQuery("select 1", [])).rejects.toBeInstanceOf(db.DemoBusyError);
    expect(pgFake.pools[0]!.query).toHaveBeenCalledTimes(1);
  });

  it("calls it busy when the connection does not come in time, and lets any other failure through as it is", async () => {
    const db = await load();
    pgFake.behaviour = async () => {
      throw new Error("timeout exceeded when trying to connect");
    };
    await expect(db.demoWorkerQuery("select 1", [])).rejects.toBeInstanceOf(db.DemoBusyError);
    pgFake.behaviour = async () => {
      throw Object.assign(new Error("permission denied for function worker_demo_begin"), { code: "42501" });
    };
    await expect(db.demoWorkerQuery("select 1", [])).rejects.toMatchObject({ code: "42501" });
  });

  it("answers null when the portal has no database connection string (the hooks' behaviour)", async () => {
    delete process.env.PORTAL_DATABASE_URL;
    delete process.env.WORKER_DATABASE_URL;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = await load();
    expect(await db.demoWorkerQuery("select 1", [])).toBeNull();
    expect(await db.workerQuery("select 1", [])).toBeNull();
  });
});
