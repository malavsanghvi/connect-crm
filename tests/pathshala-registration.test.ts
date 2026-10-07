import { describe, expect, it, vi } from "vitest";

import {
  databaseSentence,
  parseLevelFees,
  parseLevelRows,
  parsePayNowReady,
  parseQuote,
  parseSeats,
  parseTermRules,
  type LevelRow,
  type TermRulesInput,
} from "@/lib/pathshala-registration/contract";
import { feeExample, loadLevelFees, loadPayNowReady, loadSeats, loadTermRules, openRegistration, saveLevel, setLevelFees, setTermRules } from "@/lib/pathshala-registration/db";
import {
  bandCell,
  buildFeeGroups,
  changedFees,
  joinNames,
  lockedSentence,
  missingFeeNames,
  missingFeesSentence,
  openChecklist,
  seatsLabel,
  unpricedOfferedSentence,
} from "@/lib/pathshala-registration/fees";
import { ageBandLabel, levelAudience, levelProblem, nextSortOrder, normalizeLevelKey, parseAgeInput, sortTracks, suggestLevelKey } from "@/lib/pathshala-registration/levels";
import { additionLabel, feeInputValue, feeLabel, formatMoney, parseFeeInput, parseMoneyInput, reductionLabel } from "@/lib/pathshala-registration/money";
import { feeEditing, payNowBlockedReason, paymentModeSentence, rulesProblem, termBillingPhrase, termStatusLabel } from "@/lib/pathshala-registration/rules";
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

  it("reads a fee box: blank leaves it, Free or 0 is $0, dollars become cents, 1–49 cents are refused in the plan's words", () => {
    expect(parseFeeInput("", "Toddler")).toEqual({ ok: true, cents: null });
    expect(parseFeeInput("free", "Toddler")).toEqual({ ok: true, cents: 0 });
    expect(parseFeeInput("0", "Toddler")).toEqual({ ok: true, cents: 0 });
    expect(parseFeeInput("$45", "Toddler")).toEqual({ ok: true, cents: 4500 });
    expect(parseFeeInput("1,250.5", "Jainism 1")).toEqual({ ok: true, cents: 125050 });
    expect(parseFeeInput("0.25", "Hindi 1")).toEqual({ ok: false, error: "The fee for Hindi 1 is $0.25. A fee is Free ($0) or at least $0.50, the smallest online payment." });
    expect(parseFeeInput("abc", "Hindi 1")).toEqual({ ok: false, error: "The fee for Hindi 1 must be Free or an amount like 130 or 130.50." });
    expect(parseFeeInput("-5", "Hindi 1").ok).toBe(false);
    expect(parseMoneyInput("", "The family cap")).toEqual({ ok: true, cents: null });
    expect(parseMoneyInput("275", "The family cap")).toEqual({ ok: true, cents: 27500 });
    expect(parseMoneyInput("x", "The late fee")).toEqual({ ok: false, error: "The late fee must be an amount like 25 or 25.50." });
  });
});

describe("Pathshala › Levels: age bands and the database's checks", () => {
  it("tells adult classes, children's levels and open levels apart by the band (§2.1)", () => {
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

  it("checks a level in the plan's words before asking the database", () => {
    const ok = { name: "Jainism 3", key: "3", sort_order: 3, min_age: 8, max_age: 10 };
    expect(levelProblem(ok)).toBeNull();
    expect(levelProblem({ ...ok, min_age: 12, max_age: 10 })).toBe("The minimum age (12) is above the maximum age (10).");
    expect(levelProblem({ ...ok, name: " " })).toMatch(/^Give the level a name/);
    expect(levelProblem({ ...ok, key: "" })).toMatch(/^Give the level a key/);
    expect(parseAgeInput("", "minimum")).toEqual({ ok: true, age: null });
    expect(parseAgeInput("18", "minimum")).toEqual({ ok: true, age: 18 });
    expect(parseAgeInput("121", "maximum")).toEqual({ ok: false, error: "The maximum age must be a whole number of years from 0 to 120." });
    expect(parseAgeInput("7.5", "minimum").ok).toBe(false);
  });

  it("suggests a key in the seed's style and orders tracks and new levels", () => {
    expect(suggestLevelKey("Jainism 8", "Jainism")).toBe("8");
    expect(suggestLevelKey("Adult class (Moms)", "Jainism")).toBe("adult_class_moms");
    expect(suggestLevelKey("Toddler", "Jainism")).toBe("toddler");
    expect(normalizeLevelKey(" Adult Dads! ")).toBe("adult_dads");
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
    classes: [{ level_id: "toddler" }, { level_id: "j1" }, { level_id: "j1" }, { level_id: "g3" }],
    fees: [
      { term_id: "t26", level_id: "toddler", fee_cents: 4500, set_by: null, set_at: null },
      { term_id: "t25", level_id: "j1", fee_cents: 12000, set_by: null, set_at: null },
      { term_id: "t25", level_id: "g3", fee_cents: 13000, set_by: null, set_at: null },
    ],
    seats: [{ level_id: "j1", seats: 40, taken: 12, held: 2, free: 26, waitlist: 0, waitlist_on: true }],
  });

  it("lists active, offered or priced levels by track and order; a retired level without a class or fee is left out", () => {
    expect(groups.map((g) => g.track.name)).toEqual(["Jainism", "Gujarati"]);
    expect(groups[0].rows.map((r) => r.level.name)).toEqual(["Toddler", "Jainism 1", "Adult class (Moms)"]);
    const j1 = groups[0].rows[1];
    expect(j1).toMatchObject({ offered: true, classes: 2, saved: null, suggestion: { cents: 12000, from: "2025-26" } });
    expect(seatsLabel(j1.seats)).toBe("40 seats · 12 taken · 2 held · 26 free");
    expect(groups[0].rows[0]).toMatchObject({ offered: true, saved: 4500, suggestion: null });
    expect(groups[0].rows[2]).toMatchObject({ offered: false, saved: null, suggestion: null });
  });

  it("names the offered levels without a fee, as the database refuses to open (P21)", () => {
    expect(missingFeeNames(groups)).toEqual(["Jainism 1", "Gujarati 3"]);
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

  it("says the seats in one line", () => {
    expect(seatsLabel(null)).toBe("—");
    expect(seatsLabel({ level_id: "x", seats: null, taken: 5, held: 0, free: null, waitlist: 0, waitlist_on: false })).toBe("No limit · 5 taken");
    expect(seatsLabel({ level_id: "x", seats: 10, taken: 10, held: 0, free: 0, waitlist: 3, waitlist_on: true })).toBe("10 seats · 10 taken · Full · 3 waiting");
    expect(seatsLabel({ level_id: "x", seats: 1, taken: 1, held: 0, free: 0, waitlist: 0, waitlist_on: false })).toBe("1 seat · 1 taken · Full · no waitlist");
  });

  it("lists what opening registration still waits for, refusals first", () => {
    const items = openChecklist({
      groups,
      paymentMode: "pay_now",
      payNowBlocked: "Pay at registration waits for fee receipts (P13).",
      givingOn: false,
      membershipRequired: true,
      registrationOpensAt: null,
      registrationClosesAt: "2026-09-02T04:59:00Z",
      tz: TZ,
    });
    expect(items[0]).toEqual({ tone: "bad", text: "Set the fee for Jainism 1 and Gujarati 3 before opening registration." });
    expect(items[1]).toEqual({ tone: "bad", text: "This term is set to “Pay when registering”, which cannot be used yet: Pay at registration waits for fee receipts (P13)." });
    expect(items.find((i) => i.text.startsWith("No age band"))?.text).toBe(
      "No age band yet for Jainism 1 and Gujarati 3: the app cannot suggest them by age, or keep adult classes for adults. Set the bands in Pathshala › Levels.",
    );
    expect(items.some((i) => i.text === "Families can register as soon as registration opens until Tue, Sep 1, 11:59 PM. The dates are on the term's form.")).toBe(true);
    expect(items.some((i) => i.text.startsWith("Membership is required"))).toBe(true);
    expect(items.some((i) => i.text.startsWith("Pledges & donations is off"))).toBe(true);

    const none = openChecklist({ groups: [], paymentMode: "pledge", payNowBlocked: "x", givingOn: true, membershipRequired: false, registrationOpensAt: null, registrationClosesAt: null, tz: TZ });
    expect(none[0].text).toMatch(/^No classes yet: opening now locks the term with no fees to set/);
    expect(none.some((i) => i.text.startsWith("This term is set to"))).toBe(false);
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
  const term = { registration_closes_at: "2026-09-02T04:59:00Z" };

  it("explains each payment mode in one or two sentences", () => {
    expect(paymentModeSentence("pledge", rules)).toMatch(/^Registering adds the fee to the family's pledges, one per learner\./);
    expect(paymentModeSentence("pay_now", { ...rules, office_payment_allowed: true })).toBe(
      "Families pay online while registering (card, PayPal, Apple Pay or Google Pay). Seats are held 48 hours while they pay, or 7 days when they choose to pay at the office; a seat not paid for in time is released.",
    );
  });

  it("checks the rules before asking the database", () => {
    expect(rulesProblem(rules, term, TZ)).toBeNull();
    expect(rulesProblem({ ...rules, hold_hours: 0 }, term, TZ)).toBe("A seat is held for payment 1 to 168 hours.");
    expect(rulesProblem({ ...rules, office_hold_days: 22 }, term, TZ)).toBe("A seat is held for payment at the office 1 to 21 days.");
    expect(rulesProblem({ ...rules, payment_mode: "pay_now", seat_rule: "office" }, term, TZ)).toMatch(/works only with “Register now, pay later”/);
    expect(rulesProblem({ ...rules, sibling_discount_pct: 101 }, term, TZ)).toBe("The sibling discount is a whole percent from 0 to 100.");
    expect(rulesProblem({ ...rules, late_fee_cents: 2500 }, term, TZ)).toMatch(/^A late fee applies only in a late registration window/);
    expect(rulesProblem({ ...rules, late_registration_closes_at: "2026-09-01T00:00:00Z" }, term, TZ)).toBe("Late registration must end after registration closes (Tue, Sep 1, 11:59 PM).");
    expect(rulesProblem({ ...rules, late_registration_closes_at: "2026-09-15T04:59:00Z", late_fee_cents: 2500 }, term, TZ)).toBeNull();
    expect(rulesProblem({ ...rules, late_registration_closes_at: "2026-09-15T04:59:00Z" }, { registration_closes_at: null }, TZ)).toMatch(/^Set when registration closes/);
  });

  it("says why pay when registering cannot be chosen, never hiding it (P20)", () => {
    expect(payNowBlockedReason({ givingOn: false, ready: { status: "ok", sentence: null } })).toBe("Pay when registering needs Pledges & donations (Giving) switched on.");
    expect(payNowBlockedReason({ givingOn: true, ready: { status: "ok", sentence: null } })).toBeNull();
    expect(payNowBlockedReason({ givingOn: true, ready: { status: "ok", sentence: "Pay at registration waits for fee receipts (P13)." } })).toBe("Pay at registration waits for fee receipts (P13).");
    expect(payNowBlockedReason({ givingOn: true, ready: { status: "missing" } })).toBe("Pay when registering needs the database update that is on its way.");
    expect(payNowBlockedReason({ givingOn: true, ready: { status: "error", reason: "the database could not be reached" } })).toBe(
      "Whether families can pay when registering could not be checked — the database could not be reached.",
    );
  });

  it("lets the principal change a draft, and only the treasurer an open term, with a reason (P9, P16)", () => {
    const principal = { permissions: ["pathshala.view", "pathshala.manage"], isPlatformAdmin: false };
    const treasurer = { permissions: ["giving.view", "giving.manage"], isPlatformAdmin: false };
    const committee = { permissions: ["pathshala.view"], isPlatformAdmin: false };
    const draft = { status: "draft", fees_locked_at: null };
    const open = { status: "registration", fees_locked_at: "2026-08-01T00:00:00Z" };
    expect(feeEditing(principal, draft)).toMatchObject({ open: false, canEdit: true, needsReason: false, canOpen: true });
    expect(feeEditing(treasurer, draft)).toMatchObject({ open: false, canEdit: false, canOpen: false });
    expect(feeEditing(principal, open)).toMatchObject({ open: true, canEdit: false, needsReason: true, canOpen: false });
    expect(feeEditing(principal, open).note).toMatch(/Only the treasurer \(giving\.manage\) can change them now, with a reason/);
    expect(feeEditing(treasurer, open)).toMatchObject({ open: true, canEdit: true, needsReason: true });
    expect(feeEditing(committee, draft).canEdit).toBe(false);
    // A term opened before 0590 has no lock, but it is open: the treasurer's.
    expect(feeEditing(principal, { status: "active", fees_locked_at: null })).toMatchObject({ open: true, canEdit: false });
  });

  it("describes billing only as the term does it (F18)", () => {
    expect(termBillingPhrase({ mode: "pledge", givingOn: true })).toBe("fees per level, added to the family's pledges when a seat is given");
    expect(termBillingPhrase({ mode: "pay_now", givingOn: true })).toBe("fees per level, paid online when registering");
    expect(termBillingPhrase({ mode: "pledge", givingOn: false })).toBe("fees per level, not billed while Pledges & donations is off");
    expect(termBillingPhrase({ mode: null, givingOn: true })).toBeNull();
    expect(termStatusLabel("registration")).toBe("Registration open");
    expect(termStatusLabel("weird")).toBe("weird");
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

  it("reads levels, fees, seats and the pay-now answer defensively", () => {
    const lv = parseLevelRows([{ id: "l", track_id: "t", key: "3", name: "Jainism 3", sort_order: "3", min_age: 8, max_age: null, active: false }]);
    expect(lv.ok && lv.value[0]).toEqual({ id: "l", track_id: "t", key: "3", name: "Jainism 3", sort_order: 3, min_age: 8, max_age: null, active: false });
    expect(parseLevelRows([{ id: "l" }]).ok).toBe(false);
    expect(parseLevelFees([{ term_id: "t", level_id: "l", fee_cents: 4500 }])).toEqual({ ok: true, value: [{ term_id: "t", level_id: "l", fee_cents: 4500, set_by: null, set_at: null }] });
    expect(parseLevelFees([{ term_id: "t", level_id: "l", fee_cents: 45.5 }]).ok).toBe(false);
    const seats = parseSeats({ levels: [{ level_id: "l", capacity: 20, taken: 3, held: 1, free: 16, waitlist_length: 2, waitlist_enabled: true }] });
    expect(seats.ok && seats.value[0]).toEqual({ level_id: "l", seats: 20, taken: 3, held: 1, free: 16, waitlist: 2, waitlist_on: true });
    expect(parsePayNowReady(null)).toEqual({ ok: true, value: null });
    expect(parsePayNowReady("Pay at registration waits for fee receipts (P13).")).toEqual({ ok: true, value: "Pay at registration waits for fee receipts (P13)." });
    expect(parsePayNowReady({ ready: true })).toEqual({ ok: true, value: null });
    expect(parsePayNowReady(42).ok).toBe(false);
  });

  it("reads the owner's example family as the database prices it (§2.4: $130.00, $117.00, $28.00, $50.00 = $325.00)", () => {
    const q = parseQuote({
      lines: [
        { first_name: "Riya", level_id: "j5", learner_kind: "child", family_rank: 1, base_fee_cents: 13000, sibling_discount_cents: 0, cap_reduction_cents: 0, late_fee_cents: 0, assistance_cents: 0, total_cents: 13000 },
        { first_name: "Dev", level_id: "j2", learner_kind: "child", family_rank: 2, base_fee_cents: 13000, sibling_discount_cents: 1300, total_cents: 11700 },
        { first_name: "Anya", level_id: "toddler", learner_kind: "child", family_rank: 3, base_fee_cents: 4500, sibling_discount_cents: 450, cap_reduction_cents: 1250, total_cents: 2800 },
        { first_name: "Mira", level_id: "moms", learner_kind: "adult", family_rank: null, base_fee_cents: 5000, total_cents: 5000 },
      ],
    });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.value.children_total_cents).toBe(27500);
    expect(q.value.adults_total_cents).toBe(5000);
    expect(q.value.total_cents).toBe(32500);
    expect(q.value.lines[2]).toMatchObject({ first_name: "Anya", sibling_discount_cents: 450, cap_reduction_cents: 1250, late_fee_cents: 0 });
    expect(parseQuote({ lines: [{ base_fee_cents: 1, total_cents: 1, learner_kind: "teen" }] }).ok).toBe(false);
    expect(parseQuote({ total_cents: 1 }).ok).toBe(false);
  });

  it("shows the functions' own sentences, never Postgres' wording", () => {
    expect(databaseSentence({ code: "22023", message: "Set the fee for Gujarati 3 and Hindi 1 before opening registration." })).toBe(
      "Set the fee for Gujarati 3 and Hindi 1 before opening registration.",
    );
    expect(databaseSentence({ code: "42501", message: "Only the treasurer can change fees after registration opens." })).toBe("Only the treasurer can change fees after registration opens.");
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

  it("calls the functions by the contract's names and arguments", async () => {
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
    await saveLevel(db, "c1", { track_id: "t", key: "3", name: "Jainism 3", sort_order: 3, min_age: 8, max_age: 10, active: true }, "New level");
    await setLevelFees(db, "term", [{ level_id: "l", fee_cents: 4500 }], "Fees");
    await setTermRules(db, "term", rules, "Rules");
    await openRegistration(db, "term", "Open");
    await loadPayNowReady(db, "c1");
    expect(calls.map((c) => [c.name, c.args])).toEqual([
      ["save_pathshala_level", { p_center: "c1", p_level: { track_id: "t", key: "3", name: "Jainism 3", sort_order: 3, min_age: 8, max_age: 10, active: true }, p_reason: "New level" }],
      ["set_pathshala_level_fees", { p_term: "term", p_fees: [{ level_id: "l", fee_cents: 4500 }], p_reason: "Fees" }],
      ["set_pathshala_term_rules", { p_term: "term", p_rules: rules, p_reason: "Rules" }],
      ["open_pathshala_registration", { p_term: "term", p_reason: "Open" }],
      ["pathshala_pay_now_ready", { p_center: "c1" }],
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
    // A write that worked is never reported as failed because of what it answered.
    expect(await saveLevel(fakeDb({ data: "a-uuid" }).db, "c", { track_id: "t", key: "k", name: "N", sort_order: 0, min_age: null, max_age: null, active: true }, "r")).toEqual({ ok: true, value: null });
    // The fee example writes nothing: an answer it cannot read is a failure, said plainly.
    const odd = await feeExample(fakeDb({ data: { lines: "x" } }).db, "t", [{ first_name: "Riya", age_on_cutoff: 12, level_id: "l" }]);
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
