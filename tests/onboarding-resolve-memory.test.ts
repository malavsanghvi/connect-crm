import { describe, expect, it } from "vitest";

import { applyRules, describeRule, ruleFromAnswer, ruleMatches, validateRule, type DecisionRule } from "@/lib/onboarding/resolve/memory";
import type { RawRecord } from "@/lib/onboarding/resolve/types";

import { gift, rec, run } from "./fixtures/onboarding-resolve/helpers";

/** A file with two shared-phone pairs, one address-only pair, a child and a money conflict. Ids and rows change per "night". */
function night(tag: string, extra: RawRecord[] = []): RawRecord[] {
  const r = (id: string, fields: Partial<RawRecord>) => rec({ id: `${tag}-${id}`, ...fields });
  return [
    r("a1", { name: "Rahul Doshi", mobile: "713-555-0101", address1: "12 Lotus Ln", zip: "77478" }),
    r("a2", { name: "Nirav Kapadia", source: "b.csv", phone: "713-555-0101", address1: "90 Cedar Dr", zip: "77479" }),
    r("b1", { name: "Hetal Modi", mobile: "281-555-0202", address1: "5 Maple Ct", zip: "77478" }),
    r("b2", { name: "Sonal Amin", source: "b.csv", phone: "281-555-0202", address1: "7 Banyan Cir", zip: "77459" }),
    r("m1", { name: "Kiran Shah", mobile: "832-555-0303", address1: "33 Jasmine Way", zip: "77406" }),
    r("m2", { name: "Pooja Desai", source: "b.csv", address1: "33 Jasmine Way", zip: "77406" }),
    r("k1", { name: "Zoya Trivedi", role: "Daughter", phone: "281-555-0404", address1: "8 Orchid St", zip: "77099" }),
    gift({ id: `${tag}-c1`, name: "Dipak Vora", source: "bank.csv", amount: "100.00", date: "2026-04-05", ref: "7001" }),
    gift({ id: `${tag}-c2`, name: "Vora, Dipak", source: "qbo", amount: "100.07", date: "2026-04-05", ref: "7001" }),
    ...extra,
  ];
}

const when = "2026-10-12T09:00:00.000Z";
const by = "user-1";

describe("a remembered answer", () => {
  it("is not asked again on the next night's pull, even though ids and rows changed", () => {
    const first = run(night("n1"));
    const phone = first.groups.find((g) => g.signature === "shared_phone_households")!;
    expect(phone.items).toHaveLength(2);
    const made = ruleFromAnswer({ group: phone, answer: "separate", decidedBy: by, decidedAt: when, sample: phone.items[0] });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.rule.scope).toBe("identifier");
    expect(made.rule.conditions[0]).toMatchObject({ type: "identifier", field: "phone" });

    const second = run(night("n2"), {}, [made.rule]);
    expect(second.answeredByRules).toHaveLength(1);
    expect(second.answeredByRules[0]).toMatchObject({ ruleId: made.rule.id, answer: "separate" });
    const left = second.groups.find((g) => g.signature === "shared_phone_households")!;
    expect(left.items).toHaveLength(1); // the other phone is still a new question
    expect(second.metrics.learned).toBe(1);
    expect(second.dispositions.filter((d) => d.status === "learned")).toHaveLength(1);
  });

  it("asks nothing it already knows once every question is answered", () => {
    const first = run(night("n1"));
    const rules: DecisionRule[] = [];
    for (const g of first.groups) {
      if (g.tier === "D") continue;
      for (const item of g.items) {
        const made = ruleFromAnswer({ group: g, answer: g.question.recommended, decidedBy: by, decidedAt: when, sample: item });
        expect(made.ok).toBe(true);
        if (made.ok) rules.push(made.rule);
      }
    }
    const later = run(night("n3"), {}, rules);
    const cSignatures = later.groups.filter((g) => g.tier === "C");
    expect(cSignatures).toEqual([]);
    // Only the held items are left for a person.
    expect(later.groups.map((g) => g.signature).sort()).toEqual(["amount_differs_cents", "minor_record"]);
    expect(later.metrics.questions).toBeLessThan(first.metrics.questions);
    expect(later.metrics.asked).toBe(0);
  });

  it("can be made for a whole pattern and then answers a different, similar case", () => {
    const first = run(night("n1"));
    const maiden = first.groups.find((g) => g.signature === "spouse_maiden_name")!;
    const made = ruleFromAnswer({ group: maiden, answer: "same_household", decidedBy: by, decidedAt: when });
    expect(made.ok && made.rule.scope).toBe("pattern");
    if (!made.ok) return;
    const other = [
      rec({ id: "x1", name: "Anand Joshi", mobile: "713-555-0909", address1: "41 Saffron Pl", zip: "77478" }),
      rec({ id: "x2", name: "Priti Gandhi", source: "b.csv", address1: "41 Saffron Pl", zip: "77478" }),
    ];
    const res = run(other, {}, [made.rule]);
    expect(res.answeredByRules).toHaveLength(1);
    expect(res.groups).toHaveLength(0);
  });

  it("an exact-pair rule answers only that pair", () => {
    const first = run(night("n1"));
    const maiden = first.groups.find((g) => g.signature === "spouse_maiden_name")!;
    const made = ruleFromAnswer({ group: maiden, answer: "separate", decidedBy: by, decidedAt: when, scope: "exact_pair" });
    if (!made.ok) throw new Error(made.reason);
    expect(run(night("n2"), {}, [made.rule]).groups.map((g) => g.signature)).not.toContain("spouse_maiden_name");
    const different = [
      rec({ id: "x1", name: "Anand Joshi", mobile: "713-555-0909", address1: "41 Saffron Pl", zip: "77478" }),
      rec({ id: "x2", name: "Priti Gandhi", source: "b.csv", address1: "41 Saffron Pl", zip: "77478" }),
    ];
    expect(run(different, {}, [made.rule]).answeredByRules).toHaveLength(0);
  });

  it("the narrowest rule wins, then the newest", () => {
    const first = run(night("n1"));
    const maiden = first.groups.find((g) => g.signature === "spouse_maiden_name")!;
    const exact = ruleFromAnswer({ group: maiden, answer: "separate", decidedBy: by, decidedAt: "2026-10-01T00:00:00.000Z", scope: "exact_pair" });
    const pattern = ruleFromAnswer({ group: maiden, answer: "same_household", decidedBy: by, decidedAt: "2026-10-09T00:00:00.000Z", scope: "pattern" });
    if (!exact.ok || !pattern.ok) throw new Error("rules");
    const item = maiden.items[0];
    expect(applyRules([item], [pattern.rule, exact.rule]).applied[0].answer).toBe("separate");
    const newer = { ...pattern.rule, id: "rule:newer", decidedAt: "2026-10-10T00:00:00.000Z", answer: "separate" as const };
    expect(applyRules([item], [pattern.rule, newer]).applied[0].ruleId).toBe("rule:newer");
  });

  it("is the same rule every time it is made, and reads as a sentence", () => {
    const g = run(night("n1")).groups.find((x) => x.signature === "shared_phone_households")!;
    const a = ruleFromAnswer({ group: g, answer: "separate", decidedBy: by, decidedAt: when });
    const b = ruleFromAnswer({ group: g, answer: "separate", decidedBy: "someone-else", decidedAt: "2027-01-01T00:00:00.000Z" });
    if (!a.ok || !b.ok) throw new Error("rules");
    expect(a.rule.id).toBe(b.rule.id);
    expect(describeRule(a.rule)).toBe("The phone number matches. Nothing else does. Answer for this phone, e-mail or address: No, keep them separate (decided 2026-10-12).");
  });

  it("rejects an answer that is not one of the question's answers, and ignores a withdrawn rule", () => {
    const g = run(night("n1")).groups.find((x) => x.signature === "spouse_maiden_name")!;
    const bad = ruleFromAnswer({ group: g, answer: "use_first", decidedBy: by, decidedAt: when });
    expect(bad.ok).toBe(false);
    const ok = ruleFromAnswer({ group: g, answer: "separate", decidedBy: by, decidedAt: when, scope: "pattern" });
    if (!ok.ok) throw new Error("rule");
    const withdrawn = { ...ok.rule, revokedAt: "2026-10-13T00:00:00.000Z" };
    expect(validateRule(withdrawn)).toBe("the rule was withdrawn");
    expect(run(night("n2"), {}, [withdrawn]).groups.map((x) => x.signature)).toContain("spouse_maiden_name");
  });
});

describe("rules never apply to tier D", () => {
  const first = run(night("n1"));
  const minors = first.groups.find((g) => g.signature === "minor_record")!;
  const money = first.groups.find((g) => g.signature === "amount_differs_cents")!;

  it("a held group cannot produce a rule", () => {
    for (const g of [minors, money]) {
      const made = ruleFromAnswer({ group: g, answer: g.question.recommended, decidedBy: by, decidedAt: when });
      expect(made.ok).toBe(false);
      if (!made.ok) expect(made.reason).toBe("Answers about children and money are never remembered; a person decides each time.");
    }
  });

  it("a forged rule for a held pattern is invalid and never applied", () => {
    const forged: DecisionRule[] = [
      { id: "rule:forged-minor", signature: "minor_record", scope: "pattern", conditions: [{ type: "evidence", requires: [], allowsConflicts: [] }], answer: "ignore_row", decidedBy: by, decidedAt: when, fromGroup: null, revokedAt: null },
      { id: "rule:forged-money", signature: "amount_differs_cents", scope: "pattern", conditions: [{ type: "evidence", requires: [], allowsConflicts: [] }], answer: "use_first", decidedBy: by, decidedAt: when, fromGroup: null, revokedAt: null },
      { id: "rule:forged-id", signature: "minor_record", scope: "identifier", conditions: [{ type: "identifier", field: "phone", value: "+12815550404" }], answer: "person_will_add", decidedBy: by, decidedAt: when, fromGroup: null, revokedAt: null },
    ];
    for (const f of forged) expect(validateRule(f), f.id).toBe("rules never apply to held items");
    const res = run(night("n2"), {}, forged);
    expect(res.answeredByRules).toEqual([]);
    expect(res.groups.map((g) => g.signature)).toEqual(expect.arrayContaining(["minor_record", "amount_differs_cents"]));
    expect(res.dispositions.filter((d) => d.status === "held").length).toBeGreaterThanOrEqual(3);
  });

  it("a held item is never matched, even by a valid rule for a pattern it shares evidence with", () => {
    const c = first.groups.find((g) => g.signature === "spouse_maiden_name")!;
    const made = ruleFromAnswer({ group: c, answer: "separate", decidedBy: by, decidedAt: when, scope: "pattern" });
    if (!made.ok) throw new Error("rule");
    const heldItem = { ...c.items[0], tier: "D" as const };
    expect(ruleMatches(made.rule, c.items[0])).toBe(true);
    expect(ruleMatches(made.rule, heldItem)).toBe(false);
    expect(applyRules([heldItem], [made.rule]).applied).toEqual([]);
    const recordItem = { ...c.items[0], kind: "record" as const };
    expect(ruleMatches(made.rule, recordItem)).toBe(false);
  });

  it("the held rows stay held on every later run, however many rules exist", () => {
    const rules: DecisionRule[] = [];
    for (const g of first.groups.filter((x) => x.tier === "C")) {
      for (const item of g.items) {
        const made = ruleFromAnswer({ group: g, answer: g.question.recommended, decidedBy: by, decidedAt: when, sample: item, scope: "pattern" });
        if (made.ok) rules.push(made.rule);
      }
    }
    expect(rules.length).toBeGreaterThan(0);
    const later = run(night("n9"), {}, rules);
    const held = later.dispositions.filter((d) => d.status === "held").map((d) => d.id);
    expect(held.sort()).toEqual(["n9-c1", "n9-c2", "n9-k1"]);
  });
});
