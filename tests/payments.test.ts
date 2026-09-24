import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/supabase/proxy";
import { parseStripeSignature, paypalVerifyBody, secretsFrom, stripeSignatureFor, verifyStripeSignature } from "@/lib/payments/signature";
import {
  OFFLINE_METHODS, centsToDecimal, parseIntentRequest, processorStatusView, statementDescriptorProblem, stripePaymentMethodTypes,
} from "@/lib/payments/view";

const H = "11111111-1111-4111-8111-111111111111";

describe("Stripe webhook signatures", () => {
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const now = 1_800_000_000;
  it("accepts a valid signature from any configured secret", () => {
    const sig = stripeSignatureFor("whsec_b", now, body);
    expect(verifyStripeSignature(body, `t=${now},v1=${sig}`, ["whsec_a", "whsec_b"], now)).toEqual({ ok: true });
  });
  it("refuses a changed body, a wrong secret, a stale timestamp and a missing header", () => {
    const sig = stripeSignatureFor("whsec_a", now, body);
    expect(verifyStripeSignature(body + " ", `t=${now},v1=${sig}`, ["whsec_a"], now).ok).toBe(false);
    expect(verifyStripeSignature(body, `t=${now},v1=${sig}`, ["whsec_other"], now).ok).toBe(false);
    expect(verifyStripeSignature(body, `t=${now - 600},v1=${stripeSignatureFor("whsec_a", now - 600, body)}`, ["whsec_a"], now)).toMatchObject({ ok: false, reason: expect.stringContaining("too old") });
    expect(verifyStripeSignature(body, null, ["whsec_a"], now).ok).toBe(false);
  });
  it("parses the header and the secret list", () => {
    expect(parseStripeSignature(`t=5,v1=${"a".repeat(64)},v0=zz`)).toEqual({ t: 5, v1: ["a".repeat(64)] });
    expect(secretsFrom(" whsec_a , ,whsec_b")).toEqual(["whsec_a", "whsec_b"]);
  });
  it("builds PayPal's verification body only when every transmission header is there", () => {
    const h = new Headers({ "paypal-transmission-id": "t1", "paypal-transmission-time": "now", "paypal-transmission-sig": "s", "paypal-cert-url": "u", "paypal-auth-algo": "SHA256withRSA" });
    expect(paypalVerifyBody(h, "WH-1", { id: "e" })).toMatchObject({ transmission_id: "t1", webhook_id: "WH-1", webhook_event: { id: "e" } });
    h.delete("paypal-cert-url");
    expect(paypalVerifyBody(h, "WH-1", {})).toBeNull();
  });
});

describe("payment settings rules", () => {
  it("mirrors the database's statement descriptor rule", () => {
    expect(statementDescriptorProblem("")).toBeNull();
    expect(statementDescriptorProblem("JSH TEMPLE")).toBeNull();
    expect(statementDescriptorProblem("JSH")).toMatch(/at least 5/);
    expect(statementDescriptorProblem("12345")).toMatch(/one letter/);
    expect(statementDescriptorProblem("JSH <TEMPLE>")).toMatch(/cannot contain/);
    expect(statementDescriptorProblem("JAIN SOCIETY OF HOUSTON")).toMatch(/at most 22/);
  });
  it("labels processor states honestly", () => {
    expect(processorStatusView("live")).toEqual({ label: "Live", tone: "ok" });
    expect(processorStatusView("test", "test").label).toBe("Test mode");
    expect(processorStatusView("test", "live").label).toMatch(/not open to members/);
    expect(processorStatusView(null).label).toBe("Not connected");
  });
  it("lists the plan's offline methods", () => {
    expect(OFFLINE_METHODS.map((m) => m.method)).toEqual(["check", "cash", "zelle", "ach", "stock", "daf", "matching_gift"]);
  });
  it("maps methods to Stripe Checkout types and cents to PayPal amounts", () => {
    expect(stripePaymentMethodTypes(["card", "apple_pay", "ach"]).sort()).toEqual(["card", "us_bank_account"]);
    expect(stripePaymentMethodTypes([])).toEqual(["card"]);
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(250100)).toBe("2501.00");
  });
});

describe("the checkout route's input", () => {
  it("accepts a well-formed request and fills safe defaults", () => {
    const r = parseIntentRequest({ center_id: H, household_id: H, amount_cents: 2500, pledge_ids: [H], context: "pledges", for_label: " Pledge P-1 " });
    expect(r).toEqual({ ok: true, value: { center_id: H, household_id: H, amount_cents: 2500, pledge_ids: [H], processor: null, context: "pledges", for_label: "Pledge P-1", return_url: null } });
    const d = parseIntentRequest({ center_id: H, household_id: H, amount_cents: 100, context: "weird", processor: "venmo", return_url: "javascript:x" });
    expect(d.ok && d.value).toMatchObject({ context: "other", processor: null, return_url: null, for_label: "Gift", pledge_ids: [] });
  });
  it("refuses fractional or tiny amounts and bad ids", () => {
    expect(parseIntentRequest({ center_id: H, household_id: H, amount_cents: 12.5 }).ok).toBe(false);
    expect(parseIntentRequest({ center_id: H, household_id: H, amount_cents: 10 }).ok).toBe(false);
    expect(parseIntentRequest({ center_id: "x", household_id: H, amount_cents: 100 }).ok).toBe(false);
    expect(parseIntentRequest({ center_id: H, household_id: H, amount_cents: 100, pledge_ids: ["nope"] }).ok).toBe(false);
  });
  it("webhook and payment routes are reachable without a portal session; OAuth callbacks are not", () => {
    expect(isPublicPath("/api/webhooks/stripe")).toBe(true);
    expect(isPublicPath("/api/payments/intent")).toBe(true);
    expect(isPublicPath("/api/oauth/stripe/callback")).toBe(false);
  });
});
