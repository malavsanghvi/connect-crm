import { describe, expect, it } from "vitest";

import { poolConfig } from "../src/db";

describe("database TLS", () => {
  it("is off for a local database", () => {
    expect(poolConfig("postgres://connect_worker:pw@localhost:5432/postgres", undefined).tls).toBe("off");
  });
  it("verifies against the CA when one is given, and strips sslmode from the URL", () => {
    const { config, tls } = poolConfig("postgresql://connect_worker.ref:pw@aws-0.pooler.supabase.com:5432/postgres?sslmode=require", "CA");
    expect(tls).toBe("verified");
    expect(config.ssl).toEqual({ ca: "CA", rejectUnauthorized: true });
    expect(config.connectionString).not.toMatch(/sslmode/);
  });
  it("encrypts without verification otherwise (libpq's require)", () => {
    expect(poolConfig("postgresql://u:p@db.example.com:5432/postgres", undefined).tls).toBe("unverified");
    expect(poolConfig("postgresql://u:p@db.example.com:5432/postgres?sslmode=disable", undefined).tls).toBe("off");
  });
});
