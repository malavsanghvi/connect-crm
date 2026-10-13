import { describe, expect, it } from "vitest";

import { HANDLERS } from "../src/handlers";
import * as sweep from "../src/handlers/messaging.email_schedules_sweep";
import { createRegistry, readiness } from "../src/runner";
import type { JobContext } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

const AUTO = "17100000-0000-4000-8000-0000000000aa";
const H1 = "17100000-0000-4000-8000-0000000000a1";
const H2 = "17100000-0000-4000-8000-0000000000a2";
const P1 = "17100000-0000-4000-8000-0000000000b1";

const center = { name: "Riverside", short_name: "Riverside", currency: "EUR", time_zone: "Europe/Madrid", country: "ES", languages: ["es"] };

function household(id: string, adults: number) {
  return {
    household: { id, name: "Rivera, Alex & Zoya", number: "H-1", minor_first_names: ["Zoya"] },
    recipients: Array.from({ length: adults }, (_, i) => ({ person_id: i === 0 ? P1 : null, address: `a${i}@${id.slice(-2)}.example.org`, first_name: "Alex", name: "Alex Rivera", language: "es" })),
    data: { pledges: [{ number: "P-1", for: "Zoya's Fund", balance_cents: 40000, due_on: "2026-10-16" }], count: 1, balance_cents: 40000, next_due: "2026-10-16" },
  };
}

function scripted(batches: unknown[], enqueueOutcome = "queued") {
  const queue = [...batches];
  const { db, calls } = fakeDb({
    query: (text) => {
      if (text.includes("worker_email_schedules_due")) return [{ d: [{ automation_id: AUTO, period: "2026-10-13", audience: "pledges_due_soon" }] }];
      if (text.includes("worker_email_context")) return [{ c: { country: "ES" } }];
      if (text.includes("worker_email_schedule_batch")) return [{ b: queue.shift() ?? { households: [], more: false } }];
      if (text.includes("worker_email_enqueue")) return [{ r: { outcome: enqueueOutcome } }];
      return [{ d: {} }];
    },
  });
  const { log } = captureLog();
  return { ctx: { db, log } as unknown as JobContext, calls };
}

const queries = (calls: { fn: string; args: unknown[] }[], name: string) => calls.filter((c) => c.fn === "query" && String(c.args[0]).includes(name));

describe("messaging.email_schedules_sweep", () => {
  it("is scheduled every 5 minutes, platform-wide, and needs no provider keys", () => {
    const mod = HANDLERS.find((h) => h.kind === "messaging.email_schedules_sweep");
    expect(mod?.every).toBe(300);
    expect(readiness(createRegistry(HANDLERS), {})["messaging.email_schedules_sweep"]).toEqual({ configured: true });
  });

  it("writes each adult's values (the community's money, no child's name) and finishes the run when the audience is done", async () => {
    const { ctx, calls } = scripted([{ center, audience: "pledges_due_soon", households: [household(H1, 2)], more: false }]);
    const out = await sweep.run(job({ kind: sweep.kind }), ctx);
    expect(out.runs).toEqual([{ automation_id: AUTO, period: "2026-10-13", queued: 2, skipped: 0, duplicate: 0, done: true }]);
    const enq = queries(calls, "worker_email_enqueue");
    expect(enq).toHaveLength(2);
    const args = enq[0]?.args[1] as unknown[];
    expect(args.slice(0, 6)).toEqual([AUTO, H1, "2026-10-13", H1, P1, "a0@a1.example.org"]);
    const vars = JSON.parse(String(args[6])) as Record<string, string>;
    expect(vars.pledges_list?.replace(/\s/g, " ")).toBe("P-1 · Fund · 400,00 € · 16 de octubre de 2026");
    expect(JSON.stringify(vars)).not.toContain("Zoya");
    expect(queries(calls, "worker_email_schedule_done")).toHaveLength(1);
  });

  it("stops at the rate limit between households and leaves the rest of the run for the next sweep", async () => {
    const big = Array.from({ length: 100 }, (_, i) => household(`17100000-0000-4000-8000-${String(i).padStart(12, "0")}`, 3));
    const { ctx, calls } = scripted([
      { center, audience: "pledges_due_soon", households: big, more: true },
      { center, audience: "pledges_due_soon", households: big, more: true },
    ]);
    const out = await sweep.run(job({ kind: sweep.kind }), ctx);
    expect(out.runs[0]?.queued).toBe(501);
    expect(out.runs[0]?.done).toBe(false);
    expect(queries(calls, "worker_email_schedule_batch")).toHaveLength(2);
    expect(queries(calls, "worker_email_schedule_done")).toHaveLength(0);
  });

  it("says why a run stopped (paused, changed, a module off) and finishes nothing", async () => {
    const { ctx, calls } = scripted([{ households: [], more: false, stop: "The scheduled email was paused or changed during the run." }]);
    const out = await sweep.run(job({ kind: sweep.kind }), ctx);
    expect(out.runs[0]?.stop).toMatch(/paused/);
    expect(queries(calls, "worker_email_schedule_done")).toHaveLength(0);
  });
});
