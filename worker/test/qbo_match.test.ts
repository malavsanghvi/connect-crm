import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotConfiguredError, PermanentError } from "../src/errors";
import { run as bringIn } from "../src/handlers/qbo.bring_in_history";
import { cleanProposals, prompt, run as suggestAi, type AiCustomer } from "../src/handlers/qbo.match_suggest_ai";
import { run as pull, shouldUseCdc } from "../src/handlers/qbo.pull_customers_history";
import { createHttp } from "../src/http";
import { apiBase, cents, mapCustomer, mapTransaction, qLiteral, toE164, windowStart } from "../src/qbo_match/qbo";
import type { JobContext } from "../src/types";
import { captureLog, fakeDb, job } from "./helpers";

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, "..", "..");
const { startQbo, startAnthropic } = require(path.join(root, "e2e/mocks/qbo-mock.cjs")) as {
  startQbo: (o: { company: unknown; token?: string; realm?: string }) => Promise<{ url: string; log: string[]; close(): Promise<void>; touch(e: string, id: string, p: object): void }>;
  startAnthropic: () => Promise<{ url: string; requests: string[]; close(): Promise<void> }>;
};
const company = JSON.parse(readFileSync(path.join(root, "e2e/fixtures/o-qbo-match/company.json"), "utf8"));

describe("mapping QuickBooks JSON", () => {
  it("customers: emails lower-cased, phones in E.164, the address, sub-customers, balance in cents", () => {
    const shah = mapCustomer(company.Customer[0])!;
    expect(shah).toMatchObject({ qbo_id: "1187", display_name: "Shah Family", emails: ["priya.shah@example.com"], open_balance_cents: 40000, is_sub_customer: false });
    expect(shah.address).toEqual({ line1: "1 Lotus Ct", city: "Katy", state: "TX", zip: "77494" });
    expect(mapCustomer(company.Customer[1])!.emails).toEqual(["kiran@jsh.test"]);
    expect(mapCustomer(company.Customer[2])!.phones).toEqual(["+12815550112"]);
    expect(mapCustomer(company.Customer[7])).toMatchObject({ parent_qbo_id: "1187", is_sub_customer: true });
    expect(mapCustomer(company.Customer[8])!.active).toBe(false);
    expect(mapCustomer({})).toBeNull();
  });
  it("transactions: lines with classes (subtotals dropped), payment links, open balances", () => {
    const inv = mapTransaction("Invoice", company.Invoice[0])!;
    expect(inv).toMatchObject({ qbo_id: "6001", customer_qbo_id: "1187", total_cents: 100000, open_balance_cents: 40000, doc_number: "INV-6001" });
    expect(inv.lines).toEqual([{ amount_cents: 100000, description: "Construction pledge", item: "Pledge", account: null, class_id: "CL-CON", class_name: "Construction" }]);
    const pay = mapTransaction("Payment", company.Payment[0])!;
    expect(pay).toMatchObject({ total_cents: 60000, payment_method: "Check", reference_number: "1201", linked: [{ type: "Invoice", id: "6001", amount_cents: 60000 }] });
    expect(mapTransaction("CreditMemo", company.CreditMemo[0])!.open_balance_cents).toBe(5000);
    expect(mapTransaction("SalesReceipt", { Id: "1" })).toBeNull();
  });
  it("small helpers", () => {
    expect(cents(12.345)).toBe(1235);
    expect(cents("x")).toBe(0);
    expect(toE164("713-555-0142")).toBe("+17135550142");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
    expect(toE164("555")).toBeNull();
    expect(qLiteral("O'Brien")).toBe("'O\\'Brien'");
    expect(windowStart(7, new Date("2026-09-24T12:00:00Z"))).toBe("2019-09-24");
    expect(apiBase({}, "test")).toBe("https://sandbox-quickbooks.api.intuit.com");
    expect(apiBase({}, "live")).toBe("https://quickbooks.api.intuit.com");
    expect(apiBase({ INTUIT_API_BASE: "http://127.0.0.1:9/" }, "live")).toBe("http://127.0.0.1:9");
    expect(shouldUseCdc(null, false)).toBe(false);
    expect(shouldUseCdc(new Date(Date.now() - 3600e3).toISOString(), false)).toBe(true);
    expect(shouldUseCdc(new Date(Date.now() - 3600e3).toISOString(), true)).toBe(false);
    expect(shouldUseCdc(new Date(Date.now() - 40 * 86400e3).toISOString(), false)).toBe(false);
  });
});

function ctxFor(db: ReturnType<typeof fakeDb>["db"], env: Record<string, string>): JobContext {
  const { log } = captureLog();
  return {
    db,
    secret: (c, n) => db.readSecret({ workerId: "t", jobId: "1", purpose: "test" }, c, n),
    storeSecret: async () => ({ fingerprint: "" }),
    http: createHttp(fetch, async () => {}),
    log,
    env,
    workerId: "t",
  };
}

describe("qbo.pull_customers_history against the mock QuickBooks", () => {
  let qbo: Awaited<ReturnType<typeof startQbo>>;
  beforeAll(async () => {
    qbo = await startQbo({ company });
  });
  afterAll(() => qbo.close());

  function db(conn: Record<string, unknown> | null, secret = "mock-access-token") {
    const stored: { customers: unknown[]; txns: unknown[] } = { customers: [], txns: [] };
    const f = fakeDb({
      secrets: { "conn-1/access_token": secret },
      query: (text, params) => {
        if (text.includes("qbo_worker_connection")) return [{ r: conn }];
        if (text.includes("qbo_worker_store_customers")) {
          const rows = JSON.parse(String(params[1]));
          stored.customers.push(...rows);
          return [{ r: rows.length }];
        }
        if (text.includes("qbo_worker_store_transactions")) {
          const rows = JSON.parse(String(params[1]));
          stored.txns.push(...rows);
          return [{ r: rows.length }];
        }
        if (text.includes("qbo_worker_finish_pull")) return [{ r: { suggestions: 5, ambiguous: 1, no_candidate: 1 } }];
        if (text.includes("enqueue_job")) return [{ r: "99" }];
        return [];
      },
    });
    return { ...f, stored };
  }
  const conn = { connection_id: "conn-1", provider: "quickbooks_online", status: "connected", realm_id: "9130355", mode: "test", history_years: 7, last_pull_at: null, accounting_on: true };

  it("reads every customer and the history in the window, stores them and asks the AI about the rest", async () => {
    const d = db(conn);
    const r = (await pull(job({ kind: "qbo.pull_customers_history" }), ctxFor(d.db, { INTUIT_API_BASE: qbo.url, ANTHROPIC_API_KEY: "test" }))) as Record<string, unknown>;
    expect(d.stored.customers).toHaveLength(9);
    const ids = (d.stored.txns as { qbo_type: string; qbo_id: string }[]).map((t) => `${t.qbo_type}:${t.qbo_id}`).sort();
    expect(ids).toContain("Invoice:6001");
    expect(ids).toContain("Payment:7001");
    expect(ids).toContain("CreditMemo:8001");
    expect(ids).not.toContain("SalesReceipt:5004"); // 2012: outside the 7-year window
    expect(r).toMatchObject({ mode: "full", customers_read: 9, ai_job: "99" });
    expect(qbo.log.some((l) => l.includes("Balance"))).toBe(true); // open invoices older than the window are asked for too
  });

  it("a recent last pull reads only the changes (CDC)", async () => {
    qbo.touch("Customer", "2006", { DisplayName: "Acme Temple Supplies LLC" });
    const d = db({ ...conn, last_pull_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    const r = (await pull(job({ kind: "qbo.pull_customers_history" }), ctxFor(d.db, { INTUIT_API_BASE: qbo.url }))) as Record<string, unknown>;
    expect(r).toMatchObject({ mode: "changes", customers_read: 1, transactions_read: 0, ai_job: null });
    expect((d.stored.customers[0] as { display_name: string }).display_name).toBe("Acme Temple Supplies LLC");
  });

  it("says plainly when QuickBooks is not connected, or the token was refused", async () => {
    await expect(pull(job(), ctxFor(db(null).db, { INTUIT_API_BASE: qbo.url }))).rejects.toThrow(/Connect QuickBooks first/);
    await expect(pull(job(), ctxFor(db({ ...conn, accounting_on: false }).db, {}))).rejects.toBeInstanceOf(PermanentError);
    await expect(pull(job(), ctxFor(db(conn, "wrong").db, { INTUIT_API_BASE: qbo.url }))).rejects.toThrow(/refused the access token/);
  });

  it("with no organization it queues the daily pulls", async () => {
    const d = fakeDb({ query: () => [{ r: 2 }] });
    expect(await pull(job({ center_id: null }), ctxFor(d.db, {}))).toEqual({ queued: 2 });
  });
});

describe("qbo.match_suggest_ai", () => {
  let ai: Awaited<ReturnType<typeof startAnthropic>>;
  beforeAll(async () => {
    ai = await startAnthropic();
  });
  afterAll(() => ai.close());
  const customers: AiCustomer[] = [
    {
      qbo_id: "2005", display_name: "Shah Household", given_name: null, family_name: null, company_name: null, city: null, zip: null, email_domains: [],
      candidates: [
        { household_id: "d0000000-0000-4000-8000-000000000103", name: "Rahul & Mira Shah Household", city: "Sugar Land", zip: "77478", member_first_names: ["Rahul", "Mira"], email_domains: ["example.com"] },
        { household_id: "d0000000-0000-4000-8000-000000000101", name: "Shah family", city: "Katy", zip: "77494", member_first_names: ["Priya", "Rahul"], email_domains: ["example.com"] },
      ],
    },
    { qbo_id: "2006", display_name: "Acme", given_name: null, family_name: null, company_name: "Acme", city: null, zip: null, email_domains: [], candidates: [] },
  ];

  it("is off without ANTHROPIC_API_KEY", async () => {
    await expect(suggestAi(job({ kind: "qbo.match_suggest_ai" }), ctxFor(fakeDb().db, {}))).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("sends only the ambiguous customers with candidates, caps and stores the answers", async () => {
    let stored: unknown[] = [];
    let checked: unknown = null;
    const d = fakeDb({
      query: (text, params) => {
        if (text.includes("qbo_worker_ai_input")) return [{ r: customers }];
        if (text.includes("qbo_worker_store_ai")) {
          stored = JSON.parse(String(params[1]));
          checked = params[3];
          return [{ r: stored.length }];
        }
        return [];
      },
    });
    const r = (await suggestAi(job({ kind: "qbo.match_suggest_ai" }), ctxFor(d.db, { ANTHROPIC_API_KEY: "test", ANTHROPIC_BASE_URL: ai.url }))) as Record<string, unknown>;
    expect(r).toMatchObject({ asked: 1, checked: 2, stored: 1 });
    expect(stored).toEqual([expect.objectContaining({ qbo_id: "2005", household_id: "d0000000-0000-4000-8000-000000000101", confidence: 0.85 })]);
    expect(checked).toEqual(["2005", "2006"]);
    expect(ai.requests.at(-1)).not.toMatch(/@/);
    expect(ai.requests.at(-1)).toContain("claude-opus-5");
  });

  it("keeps only households offered to that customer", () => {
    expect(cleanProposals({ matches: [{ qbo_id: "2005", household_id: "x", confidence: 2, reason: "" }, { qbo_id: "nope", household_id: null, confidence: 1 }] }, customers)).toEqual([
      { qbo_id: "2005", household_id: null, confidence: 0.85, reason: "" },
    ]);
    expect(prompt(customers)).toContain('household d0000000-0000-4000-8000-000000000101: "Shah family"; members: Priya, Rahul');
  });
});

describe("qbo.bring_in_history", () => {
  it("calls the bring-in for the customer in the payload", async () => {
    const d = fakeDb({ query: () => [{ r: { status: "done", brought_in: 3 } }] });
    expect(await bringIn(job({ kind: "qbo.bring_in_history", payload: { qbo_customer_id: "1187" } }), ctxFor(d.db, {}))).toEqual({ status: "done", brought_in: 3 });
    expect(d.calls.find((c) => c.fn === "query")?.args[1]).toEqual(["00000000-0000-4000-8000-000000000001", "1187"]);
    await expect(bringIn(job({ payload: {} }), ctxFor(d.db, {}))).rejects.toBeInstanceOf(PermanentError);
  });
});
