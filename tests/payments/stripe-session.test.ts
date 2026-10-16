import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The Stripe Checkout Session of docs/PAYMENT_ADDONS.md §8: laid out from the numbers app.create_checkout returned, a DIRECT charge
// on the organization's connected account. The pure layout (planStripeSession) is tested on its own; then the real server module
// (src/lib/payments/server.ts) posts to the local mock Stripe (e2e/mocks/payments-mock.cjs, no network) and what it received is read back.
const values: Record<string, string> = {};
vi.mock("server-only", () => ({}));
vi.mock("@/lib/messaging/server-db", () => ({ workerQuery: vi.fn() }));
vi.mock("@/lib/platform-setup/server-config", () => ({ loadPlatformConfig: async () => {}, platformValue: (n: string) => values[n] ?? "" }));

import { ProviderError, createProviderCheckout } from "@/lib/payments/server";
import { planStripeSession, type CheckoutInfo } from "@/lib/payments/stripe-session";

const require = createRequire(import.meta.url);
const { createPaymentsMock } = require("../../e2e/mocks/payments-mock.cjs") as {
  createPaymentsMock: (o?: Record<string, unknown>) => {
    listen(port?: number): Promise<string>;
    close(): Promise<void>;
    base: string;
    state: {
      requests: { method: string; path: string; account: string | null; idempotency: string | null; auth: string; body: string }[];
      sessions: Map<string, Record<string, unknown>>;
      forms: Map<string, { items: { name: string; description?: string; cents: number }[]; appFee: number | null; form: Record<string, unknown> }>;
    };
  };
};

const CHECKOUT = "11111111-1111-4111-8111-111111111111";
const SUCCESS = "https://portal.example/api/payments/return?checkout=X&result=success";
const CANCEL = "https://portal.example/api/payments/return?checkout=X&result=cancel";

const base: CheckoutInfo = {
  checkout_id: CHECKOUT, processor: "stripe", mode: "test", amount_cents: 2500, currency: "usd", account_id: "acct_org", payee_email: null,
  statement_descriptor: "JSH TEMPLE", methods: ["card", "ach"], center_name: "Jain Society of Houston", for_label: "Pledge P-1",
};

/** What app.create_checkout answers (0862): the numbers, the lines, the session length. */
function checkoutOf(gift: number, fee: number, chip: number, appFee: number, over: Partial<CheckoutInfo> = {}): CheckoutInfo {
  return {
    ...base,
    amount_cents: gift + fee, gift_cents: gift, covered_fee_cents: fee, chip_in_cents: chip, application_fee_cents: appFee, total_cents: gift + fee + chip,
    pay_method: "card", restrict_to_method: fee > 0, fee_rate_id: "rate-1", session_minutes: chip > 0 ? 60 : null,
    lines: [
      { key: "gift", label: "Your gift", cents: gift },
      ...(fee > 0 ? [{ key: "covered_fee", label: "Card fee you chose to cover", cents: fee }] : []),
      ...(chip > 0 ? [{ key: "chip_in", label: "Chip In to Weaver (optional)", cents: chip }] : []),
    ],
    ...over,
  };
}

let mock: ReturnType<typeof createPaymentsMock>;
beforeAll(async () => {
  mock = createPaymentsMock();
  values.STRIPE_API_BASE = await mock.listen(0);
  values.STRIPE_TEST_SECRET_KEY = "sk_test_platform_fake";
});
afterAll(() => mock.close());
afterEach(() => vi.restoreAllMocks());

/**
 * Posts through the real server module and returns the session as the mock stored it, and the body it was sent. Each call is a
 * new checkout (the mock, like Stripe, answers a repeated idempotency key with the first session), unless keepId is set.
 */
async function post(checkout: CheckoutInfo, keepId = false) {
  const c = keepId ? checkout : { ...checkout, checkout_id: randomUUID() };
  const spy = vi.spyOn(globalThis, "fetch");
  spy.mockClear();
  const out = await createProviderCheckout(c, SUCCESS, CANCEL);
  const sent = spy.mock.calls.find(([u]) => String(u).endsWith("/v1/checkout/sessions"))!;
  const session = mock.state.sessions.get(out.providerRef)!;
  return { out, session, form: mock.state.forms.get(out.providerRef)!, body: String((sent[1] as RequestInit).body), headers: (sent[1] as RequestInit).headers as Record<string, string> };
}

describe("the Stripe Checkout Session: a gift only", () => {
  it("is byte for byte what it was before the add-ons (golden body), a direct charge with the same headers", async () => {
    const r = await post(base, true);
    expect(r.body).toBe(
      "mode=payment&client_reference_id=11111111-1111-4111-8111-111111111111" +
        "&success_url=https%3A%2F%2Fportal.example%2Fapi%2Fpayments%2Freturn%3Fcheckout%3DX%26result%3Dsuccess" +
        "&cancel_url=https%3A%2F%2Fportal.example%2Fapi%2Fpayments%2Freturn%3Fcheckout%3DX%26result%3Dcancel" +
        "&payment_method_types%5B0%5D=card&payment_method_types%5B1%5D=us_bank_account" +
        "&line_items%5B0%5D%5Bquantity%5D=1&line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=usd&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=2500" +
        "&line_items%5B0%5D%5Bprice_data%5D%5Bproduct_data%5D%5Bname%5D=Pledge%20P-1%20%C2%B7%20Jain%20Society%20of%20Houston" +
        "&metadata%5Bcheckout_id%5D=11111111-1111-4111-8111-111111111111" +
        "&payment_intent_data%5Bmetadata%5D%5Bcheckout_id%5D=11111111-1111-4111-8111-111111111111" +
        "&payment_intent_data%5Bstatement_descriptor_suffix%5D=JSH%20TEMPLE",
    );
    expect(r.headers).toMatchObject({ authorization: "Bearer sk_test_platform_fake", "stripe-account": "acct_org", "idempotency-key": `checkout-${CHECKOUT}` });
    expect(r.body).not.toMatch(/application_fee|expires_at/);
    expect(r.session.amount_total).toBe(2500);
  });

  it("is the same for an answer that carries the new fields with nothing in them (gift 25.00, no fee, no Chip In)", async () => {
    const legacy = await post(base);
    const modern = await post(checkoutOf(2500, 0, 0, 0));
    const same = (r: { body: string; session: Record<string, unknown> }) => r.body.replaceAll(String(r.session.client_reference_id), "ID");
    expect(same(modern)).toBe(same(legacy));
  });

  it("the $1 test and an older database answer with an amount only: still one line", async () => {
    const r = await post({ ...base, amount_cents: 100, for_label: "Processor test" });
    expect(r.form.items).toEqual([{ name: "Processor test · Jain Society of Houston", description: undefined, cents: 100 }]);
  });
});

describe("the Stripe Checkout Session: the covered card fee and the Chip In", () => {
  it("a covered fee: two lines (the gift, then the fee), limited to the method the fee was worked out for", async () => {
    const r = await post(checkoutOf(10000, 330, 0, 0));
    expect(r.form.items.map((i) => [i.name, i.cents])).toEqual([["Pledge P-1 · Jain Society of Houston", 10000], ["Card fee you chose to cover", 330]]);
    expect(r.session.amount_total).toBe(10330);
    expect(r.session.payment_method_types).toEqual(["card"]);
    expect(r.form.appFee).toBeNull();
    expect(r.body).not.toMatch(/application_fee|expires_at/);
    expect(r.form.items[1]?.description).toBe("Added so Jain Society of Houston receives your full gift. About what Stripe charges.");
  });

  it("a Chip In: two lines, the application fee on the PaymentIntent, the session expires in an hour, one method", async () => {
    const before = Math.floor(Date.now() / 1000);
    const r = await post(checkoutOf(10000, 0, 500, 485));
    expect(r.form.items.map((i) => [i.name, i.cents])).toEqual([["Pledge P-1 · Jain Society of Houston", 10000], ["Chip In to Weaver (optional)", 500]]);
    expect(r.session.amount_total).toBe(10500);
    expect(r.form.appFee).toBe(485);
    expect(r.body).toContain("payment_intent_data%5Bapplication_fee_amount%5D=485");
    expect(r.session.payment_method_types).toEqual(["card"]);
    const expires = Number(r.session.expires_at);
    expect(expires).toBeGreaterThanOrEqual(before + 3600);
    expect(expires).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 3600);
    expect(r.form.items[1]?.description).toBe("A contribution to Weaver, not a gift to Jain Society of Houston.");
  });

  it("both: the gift, the fee, then the Chip In ($100.00 + $3.45 + $5.00 = $108.45), a direct charge", async () => {
    const r = await post(checkoutOf(10000, 345, 500, 500));
    expect(r.form.items.map((i) => i.cents)).toEqual([10000, 345, 500]);
    expect(r.session.amount_total).toBe(10845);
    expect(r.form.appFee).toBe(500);
    expect(r.headers["stripe-account"]).toBe("acct_org");
    expect(mock.state.requests.filter((q) => q.path === "/v1/checkout/sessions").pop()?.account).toBe("acct_org");
    expect(r.body).toContain("metadata%5Bgift_cents%5D=10000&metadata%5Bcovered_fee_cents%5D=345&metadata%5Bchip_in_cents%5D=500");
  });

  it("a bank debit: the session offers the bank account only, with the bank-debit wording", async () => {
    const r = await post(checkoutOf(10000, 81, 0, 0, { pay_method: "ach", lines: undefined }));
    expect(r.session.payment_method_types).toEqual(["us_bank_account"]);
    expect(r.form.items[1]?.name).toBe("Bank debit fee you chose to cover");
  });

  it("a Chip In without a covered fee still offers only the method its application fee was worked out for", async () => {
    const r = await post(checkoutOf(10000, 0, 500, 485, { pay_method: "ach", restrict_to_method: false }));
    expect(r.session.payment_method_types).toEqual(["us_bank_account"]);
  });

  it("the session length is the one the database gave, within Stripe's 30 minutes to 24 hours", async () => {
    const short = await post(checkoutOf(10000, 0, 500, 485, { session_minutes: 5 }));
    expect(Number(short.session.expires_at) - Math.floor(Date.now() / 1000)).toBeGreaterThan(30 * 60 - 10);
    const long = await post(checkoutOf(10000, 0, 500, 485, { session_minutes: 99999 }));
    expect(Number(long.session.expires_at) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(24 * 3600);
    const none = await post(checkoutOf(10000, 0, 500, 485, { session_minutes: null }));
    expect(Number(none.session.expires_at) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(3600);
  });
});

describe("the Stripe Checkout Session: amounts that do not add up are never sent", () => {
  const refusals: [string, CheckoutInfo][] = [
    ["the organization's charge is not gift + fee", checkoutOf(10000, 330, 0, 0, { amount_cents: 10000 })],
    ["the total is not gift + fee + Chip In", checkoutOf(10000, 345, 500, 500, { total_cents: 10000 })],
    ["an application fee without a Chip In", checkoutOf(10000, 0, 0, 100)],
    ["an application fee as large as the charge", checkoutOf(10000, 0, 500, 10500)],
    ["a fee that is not whole cents", checkoutOf(10000, 3.3, 0, 0, { amount_cents: 10003.3 })],
    ["a covered fee but no method to work it out for", checkoutOf(10000, 330, 0, 0, { pay_method: null })],
  ];
  for (const [why, c] of refusals) {
    it(why, async () => {
      expect(planStripeSession(c, SUCCESS, CANCEL, 1_800_000_000)).toMatchObject({ ok: false, error: expect.stringMatching(/did not add up.*Nothing was charged/) });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const spy = vi.spyOn(globalThis, "fetch");
      await expect(createProviderCheckout(c, SUCCESS, CANCEL)).rejects.toBeInstanceOf(ProviderError);
      expect(spy).not.toHaveBeenCalled();
    });
  }

  it("a checkout with no connected account is refused before anything is built", async () => {
    await expect(createProviderCheckout({ ...base, account_id: null }, SUCCESS, CANCEL)).rejects.toThrow(/not connected/);
  });
});

describe("planStripeSession", () => {
  it("builds the form from the answer alone: expires_at is now + the session minutes", () => {
    const plan = planStripeSession(checkoutOf(10000, 345, 500, 500), SUCCESS, CANCEL, 1_800_000_000);
    expect(plan.ok && plan.params.expires_at).toBe(1_800_000_000 + 3600);
    expect(plan.ok && (plan.params.payment_intent_data as Record<string, unknown>).application_fee_amount).toBe(500);
  });
  it("sends no application fee when the Chip In's fee is zero", () => {
    const plan = planStripeSession(checkoutOf(10000, 0, 100, 0), SUCCESS, CANCEL, 1_800_000_000);
    expect(plan.ok && (plan.params.payment_intent_data as Record<string, unknown>).application_fee_amount).toBeUndefined();
  });
});
