import { describe, expect, it } from "vitest";

import { makeConfig } from "@/lib/onboarding/resolve/config";
import { assertNoChildLeak, childIdentities, maskForAi, modelInputForGroup } from "@/lib/onboarding/resolve/mask";
import { ruleFromAnswer, type DecisionRule } from "@/lib/onboarding/resolve/memory";
import { detectDateOrder } from "@/lib/onboarding/resolve/normalize";
import { resolveRecords, type ResolveResult } from "@/lib/onboarding/resolve/run";
import type { RawRecord } from "@/lib/onboarding/resolve/types";

import { buildGolden, type Golden } from "./fixtures/onboarding-resolve/golden";
import { TODAY } from "./fixtures/onboarding-resolve/helpers";

/** What the "recipe reader" does before the engine runs: read each file's day/month order from its own dates. */
function configFor(g: Golden) {
  const bySource = new Map<string, unknown[]>();
  for (const r of g.records) {
    const list = bySource.get(r.source) ?? [];
    if (r.dob) list.push(r.dob);
    if (r.gift) list.push(r.gift.date);
    bySource.set(r.source, list);
  }
  const dateOrderBySource: Record<string, "mdy" | "dmy"> = {};
  for (const [source, values] of bySource) {
    const d = detectDateOrder(values);
    if (d.order !== "unknown") dateOrderBySource[source] = d.order;
  }
  return makeConfig(TODAY, { dateOrderBySource });
}

/** Whether a pair the engine called "the same" really is, according to the generator that made the rows. */
function correct(g: Golden, p: ResolveResult["pairs"][number]): boolean {
  const a = g.truth[p.a];
  const b = g.truth[p.b];
  if (p.relation === "same_person") return a.person === b.person;
  if (p.relation === "same_household") return a.household === b.household;
  return a.gift !== null && a.gift === b.gift;
}

const golden = buildGolden({ rows: 300, seed: 1 });
const cfg = configFor(golden);
const res = resolveRecords({ records: golden.records, config: cfg });

describe("the messy 300-row list", () => {
  it("is 300 rows from five sources, with the mess the brief names", () => {
    expect(golden.records).toHaveLength(300);
    expect(Object.keys(golden.counts).sort()).toEqual(["bank-export.csv", "directory.xlsx", "neon-export.csv", "quickbooks", "zeffy-export.csv"]);
    const names = golden.records.map((r) => r.name ?? "").join("\n");
    expect(names).toMatch(/Patil|Pattel|Saha|Metha|Dessai|Dosi|Sanghavi|Parikh|Thakker|Ghandi|Vohra|Choksi|Kapadiya/); // transliteration variants
    expect(names).toMatch(/\w+(bhai|ben) \w+/); // honorific suffixes
    expect(names).toMatch(/^Shri /m);
    expect(names).toMatch(/^\w\. \w+/m); // initials
    expect(names).toMatch(/^\w+, \w+/m); // Last, First
    expect(names).toMatch(/[઀-૿]/); // Gujarati script
    expect(names).toMatch(/ Jr\.?| Sr\.?/);
    expect(golden.records.filter((r) => golden.truth[r.id].isChild).length).toBeGreaterThanOrEqual(10);
    expect(golden.records.filter((r) => r.kind === "gift")).not.toHaveLength(0);
    // The same gift in two sources, and some of those disagreeing by cents.
    const byGift = new Map<string, number>();
    for (const r of golden.records) if (r.kind === "gift") byGift.set(golden.truth[r.id].gift!, (byGift.get(golden.truth[r.id].gift!) ?? 0) + 1);
    expect([...byGift.values()].filter((n) => n === 2).length).toBeGreaterThanOrEqual(5);
    expect(golden.records.some((r) => !r.email && !r.mobile && !r.phone && r.kind === "person")).toBe(true); // missing fields
    // Two households sharing a phone, and a name that belongs to two different people.
    const phones = new Map<string, Set<string>>();
    for (const r of golden.records) for (const v of [r.mobile, r.phone]) if (v) (phones.get(v.replace(/\D/g, "").slice(-10)) ?? phones.set(v.replace(/\D/g, "").slice(-10), new Set()).get(v.replace(/\D/g, "").slice(-10))!).add(golden.truth[r.id].household);
    expect([...phones.values()].some((s) => s.size > 1)).toBe(true);
  });

  it("tier A precision is at least 99.5% against the truth", () => {
    const aPairs = res.pairs.filter((p) => p.tier === "A");
    expect(aPairs.length).toBeGreaterThanOrEqual(60);
    const wrong = aPairs.filter((p) => !correct(golden, p));
    const precision = 1 - wrong.length / aPairs.length;
    expect(precision, `wrongly automatic: ${wrong.map((p) => `${p.a} ~ ${p.b} (${p.relation})`).join("; ")}`).toBeGreaterThanOrEqual(0.995);
  });

  it("every automatic cluster is one household in the truth", () => {
    for (const c of res.clusters) {
      const households = new Set(c.recordIds.map((id) => golden.truth[id].household));
      expect([c.id, [...households]]).toEqual([c.id, [[...households][0]]]);
    }
    for (const c of res.personClusters) {
      const persons = new Set(c.recordIds.map((id) => golden.truth[id].person));
      expect([c.id, persons.size]).toEqual([c.id, 1]);
    }
  });

  it("resolves at least 80% of the rows automatically", () => {
    expect(res.metrics.autoShare).toBeGreaterThanOrEqual(0.8);
    // and reports how the rest were handled
    expect(res.metrics.auto + res.metrics.bulk + res.metrics.asked + res.metrics.held + res.metrics.learned).toBe(300);
  });

  it("asks few questions: one per pattern, ranked, each with an answer", () => {
    expect(res.groups.length).toBeGreaterThan(0);
    expect(res.groups.length).toBeLessThanOrEqual(10);
    expect(new Set(res.groups.map((g) => g.signature)).size).toBe(res.groups.length);
    for (const g of res.groups) {
      expect(g.question.title.length).toBeGreaterThan(20);
      expect(g.question.answers.length).toBeLessThanOrEqual(3);
      expect(g.items.length).toBeGreaterThanOrEqual(g.subjects.length > 0 ? 1 : 0);
    }
    // Many items, few questions.
    const items = res.groups.reduce((n, g) => n + g.items.length, 0);
    expect(items).toBeGreaterThan(res.groups.length * 2);
  });

  it("never joins on a name alone", () => {
    for (const p of res.pairs) {
      if (p.nameOnly && p.relation !== "same_gift") {
        expect(["C", "D"], `${p.a} ~ ${p.b}`).toContain(p.tier);
        expect(p.strength).toBe("weak");
      }
      if (p.tier === "A") {
        expect(p.independent, `${p.a} ~ ${p.b}`).toBeGreaterThanOrEqual(2);
        expect(p.evidence.filter((e) => e.independent && e.kind !== "household_name").length, `${p.a} ~ ${p.b}`).toBeGreaterThanOrEqual(1);
        expect(p.conflicts.filter((c) => c.severity === "block")).toEqual([]);
      }
    }
    // Two people with one name stay two people.
    for (const c of res.clusters) expect(new Set(c.recordIds.map((id) => golden.truth[id].household)).size).toBe(1);
  });

  it("holds every child, and never decides one", () => {
    const children = golden.records.filter((r) => golden.truth[r.id].isChild);
    for (const r of children) {
      const d = res.dispositions.find((x) => x.id === r.id)!;
      expect(d.status, `${r.id} ${r.name}`).toBe("held");
    }
    const inA = res.pairs.filter((p) => p.tier === "A" && (golden.truth[p.a].isChild || golden.truth[p.b].isChild));
    expect(inA).toEqual([]);
    const linked = new Set(res.clusters.flatMap((c) => c.recordIds));
    for (const r of children) expect(linked.has(r.id)).toBe(false);
  });

  it("holds gifts whose two sources disagree, and loads the others once", () => {
    const byGift = new Map<string, RawRecord[]>();
    for (const r of golden.records) if (r.kind === "gift") byGift.set(golden.truth[r.id].gift!, [...(byGift.get(golden.truth[r.id].gift!) ?? []), r]);
    const skip = new Set(res.giftDuplicates.map((d) => d.skip));
    const keep = new Set(res.giftDuplicates.map((d) => d.keep));
    // Precision: every pair loaded once really is one gift.
    for (const d of res.giftDuplicates) expect(golden.truth[d.keep].gift, `${d.keep} / ${d.skip}`).toBe(golden.truth[d.skip].gift);
    // A gift that is skipped as a duplicate is not also held for a money conflict.
    for (const id of skip) expect(res.dispositions.find((x) => x.id === id)!.status).not.toBe("held");
    expect([...skip].filter((id) => keep.has(id))).toEqual([]);
    // Cents conflicts: both rows are held.
    const conflicts = [...byGift.values()].filter((rows) => rows.length === 2 && new Set(rows.map((r) => String(r.gift!.amount).replace(/[$,]/g, ""))).size === 2);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    const held = conflicts.filter((rows) => rows.every((r) => res.dispositions.find((x) => x.id === r.id)!.status === "held"));
    expect(held.length / conflicts.length).toBeGreaterThanOrEqual(0.5);
    // Recall of the exact duplicates (reported, not a promise): most are found.
    const exact = [...byGift.values()].filter((rows) => rows.length === 2 && new Set(rows.map((r) => String(r.gift!.amount).replace(/[$,]/g, "").replace(/\.00$/, ""))).size === 1);
    const found = exact.filter((rows) => rows.some((r) => skip.has(r.id)));
    expect(found.length / Math.max(1, exact.length)).toBeGreaterThanOrEqual(0.6);
  });
});

describe("no child in anything built for a model (D2)", () => {
  const kids = childIdentities(golden.records, cfg);
  const raws = new Map(golden.records.map((r) => [r.id, r]));
  it("finds the children first", () => {
    expect(kids.length).toBeGreaterThanOrEqual(10);
  });
  it("every row, masked", () => {
    for (const r of golden.records) assertNoChildLeak(maskForAi(r, cfg), kids);
  });
  it("every question's model input", () => {
    for (const g of res.groups) assertNoChildLeak(modelInputForGroup(g, raws, cfg), kids);
  });
  it("the helper really fails when a child's name is let through", () => {
    const first = kids.find((k) => k.first.length > 2)!;
    expect(() => assertNoChildLeak({ note: `ask about ${first.first}` }, kids)).toThrow();
  });
});

describe("remembered answers", () => {
  const rules: DecisionRule[] = [];
  for (const g of res.groups.filter((x) => x.tier === "C")) {
    for (const item of g.items) {
      const made = ruleFromAnswer({ group: g, answer: g.question.recommended, decidedBy: "user-1", decidedAt: "2026-10-12T09:00:00.000Z", sample: item });
      if (made.ok) rules.push(made.rule);
    }
  }
  const second = resolveRecords({ records: golden.records, config: cfg, rules });

  it("a second pull of the same rows asks nothing it already knows", () => {
    expect(rules.length).toBeGreaterThan(0);
    expect(second.groups.filter((g) => g.tier === "C")).toEqual([]);
    expect(second.metrics.asked).toBe(0);
    expect(second.metrics.learned).toBeGreaterThan(0);
    expect(second.metrics.withoutPersonShare).toBeGreaterThan(res.metrics.withoutPersonShare);
  });
  it("never touches a held row", () => {
    const held = (r: ResolveResult) => r.dispositions.filter((d) => d.status === "held").map((d) => d.id).sort();
    expect(held(second)).toEqual(held(res));
    expect(second.answeredByRules.every((a) => !second.items.find((i) => i.key === a.itemKey && i.tier === "D"))).toBe(true);
    expect(second.groups.filter((g) => g.tier === "D").map((g) => g.signature).sort()).toEqual(res.groups.filter((g) => g.tier === "D").map((g) => g.signature).sort());
  });
});

describe("the engine is deterministic and storable", () => {
  it("gives the same result for the same rows, and the result is plain JSON", () => {
    const again = resolveRecords({ records: buildGolden({ rows: 300, seed: 1 }).records, config: cfg });
    expect(again.metrics).toEqual(res.metrics);
    expect(again.pairs.map((p) => `${p.a}~${p.b}:${p.tier}`)).toEqual(res.pairs.map((p) => `${p.a}~${p.b}:${p.tier}`));
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });
});

describe("other files from the same generator", () => {
  // The share resolved automatically moves from file to file (78% to 83% over these seeds, 76% to 83% over ten). Precision does
  // not move: no wrong automatic link in any of them.
  const shares: number[] = [];
  for (const seed of [2, 3, 4, 5, 6]) {
    it(`seed ${seed}: no wrong automatic link, and mostly automatic`, () => {
      const g = buildGolden({ rows: 300, seed });
      const r = resolveRecords({ records: g.records, config: configFor(g) });
      const a = r.pairs.filter((p) => p.tier === "A");
      expect(1 - a.filter((p) => !correct(g, p)).length / a.length, `seed ${seed}`).toBeGreaterThanOrEqual(0.995);
      expect(r.metrics.autoShare, `seed ${seed}`).toBeGreaterThanOrEqual(0.75);
      shares.push(r.metrics.autoShare);
    });
  }
  it("on average, about 80% is resolved automatically", () => {
    const all = [...shares, res.metrics.autoShare];
    expect(all).toHaveLength(6);
    expect(all.reduce((n, x) => n + x, 0) / all.length).toBeGreaterThanOrEqual(0.79);
  });
});

describe("at 1,000 rows the question budget holds", () => {
  const g = buildGolden({ rows: 1000, seed: 7 });
  const r = resolveRecords({ records: g.records, config: configFor(g) });
  it("asks at most 10 questions per 1,000 rows", () => {
    expect(g.records).toHaveLength(1000);
    expect(r.budget.questions).toBeLessThanOrEqual(10);
    expect(r.metrics.questionsPer1000).toBeLessThanOrEqual(10);
    expect(r.metrics.withinQuestionTarget).toBe(true);
  });
  it("estimates the person's time from its own assumptions (the 10-minute target is reported, not promised)", () => {
    // 30 s a question, 2 s a bulk row, 30 s a held gift, 1 s any other held row (config.budget).
    const c = cfg.budget;
    const heldMoney = r.groups.filter((x) => x.tier === "D" && x.question.routeTo === "treasurer").reduce((n, x) => n + x.items.length, 0);
    const heldOther = r.groups.filter((x) => x.tier === "D" && x.question.routeTo !== "treasurer").reduce((n, x) => n + x.items.length, 0);
    const seconds = r.metrics.questions * c.secondsPerQuestion + r.metrics.bulk * c.secondsPerBulkRow + heldMoney * c.secondsPerHeldMoneyItem + heldOther * c.secondsPerHeldOtherItem;
    expect(r.metrics.minutes).toBeCloseTo(seconds / 60, 1);
    expect(r.metrics.minutesPer1000).toBeGreaterThan(0);
    expect(r.metrics.minutesPer1000).toBeLessThanOrEqual(15);
  });
  it("is still accurate and mostly automatic", () => {
    const a = r.pairs.filter((p) => p.tier === "A");
    expect(a.length).toBeGreaterThan(500);
    expect(1 - a.filter((p) => !correct(g, p)).length / a.length).toBeGreaterThanOrEqual(0.995);
    expect(r.metrics.autoShare).toBeGreaterThanOrEqual(0.8);
  });
  it("many items, few questions", () => {
    expect(r.metrics.itemsInQuestions).toBeGreaterThan(r.metrics.questions * 5);
  });
});
