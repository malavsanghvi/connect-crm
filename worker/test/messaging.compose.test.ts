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

describe("messaging.compose for a pledge emailed by hand (0792)", () => {
  const REQ = "17000000-0000-4000-8000-0000000000ee";
  const pledgeFacts = {
    trigger: "pledge_recorded",
    skip: null,
    automation: { id: AUTO, key: "pledge_recorded", template_key: "pledge_recorded" },
    center: { name: "Riverside", short_name: "Riverside", currency: "USD", time_zone: "America/Chicago", country: "US", languages: ["en"] },
    household: { id: HH, name: "Rao, Asha & Zoya", number: "H-7", minor_first_names: ["Zoya"] },
    pledge: { amount_cents: 120000, paid_cents: 20000, number: "PL-9", pledged_at: "2026-10-03", due_on: "2026-11-02", for: "Building fund" },
    wording: null,
    recipients: [{ person_id: null, address: "typed@example.org", first_name: null, name: null, language: null }],
  };

  it("reads the address from the request (not from the job), writes the email for that one address and queues it once, keyed to the request", async () => {
    const { ctx, calls } = ctxWith((text) => {
      if (text.includes("worker_email_context")) return [{ c: { country: "US" } }];
      if (text.includes("worker_pledge_email_request")) return [{ f: pledgeFacts }];
      return [{ r: { outcome: "queued" } }];
    });
    const out = await compose.run(job({ kind: "messaging.compose", payload: { automation_id: AUTO, ref_id: REF, request_id: REQ } }), ctx);
    expect(out).toEqual({ automation_id: AUTO, ref_id: REF, queued: 1, skipped: 0, duplicate: 0 });
    const q = calls.filter((c) => c.fn === "query");
    expect(String(q[1]?.args[0])).toContain("worker_pledge_email_request");
    expect(q[1]?.args[1]).toEqual([REQ, 18]);
    expect(q.some((c) => String(c.args[0]).includes("worker_email_facts"))).toBe(false);
    const enqueue = q[2]?.args[1] as unknown[];
    expect(enqueue.slice(0, 6)).toEqual([AUTO, REF, `manual:${REQ}`, HH, null, "typed@example.org"]);
    const vars = JSON.parse(String(enqueue[6])) as Record<string, string>;
    expect(vars.pledge_amount).toBe("$1,200.00");
    expect(vars.pledge_balance).toBe("$1,000.00");
    expect(vars.recipient_first_name).toBe("friend");
    expect(vars.household_name).toBe("Rao, Asha");
    expect(JSON.stringify(vars)).not.toContain("Zoya");
    // The address is never in the job itself.
    expect(JSON.stringify({ automation_id: AUTO, ref_id: REF, request_id: REQ })).not.toContain("@");
  });

  it("stops with the database's reason when the request cannot be sent, and queues nothing", async () => {
    const { ctx, calls } = ctxWith((text) => {
      if (text.includes("worker_email_context")) return [{ c: {} }];
      return [{ f: { ...pledgeFacts, skip: "Not sent: the pledge was cancelled." } }];
    });
    const out = await compose.run(job({ kind: "messaging.compose", payload: { automation_id: AUTO, ref_id: REF, request_id: REQ } }), ctx);
    expect(out.reason).toBe("Not sent: the pledge was cancelled.");
    expect(calls.filter((c) => c.fn === "query")).toHaveLength(2);
  });

  it("refuses a request id that is not an id", async () => {
    const { ctx } = ctxWith(() => []);
    await expect(compose.run(job({ kind: "messaging.compose", payload: { automation_id: AUTO, ref_id: REF, request_id: "x@y.z" } }), ctx)).rejects.toThrow(/needs an automation_id/);
  });
});
