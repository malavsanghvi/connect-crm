import { describe, expect, it, vi } from "vitest";

import {
  databaseSentence,
  FUND_CLEARED_SENTENCE,
  NO_FUND_SENTENCE,
  parseLevelFees,
  parseLevelRows,
  parseOpenResult,
  parsePayNowReady,
  parseQuote,
  parseSeats,
  parseTermRules,
  refusedLines,
  type LevelRow,
  type TermRulesInput,
} from "@/lib/pathshala-registration/contract";
import { feeExample, loadLevelFees, loadPayNowReady, loadSeats, loadTermRules, openRegistration, saveLevel, setLevelFees, setTermRules } from "@/lib/pathshala-registration/db";
import {
  bandCell,
  buildFeeGroups,
  changedFees,
  exampleOutcome,
  isPathshalaFund,
  joinNames,
  lockedSentence,
  missingFeeNames,
  missingFeesSentence,
  openChecklist,
  savedFeesSentence,
  seatsLabel,
  unpricedOfferedSentence,
} from "@/lib/pathshala-registration/fees";
import {
  ageBandLabel,
  levelAudience,
  levelProblem,
  nextSortOrder,
  normalizeLevelKey,
  parseAgeInput,
  pickableLevels,
  sortTracks,
  suggestLevelKey,
} from "@/lib/pathshala-registration/levels";
import { additionLabel, feeInputValue, feeLabel, formatMoney, parseFeeInput, parseMoneyInput, reductionLabel } from "@/lib/pathshala-registration/money";
import { feeEditing, fundText, payNowBlockedReason, paymentModeSentence, rulesProblem, termBillingPhrase, termStatusLabel } from "@/lib/pathshala-registration/rules";
import { CHECKOUT_CONTEXTS, isCheckoutContext, parseIntentRequest } from "@/lib/payments/view";

const TZ = "America/Chicago";
const level = (over: Partial<LevelRow> & Pick<LevelRow, "id" | "name" | "track_id">): LevelRow => ({ key: over.id, sort_order: 0, min_age: null, max_age: null, active: true, ...over });

describe("Pathshala fees: money in plain words", () => {
  it("shows cents as dollars with two decimals, Free for $0, and the parts of a line with their sign", () => {
    expect(formatMoney(32500)).toBe("$325.00");
    expect(formatMoney(-1300)).toBe("−$13.00");
    expect(feeLabel(0)).toBe("Free");
    expect(feeLabel(13000)).toBe("$130.00");
    expect(feeLabel(null)).toBe("Not set");
    expect(reductionLabel(1250)).toBe("−$12.50");
    expect(reductionLabel(0)).toBe("—");
    expect(additionLabel(2500)).toBe("+$25.00");
    expect(feeInputValue(13000)).toBe("130");
    expect(feeInputValue(4550)).toBe("45.50");
    expect(feeInputValue(0)).toBe("Free");
    expect(feeInputValue(null)).toBe("");
  });

  it("reads a fee box: blank leaves it, Free or 0 is $0, dollars become cents, 1–49 cents and over $1,000,000 are refused in 0590's words", () => {
    expect(parseFeeInput("", "Toddler")).toEqual({ ok: true, cents: null });
    expect(parseFeeInput("free", "Toddler")).toEqual({ ok: true, cents: 0 });
    expect(parseFeeInput("0", "Toddler")).toEqual({ ok: true, cents: 0 });
    expect(parseFeeInput("$45", "Toddler")).toEqual({ ok: true, cents: 4500 });
    expect(parseFeeInput("1,250.5", "Jainism 1")).toEqual({ ok: true, cents: 125050 });
    expect(parseFeeInput("0.25", "Hindi 1")).toEqual({ ok: false, error: "A fee is $0 (Free) or at least $0.50 (Hindi 1 was $0.25)." });
    expect(parseFeeInput("1000000.01", "Hindi 1")).toEqual({ ok: false, error: "A fee can be at most $1,000,000." });
    expect(parseFeeInput("abc", "Hindi 1")).toEqual({ ok: false, error: "The fee for Hindi 1 must be Free or an amount like 130 or 130.50." });
    expect(parseFeeInput("-5", "Hindi 1").ok).toBe(false);
    expect(parseMoneyInput("", "The family cap")).toEqual({ ok: true, cents: null });
    expect(parseMoneyInput("275", "The family cap")).toEqual({ ok: true, cents: 27500 });
    expect(parseMoneyInput("x", "The late fee")).toEqual({ ok: false, error: "The late fee must be an amount like 25 or 25.50." });
  });
});

describe("Pathshala › Levels: age bands and the database's checks", () => {
  it("tells adult classes, children's levels and open levels apart by the band (§2.1, 0590's pathshala_level_band)", () => {
    expect(levelAudience(18, null)).toBe("adult");
    expect(levelAudience(21, 99)).toBe("adult");
    expect(levelAudience(null, 4)).toBe("children");
    expect(levelAudience(8, 10)).toBe("children");
    expect(levelAudience(null, null)).toBe("any");
    expect(levelAudience(12, 25)).toBe("any");
    expect(ageBandLabel(null, null)).toBe("No age band");
    expect(ageBandLabel(8, 10)).toBe("Ages 8–10");
    expect(ageBandLabel(6, 6)).toBe("Age 6");
    expect(ageBandLabel(18, null)).toBe("18 and over");
    expect(ageBandLabel(null, 4)).toBe("Up to age 4");
    expect(bandCell({ min_age: 18, max_age: null })).toBe("Adult class · 18 and over");
    expect(bandCell({ min_age: null, max_age: 4 })).toBe("Children's level · Up to age 4");
    expect(bandCell({ min_age: null, max_age: null })).toBe("No age band");
  });

  it("checks a level in app.save_pathshala_level's words before asking the database", () => {
    const ok = { name: "Jainism 3", key: "3", sort_order: 3, min_age: 8, max_age: 10 };
    expect(levelProblem(ok)).toBeNull();
    expect(levelProblem({ ...ok, min_age: 12, max_age: 10 })).toBe("The minimum age (12) is above the maximum age (10).");
    expect(levelProblem({ ...ok, name: " " })).toBe("Give the level a name.");
    expect(levelProblem({ ...ok, name: "x".repeat(81) })).toBe("A level's name can be at most 80 characters.");
    expect(levelProblem({ ...ok, key: "" })).toBe("A level's key can use letters, digits, - and _ (for example 3 or adult_moms), up to 40 characters.");
    expect(levelProblem({ ...ok, key: "_x" })).toMatch(/^A level's key can use letters/);
    expect(levelProblem({ ...ok, sort_order: 1001 })).toBe("The order must be between -1000 and 1000.");
    expect(parseAgeInput("", "minimum")).toEqual({ ok: true, age: null });
    expect(parseAgeInput("18", "minimum")).toEqual({ ok: true, age: 18 });
    expect(parseAgeInput("121", "maximum")).toEqual({ ok: false, error: "The maximum age must be between 0 and 120 (it is 121)." });
    expect(parseAgeInput("7.5", "minimum")).toEqual({ ok: false, error: "The minimum age must be a whole number." });
  });

  it("suggests a key in the seed's style, keeps - and _ as 0590 allows, and orders tracks and new levels", () => {
    expect(suggestLevelKey("Jainism 8", "Jainism")).toBe("8");
    expect(suggestLevelKey("Adult class (Moms)", "Jainism")).toBe("adult_class_moms");
    expect(suggestLevelKey("Toddler", "Jainism")).toBe("toddler");
    expect(normalizeLevelKey(" Adult Dads! ")).toBe("adult_dads");
    expect(normalizeLevelKey("adult-dads")).toBe("adult-dads");
    expect(normalizeLevelKey("-x_")).toBe("x");
    expect(nextSortOrder([{ sort_order: 3 }, { sort_order: 9 }])).toBe(10);
    expect(nextSortOrder([])).toBe(0);
    const tracks = [
      { key: "hindi", name: "Hindi" },
      { key: "music", name: "Music" },
      { key: "jainism", name: "Jainism" },
      { key: "gujarati", name: "Gujarati" },
    ];
    expect(sortTracks(tracks).map((t) => t.key)).toEqual(["jainism", "gujarati", "hindi", "music"]);
  });

  it("keeps retired levels out of the pickers, except the level a record already has (and every level before 0590)", () => {
    const rows = [
      { id: "j1", active: true },
      { id: "j6", active: false },
      { id: "j7", active: false },
      { id: "old" }, // a database without 0590 has no flag: offered
    ];
    expect(pickableLevels(rows).map((l) => l.id)).toEqual(["j1", "old"]);
    expect(pickableLevels(rows, "j6").map((l) => l.id)).toEqual(["j1", "j6", "old"]);
    expect(pickableLevels(rows, null).map((l) => l.id)).toEqual(["j1", "old"]);
  });
});

describe("Pathshala › Terms › Fees: the table, what is missing and what changed", () => {
  const tracks = [
    { id: "tj", key: "jainism", name: "Jainism" },
    { id: "tg", key: "gujarati", name: "Gujarati" },
  ];
  const levels: LevelRow[] = [
    level({ id: "toddler", name: "Toddler", track_id: "tj", sort_order: 0, max_age: 4 }),
    level({ id: "j1", name: "Jainism 1", track_id: "tj", sort_order: 1 }),
    level({ id: "moms", name: "Adult class (Moms)", track_id: "tj", sort_order: 9, min_age: 18 }),
    level({ id: "j7", name: "Jainism 7", track_id: "tj", sort_order: 7, active: false }),
    level({ id: "j6", name: "Jainism 6", track_id: "tj", sort_order: 6, active: false }),
    level({ id: "g3", name: "Gujarati 3", track_id: "tg", sort_order: 3 }),
    level({ id: "g4", name: "Gujarati 4", track_id: "tg", sort_order: 4 }),
  ];
  const terms = [
    { id: "t26", name: "2026-27", starts_on: "2026-09-06" },
    { id: "t25", name: "2025-26", starts_on: "2025-09-07" },
  ];
  const groups = buildFeeGroups({
    term: { ...terms[0], fee_per_child_cents: 0 },
    terms,
    tracks,
    levels,
    classes: [{ level_id: "toddler" }, { level_id: "j1" }, { level_id: "j1" }, { level_id: "g3" }, { level_id: "j6" }],
    fees: [
      { term_id: "t26", level_id: "toddler", fee_cents: 4500, set_by: null, set_at: null },
      { term_id: "t25", level_id: "j1", fee_cents: 12000, set_by: null, set_at: null },
      { term_id: "t25", level_id: "g3", fee_cents: 13000, set_by: null, set_at: null },
    ],
    seats: [{ level_id: "j1", seats: 40, taken: 12, held: 2, free: 26, waitlist: 0, waitlist_on: true }],
  });

  it("lists active, priced or classed levels by track and order; a retired level with a class is listed but not offered (0590)", () => {
    expect(groups.map((g) => g.track.name)).toEqual(["Jainism", "Gujarati"]);
    expect(groups[0].rows.map((r) => r.level.name)).toEqual(["Toddler", "Jainism 1", "Jainism 6", "Adult class (Moms)"]);
    const j1 = groups[0].rows[1];
    expect(j1).toMatchObject({ offered: true, classes: 2, saved: null, suggestion: { cents: 12000, from: "2025-26" } });
    expect(seatsLabel(j1.seats)).toBe("40 seats · 12 taken · 2 held · 26 free");
    expect(groups[0].rows[0]).toMatchObject({ offered: true, saved: 4500, suggestion: null });
    expect(groups[0].rows[2]).toMatchObject({ offered: false, classes: 1 });
    expect(groups[0].rows[3]).toMatchObject({ offered: false, saved: null, suggestion: null });
  });

  it("names the offered levels without a fee as app.open_pathshala_registration does: by track name, then order (P21)", () => {
    expect(missingFeeNames(groups)).toEqual(["Gujarati 3", "Jainism 1"]);
    expect(missingFeesSentence(["Gujarati 3", "Hindi 1"])).toBe("Set the fee for Gujarati 3 and Hindi 1 before opening registration.");
    expect(missingFeesSentence([])).toBeNull();
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
    expect(unpricedOfferedSentence(["Gujarati 4"], "2026-27")).toBe("Gujarati 4 has a class but no fee for 2026-27 yet, so families cannot choose it.");
  });

  it("sends only the fees that changed (a change after opening needs a reason)", () => {
    const saved = new Map([
      ["toddler", 4500],
      ["j1", 13000],
    ]);
    const entered = new Map<string, number | null>([
      ["toddler", 4500],
      ["j1", 12000],
      ["g3", 0],
      ["g4", null],
    ]);
    expect(changedFees(saved, entered)).toEqual([
      { level_id: "j1", fee_cents: 12000 },
      { level_id: "g3", fee_cents: 0 },
    ]);
  });

  it("offers an earlier term's fee (or the old single fee) only as a suggestion: it is never a saved fee", () => {
    const g = buildFeeGroups({
      term: { ...terms[0], fee_per_child_cents: 15000 },
      terms,
      tracks,
      levels,
      classes: [{ level_id: "toddler" }, { level_id: "g3" }],
      fees: [{ term_id: "t25", level_id: "g3", fee_cents: 13000, set_by: null, set_at: null }],
      seats: null,
    });
    const toddler = g[0].rows.find((r) => r.level.id === "toddler");
    const g3 = g[1].rows.find((r) => r.level.id === "g3");
    expect(toddler).toMatchObject({ saved: null, suggestion: { cents: 15000, from: "the term's earlier single fee" } });
    expect(g3).toMatchObject({ saved: null, suggestion: { cents: 13000, from: "2025-26" } });
    expect(missingFeeNames(g)).toEqual(["Gujarati 3", "Toddler"]);
  });

  it("names every level it saved, and says a change after opening applies to new registrations only", () => {
    const names = new Map([
      ["toddler", "Toddler"],
      ["j1", "Jainism 1"],
      ["g3", "Gujarati 3"],
    ]);
    expect(savedFeesSentence([{ level_id: "toddler", fee_cents: 4500 }], names, "2026-27", "USD", false)).toBe("Fee saved for 2026-27: Toddler $45.00.");
    expect(
      savedFeesSentence(
        [
          { level_id: "toddler", fee_cents: 4500 },
          { level_id: "j1", fee_cents: 13000 },
          { level_id: "g3", fee_cents: 0 },
        ],
        names,
        "2026-27",
        "USD",
        true,
      ),
    ).toBe("Fees saved for 2026-27: Toddler $45.00, Jainism 1 $130.00 and Gujarati 3 Free. The change applies to new registrations only.");
  });

  it("says the seats in one line", () => {
    expect(seatsLabel(null)).toBe("—");
    expect(seatsLabel({ level_id: "x", seats: null, taken: 5, held: 0, free: null, waitlist: 0, waitlist_on: false })).toBe("No limit · 5 taken");
    expect(seatsLabel({ level_id: "x", seats: 10, taken: 10, held: 0, free: 0, waitlist: 3, waitlist_on: true })).toBe("10 seats · 10 taken · Full · 3 waiting");
    expect(seatsLabel({ level_id: "x", seats: 1, taken: 1, held: 0, free: 0, waitlist: 0, waitlist_on: false })).toBe("1 seat · 1 taken · Full · no waitlist");
  });

  it("finds the fund 0590 finds by itself", () => {
    expect(isPathshalaFund({ key: "pathshala", name: "Education" })).toBe(true);
    expect(isPathshalaFund({ key: "edu", name: " Pathshala sponsorship" })).toBe(true);
    expect(isPathshalaFund({ key: "general", name: "General" })).toBe(false);
  });

  it("lists what opening registration still waits for, refusals first", () => {
    const items = openChecklist({
      groups,
      paymentMode: "pay_now",
      payNowBlocked: "Pay at registration waits for fee receipts (P13).",
      givingOn: true,
      fundFound: false,
      membershipRequired: true,
      registrationOpensAt: null,
      registrationClosesAt: "2026-09-02T04:59:00Z",
      tz: TZ,
    });
    expect(items[0]).toEqual({ tone: "bad", text: "Set the fee for Gujarati 3 and Jainism 1 before opening registration." });
    expect(items[1]).toEqual({ tone: "bad", text: "This term is set to “Pay when registering”, which cannot be used yet: Pay at registration waits for fee receipts (P13)." });
    // 0590's sentence word for word, Setup › Lists first (a treasurer without Pathshala access cannot open a draft term).
    expect(items[2]).toEqual({ tone: "bad", text: NO_FUND_SENTENCE });
    expect(NO_FUND_SENTENCE).toBe(
      "There is no fund for the Pathshala fees yet. Ask the treasurer to add a fund called Pathshala in Setup › Lists, or choose a fund on this Fees screen if you also manage Giving; then open registration.",
    );
    expect(items.find((i) => i.text.startsWith("No age band"))?.text).toBe(
      "No age band yet for Jainism 1 and Gujarati 3: the app cannot suggest them by age, or keep adult classes for adults. Set the bands in Pathshala › Levels.",
    );
    expect(items.some((i) => i.text === "Families can register as soon as registration opens until Tue, Sep 1, 11:59 PM. The dates are on the term's form.")).toBe(true);
    expect(items.some((i) => i.text.startsWith("Membership is required"))).toBe(true);
    expect(items.some((i) => i.text.startsWith("Pledges & donations is off"))).toBe(false);

    const none = openChecklist({ groups: [], paymentMode: "pledge", payNowBlocked: "x", givingOn: false, fundFound: false, membershipRequired: false, registrationOpensAt: null, registrationClosesAt: null, tz: TZ });
    expect(none[0].text).toMatch(/^No classes yet: opening now locks the term with no fees to set/);
    expect(none.some((i) => i.text.startsWith("This term is set to"))).toBe(false);
    // With Giving off no fund is needed, and nothing is billed while it is off.
    expect(none.some((i) => i.text === NO_FUND_SENTENCE)).toBe(false);
    expect(none.find((i) => i.text.startsWith("Pledges & donations is off"))?.text).toBe(
      "Pledges & donations is off: registrations are kept and their fees quoted, but nothing is billed while it is off.",
    );
    expect(none.some((i) => i.text.startsWith("No registration dates are set"))).toBe(true);
  });

  it("says when and by whom fees were locked", () => {
    expect(lockedSentence("2026-09-01T15:00:00Z", "Neha Shah", TZ)).toBe("Fees and rules locked on Tue, Sep 1, 2026 by Neha Shah, when registration opened.");
    expect(lockedSentence(null, "x", TZ)).toBeNull();
  });
});

describe("Pathshala term rules: modes, checks, who may change them", () => {
  const rules: TermRulesInput = {
    payment_mode: "pledge",
    hold_hours: 48,
    office_payment_allowed: false,
    office_hold_days: 7,
    seat_rule: "automatic",
    sibling_discount_pct: 10,
    fee_per_family_cap_cents: 27500,
    late_registration_closes_at: null,
    late_fee_cents: 0,
    withdrawal_credit_until: null,
    age_cutoff_on: null,
  };
  const term = { registration_closes_at: "2026-09-02T04:59:00Z", starts_on: "2026-09-06", ends_on: "2027-05-30" };

  it("explains each payment mode in one or two sentences", () => {
    expect(paymentModeSentence("pledge", rules)).toMatch(/^Registering adds the fee to the family's pledges, one per learner\./);
    expect(paymentModeSentence("pay_now", { ...rules, office_payment_allowed: true })).toBe(
      "Families pay online while registering (card, PayPal, Apple Pay or Google Pay). Seats are held 48 hours while they pay, or 7 days when they choose to pay at the office; a seat not paid for in time is released.",
    );
  });

  it("checks the rules in app.set_pathshala_term_rules' words before asking the database", () => {
    expect(rulesProblem(rules, term, TZ)).toBeNull();
    expect(rulesProblem({ ...rules, hold_hours: 0 }, term, TZ)).toBe("A seat is held for 1 to 168 hours (7 days) while the family pays.");
    expect(rulesProblem({ ...rules, office_hold_days: 22 }, term, TZ)).toBe("A seat waiting for payment at the office is held 1 to 21 days.");
    expect(rulesProblem({ ...rules, payment_mode: "pay_now", seat_rule: "office" }, term, TZ)).toBe(
      "The office step works only with Pledge: in a pay-now term the seat is decided when the family registers.",
    );
    expect(rulesProblem({ ...rules, sibling_discount_pct: 101 }, term, TZ)).toBe("The sibling discount is 0 to 100 percent.");
    expect(rulesProblem({ ...rules, fee_per_family_cap_cents: 0 }, term, TZ)).toBe("A family cap is at least $0.50 (at most $1,000,000); leave it empty for no cap.");
    expect(rulesProblem({ ...rules, fee_per_family_cap_cents: null }, term, TZ)).toBeNull();
    expect(rulesProblem({ ...rules, late_fee_cents: 25 }, term, TZ)).toBe("A late fee is $0 or at least $0.50.");
    // A late fee without a late window is allowed: the office registering after registration closes charges it (P4).
    expect(rulesProblem({ ...rules, late_fee_cents: 2500 }, term, TZ)).toBeNull();
    expect(rulesProblem({ ...rules, late_registration_closes_at: "2026-09-01T00:00:00Z" }, term, TZ)).toBe(
      "The late window must end after registration closes (Tue, Sep 1, 11:59 PM).",
    );
    expect(rulesProblem({ ...rules, late_registration_closes_at: "2026-09-15T04:59:00Z", late_fee_cents: 2500 }, term, TZ)).toBeNull();
    expect(rulesProblem({ ...rules, late_registration_closes_at: "2026-09-15T04:59:00Z" }, { ...term, registration_closes_at: null }, TZ)).toBe(
      "Set when registration closes (on the term) before adding a late window.",
    );
    expect(rulesProblem({ ...rules, withdrawal_credit_until: "2027-06-01" }, term, TZ)).toBe("The withdrawal deadline must fall before the term ends (May 30, 2027).");
    expect(rulesProblem({ ...rules, withdrawal_credit_until: "2026-09-20" }, term, TZ)).toBeNull();
    expect(rulesProblem({ ...rules, age_cutoff_on: "2025-09-01" }, term, TZ)).toBe("The age cut-off date must be within a year before the term starts, or during the term.");
    expect(rulesProblem({ ...rules, age_cutoff_on: "2026-09-01" }, term, TZ)).toBeNull();
  });

  it("says why pay when registering cannot be chosen, the database's answer first, never hiding it (P20)", () => {
    expect(payNowBlockedReason({ givingOn: false, ready: { status: "ok", sentence: "Pay at registration needs Pledges & donations switched on (Settings › Modules)." } })).toBe(
      "Pay at registration needs Pledges & donations switched on (Settings › Modules).",
    );
    expect(payNowBlockedReason({ givingOn: false, ready: { status: "missing" } })).toBe("Pay at registration needs Pledges & donations switched on (Settings › Modules).");
    expect(payNowBlockedReason({ givingOn: true, ready: { status: "ok", sentence: null } })).toBeNull();
    expect(payNowBlockedReason({ givingOn: true, ready: { status: "ok", sentence: "Pay at registration waits for fee receipts (P13)." } })).toBe("Pay at registration waits for fee receipts (P13).");
    expect(payNowBlockedReason({ givingOn: true, ready: { status: "missing" } })).toBe("Pay when registering needs the database update that is on its way.");
    expect(payNowBlockedReason({ givingOn: true, ready: { status: "error", reason: "the database could not be reached" } })).toBe(
      "Whether families can pay when registering could not be checked — the database could not be reached.",
    );
  });

  it("follows 0590's lock: before it the principal or the treasurer, after it the treasurer with a reason; a closed term never (P9, P16)", () => {
    const principal = { permissions: ["pathshala.view", "pathshala.manage"], isPlatformAdmin: false };
    const treasurer = { permissions: ["giving.view", "giving.manage"], isPlatformAdmin: false };
    const committee = { permissions: ["pathshala.view"], isPlatformAdmin: false };
    const draft = { status: "draft", fees_locked_at: null };
    const open = { status: "registration", fees_locked_at: "2026-08-01T00:00:00Z" };
    expect(feeEditing(principal, draft)).toMatchObject({ locked: false, canEdit: true, needsReason: false, canOpen: true, canChooseFund: false });
    expect(feeEditing(treasurer, draft)).toMatchObject({ locked: false, canEdit: true, needsReason: false, canOpen: false, canChooseFund: true });
    expect(feeEditing(committee, draft)).toMatchObject({ canEdit: false, canOpen: false });
    expect(feeEditing(principal, open)).toMatchObject({ locked: true, canEdit: false, needsReason: true, canOpen: false });
    expect(feeEditing(principal, open).note).toMatch(/Only the treasurer \(giving\.manage\) can change them now, with a reason/);
    expect(feeEditing(treasurer, open)).toMatchObject({ locked: true, canEdit: true, needsReason: true, canChooseFund: true });
    // A term that left Draft before 0590 is not locked: the principal sets its fees and locks them with Open registration.
    const legacy = feeEditing(principal, { status: "active", fees_locked_at: null });
    expect(legacy).toMatchObject({ locked: false, canEdit: true, canOpen: true });
    expect(legacy.note).toMatch(/^This term left Draft before fees per level existed/);
    expect(feeEditing(treasurer, { status: "closed", fees_locked_at: "2026-08-01T00:00:00Z" })).toMatchObject({ closed: true, canEdit: false, canOpen: false });
  });

  it("names the payment mode on the Classes sub-line and promises no billing (F18: the office's Place still bills nothing)", () => {
    expect(termBillingPhrase({ mode: "pledge", locked: true, givingOn: true })).toBe("fees per level · register now, pay later");
    expect(termBillingPhrase({ mode: "pay_now", locked: true, givingOn: true })).toBe("fees per level · pay when registering");
    for (const mode of ["pledge", "pay_now"] as const) {
      for (const locked of [true, false]) {
        for (const givingOn of [true, false]) {
          expect(termBillingPhrase({ mode, locked, givingOn })).not.toMatch(/added to|pledges when|when a seat|paid online|billed when/);
        }
      }
    }
    expect(termBillingPhrase({ mode: "pledge", locked: true, givingOn: false })).toBe("fees per level, not billed while Pledges & donations is off");
    // Not locked yet: families cannot register with fees, so no billing is promised.
    expect(termBillingPhrase({ mode: "pledge", locked: false, givingOn: true })).toBe("fees per level, not yet locked for registration");
    expect(termBillingPhrase({ mode: null, locked: true, givingOn: true })).toBeNull();
    expect(termStatusLabel("registration")).toBe("Registration open");
    expect(termStatusLabel("weird")).toBe("weird");
  });

  it("says the fund of the fee pledges: found when registration opens, until it has opened; never cleared after", () => {
    const funds = [{ id: "f1", name: "Pathshala" }];
    expect(fundText("f1", funds, false)).toBe("Pathshala");
    expect(fundText("f1", funds, true)).toBe("Pathshala");
    expect(fundText("f9", funds, true)).toBe("A fund chosen by the treasurer");
    expect(fundText(null, funds, false)).toBe("Found when registration opens (the Pathshala fund)");
    expect(fundText(null, funds, true)).toBe("No fund chosen");
    expect(FUND_CLEARED_SENTENCE).toBe("The fund for the Pathshala fees cannot be cleared once registration has opened. Choose another fund instead.");
  });
});

describe("the 0590 contract: reading what the database sends", () => {
  it("reads a term's rules with the plan's defaults and refuses an unknown mode", () => {
    const r = parseTermRules({ id: "t", payment_mode: "pay_now", hold_hours: 24, office_payment_allowed: true, office_hold_days: 5, seat_rule: "automatic", late_fee_cents: 2500 });
    expect(r.ok && r.value).toMatchObject({ term_id: "t", payment_mode: "pay_now", hold_hours: 24, office_payment_allowed: true, office_hold_days: 5, late_fee_cents: 2500, fees_locked_at: null });
    const d = parseTermRules({ id: "t" });
    expect(d.ok && d.value).toMatchObject({ payment_mode: "pledge", hold_hours: 48, office_hold_days: 7, seat_rule: "automatic", late_fee_cents: 0 });
    expect(parseTermRules({ id: "t", payment_mode: "card" })).toEqual({ ok: false, error: 'unknown payment mode "card"' });
  });

  it("reads levels (with 0590's extra keys), fees, seats and the pay-now answer defensively", () => {
    const lv = parseLevelRows([{ id: "l", track_id: "t", track: "Jainism", key: "3", name: "Jainism 3", sort_order: "3", min_age: 8, max_age: null, active: false, band: "any", used: true }]);
    expect(lv.ok && lv.value[0]).toEqual({ id: "l", track_id: "t", key: "3", name: "Jainism 3", sort_order: 3, min_age: 8, max_age: null, active: false });
    expect(parseLevelRows([{ id: "l" }]).ok).toBe(false);
    expect(parseLevelFees([{ term_id: "t", level_id: "l", fee_cents: 4500 }])).toEqual({ ok: true, value: [{ term_id: "t", level_id: "l", fee_cents: 4500, set_by: null, set_at: null }] });
    expect(parseLevelFees([{ term_id: "t", level_id: "l", fee_cents: 45.5 }]).ok).toBe(false);
    // 0590's app.pathshala_seats row.
    const seats = parseSeats([
      { level_id: "l", level: "Jainism 2", track_id: "t", track: "Jainism", fee_cents: 13000, classes: 2, seats: 20, taken: 3, held: 0, free: 17, waitlist: 2, waitlist_on: true, state: "open" },
    ]);
    expect(seats.ok && seats.value[0]).toEqual({ level_id: "l", seats: 20, taken: 3, held: 0, free: 17, waitlist: 2, waitlist_on: true });
    expect(parsePayNowReady(null)).toEqual({ ok: true, value: null });
    expect(parsePayNowReady("Pay at registration waits for fee receipts (P13).")).toEqual({ ok: true, value: "Pay at registration waits for fee receipts (P13)." });
    expect(parsePayNowReady({ ready: true })).toEqual({ ok: true, value: null });
    expect(parsePayNowReady(42).ok).toBe(false);
  });

  it("reads the owner's example family as 0590 prices it (§2.4: $130.00, $117.00, $28.00, $50.00 = $325.00)", () => {
    const q = parseQuote({
      lines: [
        { index: 1, person_id: null, level_id: "j5", learner_kind: "child", family_rank: 1, age_on_cutoff: 12, base_fee_cents: 13000, sibling_discount_cents: 0, cap_reduction_cents: 0, late_fee_cents: 0, assistance_cents: 0, total_cents: 13000, priced: true },
        { index: 2, level_id: "j2", learner_kind: "child", family_rank: 2, age_on_cutoff: 9, base_fee_cents: 13000, sibling_discount_cents: 1300, total_cents: 11700, priced: true },
        { index: 3, level_id: "toddler", learner_kind: "child", family_rank: 3, age_on_cutoff: 4, base_fee_cents: 4500, sibling_discount_cents: 450, cap_reduction_cents: 1250, total_cents: 2800, priced: true },
        { index: 4, level_id: "moms", learner_kind: "adult", family_rank: null, age_on_cutoff: 44, base_fee_cents: 5000, total_cents: 5000, priced: true },
      ],
      children_total_cents: 27500,
      adults_total_cents: 5000,
      total_cents: 32500,
      late: false,
      rule_snapshot: { sibling_discount_pct: 10 },
    });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.value).toMatchObject({ children_total_cents: 27500, adults_total_cents: 5000, total_cents: 32500, late: false });
    expect(q.value.lines[2]).toMatchObject({ index: 3, first_name: null, age_on_cutoff: 4, sibling_discount_cents: 450, cap_reduction_cents: 1250, late_fee_cents: 0, priced: true, refusal: null });
    expect(refusedLines(q.value)).toEqual([]);
    expect(exampleOutcome(q.value)).toEqual({ allPriced: true, text: "Priced as a registration would be." });
    expect(exampleOutcome({ ...q.value, late: true }).text).toBe("Priced as a registration would be, in the late window.");
    expect(parseQuote({ lines: [{ base_fee_cents: 1, total_cents: 1, learner_kind: "teen" }], children_total_cents: 1, adults_total_cents: 0, total_cents: 1 }).ok).toBe(false);
    expect(parseQuote({ total_cents: 1 }).ok).toBe(false);
  });

  it("reads a line the database refused (its sentence, not priced, zero amounts) and never adds the totals up itself", () => {
    const lines = [
      { index: 1, learner: "Riya", learner_kind: "child", family_rank: 1, age_on_cutoff: 12, base_fee_cents: 13000, total_cents: 13000, priced: true, refusal: null },
      { index: 2, learner: "Riya", learner_kind: "child", family_rank: 1, age_on_cutoff: 12, base_fee_cents: 13000, total_cents: 13000, priced: true },
      { index: 3, learner_kind: "adult", base_fee_cents: 0, total_cents: 0, priced: false, refusal: "Jainism 2 is a children's class, and Mira is an adult." },
      { index: 4, priced: false, refusal: "Gujarati 4 has no fee for 2026-27 yet, so it cannot be chosen." },
    ];
    const q = parseQuote({ lines, children_total_cents: 26000, adults_total_cents: 0, total_cents: 26000, late: false });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    // One learner in two classes (the same `learner`): both lines at Riya's rank 1, as 0590 prices them.
    expect(q.value.lines.slice(0, 2).map((l) => [l.first_name, l.family_rank, l.total_cents])).toEqual([
      ["Riya", 1, 13000],
      ["Riya", 1, 13000],
    ]);
    expect(q.value.lines[2]).toMatchObject({ learner_kind: "adult", priced: false, total_cents: 0, refusal: "Jainism 2 is a children's class, and Mira is an adult." });
    expect(q.value.lines[3]).toMatchObject({ learner_kind: null, base_fee_cents: 0, total_cents: 0, priced: false });
    expect(refusedLines(q.value).length).toBe(2);
    expect(q.value.total_cents).toBe(26000);
    expect(exampleOutcome(q.value)).toEqual({ allPriced: false, text: "2 rows could not be priced — see each row." });
    expect(exampleOutcome({ lines: q.value.lines.slice(0, 3), late: false }).text).toBe("1 row could not be priced — see that row.");
    // No totals: a shape problem, never summed here (§2.4: one pricing function).
    expect(parseQuote({ lines: lines.slice(0, 1) })).toEqual({ ok: false, error: "the quote has no totals in whole cents" });
  });

  it("reads what opening registration answers, warnings included", () => {
    expect(
      parseOpenResult({
        term_id: "t",
        status: "registration",
        already_open: false,
        fees_locked_at: "2026-08-01T00:00:00Z",
        warnings: [{ level_id: "l", level: "Jainism 1", sentence: "Jainism 1 has no age band, so the app cannot suggest it by age." }],
      }),
    ).toEqual({
      status: "registration",
      already_open: false,
      fees_locked_at: "2026-08-01T00:00:00Z",
      campaign_id: null,
      fund_id: null,
      warnings: ["Jainism 1 has no age band, so the app cannot suggest it by age."],
    });
    expect(parseOpenResult(null)).toMatchObject({ already_open: false, warnings: [] });
  });

  it("shows the functions' own sentences, never Postgres' wording", () => {
    expect(databaseSentence({ code: "22023", message: "Set the fee for Gujarati 3 and Hindi 1 before opening registration." })).toBe(
      "Set the fee for Gujarati 3 and Hindi 1 before opening registration.",
    );
    expect(databaseSentence({ code: "42501", message: "Registration for 2026-27 is open, so its fees are locked. The treasurer (giving.manage) can change them, with a reason; a change applies to new registrations only." })).toMatch(
      /^Registration for 2026-27 is open/,
    );
    expect(databaseSentence({ code: "42501", message: "permission denied for table pathshala_level_fees" })).toBeNull();
    expect(databaseSentence({ code: "23514", message: 'new row for relation "pathshala_level_fees" violates check constraint' })).toBeNull();
    expect(databaseSentence({ code: "PGRST202", message: "Could not find the function" })).toBeNull();
    expect(databaseSentence("text")).toBeNull();
  });
});

/** A stand-in for the Supabase client: records the calls and answers every one the same way. */
function fakeDb(answer: { data?: unknown; error?: unknown }) {
  const calls: { kind: string; name: string; args?: unknown; filters: unknown[] }[] = [];
  const result = { data: answer.data ?? null, error: answer.error ?? null };
  const db = {
    rpc: vi.fn((name: string, args?: unknown) => {
      calls.push({ kind: "rpc", name, args, filters: [] });
      return Promise.resolve(result);
    }),
    from: vi.fn((name: string) => ({
      select: (columns: string) => {
        const call = { kind: "select", name, args: columns, filters: [] as unknown[] };
        calls.push(call);
        const rows = {
          eq: (c: string, v: string) => (call.filters.push(["eq", c, v]), rows),
          in: (c: string, v: readonly string[]) => (call.filters.push(["in", c, v]), rows),
          order: (c: string) => (call.filters.push(["order", c]), rows),
          then: (ok: (r: typeof result) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad),
        };
        return rows;
      },
    })),
  };
  return { db, calls };
}

describe("the 0590 wrapper: one narrow cast, and an older database said plainly", () => {
  const missing = { code: "PGRST202", message: "Could not find the function app.pathshala_seats(p_term) in the schema cache" };

  it("calls the functions by 0590's names and arguments", async () => {
    const { db, calls } = fakeDb({ data: null });
    const rules: TermRulesInput = {
      payment_mode: "pledge",
      hold_hours: 48,
      office_payment_allowed: false,
      office_hold_days: 7,
      seat_rule: "automatic",
      sibling_discount_pct: 10,
      fee_per_family_cap_cents: null,
      late_registration_closes_at: null,
      late_fee_cents: 0,
      withdrawal_credit_until: null,
      age_cutoff_on: null,
    };
    await saveLevel(db, "c1", { track_id: "t", key: "3", name: "Jainism 3", sort_order: 3, min_age: 8, max_age: 10 }, "New level");
    await saveLevel(db, "c1", { id: "l1", active: false }, null);
    await setLevelFees(db, "term", [{ level_id: "l", fee_cents: 4500 }], null);
    await setTermRules(db, "term", rules, "The committee agreed");
    await openRegistration(db, "term", null);
    await loadPayNowReady(db, "c1");
    await feeExample(db, "term", [{ name: "Riya", learner: "Riya", age: 12, level_id: "l" }]);
    await feeExample(db, "term", [{ name: "Learner 1", age: 12, level_id: "l" }], true);
    expect(calls.map((c) => [c.name, c.args])).toEqual([
      ["save_pathshala_level", { p_center: "c1", p_level: { track_id: "t", key: "3", name: "Jainism 3", sort_order: 3, min_age: 8, max_age: 10 }, p_reason: "New level" }],
      ["save_pathshala_level", { p_center: "c1", p_level: { id: "l1", active: false }, p_reason: null }],
      ["set_pathshala_level_fees", { p_term: "term", p_fees: [{ level_id: "l", fee_cents: 4500 }], p_reason: null }],
      ["set_pathshala_term_rules", { p_term: "term", p_rules: rules, p_reason: "The committee agreed" }],
      ["open_pathshala_registration", { p_term: "term", p_reason: null }],
      ["pathshala_pay_now_ready", { p_center: "c1" }],
      // Always {lines, late}: the screen's tick decides the late window, never today's date.
      ["pathshala_fee_example", { p_term: "term", p_lines: { lines: [{ name: "Riya", learner: "Riya", age: 12, level_id: "l" }], late: false } }],
      ["pathshala_fee_example", { p_term: "term", p_lines: { lines: [{ name: "Learner 1", age: 12, level_id: "l" }], late: true } }],
    ]);
  });

  it("reads the new columns and the fee table through the same client", async () => {
    const { db, calls } = fakeDb({ data: [] });
    expect(await loadTermRules(db, ["t1"])).toEqual({ status: "ok", value: new Map() });
    expect(await loadLevelFees(db, "c1")).toEqual({ status: "ok", value: [] });
    expect(calls[0]).toMatchObject({ name: "pathshala_terms", filters: [["in", "id", ["t1"]]] });
    expect(String(calls[0].args)).toContain("payment_mode");
    expect(calls[1]).toMatchObject({ name: "pathshala_level_fees", args: "term_id, level_id, fee_cents, set_by, set_at", filters: [["eq", "center_id", "c1"]] });
    expect(await loadTermRules(db, [])).toEqual({ status: "ok", value: new Map() });
  });

  it("answers 'missing' for a database without 0590, an error for anything else, and a shape problem for an odd answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadSeats(fakeDb({ error: missing }).db, "t")).toEqual({ status: "missing" });
    expect(await loadLevelFees(fakeDb({ error: { code: "42P01", message: 'relation "app.pathshala_level_fees" does not exist' } }).db, "c")).toEqual({ status: "missing" });
    const denied = { code: "42501", message: "permission denied" };
    expect(await loadSeats(fakeDb({ error: denied }).db, "t")).toEqual({ status: "error", error: denied });
    expect(await loadSeats(fakeDb({ data: "nope" }).db, "t")).toEqual({ status: "shape", message: "the seats are not a list" });
    expect(await setLevelFees(fakeDb({ error: { code: "PGRST202", message: "Could not find the function" } }).db, "t", [], "r")).toMatchObject({ ok: false, missing: true });
    expect(await setLevelFees(fakeDb({ error: { code: "22023", message: "x" } }).db, "t", [], "r")).toMatchObject({ ok: false, missing: false });
    // A write that worked is never reported as failed because of what it answered; the odd answer is logged.
    err.mockClear();
    expect(await saveLevel(fakeDb({ data: "a-uuid" }).db, "c", { track_id: "t", key: "k", name: "N", sort_order: 0, min_age: null, max_age: null }, "r")).toEqual({ ok: true, value: null });
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/save_pathshala_level saved the level but sent an unexpected answer/), "a-uuid");
    // The fee example writes nothing: an answer it cannot read is a failure, said plainly.
    const odd = await feeExample(fakeDb({ data: { lines: "x" } }).db, "t", [{ name: "Riya", age: 12, level_id: "l" }]);
    expect(odd.ok).toBe(false);
    warn.mockRestore();
    err.mockRestore();
  });
});

describe("checkout contexts (F17)", () => {
  const H = "11111111-1111-4111-8111-111111111111";
  it("knows the Pathshala fee context and labels it as a fee, never a gift", () => {
    expect(CHECKOUT_CONTEXTS).toContain("pathshala");
    expect(isCheckoutContext("pathshala")).toBe(true);
    expect(isCheckoutContext("tuition")).toBe(false);
    const r = parseIntentRequest({ center_id: H, household_id: H, amount_cents: 32500, pledge_ids: [H], context: "pathshala" });
    expect(r.ok && r.value).toMatchObject({ context: "pathshala", for_label: "Pathshala fee" });
    const named = parseIntentRequest({ center_id: H, household_id: H, amount_cents: 32500, context: "pathshala", for_label: "Pathshala fee 2026-27 · Riya, Dev" });
    expect(named.ok && named.value.for_label).toBe("Pathshala fee 2026-27 · Riya, Dev");
    const other = parseIntentRequest({ center_id: H, household_id: H, amount_cents: 100, context: "tuition" });
    expect(other.ok && other.value).toMatchObject({ context: "other", for_label: "Gift" });
  });
});
