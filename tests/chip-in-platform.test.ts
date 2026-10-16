// The platform team's Chip In and card-fee screens (docs/PAYMENT_ADDONS.md §11.2), the pure rules: dollars become integer cents, the
// validation sentences are the database's own (0861 app._chip_in_write, 0862 app.platform_set_fee_rate), the switch cannot be turned on
// before a limit and a suggestion are saved, the answers of the database are read defensively, and the Home notice for the owner.
import { describe, expect, it } from "vitest";

import { CHIP_IN_NOTICE_DAYS, chipInNotice } from "@/lib/home/notices";
import {
  bpsToPercent,
  canTurnOn,
  dollarsInput,
  isNotSet,
  NOT_SET,
  parseChipInForm,
  parseChipInOverview,
  parseChipInSettingsRow,
  parseChipInSummary,
  parseFeeRateForm,
  parseFeeRateRows,
  parseFeeRates,
  parsePercentToBps,
  rateText,
  savedMessage,
  splitPlatformRates,
  suggestionsText,
  TURN_ON_BLOCKED,
  whoChanged,
} from "@/lib/payments/chip-in-platform";
import { UNEXPECTED_SHAPE } from "@/lib/payments/plugins/view";

const form = (over: Partial<Parameters<typeof parseChipInForm>[0]> = {}) => parseChipInForm({ limit: "50", suggestions: ["2", "5", "10", ""], asking: false, ...over });

describe("the Chip In form: dollars become integer cents", () => {
  it("reads dollars in the ways people type them", () => {
    expect(form()).toEqual({ ok: true, value: { asking: false, limitCents: 5000, suggestedCents: [200, 500, 1000] } });
    expect(form({ limit: "$1,000.00", suggestions: ["1", "$999.99"] })).toEqual({ ok: true, value: { asking: false, limitCents: 100_000, suggestedCents: [100, 99_999] } });
    expect(form({ limit: "12.5", suggestions: ["1.50"] })).toEqual({ ok: true, value: { asking: false, limitCents: 1250, suggestedCents: [150] } });
    expect(form({ limit: "1", suggestions: ["1"] })).toEqual({ ok: true, value: { asking: false, limitCents: 100, suggestedCents: [100] } });
  });

  it("leaves blank boxes out, and saves a blank limit as no limit yet", () => {
    expect(form({ limit: "  ", suggestions: ["", " ", "", ""] })).toEqual({ ok: true, value: { asking: false, limitCents: null, suggestedCents: [] } });
    expect(form({ limit: "", suggestions: ["", "5", "", "10"] })).toMatchObject({ ok: true, value: { limitCents: null, suggestedCents: [500, 1000] } });
  });

  it("refuses a limit outside $1.00 to $1,000.00 with the database's own sentence", () => {
    const sentence = "The yearly limit per account is between $1.00 and $1,000.00.";
    expect(form({ limit: "0.99" })).toEqual({ ok: false, error: sentence });
    expect(form({ limit: "0" })).toEqual({ ok: false, error: sentence });
    expect(form({ limit: "1000.01" })).toEqual({ ok: false, error: sentence });
    expect(form({ limit: "10000" })).toEqual({ ok: false, error: sentence });
  });

  it("refuses text that is not dollars, and more than two decimals, in words", () => {
    expect(form({ limit: "fifty" })).toEqual({ ok: false, error: "Enter the yearly limit as dollars, for example 50 or 50.00." });
    expect(form({ limit: "50.123" })).toEqual({ ok: false, error: "Enter the yearly limit as dollars, for example 50 or 50.00." });
    expect(form({ limit: "-5" })).toEqual({ ok: false, error: "Enter the yearly limit as dollars, for example 50 or 50.00." });
    expect(form({ suggestions: ["2", "five"] })).toEqual({ ok: false, error: "Suggested amount 2 is not an amount in dollars, for example 5 or 5.00." });
    expect(form({ suggestions: ["", "", "3.999"] })).toEqual({ ok: false, error: "Suggested amount 3 is not an amount in dollars, for example 5 or 5.00." });
  });

  it("refuses suggestions under $1.00, over the limit, out of order or repeated, and more than four", () => {
    expect(form({ suggestions: ["0.50"] })).toEqual({ ok: false, error: "Each suggested amount is at least $1.00." });
    expect(form({ suggestions: ["5", "60"] })).toEqual({ ok: false, error: "A suggested amount cannot be more than the yearly limit." });
    expect(form({ limit: "", suggestions: ["5", "1000.01"] })).toEqual({ ok: false, error: "A suggested amount cannot be more than $1,000.00." });
    expect(form({ suggestions: ["10", "5"] })).toEqual({ ok: false, error: "List the suggested amounts from the smallest to the largest, each different." });
    expect(form({ suggestions: ["5", "5"] })).toEqual({ ok: false, error: "List the suggested amounts from the smallest to the largest, each different." });
    expect(form({ suggestions: ["1", "2", "3", "4", "5"] })).toEqual({ ok: false, error: "Suggest at most four amounts." });
  });

  it("asking needs a limit and at least one suggested amount, and says which", () => {
    expect(form({ asking: true })).toMatchObject({ ok: true, value: { asking: true, limitCents: 5000 } });
    expect(form({ asking: true, limit: "" })).toEqual({ ok: false, error: "Set the yearly limit per account before asking members for a Chip In." });
    expect(form({ asking: true, suggestions: ["", "", "", ""] })).toEqual({ ok: false, error: "Add at least one suggested amount before asking members for a Chip In." });
    // Not asking, nothing needs to be set yet: the limit and the suggestions are saved first, the switch comes after.
    expect(form({ asking: false, limit: "", suggestions: [] })).toMatchObject({ ok: true, value: { asking: false } });
  });

  it("shows cents as dollars in an input box and in a sentence", () => {
    expect(dollarsInput(5000)).toBe("50.00");
    expect(dollarsInput(150)).toBe("1.50");
    expect(dollarsInput(null)).toBe("");
    expect(suggestionsText([200, 500, 1000])).toBe("$2.00, $5.00 and $10.00");
    expect(suggestionsText([500])).toBe("$5.00");
    expect(suggestionsText([200, 500])).toBe("$2.00 and $5.00");
    expect(suggestionsText([])).toBe("");
  });
});

describe("the switch cannot be turned on until a limit and a suggestion are saved", () => {
  it("is allowed only with both saved", () => {
    expect(canTurnOn(null)).toBe(false);
    expect(canTurnOn(undefined)).toBe(false);
    expect(canTurnOn({ yearlyLimitCents: null, suggestedCents: [] })).toBe(false);
    expect(canTurnOn({ yearlyLimitCents: 5000, suggestedCents: [] })).toBe(false);
    expect(canTurnOn({ yearlyLimitCents: null, suggestedCents: [500] })).toBe(false);
    expect(canTurnOn({ yearlyLimitCents: 5000, suggestedCents: [200, 500, 1000] })).toBe(true);
    expect(TURN_ON_BLOCKED).toBe("A Chip In cannot be turned on until a yearly limit and at least one suggested amount are saved. Save them first, then switch it on.");
  });

  it("reads nothing, or an empty row, as not set", () => {
    expect(isNotSet(null)).toBe(true);
    expect(isNotSet({ yearlyLimitCents: null, suggestedCents: [], asking: false })).toBe(true);
    expect(isNotSet({ yearlyLimitCents: 5000, suggestedCents: [200], asking: false })).toBe(false);
    expect(isNotSet({ yearlyLimitCents: null, suggestedCents: [], asking: true })).toBe(false);
    expect(NOT_SET).toBe("Not set. No Chip In is asked of this organization's members.");
  });

  it("tells the platform admin what a save did", () => {
    expect(savedMessage({ changed: false })).toBe("Nothing changed: these settings were already saved.");
    expect(savedMessage({ changed: true, asking: false })).toBe("Chip In settings saved · nothing is asked of any member while the switch is off · audit logged");
    expect(savedMessage({ changed: true, asking: true, yearly_limit_cents: 5000 })).toBe(
      "Chip In is on for this organization: members are asked for an optional Chip In, up to $50.00 a year each · audit logged",
    );
    expect(savedMessage(null)).toMatch(/^Chip In settings saved/);
  });
});

describe("fee rates: percentages and dollars become basis points and cents", () => {
  it("reads a percentage with at most two decimals", () => {
    expect(parsePercentToBps("2.9")).toBe(290);
    expect(parsePercentToBps("2.90%")).toBe(290);
    expect(parsePercentToBps(" 0.8 % ")).toBe(80);
    expect(parsePercentToBps("2.95")).toBe(295);
    expect(parsePercentToBps("3")).toBe(300);
    expect(parsePercentToBps("10")).toBe(1000);
    expect(parsePercentToBps("0")).toBe(0);
    expect(parsePercentToBps("2.999")).toBeNull();
    expect(parsePercentToBps("-1")).toBeNull();
    expect(parsePercentToBps("two")).toBeNull();
    expect(parsePercentToBps("")).toBeNull();
    expect(parsePercentToBps(null)).toBeNull();
  });

  it("writes them back the way a person says them", () => {
    expect(bpsToPercent(290)).toBe("2.9");
    expect(bpsToPercent(80)).toBe("0.8");
    expect(bpsToPercent(295)).toBe("2.95");
    expect(bpsToPercent(300)).toBe("3");
    expect(bpsToPercent(5)).toBe("0.05");
    expect(rateText({ bps: 290, fixedCents: 30, capCents: null })).toBe("2.9% + $0.30");
    expect(rateText({ bps: 80, fixedCents: 0, capCents: 500 })).toBe("0.8%, never more than $5.00");
    expect(rateText({ bps: 220, fixedCents: 30, capCents: 1000 })).toBe("2.2% + $0.30, never more than $10.00");
  });

  const rate = (over: Partial<Parameters<typeof parseFeeRateForm>[0]> = {}) =>
    parseFeeRateForm({ methodClass: "card", percent: "2.2", fixed: "0.30", cap: "", note: "approved nonprofit pricing, letter of 2026-11-02", ...over });

  it("turns the form into basis points and integer cents", () => {
    expect(rate()).toEqual({ ok: true, value: { methodClass: "card", bps: 220, fixedCents: 30, capCents: null, sourceNote: "approved nonprofit pricing, letter of 2026-11-02" } });
    expect(rate({ methodClass: "ach", percent: "0.8", fixed: "", cap: "5" })).toEqual({
      ok: true,
      value: { methodClass: "ach", bps: 80, fixedCents: 0, capCents: 500, sourceNote: "approved nonprofit pricing, letter of 2026-11-02" },
    });
  });

  it("refuses with the database's sentences", () => {
    expect(rate({ methodClass: "paypal" })).toEqual({ ok: false, error: "Choose card or bank debit." });
    expect(rate({ percent: "" })).toEqual({ ok: false, error: "Enter the percentage Stripe charges, for example 2.9." });
    expect(rate({ percent: "2.999" })).toMatchObject({ ok: false, error: expect.stringMatching(/at most two decimals/) });
    expect(rate({ percent: "10.01" })).toEqual({ ok: false, error: "The percentage is between 0% and 10%." });
    expect(rate({ fixed: "1.01" })).toEqual({ ok: false, error: "The fixed part is between $0.00 and $1.00." });
    expect(rate({ fixed: "thirty" })).toEqual({ ok: false, error: "Enter the fixed part as dollars, for example 0.30." });
    expect(rate({ cap: "0" })).toEqual({ ok: false, error: "The cap is between $0.01 and $1,000.00." });
    expect(rate({ cap: "1000.01" })).toEqual({ ok: false, error: "The cap is between $0.01 and $1,000.00." });
    expect(rate({ cap: "five" })).toEqual({ ok: false, error: "Enter the cap as dollars, for example 5.00, or leave it empty for no cap." });
    expect(rate({ note: "  " })).toEqual({ ok: false, error: 'Say where this rate comes from (for example "approved nonprofit pricing, letter of 2026-11-02").' });
    expect(rate({ note: "x".repeat(501) })).toEqual({ ok: false, error: "Keep the note under 500 characters." });
  });
});

describe("the answers of the database are read defensively", () => {
  it("app.chip_in_overview: live and test apart, no names", () => {
    const answer = {
      center_id: "c1",
      calendar_year: 2026,
      asking: true,
      yearly_limit_cents: 5000,
      live: { accounts: 4, collected_cents: 12_500, refunded_cents: 500, in_flight_cents: 200, accounts_at_limit: 1 },
      test: { accounts: 1, collected_cents: 1000, refunded_cents: 0, in_flight_cents: 0, accounts_at_limit: 0 },
    };
    expect(parseChipInOverview(answer)).toEqual({
      ok: true,
      value: {
        calendarYear: 2026,
        asking: true,
        yearlyLimitCents: 5000,
        live: { accounts: 4, collectedCents: 12_500, refundedCents: 500, inFlightCents: 200, accountsAtLimit: 1 },
        test: { accounts: 1, collectedCents: 1000, refundedCents: 0, inFlightCents: 0, accountsAtLimit: 0 },
      },
    });
    expect(parseChipInOverview({ ...answer, yearly_limit_cents: null })).toMatchObject({ ok: true, value: { yearlyLimitCents: null } });
    expect(parseChipInOverview({ ...answer, test: null })).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parseChipInOverview({ ...answer, live: { accounts: "4" } })).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parseChipInOverview(null)).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
  });

  it("app.payment_fee_rates_for: standard and custom rows, a class may be missing", () => {
    const standard = { bps: 290, fixed_cents: 30, cap_cents: null, custom: false, effective_from: "2020-01-01T00:00:00Z", source_note: "Stripe US standard pricing" };
    const parsed = parseFeeRates({ card: standard, ach: { bps: 80, fixed_cents: 0, cap_cents: 500, custom: true, effective_from: "2026-11-02T10:00:00Z", source_note: "approved nonprofit pricing" } });
    expect(parsed).toEqual({
      ok: true,
      value: {
        card: { bps: 290, fixedCents: 30, capCents: null, custom: false, effectiveFrom: "2020-01-01T00:00:00Z", sourceNote: "Stripe US standard pricing" },
        ach: { bps: 80, fixedCents: 0, capCents: 500, custom: true, effectiveFrom: "2026-11-02T10:00:00Z", sourceNote: "approved nonprofit pricing" },
      },
    });
    expect(parseFeeRates({ card: standard })).toMatchObject({ ok: true, value: { card: { bps: 290 } } });
    expect(parseFeeRates({})).toEqual({ ok: true, value: {} });
    expect(parseFeeRates({ card: { ...standard, bps: "290" } })).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parseFeeRates("nope")).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
  });

  it("app.chip_in_settings rows: none is not an error; a wrong shape is", () => {
    expect(parseChipInSettingsRow(null)).toEqual({ ok: true, value: null });
    expect(
      parseChipInSettingsRow({ asking: false, yearly_limit_cents: 5000, suggested_cents: [200, 500, 1000], reason: "Owner decision", updated_by: null, updated_at: "2026-10-15T12:00:00Z" }),
    ).toEqual({ ok: true, value: { asking: false, yearlyLimitCents: 5000, suggestedCents: [200, 500, 1000], reason: "Owner decision", updatedBy: null, updatedAt: "2026-10-15T12:00:00Z" } });
    expect(parseChipInSettingsRow({ asking: "no", suggested_cents: [], updated_at: "x" })).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parseChipInSettingsRow({ asking: false, yearly_limit_cents: null, suggested_cents: ["2"], updated_at: "x" })).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
  });

  it("app.chip_in_summary: what the organization may read", () => {
    expect(parseChipInSummary({ configured: true, asking: true, yearly_limit_cents: 5000, suggested_cents: [200], updated_at: "2026-10-20T10:00:00Z" })).toEqual({
      ok: true,
      value: { configured: true, asking: true, yearlyLimitCents: 5000, suggestedCents: [200], updatedAt: "2026-10-20T10:00:00Z" },
    });
    expect(parseChipInSummary({ configured: false, asking: false, yearly_limit_cents: null, suggested_cents: [], updated_at: null })).toMatchObject({ ok: true, value: { configured: false, updatedAt: null } });
    expect(parseChipInSummary({ configured: "yes" })).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
  });

  it("app.payment_fee_rates rows: the one in force is the newest that has started; the rest are earlier", () => {
    const rows = parseFeeRateRows([
      { id: "r3", method_class: "card", bps: 270, fixed_cents: 30, cap_cents: null, effective_from: "2027-01-01T00:00:00Z", source_note: "scheduled", set_by: "u1" },
      { id: "r2", method_class: "card", bps: 280, fixed_cents: 30, cap_cents: null, effective_from: "2026-11-01T00:00:00Z", source_note: "negotiated", set_by: "u1" },
      { id: "r1", method_class: "card", bps: 290, fixed_cents: 30, cap_cents: null, effective_from: "2020-01-01T00:00:00Z", source_note: "standard", set_by: null },
      { id: "a1", method_class: "ach", bps: 80, fixed_cents: 0, cap_cents: 500, effective_from: "2020-01-01T00:00:00Z", source_note: "ACH standard", set_by: null },
    ]);
    if (!rows.ok) throw new Error(rows.error);
    const { effective, earlier } = splitPlatformRates(rows.value, new Date("2026-12-01T00:00:00Z"));
    expect(effective.card).toMatchObject({ bps: 280, sourceNote: "negotiated", custom: false, effectiveFrom: "2026-11-01T00:00:00Z" });
    // A seeded row (nobody set it) has no date worth showing.
    expect(effective.ach).toMatchObject({ bps: 80, capCents: 500, effectiveFrom: null });
    expect(earlier.map((r) => r.id)).toEqual(["r3", "r1"]);
    expect(parseFeeRateRows("no")).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parseFeeRateRows([{ id: "x", method_class: "paypal", bps: 1, fixed_cents: 0, effective_from: "x", source_note: "x" }])).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
  });

  it("says who changed a setting", () => {
    expect(whoChanged(null, "me", null)).toBe("Weaver's team");
    expect(whoChanged("u1", "me", "Priya Shah")).toBe("Priya Shah");
    expect(whoChanged("me", "me", null)).toBe("you");
    expect(whoChanged("u2", "me", null)).toBe("a Weaver platform admin");
  });
});

describe("the Home notice for the organization's owner", () => {
  const TZ = "America/Chicago";
  const NOW = new Date("2026-10-20T15:00:00Z");
  const summary = (over: Partial<Parameters<typeof chipInNotice>[0]> = {}) => ({
    configured: true,
    asking: true,
    yearlyLimitCents: 5000,
    suggestedCents: [200, 500, 1000],
    updatedAt: "2026-10-19T15:00:00Z",
    ...over,
  });

  it("tells the owner members are now asked, in the owner's terms", () => {
    const n = chipInNotice(summary(), NOW, TZ);
    expect(n).toMatchObject({ key: "chip-in-settings", tone: "info", title: "Weaver's team changed your Chip In settings on Oct 19, 2026" });
    expect(n?.lines[0]).toBe("Your members are now asked for an optional Chip In to Weaver when they pay by card or bank debit, up to $50.00 a year each. Suggested amounts: $2.00, $5.00 and $10.00.");
    expect(n?.lines[1]).toMatch(/added on top of what your organization charges and never taken out of it/);
    expect(n?.lines[1]).toMatch(/not a gift to your organization/);
  });

  it("tells the owner nothing is asked while the switch is off", () => {
    const n = chipInNotice(summary({ asking: false }), NOW, TZ);
    expect(n?.lines[0]).toBe("Your members are not asked for a Chip In. The yearly limit per account is set to $50.00. Suggested amounts: $2.00, $5.00 and $10.00.");
    expect(n?.lines[1]).toMatch(/Nothing is added to any payment until Weaver's team switches it on/);
  });

  it(`goes after ${CHIP_IN_NOTICE_DAYS} days, and is not shown when nothing is set`, () => {
    expect(chipInNotice(summary({ updatedAt: "2026-10-07T15:00:00Z" }), NOW, TZ)).not.toBeNull();
    expect(chipInNotice(summary({ updatedAt: "2026-10-05T14:59:00Z" }), NOW, TZ)).toBeNull();
    expect(chipInNotice(summary({ configured: false, yearlyLimitCents: null, suggestedCents: [], asking: false }), NOW, TZ)).toBeNull();
    expect(chipInNotice(summary({ updatedAt: null }), NOW, TZ)).toBeNull();
    expect(chipInNotice(summary({ updatedAt: "not a date" }), NOW, TZ)).toBeNull();
  });
});
