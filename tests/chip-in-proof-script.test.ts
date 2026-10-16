import { describe, expect, it } from "vitest";

import { describeQuote, intentBody, parseArgs, quoteArgs, usd } from "../scripts/chip-in-proof.mjs";

// scripts/chip-in-proof.mjs starts one test-mode payment for the Stripe proof (docs/STRIPE_CHIP_IN_PROOF.md). Only its pure parts are tested:
// what it asks the database and the route, in cents, and that it never works out a fee itself.
const ID = "11111111-1111-4111-8111-111111111111";
const ENV = { SUPABASE_URL: "https://p.supabase.co/", SUPABASE_ANON_KEY: "public-anon", PORTAL_URL: "https://portal.example/" };
const base = ["--email", "m@example.org", "--center", ID, "--household", ID, "--pledge", ID, "--gift", "10000"];

describe("chip-in-proof: the command line", () => {
  it("reads the options and the public addresses (trailing slashes dropped)", () => {
    const r = parseArgs([...base, "--cover-fee", "--chip-in", "500", "--method", "card"], ENV);
    expect(r).toMatchObject({ options: { email: "m@example.org", gift: 10000, coverFee: true, chipIn: 500, method: "card", supabase: "https://p.supabase.co", portal: "https://portal.example", anon: "public-anon" } });
  });
  it("says in a sentence what is wrong", () => {
    expect(parseArgs([...base, "--gift", "12.5"], ENV)).toEqual({ error: "--gift must be at least 50, in whole cents (10000 is $100.00)." });
    expect(parseArgs([...base, "--chip-in", "-5"], ENV)).toMatchObject({ error: expect.stringContaining("--chip-in") });
    expect(parseArgs([...base, "--method", "paypal"], ENV)).toEqual({ error: "--method must be card or ach." });
    expect(parseArgs([...base, "--nope"], ENV)).toEqual({ error: "I do not know --nope." });
    expect(parseArgs([...base, "--chip-in"], ENV)).toEqual({ error: "--chip-in needs a value." });
    expect(parseArgs(["--center", "x"], ENV)).toMatchObject({ error: expect.stringContaining("--center") });
    expect(parseArgs(base, {})).toEqual({ error: "Set PORTAL_URL (or --portal) to the portal's address." });
    expect(parseArgs(base, { PORTAL_URL: "https://p" })).toEqual({ error: "Set SUPABASE_URL and SUPABASE_ANON_KEY (the public ones every app ships)." });
  });
  it("a dry run needs no sign-in details", () => {
    expect(parseArgs(base.filter((x) => x !== "--email" && x !== "m@example.org").concat("--dry-run"), { PORTAL_URL: "https://p" })).toMatchObject({ options: { dryRun: true } });
  });
});

describe("chip-in-proof: what it sends", () => {
  const o = (parseArgs([...base, "--cover-fee", "--chip-in", "500", "--method", "card"], ENV) as { options: never }).options;
  it("asks the database for the quote with only what was chosen", () => {
    expect(quoteArgs(o)).toEqual({
      p_center: ID, p_household: ID, p_gift_cents: 10000, p_pledge_ids: [ID], p_context: "pledges", p_processor: "stripe",
      p_method: "card", p_cover_fee: true, p_chip_in_cents: 500,
    });
    const plain = (parseArgs(base, ENV) as { options: never }).options;
    expect(Object.keys(quoteArgs(plain)).sort()).toEqual(["p_center", "p_context", "p_gift_cents", "p_household", "p_pledge_ids", "p_processor"]);
  });
  it("starts the checkout with the total the quote showed, never one it worked out", () => {
    expect(intentBody(o, { total_cents: 10845 })).toMatchObject({ amount_cents: 10000, cover_fee: true, chip_in_cents: 500, pay_method: "card", expected_total_cents: 10845, processor: "stripe" });
    expect(intentBody(o, null)).not.toHaveProperty("expected_total_cents");
  });
  it("--expect sends a total the quote did not show, to see the database refuse it", () => {
    const r = parseArgs([...base, "--cover-fee", "--expect", "10000"], ENV) as { options: never };
    expect(intentBody(r.options, { total_cents: 10330 })).toMatchObject({ expected_total_cents: 10000 });
    expect(parseArgs([...base, "--expect", "1.5"], ENV)).toEqual({ error: "--expect must be whole cents, 0 or more." });
  });
  it("shows the lines and the total, and anything not offered", () => {
    const text = describeQuote({
      ok: false, mode: "test", pay_method: "card", total_cents: 10845, application_fee_cents: 500, org_charge_cents: 10345,
      lines: [{ key: "gift", label: "Your gift", cents: 10000 }, { key: "covered_fee", label: "Card fee you chose to cover", cents: 345 }, { key: "chip_in", label: "Chip In to Weaver (optional)", cents: 500 }],
      refusals: [{ message: "You have reached this year's Chip In limit.", reason: "limit_reached" }],
    });
    expect(text).toContain("Card fee you chose to cover");
    expect(text).toContain("$108.45");
    expect(text).toContain("application fee on the charge: $5.00");
    expect(text).toContain("NOT OFFERED: You have reached this year's Chip In limit. (limit_reached)");
  });
  it("formats cents without floating point", () => {
    expect([usd(0), usd(5), usd(10845), usd(100000), usd(-250)]).toEqual(["$0.00", "$0.05", "$108.45", "$1000.00", "-$2.50"]);
  });
});
