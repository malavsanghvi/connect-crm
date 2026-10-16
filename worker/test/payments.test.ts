import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermanentError, NotConfiguredError, isRetryable } from "../src/errors";
import { recordingProblem, splitStripeFees } from "../src/payments/core";
import { createHttp } from "../src/http";
import { HANDLERS } from "../src/handlers";
import * as oauth from "../src/handlers/oauth.exchange";
import * as refund from "../src/handlers/payments.refund";
import * as syncPayouts from "../src/handlers/payments.sync_payouts";
import * as testCharge from "../src/handlers/payments.test_charge";
import * as paypalHook from "../src/handlers/payments.webhook.paypal";
import * as stripeHook from "../src/handlers/payments.webhook.stripe";
import {
  centsToDecimal, clearPaypalTokens, decimalToCents, formEncode, paypalAuthAssertion, paypalMethod, stripeKey, stripeMethod,
} from "../src/payments/providers";
import { createRegistry, jobContext } from "../src/runner";
import { captureLog, fakeDb, job } from "./helpers";

const require = createRequire(import.meta.url);
// The same local mock the end-to-end flow uses (e2e/mocks/payments-mock.cjs); no network.
const { createPaymentsMock } = require("../../e2e/mocks/payments-mock.cjs") as {
  createPaymentsMock: (o?: Record<string, unknown>) => {
    listen(port?: number): Promise<string>;
    close(): Promise<void>;
    base: string;
    state: {
      requests: { method: string; path: string; account: string | null; idempotency: string | null; authAssertion: string | null; body: string }[];
      sessions: Map<string, Record<string, unknown>>;
      orders: Map<string, Record<string, unknown>>;
      /** What each Checkout Session was created with: its line items and application fee. */
      forms: Map<string, { items: { name: string; cents: number }[]; appFee: number | null }>;
      /** Bends the next payments: amountReceived, applicationFee, omitFeeDetails, feeExcludesApplication, method. */
      behavior: Record<string, unknown>;
    };
  };
};

const CENTER = "00000000-0000-4000-8000-000000000001";
const CHECKOUT = "11111111-1111-4111-8111-111111111111";

let mock: ReturnType<typeof createPaymentsMock>;
let env: Record<string, string>;
beforeAll(async () => {
  mock = createPaymentsMock();
  const base = await mock.listen(0);
  env = {
    STRIPE_TEST_SECRET_KEY: "sk_test_platform_fake", STRIPE_CLIENT_ID: "ca_fake", STRIPE_API_BASE: base, STRIPE_CONNECT_BASE: base,
    PAYPAL_SANDBOX_CLIENT_ID: "sb-client-fake", PAYPAL_SANDBOX_CLIENT_SECRET: "sb-secret-fake", PAYPAL_SANDBOX_API_BASE: base, PAYPAL_PARTNER_ID: "PARTNERFAKE",
  };
});
afterAll(() => mock.close());
beforeEach(() => {
  clearPaypalTokens();
  mock.state.behavior = {};
});

type Handler = (text: string, params: unknown[]) => unknown[];
function ctxWith(handler: Handler, j = job()) {
  const { db, calls } = fakeDb({ query: handler });
  const { log, lines } = captureLog();
  const ctx = jobContext({ db, reg: createRegistry(HANDLERS), env, http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log);
  return { ctx, calls, lines, queries: () => calls.filter((c) => c.fn === "query").map((c) => c.args as [string, unknown[]]) };
}
const v = (x: unknown) => [{ v: x }];

describe("provider helpers", () => {
  it("form-encodes nested Stripe parameters", () => {
    expect(formEncode({ mode: "payment", line_items: [{ price_data: { unit_amount: 2500 } }], metadata: { checkout_id: "x" } })).toBe(
      "mode=payment&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=2500&metadata%5Bcheckout_id%5D=x",
    );
  });
  it("converts money without floating point", () => {
    expect(decimalToCents("12.3")).toBe(1230);
    expect(decimalToCents("0.05")).toBe(5);
    expect(decimalToCents("abc")).toBeNull();
    expect(centsToDecimal(100)).toBe("1.00");
    expect(centsToDecimal(123456)).toBe("1234.56");
  });
  it("picks the method from what the provider reports", () => {
    expect(stripeMethod({ payment_method_details: { type: "card", card: { brand: "visa", last4: "4242", wallet: { type: "apple_pay" } } } }).method).toBe("apple_pay");
    expect(stripeMethod({ payment_method_details: { type: "us_bank_account", us_bank_account: { last4: "6789" } } })).toEqual({ method: "ach", detail: "Bank ••6789" });
    expect(paypalMethod({ venmo: {} })).toBe("venmo");
    expect(paypalMethod(null)).toBe("paypal");
  });
  it("uses the key for the mode, and says which variable is missing", () => {
    expect(stripeKey({ STRIPE_TEST_SECRET_KEY: "sk_test_a" }, "test")).toBe("sk_test_a");
    expect(() => stripeKey({ STRIPE_TEST_SECRET_KEY: "sk_test_a" }, "live")).toThrow(NotConfiguredError);
    expect(() => stripeKey({ STRIPE_SECRET_KEY: "sk_test_a" }, "live")).toThrow(/test key/);
    expect(() => stripeKey({ STRIPE_SECRET_KEY: "sk_live_a" }, "test")).toThrow(/STRIPE_TEST_SECRET_KEY/);
  });
  it("builds the PayPal auth assertion for a merchant", () => {
    const [h, b, sig] = paypalAuthAssertion("client", "MERCHANT1").split(".");
    expect(JSON.parse(Buffer.from(h ?? "", "base64url").toString())).toEqual({ alg: "none" });
    expect(JSON.parse(Buffer.from(b ?? "", "base64url").toString())).toEqual({ iss: "client", payer_id: "MERCHANT1" });
    expect(sig).toBe("");
  });
  it("registers the five payment handlers", () => {
    const kinds = [...createRegistry(HANDLERS).keys()];
    for (const k of ["payments.webhook.stripe", "payments.webhook.paypal", "payments.refund", "payments.test_charge", "payments.sync_payouts"]) expect(kinds).toContain(k);
    expect(stripeHook.configured({})).toMatchObject({ configured: false });
  });
});

describe("connecting", () => {
  it("Stripe: the code becomes tokens in the vault and the connected account", async () => {
    const j = job({ kind: "oauth.exchange", payload: { provider: "stripe", connection_id: "conn1", mode: "test" } });
    const { db, calls } = fakeDb({ secrets: { "conn1/oauth.code": "ac_fake_code_123" } });
    const { log } = captureLog();
    const ctx = jobContext({ db, reg: createRegistry(HANDLERS), env, http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log);
    const out = (await oauth.run(j, ctx)) as Record<string, unknown>;
    expect(String(out.external_account_id)).toMatch(/^acct_mock/);
    expect(calls.filter((c) => c.fn === "storeSecret").map((c) => c.args[2])).toEqual(["access_token", "refresh_token"]);
    const connected = calls.find((c) => c.fn === "query" && String((c.args as unknown[])[0]).includes("worker_connection_connected"));
    const params = (connected!.args as unknown[])[1] as unknown[];
    expect(params[0]).toBe("conn1");
    expect(JSON.parse(String(params[4]))).toMatchObject({ charges_enabled: true });
    expect(JSON.stringify(calls)).not.toContain("ac_fake_code_123");
  });
  it("PayPal: the merchant id is checked with PayPal (partner id) before it counts", async () => {
    const j = job({ kind: "oauth.exchange", payload: { provider: "paypal", connection_id: "conn2", mode: "test" } });
    const { db, calls } = fakeDb({ secrets: { "conn2/oauth.code": "MOCKMERCHANT01" } });
    const { log } = captureLog();
    const ctx = jobContext({ db, reg: createRegistry(HANDLERS), env, http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log);
    const out = (await oauth.run(j, ctx)) as Record<string, unknown>;
    expect(out.external_account_id).toBe("MOCKMERCHANT01");
    expect(mock.state.requests.some((r) => r.path === "/v1/customer/partners/PARTNERFAKE/merchant-integrations/MOCKMERCHANT01")).toBe(true);
    expect(calls.filter((c) => c.fn === "storeSecret")).toHaveLength(0);
  });
});

async function stripeSession(amount: number) {
  // Create a session on the mock the way the portal's intent route does, then "pay" it.
  const res = await fetch(`${mock.base}/v1/checkout/sessions`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "stripe-account": "acct_org" },
    body: formEncode({ mode: "payment", line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amount, product_data: { name: "Gift" } } }], metadata: { checkout_id: CHECKOUT }, success_url: "http://x/ok" }),
  });
  const s = (await res.json()) as { id: string };
  await fetch(`${mock.base}/pay/stripe/${s.id}`, { method: "POST", redirect: "manual" });
  return mock.state.sessions.get(s.id)!;
}

const checkout = (over: Record<string, unknown> = {}) => ({
  id: CHECKOUT, center_id: CENTER, household_id: "h", processor: "stripe", mode: "test", context: "pledges", amount_cents: 2500, currency: "usd",
  status: "pending", provider_ref: "cs", provider_payment_ref: null, payment_id: null, account_id: "acct_org", connect_method: "oauth", payee_email: null, ...over,
});

describe("payments.webhook.stripe", () => {
  it("records a paid checkout with the provider's fee and method, and marks the event processed", async () => {
    const session = await stripeSession(2500);
    const event = { id: "evt_a", type: "checkout.session.completed", account: "acct_org", data: { object: session } };
    const { ctx, queries } = ctxWith((t) => {
      if (t.includes("worker_webhook_event")) return v({ id: "we1", provider: "stripe", event_id: "evt_a", event_type: event.type, center_id: CENTER, payload: event, processed_at: null });
      if (t.includes("worker_checkout(")) return v(checkout());
      if (t.includes("worker_record_online_payment")) return v({ duplicate: false, payment_id: "pay1", checkout_id: CHECKOUT });
      return [];
    });
    const out = (await stripeHook.run(job({ kind: stripeHook.kind, payload: { webhook_event_id: "we1" } }), ctx)) as Record<string, unknown>;
    expect(out.outcome).toBe("payment recorded");
    const rec = queries().find(([t]) => t.includes("worker_record_online_payment"))!;
    expect(rec[1]).toEqual([CHECKOUT, session.payment_intent, 2500, Math.round(2500 * 0.029) + 30, "card", "visa ••4242"]);
    const pi = mock.state.requests.find((r) => r.path === `/v1/payment_intents/${String(session.payment_intent)}`);
    expect(pi?.account).toBe("acct_org");
    expect(queries().some(([t, p]) => t.includes("worker_webhook_done") && p[0] === "we1" && p[1] === CENTER)).toBe(true);
  });
  it("skips an event already processed", async () => {
    const { ctx, queries } = ctxWith((t) => (t.includes("worker_webhook_event") ? v({ id: "we1", event_type: "x", payload: {}, processed_at: "2026-01-01" }) : []));
    expect(await stripeHook.run(job({ payload: { webhook_event_id: "we1" } }), ctx)).toMatchObject({ outcome: "already processed" });
    expect(queries().some(([t]) => t.includes("worker_record_online_payment"))).toBe(false);
  });
  it("flags a refund made in the Stripe dashboard for two approvals instead of recording it (owner decision #6)", async () => {
    const event = { id: "evt_r", type: "charge.refunded", created: 1790000000,
      data: { object: { payment_intent: "pi_x", amount_refunded: 1000, refunds: { data: [{ id: "re_old", created: 1780000000 }, { id: "re_dash", created: 1790000000 }] } } } };
    const { ctx, queries } = ctxWith((t) => {
      if (t.includes("worker_webhook_event")) return v({ id: "we2", event_type: event.type, payload: event, processed_at: null });
      if (t.includes("worker_flag_provider_refund")) return v({ outcome: "flagged", refund_id: "r1", payment_id: "p", amount_cents: 1000, center_id: CENTER });
      return [];
    });
    const out = await stripeHook.run(job({ payload: { webhook_event_id: "we2" } }), ctx);
    expect(out).toMatchObject({ outcome: expect.stringContaining("flagged for approval ($10.00)"), refund_id: "r1" });
    const flag = queries().find(([t]) => t.includes("worker_flag_provider_refund"))!;
    expect(flag[1]).toEqual(["stripe", "pi_x", 1000, "re_dash", "2026-09-21", "charge.refunded"]);
    expect(queries().some(([t]) => t.includes("worker_record_provider_refund"))).toBe(false);
    const done = queries().find(([t]) => t.includes("worker_webhook_done"))!;
    expect(done[0]).toContain("worker_webhook_done($1, null, $2)");
  });
  it("a refund already recorded (ours) or a charge that is not ours changes nothing", async () => {
    const event = { id: "evt_r2", type: "charge.refunded", data: { object: { payment_intent: "pi_y", amount_refunded: 500 } } };
    const { ctx } = ctxWith((t) => {
      if (t.includes("worker_webhook_event")) return v({ id: "we3", event_type: event.type, payload: event, processed_at: null });
      if (t.includes("worker_flag_provider_refund")) return v({ outcome: "already_recorded", payment_id: "p" });
      return [];
    });
    expect(await stripeHook.run(job({ payload: { webhook_event_id: "we3" } }), ctx)).toMatchObject({ outcome: "refund already recorded" });
    const other = ctxWith((t) => {
      if (t.includes("worker_webhook_event")) return v({ id: "we4", event_type: event.type, payload: event, processed_at: null });
      if (t.includes("worker_flag_provider_refund")) return v({ outcome: "not_ours" });
      return [];
    });
    expect(await stripeHook.run(job({ payload: { webhook_event_id: "we4" } }), other.ctx)).toMatchObject({ outcome: "ignored: not a Weaver payment" });
  });
  it("while our own refund is still being recorded the event fails and is retried", async () => {
    const event = { id: "evt_r3", type: "charge.refunded", data: { object: { payment_intent: "pi_z", amount_refunded: 500 } } };
    const { ctx, queries } = ctxWith((t) => {
      if (t.includes("worker_webhook_event")) return v({ id: "we5", event_type: event.type, payload: event, processed_at: null });
      if (t.includes("worker_flag_provider_refund")) throw new Error("A refund Weaver sent to Stripe for this payment is still being recorded");
      return [];
    });
    const err = await stripeHook.run(job({ payload: { webhook_event_id: "we5" } }), ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentError);
    const done = queries().find(([t]) => t.includes("worker_webhook_done"))!;
    expect(String(done[1][1])).toMatch(/still being recorded/);
  });
});

describe("payments.webhook.paypal refunds", () => {
  it("flags a refund made in PayPal for two approvals (owner decision #6)", async () => {
    const event = { id: "WH-R", event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "7RF123", create_time: "2026-09-20T10:00:00Z",
      amount: { value: "15.00" }, seller_payable_breakdown: { total_refunded_amount: { value: "15.00" } },
      links: [{ rel: "up", href: "https://api.paypal.test/v2/payments/captures/CAP-1" }] } };
    const { ctx, queries } = ctxWith((t) => {
      if (t.includes("worker_webhook_event")) return v({ id: "wp1", event_type: event.event_type, payload: event, processed_at: null });
      if (t.includes("worker_flag_provider_refund")) return v({ outcome: "flagged", refund_id: "r2", payment_id: "p", amount_cents: 1500, center_id: CENTER });
      return [];
    });
    expect(await paypalHook.run(job({ payload: { webhook_event_id: "wp1" } }), ctx)).toMatchObject({ outcome: "refund made in PayPal flagged for approval" });
    expect(queries().find(([t]) => t.includes("worker_flag_provider_refund"))![1]).toEqual(["paypal", "CAP-1", 1500, "7RF123", "2026-09-20", "PAYMENT.CAPTURE.REFUNDED"]);
  });
});

describe("payments.webhook.paypal", () => {
  async function approvedOrder(amount: string) {
    const res = await fetch(`${mock.base}/v2/checkout/orders`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ custom_id: CHECKOUT, reference_id: CHECKOUT, amount: { currency_code: "USD", value: amount } }] }),
    });
    const o = (await res.json()) as { id: string };
    await fetch(`${mock.base}/pay/paypal/${o.id}`, { method: "POST", redirect: "manual" });
    return mock.state.orders.get(o.id)!;
  }
  it("captures an approved order and records the capture; a second delivery finds it already captured", async () => {
    const order = await approvedOrder("40.00");
    const event = { id: "WH-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: order.id, purchase_units: order.purchase_units } };
    const handler: Handler = (t) => {
      if (t.includes("worker_webhook_event")) return v({ id: "we3", event_type: event.event_type, payload: event, processed_at: null });
      if (t.includes("worker_checkout(")) return v(checkout({ processor: "paypal", amount_cents: 4000, account_id: "MERCHANT1", connect_method: "partner" }));
      if (t.includes("worker_record_online_payment")) return v({ duplicate: false, payment_id: "pay2" });
      return [];
    };
    const a = ctxWith(handler);
    await paypalHook.run(job({ payload: { webhook_event_id: "we3" } }), a.ctx);
    const rec = a.queries().find(([t]) => t.includes("worker_record_online_payment"))!;
    expect(rec[1][1]).toMatch(/^CAP/);
    expect(rec[1].slice(2)).toEqual([4000, Math.round(4000 * 0.029) + 30, "paypal", null]);
    const cap = mock.state.requests.find((r) => r.path === `/v2/checkout/orders/${String(order.id)}/capture`);
    expect(cap?.idempotency).toBe(`capture-${CHECKOUT}`);
    expect(cap?.authAssertion).toBeTruthy();
    const b = ctxWith(handler);
    await paypalHook.run(job({ payload: { webhook_event_id: "we3" } }), b.ctx);
    expect(b.queries().find(([t]) => t.includes("worker_record_online_payment"))![1][1]).toBe(rec[1][1]);
  });
});

describe("payments.refund and the $1 test", () => {
  it("refunds through Stripe with an idempotency key and records it", async () => {
    const session = await stripeSession(5000);
    const { ctx, queries } = ctxWith((t) => {
      if (t.includes("worker_payment_json")) return v({ id: "pay1", provider: "stripe", provider_ref: session.payment_intent, amount_cents: 5000, refunded_cents: 0, approved: true, mode: "test", connection: { account_id: "acct_org", connect_method: "oauth" } });
      if (t.includes("worker_record_provider_refund")) return v({ duplicate: false, refunded_cents: 2000 });
      return [];
    });
    const out = (await refund.run(job({ payload: { payment_id: "pay1", amount_cents: 2000, refunded_before: 0 } }), ctx)) as Record<string, unknown>;
    expect(String(out.refund_ref)).toMatch(/^re_/);
    const req = mock.state.requests.filter((r) => r.path === "/v1/refunds").pop()!;
    expect(req.idempotency).toBe("refund-pay1-0");
    expect(req.account).toBe("acct_org");
    expect(queries().find(([t]) => t.includes("worker_record_provider_refund"))![1]).toEqual(["pay1", 2000, 0, out.refund_ref]);
  });
  it("never sends a refund without two approvers, and does not repeat an applied one", async () => {
    const a = ctxWith((t) => (t.includes("worker_payment_json") ? v({ id: "p", provider: "stripe", approved: false, refunded_cents: 0 }) : []));
    await expect(refund.run(job({ payload: { payment_id: "p", amount_cents: 100, refunded_before: 0 } }), a.ctx)).rejects.toThrow(/two different approvers/);
    const b = ctxWith((t) => (t.includes("worker_payment_json") ? v({ id: "p", provider: "stripe", approved: true, refunded_cents: 100 }) : []));
    expect(await refund.run(job({ payload: { payment_id: "p", amount_cents: 100, refunded_before: 0 } }), b.ctx)).toEqual({ duplicate: true, refunded_cents: 100 });
  });
  it("says honestly that an email-connected PayPal account cannot be refunded from here", async () => {
    const { ctx } = ctxWith((t) => (t.includes("worker_payment_json") ? v({ id: "p", provider: "paypal", provider_ref: "CAP1", approved: true, refunded_cents: 0, mode: "test", connection: { connect_method: "email", account_id: null } }) : []));
    await expect(refund.run(job({ payload: { payment_id: "p", amount_cents: 100, refunded_before: 0 } }), ctx)).rejects.toThrow(/Business email only.*record it in Giving › Payments/);
  });
  it("refunds the paid $1 test and records it as a passing test", async () => {
    const session = await stripeSession(100);
    const { ctx, queries } = ctxWith((t) => {
      if (t.includes("worker_checkout(")) return v(checkout({ context: "processor_test", amount_cents: 100, household_id: null }));
      if (t.includes("worker_record_processor_test")) return v("test1");
      return [];
    });
    const out = (await testCharge.run(job({ payload: { checkout_id: CHECKOUT, provider_payment_ref: session.payment_intent } }), ctx)) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: true, test_id: "test1" });
    const rec = queries().find(([t]) => t.includes("worker_record_processor_test"))!;
    expect(rec[0]).toContain("$1, true");
    expect(String(rec[1][2])).toMatch(/^re_/);
  });
});

describe("payments.sync_payouts", () => {
  it("brings a payout's gross, fees and net into app.payouts and marks its payments", async () => {
    const session = await stripeSession(10000);
    await fetch(`${mock.base}/__mock/payout`, { method: "POST", body: JSON.stringify({ account: "acct_sync", intents: [session.payment_intent] }) });
    const { ctx, queries } = ctxWith((t) => {
      if (t.includes("worker_payout_accounts")) return [{ v: { center_id: CENTER, processor: "stripe", account_id: "acct_sync", mode: "test" } }];
      if (t.includes("worker_mark_payout_payments")) return v(1);
      return [];
    });
    const out = (await syncPayouts.run(job({ payload: { center_id: CENTER } }), ctx)) as { payouts: Record<string, unknown>[] };
    const fee = Math.round(10000 * 0.029) + 30;
    expect(out.payouts[0]).toMatchObject({ gross_cents: 10000, fee_cents: fee, net_cents: 10000 - fee, payments_marked: 1 });
    const up = queries().find(([t]) => t.includes("worker_upsert_payout"))!;
    expect(up[1].slice(2, 5)).toEqual([10000, fee, 10000 - fee]);
  });
});

// ── The optional Chip In and the covered card fee (docs/PAYMENT_ADDONS.md §5, §8, §10.3) ─────────────────────────────────
// The numbers are the spec's: a $100.00 gift with the card fee covered ($3.30 → $103.30), with a $5.00 Chip In and no covered
// fee ($105.00, Weaver's application fee $4.85), and with both ($3.45 fee, $108.45 charged). The mock charges 2.9% + 30 cents
// on everything charged, takes the application fee out of the connected account and itemises both in fee_details, as Stripe does.
describe("payments.webhook.stripe: the covered card fee and the Chip In", () => {
  type AddOn = { gift: number; fee: number; chip: number; appFee: number };
  const addOn = (a: AddOn, over: Record<string, unknown> = {}) =>
    checkout({
      amount_cents: a.gift + a.fee, gift_cents: a.gift, covered_fee_cents: a.fee, chip_in_cents: a.chip, application_fee_cents: a.appFee,
      total_cents: a.gift + a.fee + a.chip, pay_method: "card", ...over,
    });

  /** A Checkout Session made the way the portal makes it (one line per part of the total), then paid on the mock. */
  async function paidSession(lines: number[], opts: { appFee?: number; methods?: string[] } = {}) {
    const res = await fetch(`${mock.base}/v1/checkout/sessions`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "stripe-account": "acct_org" },
      body: formEncode({
        mode: "payment", payment_method_types: opts.methods ?? ["card"], metadata: { checkout_id: CHECKOUT }, success_url: "http://x/ok",
        line_items: lines.map((cents, i) => ({ quantity: 1, price_data: { currency: "usd", unit_amount: cents, product_data: { name: `line ${i + 1}` } } })),
        payment_intent_data: { metadata: { checkout_id: CHECKOUT }, ...(opts.appFee ? { application_fee_amount: opts.appFee } : {}) },
      }),
    });
    const s = (await res.json()) as { id: string };
    await fetch(`${mock.base}/pay/stripe/${s.id}`, { method: "POST", redirect: "manual" });
    return mock.state.sessions.get(s.id)!;
  }

  /** The database's checks in worker_record_online_payment (0862), in its words, so the worker's handling of a refusal is realistic. */
  const databaseRecords = (k: Record<string, unknown>) => (p: unknown[]) => {
    if (p[2] !== k.total_cents) throw new Error(`Stripe reports ${String(p[2])} cents for checkout ${String(k.id)}, which asked for ${String(k.total_cents)} cents. Not recorded.`);
    if (Number(k.chip_in_cents) > 0 && p[6] !== k.application_fee_cents) {
      throw new Error(`Stripe reports an application fee of ${String(p[6])} cents for checkout ${String(k.id)}, which asked for ${String(k.application_fee_cents)} cents. Not recorded.`);
    }
    if (Number(k.chip_in_cents) === 0 && Number(p[6] ?? 0) !== 0) {
      throw new Error(`Stripe reports an application fee of ${String(p[6])} cents for checkout ${String(k.id)}, which asked for none. Not recorded.`);
    }
    return { duplicate: false, payment_id: "pay1", checkout_id: k.id, gift_cents: k.gift_cents, covered_fee_cents: k.covered_fee_cents, chip_in_cents: k.chip_in_cents };
  };

  async function pay(session: Record<string, unknown>, k: Record<string, unknown>, record: (p: unknown[]) => unknown = databaseRecords(k)) {
    const event = { id: "evt_addon", type: "checkout.session.completed", account: "acct_org", data: { object: session } };
    const { ctx, queries, lines } = ctxWith((t, p) => {
      if (t.includes("worker_webhook_event")) return v({ id: "weA", provider: "stripe", event_id: "evt_addon", event_type: event.type, center_id: CENTER, payload: event, processed_at: null });
      if (t.includes("worker_checkout(")) return v(k);
      if (t.includes("worker_record_online_payment")) return v(record(p));
      return [];
    });
    const result: { out?: Record<string, unknown>; error?: unknown } = await stripeHook
      .run(job({ kind: stripeHook.kind, payload: { webhook_event_id: "weA" } }), ctx)
      .then((r) => ({ out: r as Record<string, unknown> }), (error: unknown) => ({ error }));
    const rec = queries().find(([t]) => t.includes("worker_record_online_payment"));
    const done = queries().find(([t]) => t.includes("worker_webhook_done"));
    return { ...result, rec, done, lines };
  }

  it("a gift only is recorded exactly as before: six arguments, no application fee", async () => {
    const k = addOn({ gift: 10000, fee: 0, chip: 0, appFee: 0 });
    const session = await paidSession([10000]);
    const r = await pay(session, k);
    expect(r.out?.outcome).toBe("payment recorded");
    expect(r.rec?.[1]).toEqual([CHECKOUT, session.payment_intent, 10000, 320, "card", "visa ••4242"]);
    expect(r.out?.fees).toEqual({ fee_cents: 320, processing_fee_cents: 320, application_fee_cents: 0, itemised: true });
  });

  it("a covered card fee: Stripe's fee is the covered fee, so the organization nets exactly the $100.00 gift", async () => {
    const k = addOn({ gift: 10000, fee: 330, chip: 0, appFee: 0 });
    const session = await paidSession([10000, 330]);
    const r = await pay(session, k);
    expect(r.out?.outcome).toBe("payment recorded");
    // total charged $103.30, Stripe's fee $3.30; no application fee, so the call has no seventh argument.
    expect(r.rec?.[1]).toEqual([CHECKOUT, session.payment_intent, 10330, 330, "card", "visa ••4242"]);
    expect(10330 - 330).toBe(10000);
    expect(r.out).toMatchObject({ gift_cents: 10000, covered_fee_cents: 330, chip_in_cents: 0 });
  });

  it("a Chip In without a covered fee: Stripe's fee and Weaver's application fee are recorded apart ($105.00, $3.35, $4.85)", async () => {
    const k = addOn({ gift: 10000, fee: 0, chip: 500, appFee: 485 });
    const session = await paidSession([10000, 500], { appFee: 485 });
    expect(session.payment_intent).toBeTruthy();
    const r = await pay(session, k);
    expect(r.out?.outcome).toBe("payment recorded");
    expect(r.rec?.[1]).toEqual([CHECKOUT, session.payment_intent, 10500, 335, "card", "visa ••4242", 485]);
    // Stripe's balance transaction says fee $8.20 = $3.35 + $4.85; only the $3.35 is the processing fee.
    expect(r.out?.fees).toEqual({ fee_cents: 820, processing_fee_cents: 335, application_fee_cents: 485, itemised: true });
    // The organization nets what it would with no Chip In: $100.00 less the card fee of the gift alone ($3.20).
    expect(10500 - 335 - 485).toBe(10000 - 320);
  });

  it("both: $100.00 gift + $3.45 card fee + $5.00 Chip In = $108.45; the fee recorded is Stripe's $3.45 and the organization nets $100.00", async () => {
    const k = addOn({ gift: 10000, fee: 345, chip: 500, appFee: 500 });
    const session = await paidSession([10000, 345, 500], { appFee: 500 });
    const r = await pay(session, k);
    expect(r.out?.outcome).toBe("payment recorded");
    expect(r.rec?.[1]).toEqual([CHECKOUT, session.payment_intent, 10845, 345, "card", "visa ••4242", 500]);
    expect(r.out?.fees).toEqual({ fee_cents: 845, processing_fee_cents: 345, application_fee_cents: 500, itemised: true });
    expect(10845 - 345 - 500).toBe(10000);
    const pi = mock.state.requests.find((q) => q.path === `/v1/payment_intents/${String(session.payment_intent)}`);
    expect(pi?.account).toBe("acct_org");
    expect(pi?.method).toBe("GET");
  });

  it("the processing fee is the same whether Stripe's `fee` totals the application fee or not (the breakdown decides)", async () => {
    mock.state.behavior = { feeExcludesApplication: true };
    const k = addOn({ gift: 10000, fee: 345, chip: 500, appFee: 500 });
    const session = await paidSession([10000, 345, 500], { appFee: 500 });
    const r = await pay(session, k);
    expect(r.rec?.[1]).toEqual([CHECKOUT, session.payment_intent, 10845, 345, "card", "visa ••4242", 500]);
    expect(r.out?.fees).toMatchObject({ fee_cents: 345, processing_fee_cents: 345, application_fee_cents: 500 });
  });

  it("a bank debit: the bank-debit fee (0.8%) is recorded, the method is ach", async () => {
    const k = addOn({ gift: 10000, fee: 81, chip: 0, appFee: 0 }, { pay_method: "ach" });
    const session = await paidSession([10000, 81], { methods: ["us_bank_account"] });
    const r = await pay(session, k);
    expect(r.out?.outcome).toBe("payment recorded");
    expect(r.rec?.[1]).toEqual([CHECKOUT, session.payment_intent, 10081, 81, "ach", "Bank ••6789"]);
    expect(10081 - 81).toBe(10000);
  });

  it("a charge that is not the checkout's total is not recorded: a permanent failure in plain words, kept on the event", async () => {
    mock.state.behavior = { amountReceived: 10000 };
    const k = addOn({ gift: 10000, fee: 0, chip: 500, appFee: 485 });
    const session = await paidSession([10000, 500], { appFee: 485 });
    const r = await pay(session, k);
    expect(r.out).toBeUndefined();
    expect(r.error).toBeInstanceOf(PermanentError);
    expect(isRetryable(r.error)).toBe(false);
    const message = (r.error as Error).message;
    expect(message).toContain("Stripe charged $100.00");
    expect(message).toContain("asked for $105.00");
    expect(message).toContain(String(session.payment_intent));
    expect(message).toMatch(/NOT recorded.*Stripe dashboard.*Giving › Payments/);
    // the event keeps the reason, not a success mark
    expect(r.done?.[0]).toContain("worker_webhook_done($1, $2, null)");
    expect(String(r.done?.[1][1])).toContain("Stripe charged $100.00");
    expect(r.lines.find((l) => String(l.msg).includes("NOT recorded"))).toMatchObject({ level: "error", charged_cents: 10000 });
  });

  it("an application fee that is not the one the checkout asked for is not recorded either", async () => {
    mock.state.behavior = { applicationFee: 400 };
    const k = addOn({ gift: 10000, fee: 0, chip: 500, appFee: 485 });
    const session = await paidSession([10000, 500], { appFee: 485 });
    const r = await pay(session, k);
    expect(r.error).toBeInstanceOf(PermanentError);
    expect((r.error as Error).message).toContain("application fee of $4.00");
    expect((r.error as Error).message).toContain("asked for $4.85");
    expect(String(r.done?.[1][1])).toContain("application fee of $4.00");
  });

  it("an application fee on a charge that asked for none is reported to the database, which refuses it", async () => {
    mock.state.behavior = { applicationFee: 100 };
    const k = addOn({ gift: 10000, fee: 0, chip: 0, appFee: 0 });
    const session = await paidSession([10000]);
    const r = await pay(session, k);
    expect(r.rec?.[1].slice(6)).toEqual([100]);
    expect(r.error).toBeInstanceOf(PermanentError);
  });

  it("an error the database raises for another reason stays what it was (and is retried)", async () => {
    const k = addOn({ gift: 10000, fee: 0, chip: 0, appFee: 0 });
    const session = await paidSession([10000]);
    const r = await pay(session, k, () => { throw new Error("connection reset"); });
    expect(r.error).not.toBeInstanceOf(PermanentError);
    expect((r.error as Error).message).toBe("connection reset");
  });

  it("without Stripe's fee breakdown a gift still records as before; with a Chip In or a covered fee it waits and is retried, never guessed", async () => {
    mock.state.behavior = { omitFeeDetails: true };
    const plain = addOn({ gift: 10000, fee: 0, chip: 0, appFee: 0 });
    const s1 = await paidSession([10000]);
    const a = await pay(s1, plain);
    expect(a.rec?.[1]).toEqual([CHECKOUT, s1.payment_intent, 10000, 320, "card", "visa ••4242"]);
    expect(a.out?.fees).toMatchObject({ itemised: false });

    const chip = addOn({ gift: 10000, fee: 0, chip: 500, appFee: 485 });
    const s2 = await paidSession([10000, 500], { appFee: 485 });
    const b = await pay(s2, chip);
    expect(b.rec).toBeUndefined();
    expect(b.error).toBeInstanceOf(Error);
    expect(isRetryable(b.error)).toBe(true);
    expect((b.error as Error).message).toMatch(/no fee breakdown.*application fee/);
  });

  it("a second delivery of the same event asks the database again with the same payment reference, which answers 'already recorded'", async () => {
    const k = addOn({ gift: 10000, fee: 345, chip: 500, appFee: 500 });
    const session = await paidSession([10000, 345, 500], { appFee: 500 });
    const first = await pay(session, k);
    const second = await pay(session, k, () => ({ duplicate: true, payment_id: "pay1", checkout_id: CHECKOUT }));
    expect(first.out?.outcome).toBe("payment recorded");
    expect(second.out?.outcome).toBe("already recorded");
    expect(second.rec?.[1]).toEqual(first.rec?.[1]);
  });

  it("an unpaid session that expires closes the checkout as expired, which releases the Chip In reservation in the database", async () => {
    const res = await fetch(`${mock.base}/v1/checkout/sessions`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "stripe-account": "acct_org" },
      body: formEncode({
        mode: "payment", payment_method_types: ["card"], metadata: { checkout_id: CHECKOUT }, success_url: "http://x/ok",
        line_items: [10000, 500].map((cents) => ({ quantity: 1, price_data: { currency: "usd", unit_amount: cents, product_data: { name: "x" } } })),
        payment_intent_data: { application_fee_amount: 485 }, expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    });
    const s = (await res.json()) as { id: string };
    const expired = (await fetch(`${mock.base}/__mock/expire/${s.id}`, { method: "POST" }).then((r) => r.json())) as { event: Record<string, unknown> };
    expect(expired.event.type).toBe("checkout.session.expired");
    const event = expired.event as { id: string; type: string; data: { object: Record<string, unknown> } };
    const { ctx, queries } = ctxWith((t) => {
      if (t.includes("worker_webhook_event")) return v({ id: "weE", provider: "stripe", event_id: event.id, event_type: event.type, center_id: CENTER, payload: event, processed_at: null });
      if (t.includes("worker_checkout(")) return v(addOn({ gift: 10000, fee: 0, chip: 500, appFee: 485 }));
      return [];
    });
    const out = await stripeHook.run(job({ kind: stripeHook.kind, payload: { webhook_event_id: "weE" } }), ctx);
    expect(out).toMatchObject({ outcome: "checkout expired" });
    expect(queries().find(([t]) => t.includes("worker_checkout_closed"))![1]).toEqual([CHECKOUT, "expired", "The checkout expired before it was paid."]);
    expect(queries().some(([t]) => t.includes("worker_record_online_payment"))).toBe(false);
    // an expired session cannot be paid
    const late = await fetch(`${mock.base}/pay/stripe/${s.id}`, { method: "POST", redirect: "manual" });
    expect(late.status).toBe(410);
  });

  it("a failed bank payment and a declined card close the checkout as failed, with the reason", async () => {
    const asyncFailed = { id: "evt_f1", type: "checkout.session.async_payment_failed", account: "acct_org", data: { object: { id: "cs_x", metadata: { checkout_id: CHECKOUT } } } };
    const declined = { id: "evt_f2", type: "payment_intent.payment_failed", account: "acct_org", data: { object: { id: "pi_x", metadata: { checkout_id: CHECKOUT }, last_payment_error: { message: "Your card was declined." } } } };
    for (const [event, reason, outcome] of [[asyncFailed, "The bank payment failed.", "checkout failed"], [declined, "Your card was declined.", "checkout failed"]] as const) {
      const { ctx, queries } = ctxWith((t) => {
        if (t.includes("worker_webhook_event")) return v({ id: "weF", provider: "stripe", event_id: event.id, event_type: event.type, center_id: CENTER, payload: event, processed_at: null });
        if (t.includes("worker_checkout(")) return v(addOn({ gift: 10000, fee: 0, chip: 500, appFee: 485 }));
        return [];
      });
      expect(await stripeHook.run(job({ kind: stripeHook.kind, payload: { webhook_event_id: "weF" } }), ctx)).toMatchObject({ outcome });
      expect(queries().find(([t]) => t.includes("worker_checkout_closed"))![1]).toEqual([CHECKOUT, "failed", reason]);
    }
  });

  it("the database's refusal wording is the wording the worker recognises (0862 raises '... Not recorded.')", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/0862_fee_cover_and_checkout_addons.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/reports % cents for checkout %, which asked for % cents\. Not recorded\./);
    expect(sql).toMatch(/reports an application fee of % cents for checkout %, which asked for % cents\. Not recorded\./);
    expect(sql).toMatch(/reports an application fee of % cents for checkout %, which asked for none\. Not recorded\./);
    const k = checkout({ total_cents: 10500, application_fee_cents: 485, chip_in_cents: 500 }) as never;
    expect(recordingProblem(new Error("Stripe reports 1 cents for checkout c, which asked for 10500 cents. Not recorded."), k, "pi_1", 1, 0)).toBeInstanceOf(PermanentError);
    expect(recordingProblem(new Error("connection reset"), k, "pi_1", 1, 0)).toEqual(new Error("connection reset"));
  });
});

describe("splitStripeFees", () => {
  it("separates Stripe's processing fee from Weaver's application fee, whether or not `fee` totals both", () => {
    const details = [{ amount: 345, type: "stripe_fee" }, { amount: 500, type: "application_fee" }];
    expect(splitStripeFees({ fee: 845, fee_details: details })).toEqual({ feeCents: 845, processingCents: 345, applicationCents: 500, itemised: true, byType: { stripe_fee: 345, application_fee: 500 } });
    expect(splitStripeFees({ fee: 345, fee_details: details })).toMatchObject({ feeCents: 345, processingCents: 345, applicationCents: 500 });
  });
  it("counts the other Stripe fees (tax on a fee, a pass-through fee) as processing, because Stripe takes them from the organization", () => {
    const r = splitStripeFees({ fee: 1000, fee_details: [{ amount: 300, type: "stripe_fee" }, { amount: 30, type: "tax" }, { amount: 70, type: "payment_method_passthrough_fee" }, { amount: 600, type: "application_fee" }] });
    expect(r).toMatchObject({ processingCents: 400, applicationCents: 600 });
  });
  it("a gift's plain balance transaction (no breakdown) is its `fee`, as before; nothing at all is zero", () => {
    expect(splitStripeFees({ fee: 320 })).toEqual({ feeCents: 320, processingCents: 320, applicationCents: 0, itemised: false, byType: {} });
    expect(splitStripeFees({})).toMatchObject({ feeCents: 0, processingCents: 0, applicationCents: 0, itemised: false });
  });
});
