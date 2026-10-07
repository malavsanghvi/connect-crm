import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The forms are bound to server actions; here nothing is called, only rendered.
vi.mock("@/app/(app)/pathshala/actions", () => ({ saveTerm: vi.fn() }));
// ActionForm's step-up modal verifies a code through a server action.
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { LevelFields } from "@/app/(app)/pathshala/levels/level-fields";
import { FeesEditor, rowStatus, type FeeEditorGroup, type FeeEditorRow } from "@/app/(app)/pathshala/terms/[id]/fees/fees-editor";
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
    ],
  },
];

describe("Terms › Fees: the fee editor", () => {
  it("shows a box per level: saved fees, offered levels pre-filled from last term, a missing fee, and nothing guessed for a level without a class", () => {
    const html = render(createElement(FeesEditor, { groups, action: noop, canEdit: true, needsReason: false, currency: "USD" }));
    expect(html).toMatch(tagWith("input", 'name="fee:toddler"', 'value="45"'));
    expect(html).toMatch(tagWith("input", 'name="fee:j1"', 'value="130"'));
    expect(html).toMatch(tagWith("input", 'name="fee:j2"', 'value=""'));
    // A level with no class this term starts blank; its suggestion is only a placeholder.
    expect(html).toMatch(tagWith("input", 'name="fee:moms"', 'value=""', 'placeholder="50 (2025-26)"'));
    expect(html).toContain("Saved");
    expect(html).toContain("Suggested from 2025-26 · not saved yet");
    expect(html).toContain("Needs a fee");
    expect(html).toContain("No class this term");
    expect(html).toContain("12 seats · 3 taken · 9 free");
    expect(html).toContain("Copy to the 0 selected levels");
    expect(html).toContain("Tick every level of Jainism");
    expect(html).toContain("A fee is Free ($0) or at least $0.50, the smallest online payment.");
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
    givingOn: true,
    funds: [{ id: "f1", name: "Pathshala" }],
    startsOnLabel: "Sun, Sep 6, 2026",
    registrationClosesLabel: "Tue, Sep 1, 11:59 PM",
  };

  it("shows “Pay when registering” with the plain reason it cannot be chosen yet, instead of hiding it (P20)", () => {
    const html = render(createElement(RulesForm, { ...base, payNowBlocked: "Pay at registration waits for fee receipts (P13)." }));
    expect(html).toContain("Register now, pay later");
    expect(html).toContain("Pay when registering");
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
  });

  it("lets pay now be chosen when ready, with its hold window and the office switch; the office seat rule is pledge-only", () => {
    const html = render(createElement(RulesForm, { ...base, values: { ...values, payment_mode: "pay_now", office_payment_allowed: true }, payNowBlocked: null }));
    expect(html).toMatch(tagWith("input", 'type="radio"', 'value="pay_now"', 'checked=""'));
    expect(html).not.toMatch(tagWith("input", 'value="pay_now"', 'disabled=""'));
    expect(html).toMatch(tagWith("input", 'name="hold_hours"', 'value="48"', 'inputMode="numeric"'));
    expect(html).toMatch(tagWith("input", 'name="office_hold_days"', 'value="7"', 'inputMode="numeric"'));
    expect(html).toMatch(tagWith("input", 'type="radio"', 'value="office"', 'disabled=""'));
    expect(html).toContain("Seats are held 48 hours while they pay, or 7 days when they choose to pay at the office");
  });

  it("asks for a reason after registration opens, and says when the funds could not be read", () => {
    const html = render(createElement(RulesForm, { ...base, needsReason: true, funds: null, payNowBlocked: null }));
    expect(html).toMatch(tagWith("input", 'name="reason"', "required"));
    expect(html).toContain("The funds could not be read");
    const off = render(createElement(RulesForm, { ...base, givingOn: false, payNowBlocked: "Pay when registering needs Pledges &amp; donations (Giving) switched on." }));
    expect(off).not.toContain('name="fund_id"');
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
  it("keeps the track and the level's state, and explains the age band", () => {
    const html = render(
      createElement(LevelFields, {
        level: { id: "l1", track_id: "tj", key: "adult_moms", name: "Adult class (Moms)", sort_order: 9, min_age: 18, max_age: null, active: false },
        track: { id: "tj", name: "Jainism" },
        nextOrder: 9,
      }),
    );
    expect(html).toMatch(tagWith("input", 'type="hidden"', 'name="track_id"', 'value="tj"'));
    expect(html).toMatch(tagWith("input", 'type="hidden"', 'name="active"', 'value="false"'));
    expect(html).toMatch(tagWith("input", 'name="min_age"', 'value="18"'));
    expect(html).toContain("Now: Adult class · 18 and over. Offered to adults only");
    const fresh = render(createElement(LevelFields, { level: null, track: { id: "tj", name: "Jainism" }, nextOrder: 10 }));
    expect(fresh).toContain("Leave blank to make one from the name (“Jainism 8” becomes 8).");
    expect(fresh).toMatch(tagWith("input", 'name="sort_order"', 'value="10"'));
    expect(fresh).toMatch(tagWith("input", 'type="hidden"', 'name="active"', 'value="true"'));
  });
});

describe("Terms › Fees: Try a family", () => {
  it("offers rows of learners with the term's levels and their fees", () => {
    const html = render(
      createElement(TryFamily, {
        action: vi.fn(),
        levels: [
          { id: "j2", name: "Jainism 2", label: "Jainism 2 · $130.00" },
          { id: "g4", name: "Gujarati 4", label: "Gujarati 4 · no fee yet" },
        ],
        cutoffLabel: "Sun, Sep 6, 2026",
        currency: "USD",
      }),
    );
    expect(html.match(/name="first_name"/g)?.length).toBe(3);
    expect(html).toContain("Jainism 2 · $130.00");
    expect(html).toContain("Gujarati 4 · no fee yet");
    expect(html).toContain("Ages are on the term&#x27;s cut-off date (Sun, Sep 6, 2026)");
    expect(html).toContain("Work out the fees");
  });
});
