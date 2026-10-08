import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The forms are bound to server actions; here nothing is called, only rendered.
vi.mock("@/app/(app)/pathshala/actions", () => ({ saveTerm: vi.fn() }));
// ActionForm's step-up modal verifies a code through a server action.
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { LevelFields } from "@/app/(app)/pathshala/levels/level-fields";
import {
  bulkSuggestionLabel,
  copyOnEnter,
  FeesEditor,
  rowStatus,
  suggestionButtonLabel,
  suggestionsToUse,
  type FeeEditorGroup,
  type FeeEditorRow,
} from "@/app/(app)/pathshala/terms/[id]/fees/fees-editor";
import { RulesForm, type RulesValues } from "@/app/(app)/pathshala/terms/[id]/fees/rules-form";
import { TryFamily } from "@/app/(app)/pathshala/terms/[id]/fees/try-family";
import { TermForm } from "@/app/(app)/pathshala/terms/term-form";
import type { Tables } from "@/lib/database.types";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
/** A regex for one tag carrying every attribute, in any order (React 19 serializes `name` last on form controls). */
const tagWith = (tag: string, ...attrs: string[]) => new RegExp(`<${tag}${attrs.map((a) => `(?=[^>]*\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`).join("")}[^>]*>`);
const noop = vi.fn();

const row = (over: Partial<FeeEditorRow> & Pick<FeeEditorRow, "levelId" | "name">): FeeEditorRow => ({
  band: "No age band",
  offered: true,
  classes: 1,
  retired: false,
  saved: null,
  suggestion: null,
  seats: "—",
  ...over,
});

const groups: FeeEditorGroup[] = [
  {
    trackId: "tj",
    trackName: "Jainism",
    rows: [
      row({ levelId: "toddler", name: "Toddler", band: "Children's level · Up to age 4", saved: 4500, seats: "12 seats · 3 taken · 9 free" }),
      row({ levelId: "j1", name: "Jainism 1", suggestion: { cents: 13000, from: "2025-26" } }),
      row({ levelId: "j2", name: "Jainism 2" }),
      row({ levelId: "moms", name: "Adult class (Moms)", offered: false, classes: 0, suggestion: { cents: 5000, from: "2025-26" } }),
      // Retired, but a class is still on the books: not offered (0590), so no fee is needed.
      row({ levelId: "j7", name: "Jainism 7", offered: false, classes: 1, retired: true }),
    ],
  },
];

describe("Terms › Fees: the fee editor", () => {
  it("shows a box per level holding only the saved fee: a suggestion is a placeholder with a Use button, never a value", () => {
    const html = render(createElement(FeesEditor, { groups, action: noop, canEdit: true, needsReason: false, currency: "USD" }));
    expect(html).toMatch(tagWith("input", 'name="fee:toddler"', 'value="45"'));
    // The offered level with last term's fee: blank (so "Save fees" never saves it unseen), the fee offered beside it.
    expect(html).toMatch(tagWith("input", 'name="fee:j1"', 'value=""', 'placeholder="130 (2025-26)"'));
    expect(html).toContain("Use $130.00 (2025-26)");
    expect(html).toContain('aria-label="Use the suggested fee for Jainism 1: $130.00, from 2025-26"');
    expect(html).toMatch(tagWith("input", 'name="fee:j2"', 'value=""', 'placeholder="Required"'));
    // A level with no class this term: blank too, its suggestion offered the same way, but not in the bulk button.
    expect(html).toMatch(tagWith("input", 'name="fee:moms"', 'value=""', 'placeholder="50 (2025-26)"'));
    expect(html).toContain("Use the suggestions for the 1 level without a fee");
    expect(html).not.toContain("Suggested from 2025-26 · not saved yet");
    expect(html).toContain("Saved");
    expect(html).toContain("Needs a fee");
    // Each box is described by its status.
    expect(html).toMatch(tagWith("input", 'name="fee:j1"', 'aria-describedby="fee-status-j1"'));
    expect(html).toContain('id="fee-status-j1"');
    expect(html).toContain("No class this term");
    expect(html).toContain("12 seats · 3 taken · 9 free");
    expect(html).toContain("Copy to the 0 selected levels");
    expect(html).toContain("Tick every level of Jainism");
    expect(html).toContain("A fee is $0 (Free) or at least $0.50, the smallest online payment.");
    expect(html).toContain("1 class · retired, not offered");
    expect(html).toContain("Retired: not offered, no fee needed");
    expect(html).not.toContain('name="reason"');
    expect(html).toContain("Save fees");
  });

  it("asks for a reason after registration opens, and is read-only for people who may not change fees now", () => {
    const open = render(createElement(FeesEditor, { groups, action: noop, canEdit: true, needsReason: true, currency: "USD" }));
    expect(open).toMatch(tagWith("input", 'name="reason"', "required"));
    expect(open).toContain("Required after registration opens. Fees already quoted or billed never change.");
    const reader = render(createElement(FeesEditor, { groups, action: noop, canEdit: false, needsReason: true, currency: "USD" }));
    expect(reader).not.toContain("<input");
    expect(reader).not.toContain("Save fees");
    expect(reader).toContain("$45.00");
    expect(reader).toContain("Needs a fee");
  });

  it("says what each box means as it is typed", () => {
    const saved = groups[0].rows[0];
    expect(rowStatus(saved, "45", "USD")).toEqual({ tone: "success", text: "Saved" });
    expect(rowStatus(saved, "50", "USD")).toEqual({ tone: "warning", text: "Changed from $45.00 · not saved yet" });
    expect(rowStatus(saved, "0.10", "USD").tone).toBe("danger");
    expect(rowStatus(groups[0].rows[2], "Free", "USD")).toEqual({ tone: "warning", text: "Not saved yet" });
    // After "Use", the box holds the suggestion and says where it came from, still unsaved.
    expect(rowStatus(groups[0].rows[1], "130", "USD")).toEqual({ tone: "warning", text: "Suggested from 2025-26 · not saved yet" });
    expect(rowStatus(groups[0].rows[1], "", "USD")).toEqual({ tone: "danger", text: "Needs a fee" });
  });

  it("fills only what someone chooses: the bulk button takes the offered levels without a fee and an empty box", () => {
    expect(suggestionsToUse(groups, { toddler: "45", j1: "", j2: "", moms: "" }).map((r) => r.levelId)).toEqual(["j1"]);
    expect(suggestionsToUse(groups, { toddler: "45", j1: "120", j2: "", moms: "" })).toEqual([]);
    expect(suggestionButtonLabel({ cents: 15000, from: "the term's earlier single fee" }, "USD")).toBe("Use $150.00 (the term's earlier single fee)");
    expect(bulkSuggestionLabel(8)).toBe("Use the suggestions for the 8 levels without a fee");
  });

  it("copies with Enter in the copy box instead of submitting the fees", () => {
    const copy = vi.fn();
    const enter = { key: "Enter", preventDefault: vi.fn() };
    copyOnEnter(enter, copy);
    expect(enter.preventDefault).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledTimes(1);
    const other = { key: "5", preventDefault: vi.fn() };
    copyOnEnter(other, copy);
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(copy).toHaveBeenCalledTimes(1);
    const html = render(createElement(FeesEditor, { groups, action: noop, canEdit: true, needsReason: false, currency: "USD" }));
    // The copy box has no name (it is never sent) and no dangling description until there is a problem to describe.
    expect(html).toMatch(/<input(?=[^>]*placeholder="130")(?![^>]*\bname=)(?![^>]*aria-describedby)[^>]*>/);
  });
});

const values: RulesValues = {
  payment_mode: "pledge",
  hold_hours: 48,
  office_payment_allowed: false,
  office_hold_days: 7,
  seat_rule: "automatic",
  sibling_discount_pct: 10,
  fee_per_family_cap_cents: 27500,
  late_registration_closes_local: "",
  late_fee_cents: 0,
  withdrawal_credit_until: null,
  age_cutoff_on: null,
  fund_id: null,
};

describe("Terms › Fees: the rules form", () => {
  const base = {
    values,
    action: noop,
    needsReason: false,
    locked: false,
    givingOn: true,
    funds: [{ id: "f1", name: "Pathshala" }],
    canChooseFund: true,
    startsOnLabel: "Sun, Sep 6, 2026",
    registrationClosesLabel: "Tue, Sep 1, 11:59 PM",
  };

  it("shows “Pay when registering” with the plain reason it cannot be chosen yet, instead of hiding it (P20)", () => {
    const html = render(createElement(RulesForm, { ...base, payNowBlocked: "Pay at registration waits for fee receipts (P13)." }));
    expect(html).toContain("Register now, pay later (pledge)");
    expect(html).toContain("Pay when registering (pay now)");
    expect(html).toMatch(tagWith("input", 'type="radio"', 'value="pay_now"', 'disabled=""'));
    expect(html).toMatch(tagWith("input", 'type="radio"', 'value="pledge"', 'checked=""'));
    expect(html).toContain("Cannot be chosen yet: Pay at registration waits for fee receipts (P13).");
    // Pledge mode keeps the hold windows as they are.
    expect(html).toMatch(tagWith("input", 'type="hidden"', 'name="hold_hours"', 'value="48"'));
    expect(html).toMatch(tagWith("input", 'name="fee_per_family_cap"', 'value="275"'));
    expect(html).toContain("Registration closes Tue, Sep 1, 11:59 PM (the term&#x27;s form).");
    expect(html).toContain("Blank: the first day of term (Sun, Sep 6, 2026).");
    expect(html).toContain("Found when registration opens (the Pathshala fund)");
    expect(html).not.toContain('name="reason"');
    // The sibling discount is always given (0 for none): a cleared box is never sent as 0%.
    expect(html).toMatch(tagWith("input", 'name="sibling_discount_pct"', "required", 'value="10"'));
  });

  it("lets pay now be chosen when ready, with its hold window and the office switch; the office seat rule is pledge-only", () => {
    const html = render(createElement(RulesForm, { ...base, values: { ...values, payment_mode: "pay_now", office_payment_allowed: true }, payNowBlocked: null }));
    expect(html).toMatch(tagWith("input", 'type="radio"', 'value="pay_now"', 'checked=""'));
    expect(html).not.toMatch(tagWith("input", 'value="pay_now"', 'disabled=""'));
    expect(html).toMatch(tagWith("input", 'name="hold_hours"', 'value="48"', 'inputMode="numeric"'));
    expect(html).toMatch(tagWith("input", 'name="office_hold_days"', 'value="7"', 'inputMode="numeric"'));
    expect(html).toMatch(tagWith("input", 'type="radio"', 'value="office"', 'disabled=""'));
    expect(html).toContain("Seats are held 48 hours while they pay, or 7 days when they choose to pay at the office");
    // A payment page still open keeps the seat, but not for ever (P17: at most 24 hours more).
    expect(html).toContain("a seat is not released while its payment page is still open, for at most 24 hours.");
  });

  it("asks for a reason after registration opens, and says when the funds could not be read", () => {
    const html = render(createElement(RulesForm, { ...base, needsReason: true, funds: null, payNowBlocked: null }));
    expect(html).toMatch(tagWith("input", 'name="reason"', "required"));
    expect(html).toContain("The funds could not be read");
    const off = render(createElement(RulesForm, { ...base, givingOn: false, payNowBlocked: "Pay at registration needs Pledges & donations switched on (Settings › Modules)." }));
    expect(off).not.toContain('name="fund_id"');
  });

  it("leaves the fund to the treasurer: the principal sees it, without a picker (0590: fund_id needs giving.manage)", () => {
    const principal = render(createElement(RulesForm, { ...base, canChooseFund: false, values: { ...values, fund_id: "f1" }, payNowBlocked: null }));
    expect(principal).not.toContain('name="fund_id"');
    expect(principal).toContain("Pathshala");
    expect(principal).toContain("The treasurer (giving.manage) chooses the fund.");
    const treasurer = render(createElement(RulesForm, { ...base, payNowBlocked: null }));
    expect(treasurer).toMatch(tagWith("select", 'name="fund_id"'));
  });

  it("once registration has opened, offers no way to clear the fund and never says it is found later", () => {
    const withFund = render(createElement(RulesForm, { ...base, locked: true, needsReason: true, values: { ...values, fund_id: "f1" }, payNowBlocked: null }));
    expect(withFund).toMatch(tagWith("select", 'name="fund_id"'));
    expect(withFund).not.toContain('<option value="">');
    expect(withFund).not.toContain("Found when registration opens");
    expect(withFund).toContain("Since registration opened it can be changed to another fund, not cleared.");
    // No fund yet (Giving was off when it opened): a disabled first choice, so nothing is sent until one is chosen.
    const noFund = render(createElement(RulesForm, { ...base, locked: true, needsReason: true, payNowBlocked: null }));
    expect(noFund).toContain('<option value="" disabled="" selected="">Choose the fund for the fee pledges</option>');
    expect(noFund).not.toContain("Found when registration opens");
    const principal = render(createElement(RulesForm, { ...base, locked: true, needsReason: true, canChooseFund: false, payNowBlocked: null }));
    expect(principal).toContain("No fund chosen");
    expect(principal).not.toContain("Found when registration opens");
    // A fund made inactive since stays the choice, so saving other rules never moves the fee pledges to another fund.
    const inactive = render(createElement(RulesForm, { ...base, locked: true, needsReason: true, values: { ...values, fund_id: "f-old" }, payNowBlocked: null }));
    expect(inactive).toContain('<option value="f-old" selected="">The term&#x27;s current fund (no longer active)</option>');
  });
});

describe("Terms › the term form (F18)", () => {
  const term = {
    id: "t1",
    center_id: "c",
    name: "2026-27",
    starts_on: "2026-09-06",
    ends_on: "2027-05-30",
    registration_opens_at: null,
    registration_closes_at: null,
    membership_required: true,
    fee_per_child_cents: 15000,
    fee_per_family_cap_cents: null,
    sibling_discount_pct: 10,
    no_class_dates: [],
    status: "draft",
    created_at: "2026-08-01T00:00:00Z",
    custom: {},
    // The columns migration 0590 added (their defaults).
    payment_mode: "pledge",
    hold_hours: 48,
    office_payment_allowed: false,
    office_hold_days: 7,
    seat_rule: "automatic",
    campaign_id: null,
    fund_id: null,
    late_registration_closes_at: null,
    late_fee_cents: 0,
    withdrawal_credit_until: null,
    age_cutoff_on: null,
    fees_locked_at: null,
    fees_locked_by: null,
  } satisfies Tables<"pathshala_terms">;

  it("has no fee fields and no false billing promise; a draft cannot be switched to “Registration open” here", () => {
    const html = render(createElement(TermForm, { term, tz: "America/Chicago" }));
    expect(html).not.toContain("Billed per child");
    expect(html).not.toContain('name="fee_per_child"');
    expect(html).not.toContain('name="fee_family_cap"');
    expect(html).not.toContain('name="sibling_discount_pct"');
    expect(html).not.toContain('name="status"');
    expect(html).toContain("Draft (hidden from families)");
    expect(html).toContain('href="/pathshala/terms/t1/fees"');
    expect(html).toContain("Fees are set per level on the term&#x27;s Fees and rules page");
  });

  it("moves an open term between its open statuses only", () => {
    const html = render(createElement(TermForm, { term: { ...term, status: "registration" }, tz: "America/Chicago" }));
    expect(html).toContain('<option value="registration" selected="">Registration open</option>');
    expect(html).toContain('<option value="closed">Closed</option>');
    expect(html).not.toContain('<option value="draft"');
  });
});

describe("Pathshala › Levels: the level drawer", () => {
  it("keeps the track, explains the age band, and never carries the level's offered state (only Retire changes it)", () => {
    const html = render(
      createElement(LevelFields, {
        level: { id: "l1", track_id: "tj", key: "adult_moms", name: "Adult class (Moms)", sort_order: 9, min_age: 18, max_age: null, active: false },
        track: { id: "tj", name: "Jainism" },
        nextOrder: 9,
      }),
    );
    expect(html).toMatch(tagWith("input", 'type="hidden"', 'name="track_id"', 'value="tj"'));
    expect(html).not.toContain('name="active"');
    expect(html).toMatch(tagWith("input", 'name="min_age"', 'value="18"'));
    expect(html).toContain("Now: Adult class · 18 and over. Offered to adults only");
    const fresh = render(createElement(LevelFields, { level: null, track: { id: "tj", name: "Jainism" }, nextOrder: 10 }));
    expect(fresh).toContain("Leave blank to make one from the name (“Jainism 8” becomes 8).");
    expect(fresh).toMatch(tagWith("input", 'name="sort_order"', 'value="10"'));
    expect(fresh).not.toContain('name="active"');
  });
});

describe("Terms › Fees: Try a family", () => {
  const props = {
    action: vi.fn(),
    levels: [
      { id: "j2", name: "Jainism 2", label: "Jainism 2 · $130.00" },
      { id: "g4", name: "Gujarati 4", label: "Gujarati 4 · no fee yet" },
    ],
    cutoffLabel: "Sun, Sep 6, 2026",
    currency: "USD",
  };

  it("offers rows of learners (0590's name, age, level, with each row's key) with the term's levels and their fees", () => {
    const html = render(createElement(TryFamily, { ...props, lateFeeLabel: null }));
    expect(html.match(/name="name"/g)?.length).toBe(3);
    expect(html.match(/name="age"/g)?.length).toBe(3);
    expect(html.match(/name="level_id"/g)?.length).toBe(3);
    expect(html.match(/name="row_key"/g)?.length).toBe(3);
    expect(html).toContain("Jainism 2 · $130.00");
    expect(html).toContain("Gujarati 4 · no fee yet");
    expect(html).toContain("Ages are on the term&#x27;s cut-off date (Sun, Sep 6, 2026)");
    // Two rows with one name are one learner in two classes (0590's `learner`), not two children.
    expect(html).toContain("Use the same name on two rows to price one learner in two classes.");
    expect(html).not.toContain("Give a learner two rows");
    // Each row's age and level say which learner they are for.
    expect(html).toContain('Age<span class="sr-only"> of learner 2</span>');
    expect(html).toContain('Level<span class="sr-only"> of learner 3</span>');
    expect(html).toContain("Work out the fees");
    // No late fee: nothing to try for the late window.
    expect(html).not.toContain('name="late"');
  });

  it("can price the late window when the term has a late fee", () => {
    const html = render(createElement(TryFamily, { ...props, lateFeeLabel: "$25.00 per learner" }));
    expect(html).toMatch(tagWith("input", 'type="checkbox"', 'name="late"'));
    expect(html).toContain("After registration closes each learner pays the late fee too ($25.00 per learner).");
  });
});
