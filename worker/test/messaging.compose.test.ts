import { describe, expect, it } from "vitest";

import { HANDLERS } from "../src/handlers";
import * as compose from "../src/handlers/messaging.compose";
import { createRegistry, readiness } from "../src/runner";
import type { JobContext } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

const AUTO = "17000000-0000-4000-8000-0000000000aa";
const REF = "17000000-0000-4000-8000-0000000000bb";
const HH = "17000000-0000-4000-8000-0000000000cc";
const P1 = "17000000-0000-4000-8000-0000000000d1";

function ctxWith(answer: (text: string, params: unknown[]) => unknown[]) {
  const { db, calls } = fakeDb({ query: answer });
  const { log } = captureLog();
  return { ctx: { db, log } as unknown as JobContext, calls };
}

const facts = {
  trigger: "payment_receipt",
  skip: null,
  automation: { id: AUTO, key: "payment_receipt", template_key: "receipt" },
  center: { name: "Riverside", short_name: "Riverside", currency: "INR", time_zone: "Asia/Kolkata", country: "IN", languages: ["en"] },
  household: { id: HH, name: "Rao, Asha & Zoya", number: "H-7", minor_first_names: ["Zoya"] },
  payment: { amount_cents: 12500050, received_on: "2026-10-13", method: "ach", receipt_number: "R-7", receipt_name: null, applied_to: [] },
  wording: null,
  recipients: [
    { person_id: P1, address: "asha@example.org", first_name: "Asha", name: "Asha Rao", language: "en" },
    { person_id: null, address: "", first_name: null, name: null, language: null },
  ],
};

describe("messaging.compose", () => {
  it("is a registered job kind that needs no provider keys and is not scheduled", () => {
    const mod = HANDLERS.find((h) => h.kind === "messaging.compose");
    expect(mod).toBeDefined();
    expect(mod?.every).toBeUndefined();
    expect(readiness(createRegistry(HANDLERS), {})["messaging.compose"]).toEqual({ configured: true });
  });

  it("works out the age of majority from the community's place, writes the values and queues one email per address", async () => {
    const { ctx, calls } = ctxWith((text) => {
      if (text.includes("worker_email_context")) return [{ c: { center_id: "c", country: "SG", state_region: null, age_of_majority: null } }];
      if (text.includes("worker_email_facts")) return [{ f: facts }];
      return [{ r: { outcome: "queued" } }];
    });
    const out = await compose.run(job({ kind: "messaging.compose", payload: { automation_id: AUTO, ref_id: REF } }), ctx);
    expect(out).toEqual({ automation_id: AUTO, ref_id: REF, queued: 1, skipped: 0, duplicate: 0 });
    const q = calls.filter((c) => c.fn === "query");
    expect((q[1]?.args[1] as unknown[])[2]).toBe(21); // Singapore: 21
    const enqueue = q[2]?.args[1] as unknown[];
    expect(enqueue.slice(0, 6)).toEqual([AUTO, REF, "", HH, P1, "asha@example.org"]);
    const vars = JSON.parse(String(enqueue[6])) as Record<string, string>;
    expect(vars.payment_amount).toBe("₹1,25,000.50");
    expect(vars.household_name).toBe("Rao, Asha");
    expect(JSON.stringify(vars)).not.toContain("Zoya");
    expect(vars.payment_applied_to).toBe("the community's work");
  });

  it("stops with the database's reason when the record gets no email, and queues nothing", async () => {
    const { ctx, calls } = ctxWith((text) => {
      if (text.includes("worker_email_context")) return [{ c: { country: "US" } }];
      return [{ f: { ...facts, skip: "Not sent: the email was switched off before it went." } }];
    });
    const out = await compose.run(job({ kind: "messaging.compose", payload: { automation_id: AUTO, ref_id: REF } }), ctx);
    expect(out.reason).toBe("Not sent: the email was switched off before it went.");
    expect(calls.filter((c) => c.fn === "query")).toHaveLength(2);
  });

  it("counts duplicates and skips, and refuses a job without ids", async () => {
    const answers = [{ r: { outcome: "duplicate" } }];
    const { ctx } = ctxWith((text) => {
      if (text.includes("worker_email_context")) return [{ c: {} }];
      if (text.includes("worker_email_facts")) return [{ f: facts }];
      return answers;
    });
    const out = await compose.run(job({ kind: "messaging.compose", payload: { automation_id: AUTO, ref_id: REF, period: "2026-10" } }), ctx);
    expect(out.duplicate).toBe(1);
    await expect(compose.run(job({ kind: "messaging.compose", payload: {} }), ctx)).rejects.toThrow(/automation_id/);
  });
});
