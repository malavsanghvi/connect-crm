import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/payments/intent (docs/PAYMENT_ADDONS.md §8): the payer's add-on choices go to app.create_checkout unchanged, the route
// calculates nothing, a refused add-on is a plain 409 with its SQLSTATE, and an older app that sends none is served as before.
// The database and Stripe are replaced: what is checked is what the route sends and answers.
const rpc = vi.fn();
vi.mock("@/lib/payments/server", () => ({ tokenClient: () => ({ rpc }), originOf: () => "http://localhost:3000" }));
const startProviderCheckout = vi.fn();
vi.mock("@/lib/payments/checkout", () => ({ startProviderCheckout: (...a: unknown[]) => startProviderCheckout(...a) }));

import { POST } from "@/app/api/payments/intent/route";

const CENTER = "00000000-0000-4000-8000-0000000000aa";
const HOUSEHOLD = "00000000-0000-4000-8000-0000000000bb";
const PLEDGE = "00000000-0000-4000-8000-0000000000cc";
const CHECKOUT = "11111111-1111-4111-8111-111111111111";

const request = (body: unknown, token: string | null = "member-token") =>
  new NextRequest("http://localhost/api/payments/intent", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const gift = { center_id: CENTER, household_id: HOUSEHOLD, amount_cents: 10000, pledge_ids: [PLEDGE], processor: "stripe", context: "pledges", for_label: "Pledge P-1" };

const GIFT_ONLY = { checkout_id: CHECKOUT, processor: "stripe", mode: "test", amount_cents: 10000, currency: "usd", account_id: "acct_org" };
const BOTH = {
  ...GIFT_ONLY, amount_cents: 10345, gift_cents: 10000, covered_fee_cents: 345, chip_in_cents: 500, application_fee_cents: 500, total_cents: 10845,
  pay_method: "card", restrict_to_method: true, session_minutes: 60,
  lines: [{ key: "gift", label: "Your gift", cents: 10000 }, { key: "covered_fee", label: "Card fee you chose to cover", cents: 345 }, { key: "chip_in", label: "Chip In to Weaver (optional)", cents: 500 }],
};

beforeEach(() => {
  rpc.mockReset();
  startProviderCheckout.mockReset();
  startProviderCheckout.mockImplementation(async (_db: unknown, info: { checkout_id: string; mode: string; processor: string }) => ({
    ok: true, checkoutId: info.checkout_id, url: "https://checkout.stripe.test/c/pay/cs_test_1", mode: info.mode, processor: info.processor,
  }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/payments/intent: an app that sends no add-ons", () => {
  it("reaches the database with exactly the seven arguments it always had, and gets the answer it always got", async () => {
    rpc.mockResolvedValue({ data: GIFT_ONLY, error: null });
    const res = await POST(request(gift));
    expect(rpc).toHaveBeenCalledWith("create_checkout", {
      p_center: CENTER, p_household: HOUSEHOLD, p_amount_cents: 10000, p_pledge_ids: [PLEDGE], p_processor: "stripe", p_context: "pledges", p_for_label: "Pledge P-1",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkout_id: CHECKOUT, url: "https://checkout.stripe.test/c/pay/cs_test_1", mode: "test", processor: "stripe" });
  });

  it("is refused without a token, and a malformed add-on is refused before the database is asked", async () => {
    expect((await POST(request(gift, null))).status).toBe(401);
    for (const bad of [{ chip_in_cents: 5.5 }, { chip_in_cents: -1 }, { cover_fee: "yes" }, { pay_method: "paypal" }, { expected_total_cents: "10845" }]) {
      const res = await POST(request({ ...gift, ...bad }));
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/payments/intent: the payer's add-on choices", () => {
  it("passes the covered fee, the Chip In, the method and the total they saw to create_checkout, and builds the page from its answer", async () => {
    rpc.mockResolvedValue({ data: BOTH, error: null });
    const res = await POST(request({ ...gift, cover_fee: true, chip_in_cents: 500, pay_method: "card", expected_total_cents: 10845 }));
    expect(rpc).toHaveBeenCalledWith("create_checkout", {
      p_center: CENTER, p_household: HOUSEHOLD, p_amount_cents: 10000, p_pledge_ids: [PLEDGE], p_processor: "stripe", p_context: "pledges", p_for_label: "Pledge P-1",
      p_cover_fee: true, p_chip_in_cents: 500, p_pay_method: "card", p_expected_total_cents: 10845,
    });
    // the provider page is built from the database's answer, untouched
    expect(startProviderCheckout.mock.calls[0]?.[1]).toBe(BOTH);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ checkout_id: CHECKOUT, gift_cents: 10000, covered_fee_cents: 345, chip_in_cents: 500, total_cents: 10845, pay_method: "card" });
    expect(body.lines).toHaveLength(3);
  });

  it("sends only the choices the payer made (a Chip In alone, an unchecked box is nothing)", async () => {
    rpc.mockResolvedValue({ data: GIFT_ONLY, error: null });
    await POST(request({ ...gift, cover_fee: false, chip_in_cents: 0, pay_method: null, expected_total_cents: null }));
    expect(Object.keys(rpc.mock.calls[0]?.[1] as object).sort()).toEqual(["p_amount_cents", "p_center", "p_context", "p_for_label", "p_household", "p_pledge_ids", "p_processor"]);
    rpc.mockClear();
    await POST(request({ ...gift, chip_in_cents: 200 }));
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_chip_in_cents: 200 });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_cover_fee");
  });
});

describe("POST /api/payments/intent: a refused add-on is a plain 409 and nothing is charged", () => {
  const refuse = (code: string, message: string) => rpc.mockResolvedValue({ data: null, error: { code, message } });

  it("the total changed (CCTOT): review it and try again", async () => {
    refuse("CCTOT", "The total changed from $108.45 to $108.48. Review it and try again.");
    const res = await POST(request({ ...gift, cover_fee: true, chip_in_cents: 500, expected_total_cents: 10845 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Could not start the payment. The total changed from $108.45 to $108.48. Review it and try again. Nothing was charged.",
      code: "CCTOT",
    });
    expect(startProviderCheckout).not.toHaveBeenCalled();
  });

  it("the yearly Chip In limit (CCLIM), a Chip In that is not available (CCCHP) and a covered fee that is not allowed (CCFEE)", async () => {
    refuse("CCLIM", "You have reached this year's Chip In limit.");
    let res = await POST(request({ ...gift, chip_in_cents: 500 }));
    expect([res.status, await res.json()]).toEqual([409, { error: "Could not add a Chip In. You have reached this year's Chip In limit. Nothing was charged.", code: "CCLIM" }]);
    refuse("CCCHP", "A Chip In is not available for this payment.");
    res = await POST(request({ ...gift, chip_in_cents: 500 }));
    expect([res.status, (await res.json()).code]).toEqual([409, "CCCHP"]);
    refuse("CCFEE", "Jain Society does not take a covered card fee on this kind of payment.");
    res = await POST(request({ ...gift, cover_fee: true }));
    expect([res.status, await res.json()]).toEqual([409, { error: "Could not start the payment. Jain Society does not take a covered card fee on this kind of payment. Nothing was charged.", code: "CCFEE" }]);
    expect(startProviderCheckout).not.toHaveBeenCalled();
  });

  it("the other refusals keep their old answers: no permission 403, a validation 400 in the database's words", async () => {
    refuse("42501", "Only an adult of the family can pay for it.");
    expect((await POST(request(gift))).status).toBe(403);
    refuse("22023", "The amount must be at least $0.50.");
    const res = await POST(request(gift));
    expect([res.status, await res.json()]).toEqual([400, { error: "The amount must be at least $0.50." }]);
  });

  it("Stripe refusing the session is reported with the checkout it released", async () => {
    rpc.mockResolvedValue({ data: BOTH, error: null });
    startProviderCheckout.mockResolvedValue({ ok: false, status: 502, error: "Stripe refused the request: no" });
    const res = await POST(request({ ...gift, cover_fee: true, chip_in_cents: 500 }));
    expect([res.status, await res.json()]).toEqual([502, { error: "Stripe refused the request: no", checkout_id: CHECKOUT }]);
  });
});
