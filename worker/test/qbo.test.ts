import { createRequire } from "node:module";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { NotConfiguredError, PermanentError } from "../src/errors";
import { HANDLERS } from "../src/handlers";
import * as oauth from "../src/handlers/oauth.exchange";
import * as post from "../src/handlers/qbo.post";
import * as pull from "../src/handlers/qbo.pull_lists";
import * as refresh from "../src/handlers/qbo.refresh_token";
import * as testPost from "../src/handlers/qbo.test_post";
import { createHttp } from "../src/http";
import { applyCreditMemo, checkDoc, dollars, references, toQbo, totalCents, type QboDoc } from "../src/qbo/documents";
import { apiBase, appKeys, faultMessage, ReconnectNeededError, tokenRequest, tokenUrl } from "../src/qbo/intuit";
import { createRegistry, jobContext } from "../src/runner";
import { captureLog, fakeDb, job } from "./helpers";

type Mock = { base: string; realm: string; state: { created: { entity: string; requestId: string; doc: Record<string, unknown> }[]; tokens: { grant: string }[] }; close(): Promise<void> };
const require = createRequire(import.meta.url);
const { startIntuitMock } = require("../../e2e/mocks/intuit.cjs") as { startIntuitMock: (o?: object) => Promise<Mock> };

let mock: Mock;
let env: Record<string, string>;
beforeAll(async () => {
  mock = await startIntuitMock();
  env = { INTUIT_CLIENT_ID: "intuit-test-client", INTUIT_CLIENT_SECRET: "intuit-test-secret-000", INTUIT_OAUTH_BASE: mock.base, INTUIT_API_BASE: mock.base };
});
afterAll(() => mock.close());

const http = createHttp(fetch, async () => {});
const CONN = "c0000000-0000-4000-8000-000000000001";

/** A fake database that answers the QuickBooks functions like the real ones would. */
function qboDb(opts: { settings?: Record<string, unknown>; claims?: unknown[]; secrets?: Record<string, string>; plan?: unknown } = {}) {
  const secrets = { ...(opts.secrets ?? {}) };
  const claims = [...(opts.claims ?? [])];
  const stored: Record<string, unknown[]> = {};
  const { db, calls } = fakeDb({
    query: (text, params) => {
      if (text.includes("qbo_worker_connection(")) {
        return [{ c: { id: CONN, center_id: "00000000-0000-4000-8000-000000000001", provider: "quickbooks_online", status: "connected", realm_id: mock.realm,
                       display_name: "JSH", environment: "production", settings: opts.settings ?? {}, api: "production", read_only: false, module_on: true } }];
      }
      if (text.includes("qbo_worker_store_list")) { stored[params[1] as string] = JSON.parse(params[2] as string); return [{ n: (stored[params[1] as string] ?? []).length }]; }
      if (text.includes("qbo_worker_pull_done")) return [{ r: { warnings: [] } }];
      if (text.includes("qbo_worker_claim")) return [{ c: claims.shift() ?? { ready: true, realm_connection: CONN, units: [] } }];
      if (text.includes("qbo_worker_test_post_plan")) return [{ p: opts.plan }];
      if (text.includes("qbo_worker_due")) return [{ d: [{ connection_id: CONN, center_id: "00000000-0000-4000-8000-000000000001", refresh: true, pull: true, post: false }] }];
      return [{}];
    },
  });
  const origRead = db.readSecret.bind(db), origStore = db.storeSecret.bind(db);
  db.readSecret = async (ctx, c, n) => { await origRead(ctx, c, n); return secrets[`${c}/${n}`] ?? null; };
  db.storeSecret = async (ctx, c, n, v) => { secrets[`${c}/${n}`] = v; return origStore(ctx, c, n, v); };
  return { db, calls, secrets, stored };
}
function ctxOf(db: ReturnType<typeof fakeDb>["db"], j = job(), e = env) {
  const { log, lines } = captureLog();
  return { ctx: jobContext({ db, reg: createRegistry(HANDLERS), env: e, http, log, workerId: "w" }, j, log), lines };
}
async function signedIn(): Promise<Record<string, string>> {
  const t = await tokenRequest(http, env, "production", { grant_type: "authorization_code", code: await authCode(), redirect_uri: "https://portal.test/api/oauth/intuit/callback" });
  return { [`${CONN}/access_token`]: t.accessToken, [`${CONN}/refresh_token`]: t.refreshToken };
}
async function authCode(): Promise<string> {
  const r = await fetch(`${mock.base}/connect/oauth2?client_id=intuit-test-client&redirect_uri=${encodeURIComponent("https://portal.test/api/oauth/intuit/callback")}&state=s`, { redirect: "manual" });
  return new URL(r.headers.get("location")!).searchParams.get("code")!;
}

describe("documents", () => {
  const sr: QboDoc = { entity: "SalesReceipt", txn_date: "2026-03-02", doc_number: "R-26-1", private_note: "n", customer_ref: "58", customer_status: "matched",
    deposit_account: "3", lines: [{ amount_cents: 5100, description: "Gift", item_id: "20", account_id: "1", class_id: "30" }] };
  it("cents become exact dollars", () => {
    expect(dollars(1999)).toBe(19.99);
    expect(dollars(10)).toBe(0.1);
    expect(() => dollars(1.5)).toThrow();
  });
  it("a sales receipt goes through the item, with class, customer and deposit account", () => {
    expect(toQbo(sr)).toEqual({
      TxnDate: "2026-03-02", DocNumber: "R-26-1", PrivateNote: "n", CustomerRef: { value: "58" }, DepositToAccountRef: { value: "3" },
      Line: [{ Amount: 51, Description: "Gift", DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "20" }, ClassRef: { value: "30" }, Qty: 1, UnitPrice: 51 } }],
    });
  });
  it("no customer yet: the entry posts without CustomerRef", () => {
    expect(toQbo({ ...sr, customer_ref: null })).not.toHaveProperty("CustomerRef");
  });
  it("journal entries must balance; deposits carry the source account", () => {
    const je: QboDoc = { entity: "JournalEntry", txn_date: "2026-03-02", lines: [
      { amount_cents: 150, posting: "Debit", account_id: "5" }, { amount_cents: 150, posting: "Credit", account_id: "4" }] };
    expect((toQbo(je).Line as { JournalEntryLineDetail: { PostingType: string } }[]).map((l) => l.JournalEntryLineDetail.PostingType)).toEqual(["Debit", "Credit"]);
    expect(totalCents(je)).toBe(150);
    expect(() => checkDoc({ ...je, lines: [{ ...je.lines[0]! }, { ...je.lines[1]!, amount_cents: 149 }] })).toThrow(/balance/);
    const dep: QboDoc = { entity: "Deposit", txn_date: "2026-03-03", deposit_account: "2", lines: [{ amount_cents: 100, account_id: "3" }] };
    expect(toQbo(dep)).toMatchObject({ DepositToAccountRef: { value: "2" }, Line: [{ DetailType: "DepositLineDetail", DepositLineDetail: { AccountRef: { value: "3" } } }] });
    expect(references(dep)).toEqual({ accounts: ["2", "3"], items: [], classes: [] });
  });
  it("a pledge write-off credit memo goes to the customer, and is applied to its invoice with a $0 payment", () => {
    const cm: QboDoc = { entity: "CreditMemo", txn_date: "2026-09-25", doc_number: "WO-P-1", customer_ref: "701", apply_to_invoice: "7401",
      lines: [{ amount_cents: 50000, description: "Pledge write-off", item_id: "23", account_id: "10" }] };
    expect(toQbo(cm)).toEqual({ TxnDate: "2026-09-25", DocNumber: "WO-P-1", CustomerRef: { value: "701" },
      Line: [{ Amount: 500, Description: "Pledge write-off", DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "23" }, Qty: 1, UnitPrice: 500 } }] });
    expect(applyCreditMemo(cm, "3001")).toEqual({ TxnDate: "2026-09-25", CustomerRef: { value: "701" }, TotalAmt: 0,
      Line: [{ Amount: 500, LinkedTxn: [{ TxnId: "7401", TxnType: "Invoice" }] }, { Amount: 500, LinkedTxn: [{ TxnId: "3001", TxnType: "CreditMemo" }] }] });
    expect(() => checkDoc({ ...cm, customer_ref: null })).toThrow(/customer/);
  });
  it("a receivable journal line carries its customer", () => {
    const je: QboDoc = { entity: "JournalEntry", txn_date: "2026-09-25", lines: [
      { amount_cents: 100, posting: "Debit", account_id: "10" }, { amount_cents: 100, posting: "Credit", account_id: "11", customer_ref: "701" }] };
    const line = (toQbo(je).Line as { JournalEntryLineDetail: Record<string, unknown> }[])[1]!;
    expect(line.JournalEntryLineDetail.Entity).toEqual({ Type: "Customer", EntityRef: { value: "701" } });
  });
  it("refuses a sales line without an item", () => {
    expect(() => checkDoc({ ...sr, lines: [{ amount_cents: 1, account_id: "1" }] })).toThrow(/item/);
  });
});

describe("Intuit endpoints and tokens", () => {
  it("uses Intuit's hosts unless overridden", () => {
    expect(tokenUrl({})).toBe("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
    expect(apiBase({}, "production")).toBe("https://quickbooks.api.intuit.com");
    expect(apiBase({}, "sandbox")).toBe("https://sandbox-quickbooks.api.intuit.com");
    expect(apiBase({ INTUIT_API_BASE: "http://m/" }, "sandbox")).toBe("http://m");
  });
  it("sandbox companies use the sandbox keys when set", () => {
    expect(appKeys({ INTUIT_CLIENT_ID: "p", INTUIT_CLIENT_SECRET: "ps", INTUIT_SANDBOX_CLIENT_ID: "s", INTUIT_SANDBOX_CLIENT_SECRET: "ss" }, "sandbox")).toEqual({ id: "s", secret: "ss" });
    expect(() => appKeys({}, "production")).toThrow(NotConfiguredError);
  });
  it("a refused refresh token means connect again", async () => {
    await expect(tokenRequest(http, env, "production", { grant_type: "refresh_token", refresh_token: "rt_nope" })).rejects.toBeInstanceOf(ReconnectNeededError);
  });
  it("faults read as one plain sentence", () => {
    expect(faultMessage({ Fault: { Error: [{ Message: "Invalid Reference Id", Detail: "Item 9 not found", code: "2500" }] } }, 400))
      .toBe("QuickBooks refused it — Invalid Reference Id: Item 9 not found (code 2500)");
  });
});

describe("oauth.exchange for Intuit", () => {
  it("swaps the code, stores both tokens and marks the connection connected with the company name", async () => {
    const { db, calls, secrets } = qboDb({ secrets: { [`${CONN}/oauth.code`]: await authCode() } });
    const j = job({ kind: "oauth.exchange", payload: { provider: "intuit", connection_id: CONN, redirect_uri: "https://portal.test/api/oauth/intuit/callback" } });
    const out = await oauth.run(j, ctxOf(db, j).ctx);
    expect(out).toMatchObject({ provider: "intuit", company: "Jain Society of Houston (Intuit test company)" });
    expect(secrets[`${CONN}/access_token`]).toMatch(/^at_/);
    expect(secrets[`${CONN}/refresh_token`]).toMatch(/^rt_/);
    const connected = calls.find((c) => c.fn === "query" && String(c.args[0]).includes("qbo_worker_connected"));
    expect((connected?.args[1] as unknown[])[3]).toBe("Jain Society of Houston (Intuit test company)");
    expect(JSON.stringify(out)).not.toMatch(/at_|rt_/);
  });
  it("without Intuit keys the job says so", async () => {
    const j = job({ kind: "oauth.exchange", payload: { provider: "intuit", connection_id: CONN } });
    await expect(oauth.run(j, ctxOf(fakeDb().db, j, {}).ctx)).rejects.toBeInstanceOf(NotConfiguredError);
  });
});

describe("qbo.pull_lists", () => {
  it("pulls every list, including inactive rows, and records the run", async () => {
    const { db, calls, stored } = qboDb({ secrets: await signedIn(), settings: { access_expires_at: new Date(Date.now() + 3600e3).toISOString() } });
    const j = job({ kind: "qbo.pull_lists", payload: { connection_id: CONN } });
    const out = await pull.run(j, ctxOf(db, j).ctx);
    expect(out.counts).toEqual({ accounts: 9, classes: 3, locations: 1, items: 3, tax_codes: 2, payment_methods: 3 });
    expect((stored.accounts as { qbo_id: string; active: boolean; account_type: string }[]).find((a) => a.qbo_id === "9")).toMatchObject({ active: false, account_type: "Income" });
    expect((stored.classes as { name: string }[]).map((c) => c.name)).toContain("Construction");
    expect(calls.some((c) => c.fn === "query" && String(c.args[0]).includes("qbo_worker_pull_done($1, $2, true"))).toBe(true);
  });
  it("renews an expired sign-in first, then pulls", async () => {
    const { db, calls } = qboDb({ secrets: await signedIn(), settings: { access_expires_at: new Date(Date.now() - 1000).toISOString() } });
    const j = job({ kind: "qbo.pull_lists", payload: { connection_id: CONN } });
    await pull.run(j, ctxOf(db, j).ctx);
    expect(calls.some((c) => c.fn === "query" && String(c.args[0]).includes("qbo_worker_tokens_refreshed"))).toBe(true);
  });
  it("a dead sign-in records a reconnect problem and fails without retrying", async () => {
    const { db, calls } = qboDb({ secrets: { [`${CONN}/refresh_token`]: "rt_revoked_000" } });
    const j = job({ kind: "qbo.pull_lists", payload: { connection_id: CONN } });
    const err = await pull.run(j, ctxOf(db, j).ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    const problem = calls.find((c) => c.fn === "query" && String(c.args[0]).includes("qbo_worker_connection_problem"));
    expect((problem?.args[1] as unknown[])[2]).toBe(true);
    expect(calls.some((c) => c.fn === "query" && String(c.args[0]).includes("qbo_worker_pull_done($1, $2, false"))).toBe(true);
  });
});

describe("qbo.post", () => {
  beforeEach(() => post.resetWarnings());
  const unit = (id: string, over: Partial<QboDoc> = {}) => ({ unit_id: id, posting_ids: [id], doc: {
    entity: "SalesReceipt", txn_date: "2026-03-02", doc_number: "R-1", customer_ref: null, customer_status: "not_built", deposit_account: "3",
    lines: [{ amount_cents: 5100, item_id: "20", account_id: "1", class_id: "30" }], ...over } });
  it("posts each unit once, idempotently, and logs once that donor matching is missing", async () => {
    const id1 = "11111111-0000-4000-8000-000000000001", id2 = "11111111-0000-4000-8000-000000000002";
    const { db, calls } = qboDb({ secrets: await signedIn(), settings: { access_expires_at: new Date(Date.now() + 3600e3).toISOString() },
      claims: [{ ready: true, realm_connection: CONN, units: [unit(id1), unit(id2)] }] });
    const j = job({ kind: "qbo.post", payload: {} });
    const { ctx, lines } = ctxOf(db, j);
    const before = mock.state.created.length;
    expect(await post.run(j, ctx)).toMatchObject({ posted: 2, failed: 0 });
    expect(mock.state.created.slice(before).map((c) => c.requestId)).toEqual([id1, id2]);
    expect(calls.filter((c) => c.fn === "query" && String(c.args[0]).includes("qbo_worker_posting_done")).length).toBe(2);
    expect(lines.filter((l) => String(l.msg).includes("donor matching")).length).toBe(1);
    // The same unit again (a retry after a lost answer) returns the first entry, not a second one.
    const again = qboDb({ secrets: await signedIn(), claims: [{ ready: true, realm_connection: CONN, units: [unit(id1)] }] });
    await post.run(j, ctxOf(again.db, j).ctx);
    expect(mock.state.created.filter((c) => c.requestId === id1).length).toBe(1);
  });
  it("a QuickBooks refusal is an exception for a person, not a retry", async () => {
    const id = "11111111-0000-4000-8000-000000000003";
    const { db, calls } = qboDb({ secrets: await signedIn(), claims: [{ ready: true, realm_connection: CONN, units: [unit(id, { lines: [{ amount_cents: 100, item_id: "999" }] })] }] });
    const j = job({ kind: "qbo.post", payload: {} });
    expect(await post.run(j, ctxOf(db, j).ctx)).toMatchObject({ posted: 0, failed: 1 });
    const failed = calls.find((c) => c.fn === "query" && String(c.args[0]).includes("qbo_worker_posting_failed"));
    expect(failed?.args[1]).toEqual([[id], expect.stringContaining("Invalid Reference Id"), false, "1"]);
  });
  it("a pledge write-off posts its credit memo once and applies it to the invoice once", async () => {
    const id = "11111111-0000-4000-8000-0000000000c1";
    const cmUnit = { unit_id: id, posting_ids: [id], doc: { entity: "CreditMemo", txn_date: "2026-09-25", doc_number: "WO-1", customer_ref: "701",
      customer_status: "matched", apply_to_invoice: "7401", lines: [{ amount_cents: 50000, description: "Pledge write-off", item_id: "20", account_id: "1" }] } };
    const { db, calls } = qboDb({ secrets: await signedIn(), claims: [{ ready: true, realm_connection: CONN, units: [cmUnit] }] });
    const j = job({ kind: "qbo.post", payload: {} });
    expect(await post.run(j, ctxOf(db, j).ctx)).toMatchObject({ posted: 1, failed: 0 });
    const made = mock.state.created.filter((c) => c.requestId === id || c.requestId === `${id}-apply`);
    expect(made.map((c) => c.entity)).toEqual(["CreditMemo", "Payment"]);
    const cmId = made[0]!.doc.Id as string;
    expect((made[1]!.doc.Line as { LinkedTxn: { TxnId: string; TxnType: string }[] }[]).map((l) => l.LinkedTxn[0])).toEqual([
      { TxnId: "7401", TxnType: "Invoice" }, { TxnId: cmId, TxnType: "CreditMemo" }]);
    const done = calls.find((c) => c.fn === "query" && String(c.args[0]).includes("qbo_worker_posting_done"));
    expect((done?.args[1] as unknown[]).slice(1, 3)).toEqual(["CreditMemo", cmId]);
    // Retried (a lost answer): QuickBooks returns the first ones; nothing is created twice.
    const again = qboDb({ secrets: await signedIn(), claims: [{ ready: true, realm_connection: CONN, units: [cmUnit] }] });
    await post.run(j, ctxOf(again.db, j).ctx);
    expect(mock.state.created.filter((c) => c.requestId === id || c.requestId === `${id}-apply`).length).toBe(2);
  });
  it("not ready: says why and posts nothing", async () => {
    const { db } = qboDb({ claims: [{ ready: false, reason: "The test post is not approved.", units: [] }] });
    const j = job({ kind: "qbo.post", payload: {} });
    expect(await post.run(j, ctxOf(db, j).ctx)).toMatchObject({ ready: false, reason: "The test post is not approved." });
  });
});

describe("qbo.test_post", () => {
  const docs: QboDoc[] = [
    { entity: "SalesReceipt", txn_date: "2026-03-02", deposit_account: "3", lines: [{ amount_cents: 100, item_id: "20", account_id: "1", class_id: "30" }] },
    { entity: "RefundReceipt", txn_date: "2026-03-02", deposit_account: "2", lines: [{ amount_cents: 100, item_id: "20", account_id: "1", class_id: "30" }] },
    { entity: "Deposit", txn_date: "2026-03-02", deposit_account: "2", lines: [{ amount_cents: 100, account_id: "3" }] },
    { entity: "JournalEntry", txn_date: "2026-03-02", lines: [{ amount_cents: 100, posting: "Debit", account_id: "5" }, { amount_cents: 100, posting: "Credit", account_id: "4" }] },
  ];
  it("post mode creates one of each type", async () => {
    const { db, calls } = qboDb({ secrets: await signedIn(), plan: { ok: true, mode: "post", connection_id: CONN, docs } });
    const j = job({ kind: "qbo.test_post", payload: { test_id: "t1" } });
    const out = await testPost.run(j, ctxOf(db, j).ctx);
    expect(out).toMatchObject({ ok: true, mode: "post" });
    expect(mock.state.created.filter((c) => c.requestId.startsWith("t1-")).map((c) => c.entity).sort()).toEqual(["Deposit", "JournalEntry", "RefundReceipt", "SalesReceipt"]);
    expect(calls.some((c) => c.fn === "query" && String(c.args[0]).includes("qbo_worker_test_post_done"))).toBe(true);
  });
  it("dry run (read-only company) creates nothing and checks every reference", async () => {
    const before = mock.state.created.length;
    const bad = [{ ...docs[0]!, lines: [{ amount_cents: 100, item_id: "20", account_id: "1", class_id: "32" }] }, ...docs.slice(1)];
    const { db } = qboDb({ secrets: await signedIn(), plan: { ok: true, mode: "dry_run", connection_id: CONN, docs: bad } });
    const j = job({ kind: "qbo.test_post", payload: { test_id: "t2" } });
    const out = (await testPost.run(j, ctxOf(db, j).ctx)) as { ok: boolean; results: { entity: string; ok: boolean; error?: string }[] };
    expect(mock.state.created.length).toBe(before);
    expect(out.ok).toBe(false);
    expect(out.results[0]).toMatchObject({ entity: "SalesReceipt", ok: false, error: expect.stringContaining("inactive") });
    expect(out.results.slice(1).every((r) => r.ok)).toBe(true);
  });
});

describe("qbo.refresh_token", () => {
  it("the hourly round renews sign-ins and queues the daily pull", async () => {
    const { db, calls } = qboDb({ secrets: await signedIn() });
    const j = job({ kind: "qbo.refresh_token", center_id: null, payload: {} });
    expect(await refresh.run(j, ctxOf(db, j).ctx)).toMatchObject({ connections: 1, refreshed: 1, pulls: 1 });
    expect(calls.some((c) => c.fn === "query" && String(c.args[0]).includes("'qbo.pull_lists'"))).toBe(true);
    expect(refresh.every).toBe(3600);
  });
});
